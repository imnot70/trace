import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitService } from '../src/main/services/gitService'

let tmp: string
let git: GitService

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-git-'))
  git = new GitService({
    getCommitter: () => ({ name: 'tester', email: 'tester@example.com' }),
    getToken: () => null
  })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** 创建本地 bare 仓库充当远程 */
function makeBare(name: string): string {
  const bare = path.join(tmp, name)
  fs.mkdirSync(bare, { recursive: true })
  const g = simpleGit(bare)
  g.init(true, ['--initial-branch=main'])
  return bare
}

async function writeFile(vault: string, rel: string, content: string): Promise<void> {
  const abs = path.join(vault, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf-8')
}

describe('GitService（本地 bare 远端）', () => {
  it('关联空远端并推送本地内容', async () => {
    const bare = makeBare('remote.git')
    const vault = path.join(tmp, 'v1')
    fs.mkdirSync(vault)
    await writeFile(vault, '笔记.md', '# 你好\n')

    const result = await git.associate(vault, bare)
    expect(result.ok).toBe(true)

    const status = await git.status(vault)
    expect(status.associated).toBe(true)
    expect(status.dirty).toBe(false)
    // 远端收到了提交
    const remoteHead = await simpleGit(bare).raw(['rev-parse', 'HEAD'])
    expect(remoteHead).toBeTruthy()
  })

  it('远端有内容时本地空库自动采用远端历史', async () => {
    const bare = makeBare('remote.git')
    const v1 = path.join(tmp, 'v1')
    fs.mkdirSync(v1)
    await writeFile(v1, '笔记.md', '# 第一版\n')
    expect((await git.associate(v1, bare)).ok).toBe(true)

    const v2 = path.join(tmp, 'v2')
    fs.mkdirSync(v2)
    expect((await git.associate(v2, bare)).ok).toBe(true)
    expect(fs.readFileSync(path.join(v2, '笔记.md'), 'utf-8')).toBe('# 第一版\n')
  })

  it('双向同步：B 修改推送、A 拉取', async () => {
    const bare = makeBare('remote.git')
    const v1 = path.join(tmp, 'v1')
    const v2 = path.join(tmp, 'v2')
    fs.mkdirSync(v1)
    await writeFile(v1, '笔记.md', 'A\n')
    await git.associate(v1, bare)

    fs.mkdirSync(v2)
    await git.associate(v2, bare)

    await writeFile(v2, '笔记.md', 'B\n')
    expect((await git.sync(v2)).ok).toBe(true)

    expect((await git.sync(v1)).ok).toBe(true)
    expect(fs.readFileSync(path.join(v1, '笔记.md'), 'utf-8')).toBe('B\n')
  })

  it('未提交的本地修改在同步时自动提交', async () => {
    const bare = makeBare('remote.git')
    const v1 = path.join(tmp, 'v1')
    fs.mkdirSync(v1)
    await writeFile(v1, 'a.md', '1\n')
    await git.associate(v1, bare)
    const status1 = await git.status(v1)
    expect(status1.dirty).toBe(false)

    await writeFile(v1, 'a.md', '2\n')
    const status2 = await git.status(v1)
    expect(status2.dirty).toBe(true)

    await git.sync(v1)
    const status3 = await git.status(v1)
    expect(status3.dirty).toBe(false)
    expect(status3.ahead).toBe(0)
  })

  it('同文件分叉时返回冲突且本地内容不被破坏', async () => {
    const bare = makeBare('remote.git')
    const v1 = path.join(tmp, 'v1')
    const v2 = path.join(tmp, 'v2')
    fs.mkdirSync(v1)
    await writeFile(v1, 'f.md', 'base\n')
    await git.associate(v1, bare)

    fs.mkdirSync(v2)
    await git.associate(v2, bare)

    // B 先改并推送
    await writeFile(v2, 'f.md', 'B 的修改\n')
    expect((await git.sync(v2)).ok).toBe(true)
    // A 拉到 B，再改并推送
    expect((await git.sync(v1)).ok).toBe(true)
    await writeFile(v1, 'f.md', 'A 的修改\n')
    expect((await git.sync(v1)).ok).toBe(true)
    // B 基于旧版本改同一文件后同步 → 冲突
    await writeFile(v2, 'f.md', 'B 的新修改\n')
    const result = await git.sync(v2)
    expect(result.ok).toBe(false)
    expect(result.conflicts).toContain('f.md')
    // rebase 已中止，本地工作区内容保持不变
    expect(fs.readFileSync(path.join(v2, 'f.md'), 'utf-8')).toBe('B 的新修改\n')
  })

  it('解除关联保留本地仓库', async () => {
    const bare = makeBare('remote.git')
    const v1 = path.join(tmp, 'v1')
    fs.mkdirSync(v1)
    await writeFile(v1, 'a.md', '1\n')
    await git.associate(v1, bare)

    expect((await git.disconnect(v1)).ok).toBe(true)
    const status = await git.status(v1)
    expect(status.associated).toBe(false)
    // 本地提交仍在
    expect(await git.isRepo(v1)).toBe(true)
  })
})
