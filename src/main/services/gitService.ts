import { simpleGit, type SimpleGit } from 'simple-git'
import { logger } from '../lib/logger'
import type { GitStatus } from '@shared/types'

export interface GitDeps {
  /** 提交作者身份（登录用户名或默认值） */
  getCommitter: () => { name: string; email: string }
  /** GitHub PAT，用于给 github.com 的远程注入认证头 */
  getToken: () => string | null
}

export interface SyncOutcome {
  ok: boolean
  error?: string
  conflicts?: string[]
}

/**
 * Git 同步服务：每个笔记库 = 一个 git 仓库。
 * 同步语义：fetch → rebase 拉取 → add -A + commit → push。
 * Token 通过每次调用的 http.extraheader 注入，绝不写入 .git/config。
 */
export class GitService {
  constructor(private deps: GitDeps) {}

  isRepo(vaultPath: string): Promise<boolean> {
    return simpleGit(vaultPath).checkIsRepo().catch(() => false)
  }

  private git(vaultPath: string): SimpleGit {
    const { name, email } = this.deps.getCommitter()
    // simple-git 的 config 选项会自动为每一项加上 -c 前缀
    const config = ['core.quotepath=false', `user.name=${name}`, `user.email=${email}`]
    const token = this.deps.getToken()
    if (token) {
      const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
      config.push(`http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`)
    }
    return simpleGit({ baseDir: vaultPath, config })
  }

  /** 本地状态（不访问网络，用于界面展示） */
  async status(vaultPath: string): Promise<GitStatus> {
    const base: GitStatus = {
      associated: false,
      repoFullName: null,
      remoteUrl: null,
      branch: null,
      ahead: 0,
      behind: 0,
      dirty: false
    }
    try {
      const git = this.git(vaultPath)
      if (!(await git.checkIsRepo())) return base
      const origin = (await git.getRemotes(true)).find((r) => r.name === 'origin')
      const remoteUrl = origin?.refs?.fetch ?? null
      let branch: string | null = null
      try {
        const current = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
        if (current && current !== 'HEAD') branch = current
      } catch {
        // unborn HEAD
      }
      const dirty = !(await git.status()).isClean()
      let ahead = 0
      let behind = 0
      if (branch) {
        const ab = await this.aheadBehind(git, `origin/${branch}`)
        if (ab) {
          ahead = ab.ahead
          behind = ab.behind
        }
      }
      return {
        associated: !!remoteUrl,
        repoFullName: remoteUrl ? parseRepoFullName(remoteUrl) : null,
        remoteUrl,
        branch,
        ahead,
        behind,
        dirty
      }
    } catch (e) {
      logger.warn('读取 git 状态失败', e)
      return base
    }
  }

  /** 关联远程仓库并完成首次同步（远端有内容则拉取，否则推送本地内容） */
  async associate(vaultPath: string, remoteUrl: string): Promise<SyncOutcome> {
    const git = this.git(vaultPath)
    if (!(await this.isRepo(vaultPath))) {
      try {
        await git.init(['--initial-branch=main'])
      } catch {
        await git.init()
      }
    }
    const origin = (await git.getRemotes(true)).find((r) => r.name === 'origin')
    if (!origin) await git.addRemote('origin', remoteUrl)
    else if (origin.refs?.fetch !== remoteUrl) await git.remote(['set-url', 'origin', remoteUrl])
    return this.sync(vaultPath)
  }

  /** 解除关联（保留本地历史与提交） */
  async disconnect(vaultPath: string): Promise<SyncOutcome> {
    const git = this.git(vaultPath)
    await git.removeRemote('origin')
    return { ok: true }
  }

  /**
   * 同步：fetch → 提交本地变更 → rebase 拉取远端 → push。
   * 先提交再拉取，冲突时 rebase 以非零退出并可用 --abort 干净回退；
   * 不使用 --autostash（stash 恢复冲突时退出码为 0，会静默产生冲突文件）。
   */
  async sync(vaultPath: string): Promise<SyncOutcome> {
    const git = this.git(vaultPath)
    if (!(await this.isRepo(vaultPath))) return { ok: false, error: '该笔记库尚未初始化 git 仓库' }
    const remotes = await git.getRemotes(true)
    if (!remotes.some((r) => r.name === 'origin')) return { ok: false, error: '尚未关联远程仓库' }

    await git.fetch(['origin', '--prune'])

    const remoteDefault = await this.remoteDefaultBranch(git)
    let branch = remoteDefault ?? 'main'
    let unborn = true
    try {
      const current = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      if (current && current !== 'HEAD') {
        branch = current
        unborn = false
      }
    } catch {
      // 尚无任何提交（unborn HEAD）
    }
    const remoteRef = `origin/${branch}`
    const hasRemoteRef = await this.refExists(git, remoteRef)

    // 1. 提交本地全部变更
    if (!(await git.status()).isClean()) {
      await git.add(['-A'])
      if ((await git.diff(['--cached', '--name-only'])).trim()) {
        await git.commit(`Trace 同步 ${new Date().toLocaleString('zh-CN')}`)
      }
    }
    const hasHead = await this.refExists(git, 'HEAD')

    // 2. 集成远端更新
    if (hasRemoteRef && unborn && !hasHead) {
      // 本地还没有任何提交：直接采用远端历史
      await this.adoptRemote(git, branch, remoteRef)
    } else if (hasRemoteRef) {
      const ab = await this.aheadBehind(git, remoteRef)
      if (ab && ab.behind > 0) {
        try {
          await git.pull(['--rebase', 'origin', branch])
        } catch (e) {
          const conflicts = await this.conflictedFiles(git)
          if (conflicts.length > 0) {
            await this.abortRebase(git)
            logger.warn('同步冲突', e)
            return { ok: false, error: '同步存在冲突，已中止自动同步，请手动处理冲突文件', conflicts }
          }
          throw e
        }
      }
    }

    // 3. 推送
    const ab = hasRemoteRef ? await this.aheadBehind(git, remoteRef) : null
    const ahead = ab?.ahead ?? 0
    if (hasHead && (!hasRemoteRef || ahead > 0)) {
      await git.push(['-u', 'origin', branch])
    }
    return { ok: true }
  }

  private async adoptRemote(git: SimpleGit, branch: string, remoteRef: string): Promise<void> {
    try {
      await git.raw(['checkout', '-B', branch, remoteRef])
    } catch {
      await git.raw(['reset', '--hard', remoteRef])
    }
    try {
      await git.raw(['branch', '--set-upstream-to', remoteRef, branch])
    } catch {
      /* 部分场景下 -u push 时会再次设置，忽略 */
    }
  }

  private async aheadBehind(git: SimpleGit, remoteRef: string): Promise<{ ahead: number; behind: number } | null> {
    try {
      const out = await git.raw(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`])
      const [ahead, behind] = out.trim().split(/\s+/).map(Number)
      return { ahead: ahead || 0, behind: behind || 0 }
    } catch {
      return null
    }
  }

  private async refExists(git: SimpleGit, ref: string): Promise<boolean> {
    // 注意不要用 --quiet：simple-git 依据 stderr 判定失败，静默退出会被误判为成功
    try {
      await git.raw(['rev-parse', '--verify', ref])
      return true
    } catch {
      return false
    }
  }

  private async remoteDefaultBranch(git: SimpleGit): Promise<string | null> {
    try {
      const out = await git.raw(['ls-remote', '--symref', 'origin', 'HEAD'])
      const m = out.match(/ref: refs\/heads\/(\S+)\s+HEAD/)
      return m ? m[1] : null
    } catch {
      return null
    }
  }

  private async conflictedFiles(git: SimpleGit): Promise<string[]> {
    try {
      const out = await git.raw(['diff', '--name-only', '--diff-filter=U'])
      return out.split('\n').map((s) => s.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  private async abortRebase(git: SimpleGit): Promise<void> {
    try {
      await git.rebase(['--abort'])
    } catch (e) {
      logger.error('中止 rebase 失败，请手动执行 git rebase --abort', e)
    }
  }
}

/** 从远程 URL 解析 owner/repo（支持 https 与 ssh 形式） */
export function parseRepoFullName(url: string): string | null {
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?\/?$/)
  return m ? m[1] : null
}
