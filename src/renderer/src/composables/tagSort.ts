import type { TagStatInfo } from '@shared/types'

/**
 * 标签排序口径单一来源（FR-2.6.16）：侧栏标签区与打标签弹窗共用同一组模式定义、
 * 持久化键与比较逻辑，保证两处排序永远一致。
 * - default：定义创建序（引入排序功能前的既有行为，保持默认）；
 * - count：按笔记数降序（统计缺失视同 0）；
 * - recent：按最近使用降序（携带该标签的笔记最大 mtime；统计缺失视同 0，排最后）。
 */

export type TagSortMode = 'default' | 'count' | 'recent'

export const TAG_SORT_MODES: { value: TagSortMode; label: string }[] = [
  { value: 'default', label: '默认排序' },
  { value: 'count', label: '按笔记数' },
  { value: 'recent', label: '按最近使用' }
]

const STORAGE_KEY = 'trace.tagSort'

export function loadTagSortMode(): TagSortMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'count' || raw === 'recent' ? raw : 'default'
}

export function saveTagSortMode(mode: TagSortMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}

/** 统计索引：标签名（小写）→ 统计行。排序前构建一次，避免逐项线性查找 */
export function tagStatIndex(stats: TagStatInfo[] | undefined | null): Map<string, TagStatInfo> {
  const map = new Map<string, TagStatInfo>()
  for (const s of stats ?? []) map.set(s.name.toLowerCase(), s)
  return map
}

/**
 * 按模式排序（返回新数组，不改入参）。并列时的兜底：中文名称 localeCompare，
 * 保证同计数 / 同时间的标签顺序稳定不抖动。
 */
export function sortTags<T extends { name: string }>(
  tags: T[],
  mode: TagSortMode,
  stats: Map<string, TagStatInfo>
): T[] {
  if (mode === 'default') return [...tags]
  const statOf = (t: T): TagStatInfo | undefined => stats.get(t.name.toLowerCase())
  return [...tags].sort((a, b) => {
    const sa = statOf(a)
    const sb = statOf(b)
    if (mode === 'count') {
      const diff = (sb?.count ?? 0) - (sa?.count ?? 0)
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-Hans-CN')
    }
    const diff = (sb?.lastUsed ?? 0) - (sa?.lastUsed ?? 0)
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}
