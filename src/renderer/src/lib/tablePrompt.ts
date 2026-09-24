/**
 * 表格尺寸输入状态机（纯函数，可单测）：见 requirements/2026-09-24_table-insert-enhance/。
 *
 * 交互：Ctrl+T（或工具栏「表格」按钮）进入提示态 → 输入「行 列」（如 `5 6`）→ 空格 / 回车插入；
 * 未输入任何数字时按空格 = 按默认尺寸插入；Esc / 点击他处取消。
 * **不做倒计时自动插入**（2026-09-24 用户实测反馈：浮层已经说明了操作方式，1 秒抢跑会让提示来不及看）。
 * 状态机只负责决策，浮层负责把状态显示给用户（尺寸回显、非法输入提示）。
 */
export interface TablePrompt {
  /** 已确认的行数（null = 尚未输入） */
  rows: number | null
  /** 已确认的列数（null = 尚未输入） */
  cols: number | null
  /** 正在输入、尚未以空格提交的数字串 */
  pending: string
}

export const TABLE_PROMPT_LIMITS = { maxRows: 50, maxCols: 20, defaultRows: 2, defaultCols: 2 } as const

/** 单次按键的语义（由键位层判定后交给状态机） */
export type PromptKey = 'digit' | 'space' | 'enter' | 'escape' | 'other'

export interface PromptStep {
  next: TablePrompt
  action: 'stay' | 'insert' | 'cancel'
  /** 非法 / 超限输入的提示（浮层红字），无则 null */
  warning: string | null
}

export function startPrompt(): TablePrompt {
  return { rows: null, cols: null, pending: '' }
}

function clamp(value: number, max: number): { value: number; warning: string | null } {
  if (value > max) return { value: max, warning: `最多 ${max}${max === TABLE_PROMPT_LIMITS.maxRows ? ' 行' : ' 列'}，已按上限处理` }
  return { value, warning: null }
}

/** 提交 pending 数字：依次填 行 → 列；两边都已就位时为 null（表示该插入） */
function commitPending(cur: TablePrompt): { next: TablePrompt; full: boolean; warning: string | null } {
  if (cur.pending === '') return { next: cur, full: cur.rows !== null && cur.cols !== null, warning: null }
  const raw = Number.parseInt(cur.pending, 10)
  const value = Number.isFinite(raw) && raw > 0 ? raw : 1
  if (cur.rows === null) {
    const { value: rows, warning } = clamp(value, TABLE_PROMPT_LIMITS.maxRows)
    return { next: { ...cur, rows, pending: '' }, full: false, warning }
  }
  const { value: cols, warning } = clamp(value, TABLE_PROMPT_LIMITS.maxCols)
  return { next: { ...cur, cols, pending: '' }, full: true, warning }
}

export function stepPrompt(cur: TablePrompt, key: PromptKey, digit = ''): PromptStep {
  switch (key) {
    case 'digit': {
      if (!/^[0-9]$/.test(digit)) return { next: cur, action: 'stay', warning: null }
      // 最多 3 位，避免误按住键产生超长数字串
      const pending = (cur.pending + digit).replace(/^0+(?=\d)/, '').slice(0, 3)
      return { next: { ...cur, pending }, action: 'stay', warning: null }
    }
    case 'space': {
      // 无待提交数字：直接按当前尺寸插入（未输入过任何数字时即默认尺寸）
      if (cur.pending === '') return { next: cur, action: 'insert', warning: null }
      const { next, full, warning } = commitPending(cur)
      return { next, action: full ? 'insert' : 'stay', warning }
    }
    case 'enter': {
      const { next, warning } = commitPending(cur)
      return { next, action: 'insert', warning }
    }
    case 'escape':
      return { next: cur, action: 'cancel', warning: null }
    default:
      return { next: cur, action: 'cancel', warning: null }
  }
}

/** 当前将插入的尺寸（含默认值与上限钳制） */
export function promptDims(cur: TablePrompt): { rows: number; cols: number } {
  const pendingValue = cur.pending === '' ? null : Math.max(1, Number.parseInt(cur.pending, 10) || 1)
  const rows = cur.rows ?? pendingValue ?? TABLE_PROMPT_LIMITS.defaultRows
  const cols = cur.cols ?? (cur.rows !== null ? pendingValue : null) ?? TABLE_PROMPT_LIMITS.defaultCols
  return {
    rows: Math.min(rows, TABLE_PROMPT_LIMITS.maxRows),
    cols: Math.min(cols, TABLE_PROMPT_LIMITS.maxCols)
  }
}

/**
 * 浮层文案：尺寸回显 + 操作提示 + 「当前按空格 / 回车会发生什么」。
 * 脚注按状态精确描述，避免用户误会：
 * - 什么都没输入：空格 / 回车都按默认尺寸插入；
 * - 正在输第一个数：空格是「分隔到下一个数」，回车才是插入；
 * - 已提交行数（空格已按过）：空格 / 回车都按当前尺寸插入；
 * - 行列都齐：空格 / 回车立即插入。
 * 警告由调用方按最近一次 step 的 warning 渲染
 */
export function promptText(cur: TablePrompt): { dims: string; hint: string; footer: string } {
  const { rows, cols } = promptDims(cur)
  const typed = cur.rows !== null || cur.cols !== null || cur.pending !== ''
  let footer: string
  if (!typed) footer = `按空格或回车插入 ${rows} 行 × ${cols} 列`
  else if (cur.pending !== '' && cur.rows === null) footer = `空格继续输入列数 · 回车插入 ${rows} 行 × ${cols} 列`
  else footer = `空格或回车插入 ${rows} 行 × ${cols} 列`
  return {
    dims: `${rows} 行 × ${cols} 列`,
    hint: '输入行列数（如 5 6）· 空格 / 回车 插入 · Esc 取消',
    footer
  }
}
