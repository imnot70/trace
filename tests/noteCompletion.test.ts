import { describe, expect, it } from 'vitest'
import { collectNotes, flatNoteOptions, flatCompletionOptions, type NoteTreeNode } from '../src/renderer/src/lib/noteCompletion'

const tree: NoteTreeNode[] = [
  {
    name: 'dir_01',
    kind: 'dir',
    children: [
      { name: '搜索结果', kind: 'note' },
      { name: '子目录', kind: 'dir', children: [{ name: '深层笔记', kind: 'note' }] }
    ]
  },
  { name: 'dir_02', kind: 'dir', children: [{ name: '搜索结果', kind: 'note' }, { name: '笔记B', kind: 'note' }] },
  { name: '首页', kind: 'note' },
  { name: '.隐藏', kind: 'note' }
]

describe('collectNotes', () => {
  it('递归收集全部笔记并携带目录；跳过隐藏项', () => {
    const notes = collectNotes(tree)
    expect(notes.map((n) => n.rel).sort()).toEqual(
      ['dir_01/搜索结果', 'dir_01/子目录/深层笔记', 'dir_02/笔记B', 'dir_02/搜索结果', '首页'].sort()
    )
    expect(notes.find((n) => n.rel === 'dir_01/子目录/深层笔记')?.dir).toBe('dir_01/子目录')
    expect(notes.find((n) => n.rel === '首页')?.dir).toBe('')
    expect(notes.some((n) => n.name === '.隐藏')).toBe(false)
  })
})

describe('flatCompletionOptions', () => {
  it('包含命中的文件夹（label 以 / 结尾、isDir）', () => {
    const opts = flatCompletionOptions(tree, 'dir_01', '首页')
    // 名字或路径含 dir_01 的文件夹：dir_01 本身 + 其子目录（路径包含）
    const dirs = opts.filter((o) => o.isDir).map((o) => o.label)
    expect(dirs).toEqual(['dir_01/', 'dir_01/子目录/'])
    expect(opts.find((o) => o.isDir)?.detail).toBe('文件夹')
  })

  it('空前缀列出根目录文件夹（浏览入口）', () => {
    const opts = flatCompletionOptions(tree, '', '首页')
    const dirs = opts.filter((o) => o.isDir).map((o) => o.label)
    expect(dirs).toEqual(['dir_01/', 'dir_02/'])
  })
})

describe('flatNoteOptions', () => {
  const notes = collectNotes(tree)

  it('叶子名包含命中（评分 1），detail 为所在目录', () => {
    const opts = flatNoteOptions(notes, '搜索', 'dir_02/搜索结果')
    expect(opts.map((o) => o.label).sort()).toEqual(['dir_01/搜索结果'].sort())
    expect(opts[0].detail).toBe('dir_01')
  })

  it('前缀命中排在包含命中之前；同分按路径字典序', () => {
    const t2: NoteTreeNode[] = [
      { name: '笔记', kind: 'note' },
      { name: 'ab', kind: 'dir', children: [{ name: '笔记x', kind: 'note' }] },
      { name: 'aa', kind: 'dir', children: [{ name: '笔记y', kind: 'note' }] }
    ]
    const opts = flatNoteOptions(collectNotes(t2), '笔记', '其他/当前')
    // 「笔记」前缀命中在最前；「笔记y / 笔记x」同为包含命中，按路径 aa < ab
    expect(opts.map((o) => o.label)).toEqual(['笔记', '笔记y', '笔记x'])
  })

  it('路径包含也算命中（评分 2）；无重名用叶子名', () => {
    const opts = flatNoteOptions(notes, 'dir_02', '首页')
    // 「搜索结果」库内同名 2 篇 → label 用完整路径；「笔记B」名字唯一 → 叶子名
    expect(opts.map((o) => o.label).sort()).toEqual(['dir_02/搜索结果', '笔记B'].sort())
  })

  it('库内同名笔记 label 用完整路径消歧', () => {
    const opts = flatNoteOptions(notes, '搜索', '首页')
    // 库内「搜索结果」有两篇（dir_01 / dir_02），排除当前 dir_02 后剩 dir_01 一篇，
    // 但重名判定看全库计数（含自身）>1 → 仍用完整路径
    expect(opts[0].label).toBe('dir_01/搜索结果')
  })

  it('排除当前笔记（自引用）', () => {
    const opts = flatNoteOptions(notes, '首页', '首页')
    expect(opts).toEqual([])
  })

  it('空前缀列出全库笔记并截断到上限', () => {
    const many: NoteTreeNode[] = Array.from({ length: 40 }, (_, i) => ({ name: `n${String(i).padStart(2, '0')}`, kind: 'note' }))
    expect(flatNoteOptions(collectNotes(many), '', 'x').length).toBe(30)
    // 无重名的用叶子名，同名两篇「搜索结果」用完整路径
    expect(flatNoteOptions(collectNotes(tree), '', '首页').map((o) => o.label).sort()).toEqual(
      ['dir_01/搜索结果', 'dir_02/搜索结果', '深层笔记', '笔记B'].sort()
    )
  })
})
