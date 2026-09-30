import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { treeHasWikiTarget } from '../src/renderer/src/lib/wikiTarget'

const TREE: TreeNode[] = [
  { name: '首页', path: '首页.md', kind: 'note' },
  {
    name: 'dir_01',
    path: 'dir_01',
    kind: 'dir',
    children: [
      { name: '44', path: 'dir_01/44.md', kind: 'note' },
      {
        name: 'dir_01_sub_01',
        path: 'dir_01/dir_01_sub_01',
        kind: 'dir',
        children: [{ name: '深层笔记', path: 'dir_01/dir_01_sub_01/深层笔记.md', kind: 'note' }]
      }
    ]
  },
  {
    name: 'dir_02',
    path: 'dir_02',
    kind: 'dir',
    children: [{ name: 'for_test_02', path: 'dir_02/for_test_02.md', kind: 'note' }]
  }
]

describe('断链判定：所见即所得装饰层口径（含路径形式，2026-09-30 修复）', () => {
  it('叶子名匹配（大小写不敏感）', () => {
    expect(treeHasWikiTarget(TREE, '首页')).toBe(true)
    expect(treeHasWikiTarget(TREE, 'FOR_TEST_02')).toBe(true)
    expect(treeHasWikiTarget(TREE, '不存在的笔记')).toBe(false)
  })

  it('路径形式匹配：与「相对路径去 .md 后缀」比较（修复前误报断链）', () => {
    expect(treeHasWikiTarget(TREE, 'dir_02/for_test_02')).toBe(true)
    expect(treeHasWikiTarget(TREE, 'dir_01/dir_01_sub_01/深层笔记')).toBe(true)
    expect(treeHasWikiTarget(TREE, 'DIR_02/FOR_TEST_02')).toBe(true)
  })

  it('路径形式写错目录 / 写错层级 → 断链', () => {
    expect(treeHasWikiTarget(TREE, 'dir_01/for_test_02')).toBe(false)
    expect(treeHasWikiTarget(TREE, 'for_test_02/for_test_02')).toBe(false)
    expect(treeHasWikiTarget(TREE, 'dir_02/不存在')).toBe(false)
  })
})
