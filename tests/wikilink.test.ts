import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

/**
 * 双链索引服务单元测试：正向/反向索引、反向链接查询、断链检测、
 * 增量更新、重命名改写索引。在临时目录中模拟笔记库。
 */
import { WikilinkService } from '../src/main/services/wikilink'

let tmp: string
let vaultPath: string
let svc: WikilinkService

function write(name: string, content: string): void {
  fs.writeFileSync(path.join(vaultPath, name), content, 'utf-8')
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-wikilink-'))
  vaultPath = path.join(tmp, '测试库')
  fs.mkdirSync(path.join(vaultPath, '子目录'), { recursive: true })
  svc = new WikilinkService(
    (vault) => (vault === '测试库' ? vaultPath : path.join(tmp, vault)),
    () => ['测试库']
  )
  write('笔记A.md', '# 笔记A\n\n这里引用 [[笔记B]] 和 [[子目录/笔记C]]，还有断链 [[不存在]]。')
  write('笔记B.md', '# 笔记B\n\n反向引用 [[笔记A]]。')
  write(path.join('子目录', '笔记C.md'), '# 笔记C\n\n我也引用 [[笔记A]]。')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('WikilinkService 索引构建', () => {
  it('启动构建：统计文件数与引用数', async () => {
    const stats = await svc.buildIndex(true)
    expect(stats.totalFiles).toBe(3)
    expect(stats.totalLinks).toBe(5)
  })

  it('反向链接：同名与路径形式引用都归属目标笔记', async () => {
    await svc.buildIndex(true)
    const backlinks = svc.getBacklinks('测试库', '笔记A.md')
    // 笔记B（[[笔记A]]）+ 笔记C（[[笔记A]]）
    expect(backlinks.map((r) => r.title).sort()).toEqual(['笔记B', '笔记C'])
    expect(backlinks.every((r) => r.snippet === '[[笔记A]]')).toBe(true)
  })

  it('路径形式引用 [[dir/名]] 计入对「名」的引用且保留原文摘要', async () => {
    await svc.buildIndex(true)
    const backlinks = svc.getBacklinks('测试库', '子目录/笔记C.md')
    expect(backlinks).toHaveLength(1)
    expect(backlinks[0].title).toBe('笔记A')
    expect(backlinks[0].snippet).toBe('[[子目录/笔记C]]')
  })

  it('排除自身引用', async () => {
    write('笔记A.md', '# 笔记A\n\n自指 [[笔记A]]，他人引用 [[笔记B]]。')
    await svc.buildIndex(true)
    // 笔记A 的反向链接 = 笔记B + 笔记C（均含 [[笔记A]]），自身的 `自指 [[笔记A]]` 不计入
    expect(svc.getBacklinks('测试库', '笔记A.md').map((r) => r.title)).toEqual(['笔记B', '笔记C'])
    expect(svc.getBacklinks('测试库', '笔记B.md').map((r) => r.title)).toEqual(['笔记A'])
  })

  it('同一行多个引用不互相覆盖（各自摘要在反向链接中正确）', async () => {
    await svc.buildIndex(true)
    // 笔记A 第 3 行有 3 个引用；查 笔记B 的反向链接应看到 [[笔记B]] 而非同行其他引用
    const backlinks = svc.getBacklinks('测试库', '笔记B.md')
    expect(backlinks).toHaveLength(1)
    expect(backlinks[0].snippet).toBe('[[笔记B]]')
    expect(backlinks[0].line).toBe(3)
  })
})

describe('WikilinkService 断链检测', () => {
  it('未解析引用被列出，路径形式引用不误报', async () => {
    await svc.buildIndex(true)
    const refs = svc.getUnresolvedRefs()
    // 只有 [[不存在]] 是断链；[[笔记B]] / [[笔记A]] / [[子目录/笔记C]] 均可解析
    expect(refs).toHaveLength(1)
    expect(refs[0].targetName).toBe('不存在')
    expect(refs[0].title).toBe('笔记A')
  })

  it('按库过滤断链', async () => {
    // 造第二个库
    const vault2 = path.join(tmp, '库二')
    fs.mkdirSync(vault2)
    fs.writeFileSync(path.join(vault2, '笔记X.md'), '引用 [[另一个断链]]', 'utf-8')
    const multi = new WikilinkService(
      (vault) => (vault === '测试库' ? vaultPath : vault2),
      () => ['测试库', '库二']
    )
    await multi.buildIndex(true)
    expect(multi.getUnresolvedRefs('库二').map((r) => r.targetName)).toEqual(['另一个断链'])
    expect(multi.getUnresolvedRefs('测试库').map((r) => r.targetName)).toEqual(['不存在'])
  })
})

describe('WikilinkService 增量更新', () => {
  it('updateFileIndex：新增文件后反向链接即时可见（无需重建）', async () => {
    await svc.buildIndex(true)
    expect(svc.getBacklinks('测试库', '笔记A.md')).toHaveLength(2)

    write('笔记D.md', '新笔记引用 [[笔记A]]。')
    await svc.updateFileIndex('测试库', '笔记D.md')
    const backlinks = svc.getBacklinks('测试库', '笔记A.md')
    expect(backlinks.map((r) => r.title)).toContain('笔记D')
  })

  it('updateFileIndex：内容修改后以新内容为准', async () => {
    await svc.buildIndex(true)
    write('笔记B.md', '# 笔记B\n\n改引 [[笔记C]] 了。')
    await svc.updateFileIndex('测试库', '笔记B.md')
    expect(svc.getBacklinks('测试库', '笔记A.md').map((r) => r.title)).toEqual(['笔记C'])
  })

  it('updateFileIndex：文件已删除时移出索引', async () => {
    await svc.buildIndex(true)
    fs.rmSync(path.join(vaultPath, '笔记B.md'))
    await svc.updateFileIndex('测试库', '笔记B.md')
    expect(svc.getBacklinks('测试库', '笔记A.md').map((r) => r.title)).toEqual(['笔记C'])
  })

  it('removeFileIndex：直接移除来源笔记的引用', async () => {
    await svc.buildIndex(true)
    svc.removeFileIndex('测试库', '笔记B.md')
    expect(svc.getBacklinks('测试库', '笔记A.md').map((r) => r.title)).toEqual(['笔记C'])
  })
})

describe('WikilinkService 重命名改写索引', () => {
  it('反向索引键与引用详情路径同步迁移，无幽灵条目', async () => {
    await svc.buildIndex(true)
    svc.renameNoteInIndex('测试库', '笔记A.md', '笔记A改.md')

    // 引用旧名的条目（笔记B/笔记C 的 [[笔记A]]）现归属新名
    expect(svc.getBacklinks('测试库', '笔记A.md')).toHaveLength(0)
    const renamed = svc.getBacklinks('测试库', '笔记A改.md')
    expect(renamed.map((r) => r.title).sort()).toEqual(['笔记B', '笔记C'])

    // 迁移后的正向条目能被增量删除正确清理（detailKey 若残留旧路径会变成幽灵反向链接）
    svc.removeFileIndex('测试库', '笔记A改.md')
    expect(svc.getBacklinks('测试库', '笔记B.md')).toHaveLength(0)
    expect(svc.getBacklinks('测试库', '子目录/笔记C.md')).toHaveLength(0)
  })
})
