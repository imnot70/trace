import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { errMessage } from '../lib/errMessage'
import { resolveWithin } from '../lib/paths'
import { logger } from '../lib/logger'
import type { GitStatus } from '@shared/types'

export interface GitDeps {
  /** 提交作者身份（登录用户名或默认值） */
  getCommitter: () => { name: string; email: string }
  /** GitHub PAT，用于给 github.com 的远程注入认证头 */
  getToken: () => string | null
  /** Git 同步的 HTTP/HTTPS 代理地址（空 = 不使用） */
  getProxyUrl: () => string
  /**
   * 内置 git 可执行文件路径（FR-2.8.13）。
   * 返回 null/未提供 = 使用系统 PATH 中的 git。
   */
  getGitBinary?: () => string | null
}

export interface SyncOutcome {
  ok: boolean
  error?: string
  conflicts?: string[]
}

/** 冲突文件内容（三方对比） */
export interface ConflictContent {
  /** 本地版本（ours） */
  ours: string
  /** 远端版本（theirs） */
  theirs: string
  /** 共同祖先版本（base） */
  base: string
  /** 当前工作区内容（可能包含冲突标记） */
  current: string
}

/** 冲突解决方式 */
export type ConflictResolution =
  | { type: 'ours' } // 接受本地版本
  | { type: 'theirs' } // 接受远端版本
  | { type: 'manual'; content: string } // 手动编辑的内容

/**
 * Git 同步服务：每个笔记库 = 一个 git 仓库。
 * 同步语义：fetch → rebase 拉取 → add -A + commit → push。
 * Token 通过每次调用的 http.extraheader 注入，绝不写入 .git/config。
 */
export class GitService {
  /** 按库串行化同步：手动同步与 autoSync 定时器可能并发触发同一仓库，并发会撞 .git/index.lock */
  private syncQueues = new Map<string, Promise<SyncOutcome>>()

  constructor(private deps: GitDeps) {}

  /** 是否已初始化为 git 仓库。直接检查 .git，避免依赖 checkIsRepo 的英文错误匹配（中文 locale 下会误抛异常） */
  isRepo(vaultPath: string): boolean {
    return fs.existsSync(path.join(vaultPath, '.git'))
  }

  /**
   * 构造 simple-git 选项。
   *
   * 内置 git 时附加 `binary`；同时必须打开 `unsafe.allowUnsafeCustomBinary`：
   * simple-git 对 `binary` 做字符白名单校验（`/^([a-z]:)?([a-z0-9/.\\_~-]+)$/i`），
   * 不含空格与非 ASCII——安装在 `C:\Program Files\…` 或中文用户名路径下会被拒绝。
   * 该路径来自 `process.resourcesPath`（应用自身、非用户输入），放行是安全的。
   */
  private gitOptions(vaultPath: string, config: string[], timeoutMs: number) {
    const base = { baseDir: vaultPath, config, timeout: { block: timeoutMs } }
    const binary = this.deps.getGitBinary?.() ?? null
    if (!binary) return base
    return { ...base, binary, unsafe: { allowUnsafeCustomBinary: true } }
  }

  private git(vaultPath: string): SimpleGit {
    const { name, email } = this.deps.getCommitter()
    // simple-git 的 config 选项会自动为每一项加上 -c 前缀
    // autocrlf=false：笔记内容由应用逐字节管理（hash 防覆盖比对），git 不得转换行尾
    const config = ['core.quotepath=false', 'core.autocrlf=false', `user.name=${name}`, `user.email=${email}`]
    const token = this.deps.getToken()
    if (token) {
      const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
      config.push(`http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`)
    }
    // 代理与令牌同策略：每次调用以 -c 注入，不写入 .git/config
    const proxyUrl = this.deps.getProxyUrl().trim()
    if (proxyUrl) {
      config.push(`http.proxy=${proxyUrl}`, `https.proxy=${proxyUrl}`)
    }
    // 阻塞超时 60s：网络不通（无法访问 GitHub）时 git 会长时间挂起，
    // 同步按钮会无限转圈；本地操作（提交/状态）远用不到这么久
    return simpleGit(this.gitOptions(vaultPath, config, 60_000))
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
      if (!this.isRepo(vaultPath)) return base
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
    if (!this.isRepo(vaultPath)) {
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
   * 同步（按库排队）：同一仓库的并发同步请求串行执行，后到者等前一轮完成后再跑，
   * 避免「提交 → rebase → push」中间态被另一轮同步踩进去（实测会撞 .git/index.lock）。
   */
  async sync(vaultPath: string): Promise<SyncOutcome> {
    const prev = this.syncQueues.get(vaultPath) ?? Promise.resolve()
    const task = prev.catch(() => {}).then(() => this.doSync(vaultPath))
    this.syncQueues.set(vaultPath, task)
    try {
      return await task
    } finally {
      if (this.syncQueues.get(vaultPath) === task) this.syncQueues.delete(vaultPath)
    }
  }

  /**
   * 同步：fetch → 提交本地变更 → rebase 拉取远端 → push。
   * 先提交再拉取，冲突时 rebase 以非零退出并可用 --abort 干净回退；
   * 不使用 --autostash（stash 恢复冲突时退出码为 0，会静默产生冲突文件）。
   */
  private async doSync(vaultPath: string): Promise<SyncOutcome> {
    const git = this.git(vaultPath)
    if (!this.isRepo(vaultPath)) return { ok: false, error: '该笔记库尚未初始化 git 仓库' }
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
            // 保留rebase状态，让用户在应用内解决冲突
            logger.warn('同步冲突，等待用户解决', e)
            return { ok: false, error: '同步存在冲突，请解决冲突后继续', conflicts }
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

  /**
   * 获取当前冲突文件列表（rebase进行中时调用）
   */
  async getConflictFiles(vaultPath: string): Promise<string[]> {
    const git = this.git(vaultPath)
    if (!this.isRepo(vaultPath)) return []
    return this.conflictedFiles(git)
  }

  /**
   * 获取冲突文件的三方内容（ours/theirs/base）
   */
  async getConflictContent(vaultPath: string, filePath: string): Promise<ConflictContent | null> {
    const git = this.git(vaultPath)
    if (!this.isRepo(vaultPath)) return null

    try {
      // 获取当前工作区内容（包含冲突标记）
      const current = await git.raw(['show', `:${filePath}`])

      // 获取ours版本（本地）
      let ours = ''
      try {
        ours = await git.raw(['show', `HEAD:${filePath}`])
      } catch {
        // 文件在HEAD中不存在（新文件）
        ours = ''
      }

      // 获取theirs版本（远端）
      let theirs = ''
      try {
        theirs = await git.raw(['show', `MERGE_HEAD:${filePath}`])
      } catch {
        // 文件在MERGE_HEAD中不存在
        theirs = ''
      }

      // 获取base版本（共同祖先）
      let base = ''
      try {
        base = await git.raw(['show', `MERGE_BASE:${filePath}`])
      } catch {
        // 无法获取共同祖先
        base = ''
      }

      return { ours, theirs, base, current }
    } catch (e) {
      logger.warn('获取冲突内容失败', e)
      return null
    }
  }

  /**
   * 解决单个文件的冲突
   */
  async resolveConflict(
    vaultPath: string,
    filePath: string,
    resolution: ConflictResolution
  ): Promise<boolean> {
    const git = this.git(vaultPath)
    if (!this.isRepo(vaultPath)) return false

    try {
      // 路径守卫：filePath 来自渲染端 IPC，必须落在库内（防 ../ 越权写盘），放行后供下方 git 操作复用
      resolveWithin(vaultPath, filePath)
      let content: string
      switch (resolution.type) {
        case 'ours':
          content = (await this.getConflictContent(vaultPath, filePath))?.ours ?? ''
          break
        case 'theirs':
          content = (await this.getConflictContent(vaultPath, filePath))?.theirs ?? ''
          break
        case 'manual':
          content = resolution.content
          break
      }

      // 写入解决后的内容
      const fullPath = path.join(vaultPath, filePath)
      await fs.promises.writeFile(fullPath, content, 'utf-8')

      // 标记为已解决
      await git.add(filePath)
      return true
    } catch (e) {
      logger.warn('解决冲突失败', e)
      return false
    }
  }

  /**
   * 继续rebase（所有冲突解决后调用）
   */
  async continueRebase(vaultPath: string): Promise<SyncOutcome> {
    const git = this.git(vaultPath)
    if (!this.isRepo(vaultPath)) return { ok: false, error: '该笔记库尚未初始化 git 仓库' }

    try {
      // 检查是否还有未解决的冲突
      const conflicts = await this.conflictedFiles(git)
      if (conflicts.length > 0) {
        return { ok: false, error: '仍有未解决的冲突文件', conflicts }
      }

      // 继续rebase
      await git.raw(['-c', 'core.editor=true', 'rebase', '--continue'])

      // 推送（如果需要）
      const branch = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      const remoteRef = `origin/${branch}`
      const hasRemoteRef = await this.refExists(git, remoteRef)
      if (hasRemoteRef) {
        const ab = await this.aheadBehind(git, remoteRef)
        if (ab && ab.ahead > 0) {
          await git.push(['-u', 'origin', branch])
        }
      }

      return { ok: true }
    } catch (e) {
      logger.warn('继续rebase失败', e)
      return { ok: false, error: errMessage(e) }
    }
  }

  /**
   * 中止rebase（公开方法，供IPC调用）
   */
  async abortRebaseOperation(vaultPath: string): Promise<boolean> {
    const git = this.git(vaultPath)
    if (!this.isRepo(vaultPath)) return false

    try {
      await this.abortRebase(git)
      return true
    } catch {
      return false
    }
  }

  /**
   * 代理连通性测试：经（可选）代理访问 github.com 列出引用——轻量请求，不涉及任何仓库。
   * 失败时抛出原始错误，由 IPC 层的 errMessage 转为友好文案。
   */
  async testProxy(timeoutMs = 15_000): Promise<SyncOutcome> {
    const proxyUrl = this.deps.getProxyUrl().trim()
    const git = simpleGit(
      this.gitOptions(
        os.tmpdir(),
        proxyUrl ? [`http.proxy=${proxyUrl}`, `https.proxy=${proxyUrl}`] : [],
        timeoutMs
      )
    )
    await git.raw(['ls-remote', 'https://github.com/git/git.git', 'HEAD'])
    return { ok: true }
  }
}

/** 从远程 URL 解析 owner/repo（支持 https 与 ssh 形式） */
export function parseRepoFullName(url: string): string | null {
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?\/?$/)
  return m ? m[1] : null
}
