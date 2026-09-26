/**
 * 表格内 Tab / Shift+Tab 跳转（FR-2.4.21）：见 ai/requirements/2026-09-24_table-insert-enhance/。
 * 语法树驱动：光标位于 `Table` 节点内时才接管 Tab；单元格按文档序（即行优先）收集。
 */
import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { completionStatus } from '@codemirror/autocomplete'

export interface CellRange {
  from: number
  to: number
}

export interface TableContext {
  from: number
  to: number
  /** 行优先的单元格区间（含表头行） */
  cells: CellRange[]
  /** 光标所在（或最接近的）单元格下标 */
  index: number
}

/** 单元格内容区间：去掉两端 `|` 与空白，供跳转后选中内容 */
export function cellContent(state: EditorState, cell: CellRange): CellRange {
  const text = state.doc.sliceString(cell.from, cell.to)
  const lead = text.length - text.replace(/^\s*\|?\s*/, '').length
  const trail = text.length - text.replace(/\s*\|?\s*$/, '').length
  const from = cell.from + lead
  const to = Math.max(from, cell.to - trail)
  return { from, to }
}

/** 取光标处的 Table 节点：先按两种偏置向上找；都落空时再看是否正好停在表格的边界 */
function tableNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  for (const bias of [-1, 1] as const) {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, bias)
    while (node && node.name !== 'Table') node = node.parent
    if (node) return node
  }
  // 光标停在表格首行行首 / 末行行尾（例如在所见即所得里点击渲染态表格，光标落到块边界）：
  // 上面的偏置都会落到相邻节点，这里按边界认领
  let found: SyntaxNode | null = null
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'Table' && (ref.from === pos || ref.to === pos)) {
        found = ref.node
        return false
      }
      return true
    }
  })
  return found
}

/** 光标所在表格及其单元格序列；不在表格内返回 null */
export function tableAt(state: EditorState, pos: number): TableContext | null {
  const node = tableNodeAt(state, pos)
  if (!node) return null
  const cells: CellRange[] = []
  syntaxTree(state).iterate({
    from: node.from,
    to: node.to,
    enter: (ref) => {
      if (ref.name === 'TableCell') {
        cells.push({ from: ref.from, to: ref.to })
        return false
      }
      return true
    }
  })
  if (cells.length === 0) return null
  // 光标落在单元格分隔符上时：先取「其后第一个」作为当前格，方向由 tableTab 再调整
  let index = cells.findIndex((c) => pos >= c.from && pos <= c.to)
  if (index < 0) index = cells.findIndex((c) => c.from >= pos)
  if (index < 0) index = cells.length - 1
  return { from: node.from, to: node.to, cells, index }
}

/** 表头行的列数（该行内单元格数量），上限取 1 */
export function columnCount(state: EditorState, table: TableContext): number {
  const headerLine = state.doc.lineAt(table.cells[0].from)
  const n = table.cells.filter((c) => state.doc.lineAt(c.from).from === headerLine.from).length
  return Math.max(1, n)
}

/** 生成一行空单元格（与既有模板同形：`|  |  |`） */
export function emptyRowText(cols: number): string {
  return `| ${Array.from({ length: cols }, () => '').join(' | ')} |`
}

/** 选中目标区间（空则落光标），并滚动到位 */
function placeAt(view: EditorView, range: CellRange): void {
  const empty = range.from >= range.to
  view.dispatch({
    selection: empty ? EditorSelection.cursor(range.from) : EditorSelection.range(range.from, range.to),
    effects: EditorView.scrollIntoView(range.from, { y: 'nearest' }),
    userEvent: 'select'
  })
  view.focus()
}

/**
 * 表格内跳转（Tab = 1 / Shift+Tab = -1）。
 * 返回 false 表示「未处理」——光标不在表格内、或补全浮层打开时让位给默认行为
 */
export function tableTab(view: EditorView, dir: 1 | -1): boolean {
  const state = view.state
  if (completionStatus(state) !== null) return false // 补全浮层打开：Tab 用于接受补全
  const table = tableAt(state, state.selection.main.head)
  if (!table) return false

  const target = table.index + dir
  if (target >= 0 && target < table.cells.length) {
    placeAt(view, cellContent(state, table.cells[target]))
    return true
  }

  if (dir === 1) {
    // 末格 Tab → 追加一行（列数与表头一致）并跳到新行首格
    const cols = columnCount(state, table)
    const lastLine = state.doc.lineAt(table.to)
    const insertAt = lastLine.to
    view.dispatch({ changes: { from: insertAt, insert: `\n${emptyRowText(cols)}` }, userEvent: 'input' })
    // 新行的单元格 = 起始位置在新行内的那些（不能直接取 cells[0]——那是表头首格）
    const next = tableAt(view.state, insertAt + 3) // 新行首格内（`\n| ` 之后）
    const rowCells = next ? next.cells.filter((c) => c.from >= insertAt + 1) : []
    const target2 = rowCells[0] ?? { from: insertAt + 1, to: insertAt + 1 }
    placeAt(view, cellContent(view.state, target2))
    return true
  }

  // 首格 Shift+Tab → 光标移到表格上一行行尾（离开表格）
  const tableLine = state.doc.lineAt(table.from)
  const exit = tableLine.from > 0 ? tableLine.from - 1 : 0
  placeAt(view, { from: exit, to: exit })
  return true
}
