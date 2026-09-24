import { describe, expect, it } from 'vitest'
import {
  TABLE_PROMPT_LIMITS,
  promptDims,
  promptText,
  startPrompt,
  stepPrompt,
  type TablePrompt
} from '../src/renderer/src/lib/tablePrompt'

/** 依次打入一串按键（digit 用字符表示，' ' = 空格，'\n' = 回车，'\x1b' = Esc） */
function run(keys: string): { state: TablePrompt; actions: string[]; warnings: (string | null)[] } {
  let state = startPrompt()
  const actions: string[] = []
  const warnings: (string | null)[] = []
  for (const ch of keys) {
    const key = ch === ' ' ? 'space' : ch === '\n' ? 'enter' : ch === '\x1b' ? 'escape' : 'digit'
    const step = stepPrompt(state, key, key === 'digit' ? ch : '')
    state = step.next
    actions.push(step.action)
    warnings.push(step.warning)
  }
  return { state, actions, warnings }
}

describe('表格尺寸状态机', () => {
  it('默认尺寸', () => {
    expect(promptDims(startPrompt())).toEqual({ rows: 2, cols: 2 })
  })

  it('输入「5 6 」→ 插入 5 行 6 列', () => {
    const { state, actions } = run('5 6 ')
    expect(state).toEqual({ rows: 5, cols: 6, pending: '' })
    expect(actions.at(-1)).toBe('insert')
    expect(promptDims(state)).toEqual({ rows: 5, cols: 6 })
  })

  it('输入「5 6」后回车 → 插入；输入过程中尺寸实时可见', () => {
    const r1 = run('5')
    expect(promptDims(r1.state)).toEqual({ rows: 5, cols: 2 }) // 只输了行数：列取默认
    const r2 = run('5 ')
    expect(promptDims(r2.state)).toEqual({ rows: 5, cols: 2 })
    const r3 = run('5 6')
    expect(promptDims(r3.state)).toEqual({ rows: 5, cols: 6 })
    expect(r3.actions.at(-1)).toBe('stay')
    const r4 = run('5 6\n')
    expect(r4.actions.at(-1)).toBe('insert')
    expect(promptDims(r4.state)).toEqual({ rows: 5, cols: 6 })
  })

  it('只输入「3 」后回车 → 3 行 2 列', () => {
    const { state, actions } = run('3 \n')
    expect(actions.at(-1)).toBe('insert')
    expect(promptDims(state)).toEqual({ rows: 3, cols: 2 })
  })

  it('未输入数字时：空格 = 默认尺寸插入；回车 = 默认尺寸插入', () => {
    expect(run(' ').actions).toEqual(['insert'])
    expect(run('\n').actions).toEqual(['insert'])
  })

  it('Esc 取消', () => {
    const { actions } = run('5\x1b')
    expect(actions.at(-1)).toBe('cancel')
  })

  it('其它键取消（把按键放行给编辑器）', () => {
    const step = stepPrompt(run('5').state, 'other')
    expect(step.action).toBe('cancel')
  })

  it('超限输入给出警告并钳制到上限', () => {
    const { state, warnings } = run('99 99 ')
    expect(warnings.some((w) => w?.includes('最多 50 行'))).toBe(true)
    expect(warnings.some((w) => w?.includes('最多 20 列'))).toBe(true)
    expect(promptDims(state)).toEqual({ rows: TABLE_PROMPT_LIMITS.maxRows, cols: TABLE_PROMPT_LIMITS.maxCols })
  })

  it('数字串最长 3 位；前导零归并', () => {
    expect(run('12345').state.pending).toBe('123')
    expect(run('007').state.pending).toBe('7')
  })

  it('重复空格 = 确认插入（空格始终是确认键）', () => {
    const { state, actions } = run('5  ')
    // 第一个空格提交行数；第二个空格按「5 行 × 默认 2 列」插入
    expect(state.rows).toBe(5)
    expect(actions.at(-1)).toBe('insert')
  })

  it('浮层脚注按状态精确描述（无倒计时相关文案）', () => {
    expect(promptText(startPrompt()).footer).toBe('按空格或回车插入 2 行 × 2 列')
    expect(promptText(startPrompt()).footer).not.toContain('秒')
    // 正在输第一个数：空格是分隔，回车才是插入
    expect(promptText(run('5').state).footer).toBe('空格继续输入列数 · 回车插入 5 行 × 2 列')
    // 行数已提交：空格 / 回车都插入
    expect(promptText(run('5 ').state).footer).toBe('空格或回车插入 5 行 × 2 列')
    expect(promptText(run('5 6').state).footer).toBe('空格或回车插入 5 行 × 6 列')
    expect(promptText(run('5 6').state).dims).toBe('5 行 × 6 列')
  })

  it('只输入行数后按两次空格 → 5 行 2 列（空格既是分隔也是确认）', () => {
    const { state, actions } = run('5  ')
    expect(actions.at(-1)).toBe('insert')
    expect(promptDims(state)).toEqual({ rows: 5, cols: 2 })
  })
})
