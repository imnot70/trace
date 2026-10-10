import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

/** FR-2.6.6 扩展：noteGetInfo 统计口径（大小 / 行数 / 非空白字符数 / 绝对路径） */
import { FsTreeService } from '../src/main/services/fsTree'
import { TrashService } from '../src/main/services/trash'

let tmp: string

function buildFsTree(vaultDir: string): FsTreeService {
  const trash = new TrashService(() => path.join(tmp, 'ws'), () => 0)
  return new FsTreeService(() => vaultDir, trash)
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-note-info-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('noteGetInfo（FR-2.6.6 扩展）', () => {
  it('返回时间 / 大小 / 行数 / 非空白字符数 / 绝对路径', () => {
    const vaultDir = path.join(tmp, 'vault')
    fs.mkdirSync(vaultDir, { recursive: true })
    // 行数按 \n 计（尾随换行也占一行口径：4 段 = 4 行）；字符数不含空白（#标题 3 + helloworld 10 = 13）
    const content = '# 标 题\n\nhello world\n'
    fs.writeFileSync(path.join(vaultDir, 'a.md'), content, 'utf8')

    const r = buildFsTree(vaultDir).noteGetInfo('v', 'a.md')
    expect(r.ok).toBe(true)
    expect(r.info).toBeDefined()
    const info = r.info!
    expect(info.lines).toBe(4)
    expect(info.chars).toBe(13)
    expect(info.size).toBe(Buffer.byteLength(content, 'utf8'))
    expect(path.resolve(info.absPath)).toBe(path.resolve(path.join(vaultDir, 'a.md')))
    expect(Number.isNaN(Date.parse(info.birthtime))).toBe(false)
    expect(Number.isNaN(Date.parse(info.mtime))).toBe(false)
  })

  it('含 frontmatter 的笔记按整文件统计（与编辑器行号同口径）', () => {
    const vaultDir = path.join(tmp, 'vault')
    fs.mkdirSync(vaultDir, { recursive: true })
    const content = '---\ntags: [x]\n---\n\n正文\n'
    fs.writeFileSync(path.join(vaultDir, 'b.md'), content, 'utf8')

    const r = buildFsTree(vaultDir).noteGetInfo('v', 'b.md')
    expect(r.ok).toBe(true)
    // 6 段 = 6 行；非空白字符：'---'×2=6 + 'tags:[x]'=8 + '正文'=2 → 16
    expect(r.info!.lines).toBe(6)
    expect(r.info!.chars).toBe(16)
  })

  it('文件不存在返回 ok: false', () => {
    const vaultDir = path.join(tmp, 'vault')
    fs.mkdirSync(vaultDir, { recursive: true })
    const r = buildFsTree(vaultDir).noteGetInfo('v', 'missing.md')
    expect(r.ok).toBe(false)
    expect(r.info).toBeUndefined()
  })
})
