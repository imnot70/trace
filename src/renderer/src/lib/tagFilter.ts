import { useAppStore } from '../stores/app'
import { useTreeStore } from '../stores/tree'
import { pickTagColor } from '@shared/tagPalette'

/**
 * 按标签名跳转标签筛选视图（FR-2.6.18 正文内联标签点击；笔记信息弹窗胶囊 FR-2.6.6 扩展
 * 同逻辑收敛至此）：定义缺失（正文标签尚未被聚合扫描注册）时先创建定义（自动配色，与
 * 打标签内联新建同一色板）；已在标签筛选视图则 toggle 多选（FR-2.6.13 口径），否则新建
 * 单标签筛选。
 */
export async function jumpToTagFilter(name: string): Promise<void> {
  const tree = useTreeStore()
  const app = useAppStore()
  const lower = name.toLowerCase()
  let def = tree.tags.find((t) => t.name.toLowerCase() === lower)
  if (!def) {
    const res = await window.trace.createTag(name, pickTagColor(name))
    if (res.ok && res.tag) {
      def = res.tag
      await tree.loadTags()
    } else {
      // 创建失败最常见于「定义已在主进程侧注册」（正文标签聚合扫描 / 外部工具写入）而
      // 渲染端快照滞后——刷新快照后重查，不能直接放弃
      await tree.loadTags()
      def = tree.tags.find((t) => t.name.toLowerCase() === lower)
      if (!def) return
    }
  }
  const id = def.id
  if (app.view.name === 'grid' && app.view.section === 'tags') {
    const current = app.view.tagIds ?? []
    const next = current.includes(id) ? current.filter((t) => t !== id) : [...current, id]
    app.view = next.length ? { name: 'grid', section: 'tags', tagIds: next } : { name: 'welcome' }
  } else {
    app.view = { name: 'grid', section: 'tags', tagIds: [id] }
  }
}
