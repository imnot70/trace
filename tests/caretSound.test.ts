import { describe, expect, it } from 'vitest'

/**
 * 回车音效纯逻辑单元测试：限流窗口与合成参数抖动。
 * 实际发声依赖 Web Audio（jsdom 无实现），交互路径见设计文档手动清单。
 */
import {
  CONCRETE_VARIANTS,
  RATCHET_DURATION_S,
  SOUND_MIN_INTERVAL_MS,
  ratchetSchedule,
  resolveVariant,
  shouldPlayReturn,
  synthParams
} from '../src/renderer/src/lib/caretSound'

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
    expect(synthParams(fixed(0)).clickFreq).toBeCloseTo(2000 * 0.94, 5)
    expect(synthParams(fixed(1)).clickFreq).toBeCloseTo(2000 * 1.06, 5)
    expect(synthParams(fixed(0)).bodyFreq).toBeCloseTo(140 * 0.94, 5)
    expect(synthParams(fixed(1)).bodyFreq).toBeCloseTo(140 * 1.06, 5)
  })

  it('中值输入时接近基准频率（约 2kHz 咔 + 140Hz 木）', () => {
    const p = synthParams(fixed(0.5))
    expect(p.clickFreq).toBeCloseTo(2000, 0)
    expect(p.bodyFreq).toBeCloseTo(140, 0)
  })

  it('连续取值的分布落在合理区间（随机源真实调用）', () => {
    for (let i = 0; i < 200; i++) {
      const p = synthParams()
      expect(p.clickFreq).toBeGreaterThan(2000 * 0.93)
      expect(p.clickFreq).toBeLessThan(2000 * 1.07)
      expect(p.bodyFreq).toBeGreaterThan(140 * 0.93)
      expect(p.bodyFreq).toBeLessThan(140 * 1.07)
    }
  })
})

describe('回车音效：音色解析与轮换', () => {
  it('固定音色原样返回，轮换下标不变', () => {
    expect(resolveVariant('wood', 0)).toEqual({ variant: 'wood', nextIndex: 0 })
    expect(resolveVariant('metal', 2)).toEqual({ variant: 'metal', nextIndex: 2 })
    expect(resolveVariant('ratchet', 1)).toEqual({ variant: 'ratchet', nextIndex: 1 })
  })

  it('轮换模式按顺序循环（木质 → 金属 → 打字机 → 木质）', () => {
    let idx = 0
    const picked: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = resolveVariant('rotate', idx)
      picked.push(r.variant)
      idx = r.nextIndex
    }
    expect(picked).toEqual(['wood', 'metal', 'ratchet', 'wood'])
  })

  it('轮换下标始终落在合法范围（长时间使用不会越界）', () => {
    let idx = 0
    for (let i = 0; i < 100; i++) {
      const r = resolveVariant('rotate', idx)
      idx = r.nextIndex
      expect(CONCRETE_VARIANTS).toContain(r.variant)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(CONCRETE_VARIANTS.length)
    }
  })
})

describe('回车音效：棘齿声排布', () => {
  const fixed = (v: number) => () => v

  it('所有齿都落在时长内，且数量与间隔相符（0.8s 内约 70 齿）', () => {
    const clicks = ratchetSchedule(fixed(0.5), RATCHET_DURATION_S)
    expect(clicks.length).toBeGreaterThan(40)
    expect(clicks.length).toBeLessThan(120)
    for (const c of clicks) {
      expect(c.t).toBeGreaterThanOrEqual(0)
      expect(c.t).toBeLessThan(RATCHET_DURATION_S)
      expect(c.freq).toBeGreaterThanOrEqual(700)
      expect(c.freq).toBeLessThanOrEqual(1600)
      expect(c.amp).toBeGreaterThan(0)
      expect(c.amp).toBeLessThanOrEqual(1)
    }
  })

  it('间隔随时间变密（划过的加速感）', () => {
    const clicks = ratchetSchedule(fixed(0.5), RATCHET_DURATION_S)
    const firstGap = clicks[1].t - clicks[0].t
    const lastGap = clicks[clicks.length - 1].t - clicks[clicks.length - 2].t
    expect(lastGap).toBeLessThan(firstGap)
  })

  it('振幅呈中间偏强的包络（起手与收尾更轻）', () => {
    const clicks = ratchetSchedule(fixed(0.5), RATCHET_DURATION_S)
    const mid = clicks[Math.floor(clicks.length / 2)].amp
    expect(mid).toBeGreaterThan(clicks[0].amp)
    expect(mid).toBeGreaterThan(clicks[clicks.length - 1].amp)
  })
})
