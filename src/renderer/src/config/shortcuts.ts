/**
 * 快捷键注册表：设置页「快捷键」速查表的单一数据源。
 * 实际绑定分布在 window keydown（全局键，App.vue）与 CodeMirror keymap（编辑器键，MarkdownEditor.vue），
 * 修改键位时必须同步本表。
 */
export interface ShortcutItem {
  /** 键位显示形式 */
  keys: string
  desc: string
  group: '全局' | '编辑器'
}

export const SHORTCUTS: ShortcutItem[] = [
  { keys: 'Ctrl + S', desc: '保存当前笔记', group: '全局' },
  { keys: 'Alt + P', desc: '呼出 / 收起悬浮预览', group: '全局' },
  { keys: 'Alt + 1 / 2 / 3 / 4', desc: '打开常用 / 收藏 / 回收站 / 笔记库网格（再按一次关闭，回收站仅进入）', group: '全局' },
  { keys: 'Ctrl + ,', desc: '打开设置', group: '全局' },
  { keys: 'Alt + F', desc: '进入 / 退出专注模式', group: '全局' },
  { keys: 'Alt + W', desc: '进入 / 退出心流模式（沉浸创作：隐藏界面 + 所见即所得 + 打字机）', group: '全局' },
  { keys: 'Alt + B', desc: '显示 / 隐藏左侧栏', group: '全局' },
  { keys: 'Alt + V', desc: '显示 / 隐藏预览区', group: '全局' },
  { keys: 'Ctrl + N', desc: '新建笔记（自动定位到当前上下文所在文件夹）', group: '全局' },
  { keys: 'Esc', desc: '分级回退：关闭悬浮预览（[[ 补全保持）→ 收起 [[ 补全 → 退出心流模式 → 返回上级文件夹 → 关闭网格', group: '全局' },
  { keys: '↑ / ↓（搜索结果内）', desc: '在搜索结果间移动高亮', group: '全局' },
  { keys: 'Enter（搜索结果内）', desc: '打开高亮的搜索结果', group: '全局' },
  { keys: 'Alt + Enter（搜索结果内）', desc: '关闭搜索框并以悬浮预览查看高亮结果', group: '全局' },
  { keys: 'Alt + Enter（[[ 补全时）', desc: '悬浮预览选中的笔记（不插入、不切走）；悬浮预览打开时再按 = 插入该笔记的引用', group: '编辑器' },
  { keys: 'Alt + T', desc: '开关打字机模式（高位 / 低位 ↔ 关；再次开启恢复上次形态）', group: '编辑器' },
  { keys: 'Ctrl + Enter', desc: '在当前行下方插入一个空行，光标移到新行行首（补全打开时 = 接受补全）', group: '编辑器' },
  { keys: 'Ctrl + Shift + Enter', desc: '在当前行上方插入一个空行，光标移到新行行首', group: '编辑器' },
  { keys: 'Ctrl + E', desc: '切换源码 / 所见即所得编辑模式（编辑视图内）', group: '编辑器' },
  { keys: 'Ctrl + B', desc: '加粗选中文字（无选中时插入占位符）', group: '编辑器' },
  { keys: 'Ctrl + I', desc: '斜体', group: '编辑器' },
  { keys: 'Ctrl + Shift + X', desc: '删除线', group: '编辑器' },
  { keys: 'Ctrl + 1 … Ctrl + 6', desc: '设为一级 ~ 六级标题（已是同级再按一次清除）', group: '编辑器' },
  { keys: 'Ctrl + 0', desc: '清除标题层级', group: '编辑器' },
  { keys: 'Ctrl + T', desc: '在光标处插入表格', group: '编辑器' },
  { keys: 'Ctrl + Shift + H', desc: '光标跳到文件开头（Ctrl+Home 同义）', group: '编辑器' },
  { keys: 'Ctrl + Shift + E', desc: '光标跳到文件末尾（Ctrl+End 同义）', group: '编辑器' },
  { keys: 'Ctrl + Z / Ctrl + Shift + Z', desc: '撤销 / 重做', group: '编辑器' }
]

/** 按分组归类（设置页按组渲染） */
export const SHORTCUT_GROUPS: { group: ShortcutItem['group']; items: ShortcutItem[] }[] = (
  ['全局', '编辑器'] as const
).map((group) => ({ group, items: SHORTCUTS.filter((s) => s.group === group) }))
