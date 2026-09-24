/**
 * 标题层级操作（纯逻辑，可单测）：见 requirements/2026-09-24_editor-tools/。
 * 行文本 → 目标级别的行文本；level = 0 表示清除标题标记。
 * 开关语义：已是目标级别时按一次即去掉标记。
 */
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** 行首 0–3 个空格 + `#{1,6}` + 至少一个空白（与 CommonMark 的 ATX 标题一致） */
const HEADING_RE = /^(\s{0,3})(#{1,6})([ \t]+)/
/** 前导空白（非标题行设级别时保留缩进） */
const LEAD_RE = /^(\s{0,3})/

/** 该行当前的标题级别（非标题行返回 0） */
export function headingLevelOf(text: string): HeadingLevel {
  const m = HEADING_RE.exec(text)
  return m ? (m[2].length as HeadingLevel) : 0
}

/**
 * 计算把该行设为 level 后的文本：
 * - 已是目标级别 → 去掉标记（开关语义）；
 * - level = 0 → 去掉标记（非标题行原样返回）；
 * - 其余 → 替换 / 插入为 `#{level} `，保留前导空格与正文。
 */
export function headingLine(text: string, level: HeadingLevel): string {
  const m = HEADING_RE.exec(text)
  const indent = m ? m[1] : (LEAD_RE.exec(text)?.[1] ?? '')
  const rest = m ? text.slice(m[0].length) : text.slice(indent.length)
  const current = m ? m[2].length : 0
  if (level === 0 || current === level) return indent + rest
  return indent + '#'.repeat(level) + ' ' + rest
}

/** 逐行结果（供视图层一次性 dispatch；相同则不入 changes） */
export interface HeadingChange {
  from: number
  to: number
  insert: string
}

/** 选区覆盖到的所有行（多行选择时逐行生效） */
function selectedLines(state: EditorState): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = []
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      if (!out.some((l) => l.from === line.from)) out.push({ from: line.from, to: line.to, text: line.text })
    }
  }
  return out
}

/**
 * 设置 / 清除标题层级（见 requirements/2026-09-24_editor-tools/editor-tools.md FR-2.4.15）。
 * 单次 dispatch（可一步撤销）；只改行首标记，不动正文与其它结构。
 */
export function setHeading(view: EditorView, level: HeadingLevel): void {
  const changes: HeadingChange[] = []
  for (const line of selectedLines(view.state)) {
    const next = headingLine(line.text, level)
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }
  if (changes.length > 0) {
    view.dispatch({ changes, userEvent: 'input.format' })
  }
  view.focus()
}
