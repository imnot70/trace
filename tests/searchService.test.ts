import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { SearchService } from '../src/main/services/search'

/** 搜索服务标签维度（FR-2.9.11）：索引结构化标签、标签过滤、浏览模式、listTags 聚合 */
let tmp: string

function makeVault(name: string, notes: Record<string, string>): string {
  const vaultPath = path.join(tmp, name)
  for (const [rel, content] of Object.entries(notes)) {
    const abs = path.join(vaultPath, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf-8')
  }
  return vaultPath
}

const VA = '库A'
const VB = '库B'

function buildService(): SearchService {
  return new SearchService(
    (v) => path.join(tmp, v),
    () => [VA, VB]
  )
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-search-'))
  makeVault(VA, {
    '工作计划.md': '---\ntags:\n  - 工作\n  - 重要\n---\n# 工作计划正文\n本季度要完成搜索功能\n',
    '随笔.md': '# 随笔\n今天天气不错\n',
    '子目录/购物清单.md': '---\ntags: 生活\n---\n牛奶 鸡蛋 面包\n'
  })
  makeVault(VB, {
    '学习笔记.md': '---\ntags:\n  - 学习\n  - 重要\n---\nCodeMirror 的搜索面板用法\n'
  })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function build(): Promise<SearchService> {
  const svc = buildService()
  await svc.buildIndex(true)
  return svc
}

describe('搜索索引：frontmatter 结构化', () => {
  it('索引项提取 frontmatter 标签', async () => {
    const svc = await build()
    const tags = svc.listTags().map((t) => t.tag)
    expect(tags).toContain('工作')
    expect(tags).toContain('重要')
    expect(tags).toContain('生活')
    expect(tags).toContain('学习')
    const important = svc.listTags().find((t) => t.tag === '重要')
    expect(important?.count).toBe(2)
  })

  it('关键词不再命中 frontmatter 行（掩码保留行号对齐）', async () => {
    const svc = await build()
    // 旧实现里搜 "tags" 会命中 frontmatter 行；掩码后正文无该词则无结果
    const r = svc.search('tags:')
    expect(r.results).toEqual([])
    // 行号仍与源文件对齐：frontmatter 占 5 行，「本季度要完成搜索功能」在第 7 行
    const hit = svc.search('搜索功能')
    expect(hit.results?.[0]?.lineNumber).toBe(7)
  })
})

describe('标签维度过滤', () => {
  it('单标签过滤：只返回打了该标签的笔记', async () => {
    const svc = await build()
    const r = svc.search('牛奶', undefined, { tags: ['生活'] })
    expect(r.results?.length).toBeGreaterThan(0)
    expect(r.results?.every((x) => x.path === '子目录/购物清单.md')).toBe(true)
  })

  it('多标签 OR：命中任一标签即入围', async () => {
    const svc = await build()
    const r = svc.search('', undefined, { tags: ['工作', '学习'] })
    const paths = new Set(r.results?.map((x) => x.path))
    expect(paths.has('工作计划.md')).toBe(true)
    expect(paths.has('学习笔记.md')).toBe(true)
    expect(paths.has('随笔.md')).toBe(false)
  })

  it('关键词与标签取交集', async () => {
    const svc = await build()
    // 标签「学习」只有一篇；关键词「搜索」也只命中它——交集为该篇
    const r = svc.search('搜索', undefined, { tags: ['学习'] })
    expect(r.results?.map((x) => x.path)).toEqual(['学习笔记.md'])
  })

  it('空关键词 + 标签 = 浏览模式：每篇一条，按最近修改排序', async () => {
    const svc = await build()
    const r = svc.search('', undefined, { tags: ['重要'] })
    expect(r.results?.length).toBe(2)
    expect(r.results?.every((x) => x.lineNumber === 0)).toBe(true)
    // 排序只做「不抛错、字段完整」的冒烟断言（mtime 由写入顺序近似决定）
    expect(r.results?.every((x) => x.vault && x.title)).toBe(true)
  })

  it('标签与库范围叠加', async () => {
    const svc = await build()
    const r = svc.search('', undefined, { tags: ['重要'], vaults: [VB] })
    expect(r.results?.map((x) => x.path)).toEqual(['学习笔记.md'])
  })

  it('空关键词且无标签仍返回空', async () => {
    const svc = await build()
    expect(svc.search('   ').results).toEqual([])
  })
})

describe('范围与增量维护', () => {
  it('库范围过滤（既有行为不回归）', async () => {
    const svc = await build()
    const r = svc.search('的', undefined, { vaults: [VA] })
    expect(r.results?.every((x) => x.vault === VA)).toBe(true)
  })

  it('updateFileIndex 增量刷新标签', async () => {
    const svc = await build()
    expect(svc.listTags().find((t) => t.tag === '新标签')).toBeUndefined()
    fs.writeFileSync(
      path.join(tmp, VA, '随笔.md'),
      '---\ntags:\n  - 新标签\n---\n随手记\n',
      'utf-8'
    )
    await svc.updateFileIndex(VA, '随笔.md')
    expect(svc.listTags().find((t) => t.tag === '新标签')?.count).toBe(1)
    const r = svc.search('', undefined, { tags: ['新标签'] })
    expect(r.results?.map((x) => x.path)).toEqual(['随笔.md'])
  })

  it('草稿伪库同样参与索引与标签（既有行为不回归）', async () => {
    makeVault('__scratch__', { '未命名笔记.md': '---\ntags: 草稿\n---\n草稿正文\n' })
    const vaults = [VA, VB, '__scratch__']
    // getVaults 由闭包决定，重建一个含草稿库的服务
    const withDraft = new SearchService(
      (v) => path.join(tmp, v),
      () => vaults
    )
    await withDraft.buildIndex(true)
    const r = withDraft.search('草稿正文')
    expect(r.results?.[0]?.vault).toBe('__scratch__')
    expect(withDraft.listTags().find((t) => t.tag === '草稿')?.count).toBe(1)
  })
})
