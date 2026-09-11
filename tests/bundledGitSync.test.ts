import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitService } from '../src/main/services/gitService'
import { bundledGitCandidates } from '../src/main/services/bundledGit'

/**
 * 用**内置 Git**（vendor/git/<platform>/）跑真实同步链路，验证：
 *  1. 解压出来的二进制可被 simple-git 调用（含 unsafe.allowUnsafeCustomBinary 放行）
 *  2. init / add / commit / push 等真实操作可用（即 FR-2.8.5 的同步语义走得通）
 *
 * vendor/ 不入库、由 `npm run fetch:git` 生成，因此未生成时整组跳过——
 * 保证不装内置 Git 的环境（如仅跑单测的 CI）不会因此失败。
 *
 * 路径关系：打包产物为 `<resources>/git/<candidate>`（electron-builder 把
 * `vendor/git/<platform>` 映射为 `resources/git`），故这里用同一份候选列表
 * 在 `vendor/git/<platform>` 下定位，等价于运行时的 resolveBundledGitPath。
 */
const vendorPlatformDir = path.join(process.cwd(), 'vendor', 'git', process.platform)
const bundledPath =
  bundledGitCandidates()
    .map((rel) => path.join(vendorPlatformDir, rel))
    .find((candidate) => fs.existsSync(candidate)) ?? null

/** 用内置 git 构造 simpleGit，参数与 GitService 内部保持一致 */
function bundledGit(baseDir: string) {
  return simpleGit({
    baseDir,
    config: ['core.quotepath=false', 'core.autocrlf=false'],
    binary: bundledPath as string,
    unsafe: { allowUnsafeCustomBinary: true }
  })
}

describe.skipIf(!bundledPath)('GitService + 内置 Git（真实同步）', () => {
  let tmp: string
  let git: GitService

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-bundled-sync-'))
    git = new GitService({
      getCommitter: () => ({ name: 'tester', email: 'tester@example.com' }),
      getToken: () => null,
      getProxyUrl: () => '',
      getGitBinary: () => bundledPath
    })
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it(
    '关联空远端并推送：远端出现本地笔记',
    async () => {
      const bare = path.join(tmp, 'remote.git')
      fs.mkdirSync(bare, { recursive: true })
      await bundledGit(bare).init(true, ['--initial-branch=main'])

      const vault = path.join(tmp, 'v1')
      fs.mkdirSync(vault)
      fs.writeFileSync(path.join(vault, '笔记.md'), '# 你好\n', 'utf-8')

      const result = await git.associate(vault, bare)
      expect(result.ok).toBe(true)

      const files = (await bundledGit(bare).raw(['ls-tree', '-r', '--name-only', 'main'])).trim()
      expect(files).toContain('笔记.md')
    },
    30_000
  )

  it(
    '内置 Git 可读取仓库状态（isRepo / status 不抛异常）',
    async () => {
      const vault = path.join(tmp, 'v2')
      fs.mkdirSync(vault)
      fs.writeFileSync(path.join(vault, 'a.md'), 'x\n', 'utf-8')
      await bundledGit(vault).init(['--initial-branch=main'])

      expect(git.isRepo(vault)).toBe(true)
      const status = await git.status(vault)
      expect(status.dirty).toBe(true)
    },
    30_000
  )
})
