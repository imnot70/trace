import { describe, expect, it } from 'vitest'

/**
 * 回车音效纯逻辑单元测试：限流窗口与合成参数抖动。
 * 实际发声依赖 Web Audio（jsdom 无实现），交互路径见设计文档手动清单。
 */
import { SOUND_MIN_INTERVAL_MS, shouldPlayReturn, synthParams } from '../src/renderer/src/lib/caretSound'

describe('回车音效：限流', () => {
  it('首次触发（从未播放过）应发声', () => {
    expect(shouldPlayReturn(1000, 0)).toBe(true)
  })

  it('窗口边界：刚好 120ms 发声，119ms 不发声', () => {
    expect(shouldPlayReturn(1000 + SOUND_MIN_INTERVAL_MS, 1000)).toBe(true)
    expect(shouldPlayReturn(1000 + SOUND_MIN_INTERVAL_MS - 1, 1000)).toBe(false)
  })

  it('窗口内连击全部丢弃（机关枪防护）', () => {
    let last = 0
    let plays = 0
    // 每 30ms 敲一次回车：1 秒内总共 34 次，按 120ms 窗口应只放行约 8 次
    for (let t = 0; t <= 1000; t += 30) {
      if (shouldPlayReturn(t, last)) {
        plays++
        last = t
      }
    }
    expect(plays).toBeLessThanOrEqual(Math.ceil(1000 / SOUND_MIN_INTERVAL_MS) + 1)
    expect(plays).toBeGreaterThan(1)
  })
})

describe('回车音效：合成参数抖动', () => {
  const fixed = (v: number) => () => v

  it('抖动幅度在 ±6% 以内', () => {
    // rand 返回 0 → 1 - 6%；返回 1 → 1 + 6%
    expect(synthParams(fixed(0)).clickFreq).toBeCloseTo(1800 * 0.94, 5)
    expect(synthParams(fixed(1)).clickFreq).toBeCloseTo(1800 * 1.06, 5)
    expect(synthParams(fixed(0)).bodyFreq).toBeCloseTo(140 * 0.94, 5)
    expect(synthParams(fixed(1)).bodyFreq).toBeCloseTo(140 * 1.06, 5)
  })

  it('中值输入时接近基准频率（约 1.8kHz 咔 + 140Hz 木）', () => {
    const p = synthParams(fixed(0.5))
    expect(p.clickFreq).toBeCloseTo(1800, 0)
    expect(p.bodyFreq).toBeCloseTo(140, 0)
  })

  it('连续取值的分布落在合理区间（随机源真实调用）', () => {
    for (let i = 0; i < 200; i++) {
      const p = synthParams()
      expect(p.clickFreq).toBeGreaterThan(1800 * 0.93)
      expect(p.clickFreq).toBeLessThan(1800 * 1.07)
      expect(p.bodyFreq).toBeGreaterThan(140 * 0.93)
      expect(p.bodyFreq).toBeLessThan(140 * 1.07)
    }
  })
})
