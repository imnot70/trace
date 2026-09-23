import { describe, expect, it } from 'vitest'

/**
 * 心流模式纯函数单元测试：写作栏宽映射、打字机形态推导。
 * 进入 / 退出的快照还原属 app store 会话状态，见设计文档手动清单。
 */
import { FLOW_MEASURE_EM, effectiveTypewriterMode, flowMeasureEm } from '../src/renderer/src/lib/flow'

describe('心流模式：写作栏宽', () => {
  it('三档映射到对应 em 值', () => {
    expect(flowMeasureEm('narrow')).toBe(32)
    expect(flowMeasureEm('medium')).toBe(42)
    expect(flowMeasureEm('wide')).toBe(52)
  })

  it('三档依次递增（窄 < 中 < 宽）', () => {
    expect(FLOW_MEASURE_EM.narrow).toBeLessThan(FLOW_MEASURE_EM.medium)
    expect(FLOW_MEASURE_EM.medium).toBeLessThan(FLOW_MEASURE_EM.wide)
  })
})

describe('心流模式：打字机形态推导', () => {
  it('非心流：原样返回设置值（含关闭）', () => {
    expect(effectiveTypewriterMode(false, 'off')).toBe('off')
    expect(effectiveTypewriterMode(false, 'center')).toBe('center')
    expect(effectiveTypewriterMode(false, 'bottom')).toBe('bottom')
  })

  it('心流内：设置为关闭时默认开启低位', () => {
    expect(effectiveTypewriterMode(true, 'off')).toBe('bottom')
  })

  it('心流内：用户已选形态时沿用（不覆盖用户偏好）', () => {
    expect(effectiveTypewriterMode(true, 'center')).toBe('center')
    expect(effectiveTypewriterMode(true, 'bottom')).toBe('bottom')
  })

  it('心流内默认形态可配置', () => {
    expect(effectiveTypewriterMode(true, 'off', 'center')).toBe('center')
  })
})
