/**
 * 快捷键注册表：设置页「快捷键」速查表的单一数据源。
 * 实际绑定分布在 window keydown（全局键，App.vue）与 CodeMirror keymap（编辑器键，MarkdownEditor.vue），
 * 修改键位时必须同步本表。
 */
export interface ShortcutItem {
  /** 键位显示形式 */
  keys: string
  desc: string
  group: '全局' | '编辑器' | 'Vim'
}

export const SHORTCUTS: ShortcutItem[] = [
  { keys: 'Ctrl + S', desc: '保存当前笔记', group: '全局' },
  { keys: 'Alt + P', desc: '呼出 / 收起悬浮预览', group: '全局' },
  { keys: 'Alt + 1 / 2 / 3 / 4', desc: '打开常用 / 收藏 / 回收站 / 笔记库网格（再按一次关闭，回收站仅进入）', group: '全局' },
  { keys: 'Ctrl + ,', desc: '打开 / 关闭设置弹窗（Esc 或点击遮罩也可关闭）', group: '全局' },
  { keys: 'Alt + F', desc: '进入 / 退出专注模式', group: '全局' },
  { keys: 'Alt + W', desc: '进入 / 退出心流模式（沉浸创作：隐藏界面 + 所见即所得 + 打字机）', group: '全局' },
  { keys: 'Alt + B', desc: '显示 / 隐藏左侧栏', group: '全局' },
  { keys: 'Alt + V', desc: '显示 / 隐藏预览区', group: '全局' },
  { keys: 'Ctrl + N', desc: '新建笔记（自动定位到当前上下文所在文件夹）', group: '全局' },
  { keys: 'Ctrl + F', desc: '当前笔记内查找 / 替换（编辑视图内生效，焦点在预览 / 工具栏时自动聚焦编辑器；非编辑视图不响应）', group: '全局' },
  { keys: 'Shift Shift（连按两次）', desc: '打开搜索框（预置当前笔记所在库，下拉可改为所有库；全局搜索入口）', group: '全局' },
  { keys: 'Esc', desc: '分级回退：关闭查找/替换面板 → 关闭悬浮预览（[[ 补全保持）→ 收起 [[ 补全 → 退出心流模式 → 返回上级文件夹 → 关闭网格', group: '全局' },
  { keys: '↑ / ↓（搜索弹窗内）', desc: '悬浮预览未打开 = 在搜索结果间移动高亮（点击弹窗任意位置后仍可用；下拉展开时归列表）；悬浮预览打开 = 滚动预览内容', group: '全局' },
  { keys: 'Alt + ↑ / ↓（搜索弹窗内）', desc: '变更选中的搜索结果，悬浮预览内容同步跟随（不关预览直接换结果）', group: '全局' },
  { keys: 'Enter（搜索弹窗内）', desc: '打开高亮的搜索结果（焦点不必在搜索框）', group: '全局' },
  { keys: 'Alt + Enter（搜索弹窗内）', desc: '以悬浮预览查看高亮结果，搜索框保持打开（可继续换结果预览；Esc 收起搜索框去阅读）', group: '全局' },
  { keys: 'Alt + 1 / 2 / 3（搜索弹窗内）', desc: '切换标题 / 内容 / 跨库引用筛选', group: '全局' },
  { keys: 'Alt + V / Alt + T（搜索弹窗内）', desc: '展开库范围 / 标签下拉（列表内 ↑/↓ 选择、空格勾选、Esc 关闭）', group: '全局' },
  { keys: 'Alt + R（搜索弹窗内）', desc: '重建搜索索引', group: '全局' },
  { keys: '↑ / ↓（悬浮预览打开时）', desc: '滚动悬浮预览内容（编辑器聚焦时让位给光标移动；搜索框未打开且焦点在输入框时让位给输入导航）', group: '全局' },
  { keys: 'Ctrl + Shift + H / E（悬浮预览打开时）', desc: '悬浮预览跳到头部 / 尾部（编辑器聚焦时仍是光标跳文件首尾）', group: '全局' },
  { keys: 'Alt + Enter（[[ 补全时）', desc: '悬浮预览选中的笔记（不插入、不切走）；悬浮预览打开时再按 = 插入该笔记的引用', group: '编辑器' },
  { keys: 'Alt + T', desc: '打字机模式：关 → 高位 → 低位 三态循环（图标角标 ↑ 高位 / ↓ 低位，心流内外一致）', group: '编辑器' },
  { keys: 'Alt + M', desc: '开关 Vim 编辑模式（Alt+V 已被「显示/隐藏预览区」占用；顶栏 V 按钮同义，激活时高亮）', group: '编辑器' },
  { keys: 'Alt + I', desc: '打开 / 关闭快速引用面板：从当前库目录树（含草稿分组）选笔记插入 [[引用]]，不切换当前笔记；↑/↓ 移动、→/← 展开/收起、Enter 引入、Alt+Enter 预览（面板保持打开，↑/↓ 换目标预览自动跟随，预览开着再按 Alt+Enter = 插入该笔记引用，Esc 先关预览回面板）；/引入 同义（心流 / 专注可用）', group: '编辑器' },
  { keys: 'Ctrl + Enter', desc: '在当前行下方插入一个空行，光标移到新行行首（补全打开时 = 接受补全）', group: '编辑器' },
  { keys: 'Ctrl + Shift + Enter', desc: '在当前行上方插入一个空行，光标移到新行行首', group: '编辑器' },
  { keys: 'Ctrl + E', desc: '切换源码 / 所见即所得编辑模式（编辑视图内）', group: '编辑器' },
  { keys: 'Ctrl + B', desc: '加粗选中文字（无选中时插入占位符）', group: '编辑器' },
  { keys: 'Ctrl + I', desc: '斜体', group: '编辑器' },
  { keys: 'Ctrl + Shift + X', desc: '删除线', group: '编辑器' },
  { keys: 'Ctrl + 1 … Ctrl + 6', desc: '设为一级 ~ 六级标题（已是同级再按一次清除）', group: '编辑器' },
  { keys: 'Ctrl + 0', desc: '清除标题层级', group: '编辑器' },
  { keys: 'Ctrl + T', desc: '在光标处插入表格', group: '编辑器' },
  { keys: 'Ctrl + Shift + I', desc: '引入图片（系统文件选择器多选，复制进附件目录并批量插入引用）', group: '编辑器' },
  { keys: '/（编辑器内）', desc: '斜杠命令：行首输入 / 呼出命令面板（/表格 同 Ctrl+T、/标题1…6 同 Ctrl+1…6、/引用 /代码块 /任务列表 /分割线 /日期 /引入（同 Alt+I）等，行为与对应快捷键一致）', group: '编辑器' },
  { keys: 'Ctrl + Shift + H', desc: '光标跳到文件开头（Ctrl+Home 同义）', group: '编辑器' },
  { keys: 'Ctrl + Shift + E', desc: '光标跳到文件末尾（Ctrl+End 同义）', group: '编辑器' },
  { keys: 'Esc / Ctrl+[（Vim 开启时）', desc: '编辑器聚焦且无浮层时归 Vim（返回 normal，退出心流模式用 Alt+W 或顶栏按钮）；悬浮预览 / 浮层侧栏 / 各弹窗的 Esc 行为不变', group: '编辑器' },
  { keys: 'Vim 模式键位', desc: '设置开启后 normal / insert / visual 全套生效（工具栏右端显示当前模式）；Ctrl+F/B/E/I/N/T 仍归应用——全部 Vim 键位见「快捷键」分类的 Vim 分组', group: '编辑器' },
  { keys: 'Ctrl + Z / Ctrl + Shift + Z', desc: '撤销 / 重做', group: '编辑器' },
  // Vim 分组（FR-2.4.23）：vim 模式下支持的普通键位速查（不含 :ex 命令——包内 ex 解释器未开放）。
  // 应用让渡的六个 Ctrl 键已在上面「Vim 模式键位」条目说明
  { keys: 'i / a / o / O', desc: '进入插入模式（光标前 / 后 / 下方新行 / 上方新行）', group: 'Vim' },
  { keys: 'Esc / Ctrl+[', desc: '返回普通模式；可视模式下退出选择', group: 'Vim' },
  { keys: 'v / V / Ctrl+V', desc: '可视模式（字符选择 / 行选择 / 块选择）', group: 'Vim' },
  { keys: 'h j k l / w b e', desc: '按字符移动 / 按词前后移动（词首 / 词尾）', group: 'Vim' },
  { keys: '0 / ^ / $ / gg / G', desc: '行首 / 首个非空白字符 / 行尾 / 文件开头 / 文件末尾', group: 'Vim' },
  { keys: '{ / }', desc: '跳到上一段 / 下一段', group: 'Vim' },
  { keys: 'f{c} / t{c} / F{c} / T{c}', desc: '行内向右查找字符（停在 / 前一格）、向左查找（停在 / 后一格）', group: 'Vim' },
  { keys: '%', desc: '跳到与光标处配对的括号', group: 'Vim' },
  { keys: 'x / dd / yy / p / P', desc: '删除字符 / 删除整行 / 复制整行 / 粘贴到光标后 / 前', group: 'Vim' },
  { keys: 'cw / D / C / J / r / ~', desc: '改词 / 删至行尾 / 改至行尾 / 合并下一行 / 替换单个字符 / 翻转大小写', group: 'Vim' },
  { keys: '>> / <<', desc: '当前行增加 / 减少缩进', group: 'Vim' },
  { keys: 'u / Ctrl+R', desc: '撤销 / 重做', group: 'Vim' },
  { keys: '. / 数字前缀', desc: '重复上一次修改 / 指定重复次数（如 3dd、5j）', group: 'Vim' },
  { keys: '/ {词} / ? {词} + n / N', desc: '向下 / 向上搜索，跳到下一个 / 上一个匹配', group: 'Vim' },
  { keys: 'Ctrl+D / Ctrl+U', desc: '向下 / 向上滚动半页', group: 'Vim' },
  { keys: 'Ctrl+E / Ctrl+Y', desc: '向下 / 向上滚动一行', group: 'Vim' },
  { keys: 'Ctrl+O', desc: '跳回上一个光标位置；插入模式下临时返回普通模式执行一步操作', group: 'Vim' },
  { keys: 'Ctrl+A / Ctrl+X', desc: '光标处的数字加一 / 减一', group: 'Vim' },
  { keys: '应用键位保留', desc: 'Ctrl+F 查找 / Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+E 编辑形态 / Ctrl+N 新建 / Ctrl+T 表格仍归应用，Vim 不占用', group: 'Vim' }
]

/** 按分组归类（设置页按组渲染） */
export const SHORTCUT_GROUPS: { group: ShortcutItem['group']; items: ShortcutItem[] }[] = (
  ['全局', '编辑器', 'Vim'] as const
).map((group) => ({ group, items: SHORTCUTS.filter((s) => s.group === group) }))
