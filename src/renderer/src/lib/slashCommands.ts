import type { HeadingLevel } from './heading'

/**
 * 斜杠命令注册表（FR-2.4.22）：编辑器输入 `/` 呼出的命令面板。
 * 一致性原则：每条命令都是既有工具栏 / 快捷键动作的「命令化封装」，
 * action 只描述「调用哪个既有入口」，执行统一在 MarkdownEditor 的 runSlashAction
 * 里落到与快捷键完全相同的函数——新增编辑动作时在此登记一条即可。
 */
export type SlashAction =
  /** 同 Ctrl+T：进入表格尺寸提示态（FR-2.4.20） */
  | { kind: 'table' }
  /** 同 Ctrl+1–6 / Ctrl+0（FR-2.4.15） */
  | { kind: 'heading'; level: HeadingLevel }
  /** 同工具栏成对标记按钮（智能插入：有选中包裹 / 无选中插占位） */
  | { kind: 'snippet'; before: string; after: string; placeholder: string }
  /** 插入纯文本片段（日期） */
  | { kind: 'text'; text: () => string }
  /** 清理本文不可见字符（FR-2.4.25）：扫描 → 确认框 → 单事务替换（与工具栏橡皮刷同一函数） */
  | { kind: 'cleanInvisible' }
  /** 打开快速引用面板（FR-2.9.12）：目录树（含草稿）选笔记插入 [[引用]]，同 Alt+I */
  | { kind: 'insertRef' }

export interface SlashCommandDef {
  /** 命令名（含 /），过滤与展示都用它 */
  label: string
  /** 英文别名（不含 /）：输入 /t 也能命中 /表格 */
  aliases: string[]
  /** 面板说明：标注与哪个快捷键 / 工具栏按钮行为一致 */
  detail: string
  action: SlashAction
}

/** 本地日期 YYYY-MM-DD（/日期 片段） */
function todayText(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { label: '/表格', aliases: ['t', 'table'], detail: '插入表格（同 Ctrl+T，可输入行列数）', action: { kind: 'table' } },
  { label: '/标题1', aliases: ['h1'], detail: '设为一级标题（同 Ctrl+1）', action: { kind: 'heading', level: 1 } },
  { label: '/标题2', aliases: ['h2'], detail: '设为二级标题（同 Ctrl+2）', action: { kind: 'heading', level: 2 } },
  { label: '/标题3', aliases: ['h3'], detail: '设为三级标题（同 Ctrl+3）', action: { kind: 'heading', level: 3 } },
  { label: '/标题4', aliases: ['h4'], detail: '设为四级标题（同 Ctrl+4）', action: { kind: 'heading', level: 4 } },
  { label: '/标题5', aliases: ['h5'], detail: '设为五级标题（同 Ctrl+5）', action: { kind: 'heading', level: 5 } },
  { label: '/标题6', aliases: ['h6'], detail: '设为六级标题（同 Ctrl+6）', action: { kind: 'heading', level: 6 } },
  { label: '/标题0', aliases: ['h0'], detail: '清除标题层级（同 Ctrl+0）', action: { kind: 'heading', level: 0 } },
  { label: '/引用', aliases: ['quote', 'blockquote'], detail: '插入引用块（同工具栏 ❝）', action: { kind: 'snippet', before: '> ', after: '', placeholder: '引用内容' } },
  { label: '/任务列表', aliases: ['task', 'todo'], detail: '插入任务复选框', action: { kind: 'snippet', before: '- [ ] ', after: '', placeholder: '任务描述' } },
  { label: '/行内代码', aliases: ['icode', 'inlinecode'], detail: '插入行内代码（同工具栏 </>）', action: { kind: 'snippet', before: '`', after: '`', placeholder: 'code' } },
  { label: '/代码块', aliases: ['code', 'codeblock'], detail: '插入代码块（同工具栏 { }）', action: { kind: 'snippet', before: '\n```js\n', after: '\n```\n', placeholder: 'code' } },
  { label: '/行内公式', aliases: ['math', 'formula'], detail: '插入行内公式（同工具栏 ∑）', action: { kind: 'snippet', before: '$', after: '$', placeholder: '公式' } },
  { label: '/公式块', aliases: ['mathblock', 'formula-block'], detail: '插入公式块（同工具栏 ∫）', action: { kind: 'snippet', before: '\n$$\n', after: '\n$$\n', placeholder: '公式' } },
  { label: '/链接', aliases: ['link'], detail: '插入链接（同工具栏 🔗）', action: { kind: 'snippet', before: '[', after: '](https://)', placeholder: '链接文字' } },
  { label: '/分割线', aliases: ['hr', 'divider'], detail: '插入水平分割线 ---', action: { kind: 'snippet', before: '\n---\n', after: '', placeholder: '' } },
  { label: '/日期', aliases: ['date'], detail: '插入今天日期（YYYY-MM-DD）', action: { kind: 'text', text: todayText } },
  { label: '/清理字符', aliases: ['clean', 'invisible'], detail: '清理本文不可见字符（NBSP→空格、零宽→删除，先确认）', action: { kind: 'cleanInvisible' } },
  { label: '/引入', aliases: ['ref', 'insert'], detail: '打开引用面板：从目录树（含草稿）选笔记插入 [[引用]]（同 Alt+I）', action: { kind: 'insertRef' } }
]

/**
 * 按输入过滤命令：命令名包含（中文前缀即打即滤）或别名以输入为前缀（大小写不敏感）。
 * 源侧过滤后由补全源以 filter: false 呈现——CM 内置模糊过滤对中文不可靠（既有教训）。
 */
export function filterSlashCommands(query: string): SlashCommandDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (c) =>
      c.label.slice(1).toLowerCase().includes(q) ||
      c.aliases.some((a) => a.toLowerCase().startsWith(q))
  )
}
