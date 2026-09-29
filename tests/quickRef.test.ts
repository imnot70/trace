import { describe, expect, it } from 'vitest'
import {
  referenceInsertSpec,
  flattenVisibleTree,
  locateNote,
  filterDrafts,
  type PickerItem
} from '../src/renderer/src/lib/quickRef'
import type { NoteTreeNode } from '../src/renderer/src/lib/noteCompletion'

describe('两态括号一致性插入 referenceInsertSpec（FR-2.9.12）', () => {
  it('态 A：光标前有未闭合 [[ → 从 [[ 起替换，吸收光标后紧邻的 ]]', () => {
    // 用户输入 `[[日记` 后呼出面板引入 `日记/2026-09-29`，光标后有自动闭合的 ]]
    // 「前文 [[日记」共 7 字符，end = 7 + 吸收 2 个 ]
    expect(referenceInsertSpec('前文 [[日记', ']] 后文', '日记/2026-09-29')).toEqual({
      start: 3,
      end: 9,
      insert: '[[日记/2026-09-29]]'
    })
  })

  it('态 A 边界：光标后只有 1 个 ] 或无 ] 时同样正确', () => {
    expect(referenceInsertSpec('[[a', ']', 'x')).toEqual({ start: 0, end: 4, insert: '[[x]]' })
    expect(referenceInsertSpec('[[a', '', 'x')).toEqual({ start: 0, end: 3, insert: '[[x]]' })
    // 只吸收 1 个 ] 后遇到非 ] 停止
    expect(referenceInsertSpec('[[a', ']+', 'x')).toEqual({ start: 0, end: 4, insert: '[[x]]' })
  })

  it('态 B：无 [[ 上下文 → 光标处直接插入完整引用（零宽替换）', () => {
    expect(referenceInsertSpec('正文中间。', '继续', '笔记名')).toEqual({
      start: 5,
      end: 5,
      insert: '[[笔记名]]'
    })
    expect(referenceInsertSpec('', '', 'x')).toEqual({ start: 0, end: 0, insert: '[[x]]' })
  })

  it('已闭合的 [[x]] 不误判为未闭合上下文（\\[^\\]]*$ 口径）', () => {
    // [[done]] 后光标在行尾：最后一个 [[ 已被 ] 闭合，不再构成补全上下文
    // （「[[done]] 引用完」共 12 字符，插入点在行尾）
    expect(referenceInsertSpec('[[done]] 引用完', '', 'x')).toEqual({
      start: 12,
      end: 12,
      insert: '[[x]]'
    })
  })
})

const TREE: NoteTreeNode[] = [
  {
    name: '日记',
    kind: 'dir',
    children: [
      { name: '2026-09-28', kind: 'note' },
      { name: '2026-09-29', kind: 'note' }
    ]
  },
  { name: '.隐藏', kind: 'dir', children: [{ name: 'x', kind: 'note' }] },
  { name: '首页', kind: 'note' }
]

describe('树扁平化 flattenVisibleTree（FR-2.9.12 光标序列）', () => {
  it('仅展开的文件夹可见；隐藏文件（. 开头）跳过；深度递增', () => {
    const none = flattenVisibleTree(TREE, new Set())
    expect(none.map((i) => `${i.kind}:${i.rel}`)).toEqual(['dir:日记', 'note:首页'])

    const all = flattenVisibleTree(TREE, new Set(['日记']))
    expect(all.map((i) => `${i.kind}:${i.rel}`)).toEqual([
      'dir:日记',
      'note:日记/2026-09-28',
      'note:日记/2026-09-29',
      'note:首页'
    ])
    expect(all[1].depth).toBe(1)
    expect(all[3].depth).toBe(0)
  })
})

describe('呼出落位 locateNote（FR-2.9.12 D5）', () => {
  it('返回需展开的祖先目录集合；目标不存在返回 null', () => {
    expect(locateNote(TREE, '日记/2026-09-29')).toEqual({ expand: new Set(['日记']), index: -1 })
    expect(locateNote(TREE, '首页')?.expand).toEqual(new Set())
    expect(locateNote(TREE, '不存在/路径')).toBeNull()
    expect(locateNote(TREE, '日记/无此篇')).toBeNull()
  })
})

describe('草稿过滤 filterDrafts（FR-2.9.12 过滤态）', () => {
  const drafts = [
    { name: '未命名笔记.md', mtime: 1 },
    { name: 'MeetingTodo.md', mtime: 2 }
  ]
  it('空查询返回全部；大小写不敏感包含匹配', () => {
    expect(filterDrafts(drafts, '')).toHaveLength(2)
    expect(filterDrafts(drafts, '未命名')).toEqual([drafts[0]])
    // 大小写不敏感：todo 命中 MeetingTodo.md
    expect(filterDrafts(drafts, 'todo')).toEqual([drafts[1]])
    expect(filterDrafts(drafts, '无')).toEqual([])
  })
})

describe('PickerItem 类型完整性（编译期守卫）', () => {
  it('四种 kind 均可构造', () => {
    const items: PickerItem[] = [
      { kind: 'dir', name: 'd', rel: 'd', depth: 0 },
      { kind: 'note', name: 'n', rel: 'n', depth: 0 },
      { kind: 'draft', name: 'g', rel: 'g', depth: 0, mtime: 1 },
      { kind: 'header', name: 'h', rel: '', depth: 0 }
    ]
    expect(items).toHaveLength(4)
  })
})
