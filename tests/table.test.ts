import { describe, expect, it } from 'vitest'
import { TABLE_HEADERS, tableInsertPlan, tableTemplate } from '../src/renderer/src/lib/table'

describe('表格模板', () => {
  it('默认 2 列 1 行：表头 + 分隔行 + 空数据行', () => {
    expect(tableTemplate()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n|  |  |')
  })

  it('列数可调，表头按序号补齐', () => {
    expect(tableTemplate(3)).toBe('| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |')
  })
})

describe('表格插入位置规划', () => {
  it('行首插入：不补前导换行，表格后补换行', () => {
    const plan = tableInsertPlan('', 0)
    expect(plan.text.startsWith('| 列 1 |')).toBe(true)
    expect(plan.text.endsWith('\n')).toBe(true)
    // 选区覆盖首列表头占位，便于直接打字替换
    expect(plan.text.slice(plan.selStart, plan.selEnd)).toBe(TABLE_HEADERS[0])
  })

  it('行中（光标前已有内容）插入：先补换行，保证表格独占行块', () => {
    const line = '前面有文字'
    const col = 3
    const plan = tableInsertPlan(line, col)
    expect(plan.text.startsWith('\n| 列 1 |')).toBe(true)
    expect(plan.text.slice(plan.selStart, plan.selEnd)).toBe(TABLE_HEADERS[0])
  })

  it('光标前只有空白（缩进行首）视为行首', () => {
    const plan = tableInsertPlan('   ', 3)
    expect(plan.text.startsWith('| 列 1 |')).toBe(true)
  })

  it('选区内不含表头占位时，光标落到模板末尾（不抛错）', () => {
    const plan = tableInsertPlan('', 0, '| A |\n| --- |')
    expect(plan.selStart).toBe(plan.text.length)
    expect(plan.selEnd).toBe(plan.text.length)
  })
})
