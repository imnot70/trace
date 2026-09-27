/**
 * 标签柔和色板（FR-2.6.14）：新建标签自动配色的单一数据源。
 * 使用方：侧栏「+」新建、打标签弹窗内联新建（FR-2.6.12）、
 * 主进程未登记 frontmatter 标签的自动注册（services/tags.ts）——三处同一取色逻辑。
 */
export const TAG_PALETTE = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c', '#95a5a6']

/** 按名称哈希从色板取色：同名标签颜色稳定，不随创建顺序漂移 */
export function pickTagColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return TAG_PALETTE[hash % TAG_PALETTE.length]
}
