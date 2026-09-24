import { describe, expect, it } from 'vitest'
import { headingLevelOf, headingLine } from '../src/renderer/src/lib/heading'

describe('标题层级：行文本变换', () => {
  it('普通行设为各级标题', () => {
    expect(headingLine('正文', 1)).toBe('# 正文')
    expect(headingLine('正文', 3)).toBe('### 正文')
    expect(headingLine('正文', 6)).toBe('###### 正文')
  })

  it('已是目标级别 → 去掉标记（开关语义）', () => {
    expect(headingLine('# 标题', 1)).toBe('标题')
    expect(headingLine('### 标题', 3)).toBe('标题')
  })

  it('跨级替换', () => {
    expect(headingLine('## 标题', 1)).toBe('# 标题')
    expect(headingLine('# 标题', 5)).toBe('##### 标题')
  })

  it('level = 0 清除任意级别；非标题行原样返回', () => {
    expect(headingLine('###### 标题', 0)).toBe('标题')
    expect(headingLine('# 标题', 0)).toBe('标题')
    expect(headingLine('正文', 0)).toBe('正文')
  })

  it('保留前导空格（≤3）；不误伤行内 # 与「#标签」', () => {
    expect(headingLine('  ## 标题', 1)).toBe('  # 标题')
    expect(headingLine('  正文', 2)).toBe('  ## 正文')
    expect(headingLine('正文里有 # 号', 1)).toBe('# 正文里有 # 号')
    expect(headingLine('#标签', 0)).toBe('#标签') // 无空格，不是标题
    expect(headingLine('#标签', 1)).toBe('# #标签')
  })

  it('空行也能设为标题 / 从标题清空', () => {
    expect(headingLine('', 2)).toBe('## ')
    expect(headingLine('## ', 0)).toBe('')
  })

  it('headingLevelOf 识别当前级别', () => {
    expect(headingLevelOf('# 标题')).toBe(1)
    expect(headingLevelOf('###### 标题')).toBe(6)
    expect(headingLevelOf('#标签')).toBe(0)
    expect(headingLevelOf('####### 七个井号')).toBe(0)
    expect(headingLevelOf('    # 四空格缩进')).toBe(0)
  })
})
