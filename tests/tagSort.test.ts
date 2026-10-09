import { describe, expect, it } from 'vitest'
import { sortTags, tagStatIndex } from '../src/renderer/src/composables/tagSort'
import type { TagStatInfo } from '../src/shared/types'

/** FR-2.6.16 排序口径：默认序 / 笔记数 / 最近使用，并列时中文名兜底 */
describe('tagSort（FR-2.6.16）', () => {
  const tags = [
    { id: '1', name: '工作' },
    { id: '2', name: '随笔' },
    { id: '3', name: 'arch' }
  ]
  const stats: TagStatInfo[] = [
    { name: '工作', count: 3, lastUsed: 300 },
    { name: '随笔', count: 1, lastUsed: 900 },
    { name: 'ARCH', count: 3, lastUsed: 100 }
  ]

  it('default 保持定义创建序（现状不变）', () => {
    expect(sortTags(tags, 'default', new Map()).map((t) => t.id)).toEqual(['1', '2', '3'])
  })

  it('count 按笔记数降序，缺失统计视同 0，并列按名称', () => {
    const idx = tagStatIndex(stats)
    // 大小写不敏感匹配：arch ↔ ARCH
    expect(idx.get('arch')?.count).toBe(3)
    const sorted = sortTags(tags, 'count', idx).map((t) => t.name)
    // 工作(3) 与 arch(3) 并列 → 中文名 localeCompare 兜底
    expect(sorted[0]).toBe('工作')
    // 无统计的标签排最后（视同 0）
    const empty = sortTags([{ name: 'z' }, { name: 'a' }], 'count', idx).map((t) => t.name)
    expect(empty).toEqual(['a', 'z'])
  })

  it('recent 按最近使用降序', () => {
    const sorted = sortTags(tags, 'recent', tagStatIndex(stats)).map((t) => t.name)
    expect(sorted[0]).toBe('随笔') // lastUsed 900 最大
    expect(sorted[1]).toBe('工作') // 300
  })

  it('入参数组不被原地修改', () => {
    const copy = [...tags]
    sortTags(tags, 'count', tagStatIndex(stats))
    expect(tags).toEqual(copy)
  })
})
