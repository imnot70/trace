/**
 * 表格插入（纯逻辑，可单测）：见 ai/requirements/2026-09-24_editor-tools/ 与 2026-09-24_table-insert-enhance/。
 * 生成 GFM 表格模板，并规划插入位置（行中插入时先换行，保证表格独占行块）。
 */
import type { EditorView } from '@codemirror/view'

/** 默认列名（表头占位） */
export const TABLE_HEADERS = ['列 1', '列 2'] as const

/** 生成表格模板：表头 + 分隔行 + rows 行空数据行（cols 列） */
export function tableTemplate(cols = 2, rows = 1): string {
  const headers = Array.from({ length: cols }, (_, i) => TABLE_HEADERS[i] ?? `列 ${i + 1}`)
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`,
    ...Array.from({ length: rows }, () => `| ${Array.from({ length: cols }, () => '').join(' | ')} |`)
  ]
  return lines.join('\n')
}

export interface TableInsertPlan {
  /** 实际插入的文本（含前导换行与尾随换行） */
  text: string
  /** 光标选区（相对插入起点）：默认选中首列表头占位文字，直接打字即替换 */
  selStart: number
  selEnd: number
}

/**
 * 规划插入：
 * - 光标前本行已有非空白内容 → 先补换行，避免表格与既有文字同行（GFM 表格必须从行首开始）；
 * - 模板后补一个换行，便于继续书写；
 * - 选区覆盖首列表头占位（无占位时不选，光标落到模板末尾）。
 */
export function tableInsertPlan(lineText: string, col: number, template = tableTemplate()): TableInsertPlan {
  const prefix = lineText.slice(0, col).trim() === '' ? '' : '\n'
  const text = `${prefix}${template}\n`
  const at = template.indexOf(TABLE_HEADERS[0])
  if (at < 0) return { text, selStart: text.length, selEnd: text.length }
  const start = prefix.length + at
  return { text, selStart: start, selEnd: start + TABLE_HEADERS[0].length }
}

/**
 * 在光标处插入表格（FR-2.4.16 / FR-2.4.20）。
 * rows / cols 省略时用默认尺寸；rows 为**含表头**的总行数（模板参数 rows = 数据行数 = 总行数 - 1）。
 */
export function insertTable(view: EditorView, dims?: { rows: number; cols: number }): void {
  const cols = dims?.cols ?? 2
  const dataRows = Math.max(0, (dims?.rows ?? 2) - 1)
  const template = tableTemplate(cols, dataRows)
  const range = view.state.selection.main
  const line = view.state.doc.lineAt(range.from)
  const plan = tableInsertPlan(line.text, range.from - line.from, template)
  view.dispatch({
    changes: { from: range.from, insert: plan.text },
    selection: { anchor: range.from + plan.selStart, head: range.from + plan.selEnd },
    userEvent: 'input.format'
  })
  view.focus()
}
