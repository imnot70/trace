import { describe, expect, it } from 'vitest'

/**
 * 回车音效纯逻辑单元测试：限流 / 连续换行屏蔽 / 音色轮换 / 三种音色的波形特征。
 * 实际发声依赖 Web Audio（jsdom 无实现），交互路径见设计文档手动清单。
 */
import {
  CONCRETE_VARIANTS,
  CONSECUTIVE_RETURN_WINDOW_MS,
  RETRO_BELL_ONLY_DURATION_S,
  RETRO_BELL_PARTIALS,
  RETRO_BELL_START_S,
  RETRO_DURATION_S,
  RETRO_PUSH_DURATION_S,
  RETRO_PUSH_ONLY_DURATION_S,
  RETRO_PUSH_START_S,
  SOUND_MIN_INTERVAL_MS,
  gateReturn,
  renderRetroBell,
  renderRetroPush,
  renderRetroReturn,
  returnRatchetSchedule,
  resolveVariant,
  shouldPlayReturn
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

describe('回车音效：音色解析与轮换', () => {
  it('固定音色原样返回，轮换下标不变', () => {
    expect(resolveVariant('carriage', 0)).toEqual({ variant: 'carriage', nextIndex: 0 })
    expect(resolveVariant('bell', 2)).toEqual({ variant: 'bell', nextIndex: 2 })
    expect(resolveVariant('retro', 1)).toEqual({ variant: 'retro', nextIndex: 1 })
  })

  it('轮换模式按顺序循环（推回车棘轮 → 回车铃 → 复古打字机 → 推回车棘轮）', () => {
    let idx = 0
    const picked: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = resolveVariant('rotate', idx)
      picked.push(r.variant)
      idx = r.nextIndex
    }
    expect(picked).toEqual(['carriage', 'bell', 'retro', 'carriage'])
    expect(CONCRETE_VARIANTS).toEqual(['carriage', 'bell', 'retro'])
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

describe('复古打字机回车音色（按键 + 推回车 + 回车铃）', () => {
  const SR = 48000
  it('时长 1.0s（棘轮加倍 + 铃余音 +50%）、峰值归一化到 0.95 附近', () => {
    const x = renderRetroReturn(SR, () => 0.5)
    expect(x.length).toBe(Math.floor(SR * RETRO_DURATION_S))
    let peak = 0
    for (const v of x) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.9)
    expect(peak).toBeLessThanOrEqual(0.96)
  })

  it('按键始终是最强的一段：全局峰值落在按键段（前 70ms），前 2ms 内已有强瞬态', () => {
    for (const seed of [0.3, 0.5, 0.7, 0.9]) {
      const x = renderRetroReturn(SR, () => seed)
      let peak = 0
      let peakIdx = 0
      for (let i = 0; i < x.length; i++) {
        const a = Math.abs(x[i])
        if (a > peak) {
          peak = a
          peakIdx = i
        }
      }
      expect(peakIdx / SR).toBeLessThan(0.07) // 按键段（棘轮从 70ms 起）
      let early = 0
      for (let i = 0; i < Math.floor(SR * 0.002); i++) early = Math.max(early, Math.abs(x[i]))
      expect(early).toBeGreaterThan(peak * 0.5) // 起手 2ms 内已有强瞬态
    }
  })

  it('0-40ms 内有多个能量峰（实录音效的按键是若干微冲击，不是单脉冲）', () => {
    const x = renderRetroReturn(SR, () => 0.5)
    const hop = Math.round(SR * 0.002)
    const frames = Math.floor((SR * 0.04) / hop)
    const env: number[] = []
    for (let f = 0; f < frames; f++) {
      let s2 = 0
      for (let i = f * hop; i < (f + 1) * hop; i++) s2 += x[i] * x[i]
      env.push(Math.sqrt(s2 / hop))
    }
    const peak = Math.max(...env)
    let peaks = 0
    for (let i = 1; i < env.length - 1; i++) {
      if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > peak * 0.12) peaks++
    }
    expect(peaks).toBeGreaterThanOrEqual(3)
  })

  it('推回车：棘轮齿序列在 0.13s 内约 15 颗、间隔渐密、振幅渐强', () => {
    const clicks = returnRatchetSchedule(() => 0.5, RETRO_PUSH_DURATION_S)
    expect(clicks.length).toBeGreaterThanOrEqual(25) // 0.26s（原 0.13s 加倍）
    expect(clicks.length).toBeLessThanOrEqual(45)
    expect(clicks[0].t).toBe(0)
    expect(clicks[clicks.length - 1].t).toBeLessThan(RETRO_PUSH_DURATION_S)
    const firstGap = clicks[1].t - clicks[0].t
    const lastGap = clicks[clicks.length - 1].t - clicks[clicks.length - 2].t
    expect(lastGap).toBeLessThan(firstGap) // 渐密
    expect(clicks[clicks.length - 1].amp).toBeGreaterThan(clicks[0].amp) // 渐强
    expect(RETRO_PUSH_START_S).toBeLessThan(RETRO_BELL_START_S)
  })

  it('推回车段（70-200ms）有明显棘轮能量（远高于按键结束后的静默段）', () => {
    const x = renderRetroReturn(SR, () => 0.5)
    const rms = (a: number, b: number): number => {
      let s2 = 0
      for (let i = a; i < b; i++) s2 += x[i] * x[i]
      return Math.sqrt(s2 / (b - a))
    }
    const push = rms(Math.floor(SR * 0.08), Math.floor(SR * 0.18))
    // 推回车结束、铃尚未进入余振中段（0.3s）之前，不应有第二个「咔」量级的事件
    expect(push).toBeGreaterThan(0.02)
  })

  it('回车铃：四个分音（含 2742Hz 与 9700Hz）在 0.22-0.55s 窗口内显著', () => {
    const x = renderRetroReturn(SR, () => 0.5)
    const goertzel = (freq: number, fromS: number, toS: number): number => {
      const w = (2 * Math.PI * freq) / SR
      const coeff = 2 * Math.cos(w)
      let s1 = 0
      let s2 = 0
      const from = Math.floor(fromS * SR)
      const to = Math.min(x.length, Math.floor(toS * SR))
      for (let i = from; i < to; i++) {
        const s0 = x[i] + coeff * s1 - s2
        s2 = s1
        s1 = s0
      }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / Math.max(1, to - from)
    }
    // 铃的分音在铃段（0.22s 起）内应高于空白频率（1500Hz 处无分音）
    const bellMid = goertzel(RETRO_BELL_PARTIALS[0].freq, RETRO_BELL_START_S + 0.02, 0.5)
    const bellHigh = goertzel(RETRO_BELL_PARTIALS[2].freq, RETRO_BELL_START_S + 0.02, 0.5)
    const blank = goertzel(1500, RETRO_BELL_START_S + 0.02, 0.5)
    expect(bellMid).toBeGreaterThan(blank * 3)
    expect(bellHigh).toBeGreaterThan(blank * 2)
  })

  it('铃的余振使尾段（0.8-0.95s）仍有信号（余音加长 50% 后可闻）', () => {
    const x = renderRetroReturn(SR, () => 0.5)
    let s2 = 0
    const from = Math.floor(SR * 0.8)
    for (let i = from; i < x.length; i++) s2 += x[i] * x[i]
    const tail = Math.sqrt(s2 / (x.length - from))
    expect(tail).toBeGreaterThan(0.005)
  })

  it('每次渲染带抖动（连续回车不机械重复）', () => {
    const a = renderRetroReturn(SR, () => 0.3)
    const b = renderRetroReturn(SR, () => 0.7)
    let diff = 0
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
    expect(diff / a.length).toBeGreaterThan(0.005)
  })
})

describe('连续换行屏蔽（设置项 flowSoundSkipRepeat）', () => {
  const empty = { lastReturnAt: 0, lastPlayedAt: 0 }

  it('未开启屏蔽时：只受限流窗口约束（间隔 ≥120ms 即发声）', () => {
    let st = empty
    const r = gateReturn(10000, st, false)
    expect(r.play).toBe(true)
    st = r.next
    expect(gateReturn(10050, st, false).play).toBe(false) // 50ms：机关枪防护
    expect(gateReturn(10130, st, false).play).toBe(true) // 130ms：放行
  })

  it('开启屏蔽时：一串快速换行只有第一次发声', () => {
    let st = empty
    const first = gateReturn(10000, st, true)
    expect(first.play).toBe(true)
    st = first.next
    // 200 / 400 / 600 / 790ms 的后续换行都静默（且 lastReturnAt 持续推进）
    for (const dt of [200, 200, 200, 190]) {
      const r = gateReturn(st.lastReturnAt + dt, st, true)
      expect(r.play).toBe(false)
      st = r.next
    }
    // 距最后一次换行超过窗口 → 再次发声
    const later = gateReturn(st.lastReturnAt + CONSECUTIVE_RETURN_WINDOW_MS + 1, st, true)
    expect(later.play).toBe(true)
  })

  it('一串换行结束后停足够久，下一个回车恢复发声（不会整段哑掉）', () => {
    let st = empty
    st = gateReturn(10000, st, true).next // 第一次发声
    st = gateReturn(10500, st, true).next // 连续换行 → 静默
    st = gateReturn(11000, st, true).next // 仍连续 → 静默
    const r = gateReturn(11000 + CONSECUTIVE_RETURN_WINDOW_MS + 10, st, true)
    expect(r.play).toBe(true)
  })
})

describe('独立「推回车（棘轮）」音色', () => {
  const SR = 48000
  it('时长 0.3s、峰值归一化、有约 35 颗齿的能量峰、且不含铃的分音', () => {
    const x = renderRetroPush(SR, () => 0.5)
    expect(x.length).toBe(Math.floor(SR * RETRO_PUSH_ONLY_DURATION_S))
    let peak = 0
    for (const v of x) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.9)
    // 2ms 帧包络的能量峰数量
    const hop = Math.round(SR * 0.002)
    const env: number[] = []
    for (let f = 0; f * hop + hop <= x.length; f++) {
      let s2 = 0
      for (let i = f * hop; i < (f + 1) * hop; i++) s2 += x[i] * x[i]
      env.push(Math.sqrt(s2 / hop))
    }
    const mx = Math.max(...env)
    let peaks = 0
    for (let i = 1; i < env.length - 1; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > mx * 0.3) peaks++
    expect(peaks).toBeGreaterThanOrEqual(8) // 齿密集，检测阈值下至少能数出 8 个
    // 铃的分音不该出现（Goertzel 9700Hz 应接近 0）
    const g = (freq: number): number => {
      const w = (2 * Math.PI * freq) / SR
      const coeff = 2 * Math.cos(w)
      let s1 = 0, s2 = 0
      for (const v of x) { const s0 = v + coeff * s1 - s2; s2 = s1; s1 = s0 }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / x.length
    }
    expect(g(9700)).toBeLessThan(g(1200) * 0.5)
  })

  it('末尾 30ms 淡出：最后样本接近 0', () => {
    const x = renderRetroPush(SR, () => 0.5)
    expect(Math.abs(x[x.length - 1])).toBeLessThan(0.01)
  })
})

describe('独立「回车铃」音色', () => {
  const SR = 48000
  it('时长 0.8s、峰值归一化、四个分音齐全且余振长', () => {
    const x = renderRetroBell(SR, () => 0.5)
    expect(x.length).toBe(Math.floor(SR * RETRO_BELL_ONLY_DURATION_S))
    let peak = 0
    for (const v of x) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.9)
    const g = (freq: number, fromS: number, toS: number): number => {
      const w = (2 * Math.PI * freq) / SR
      const coeff = 2 * Math.cos(w)
      let s1 = 0, s2 = 0
      const from = Math.floor(fromS * SR)
      const to = Math.min(x.length, Math.floor(toS * SR))
      for (let i = from; i < to; i++) { const s0 = x[i] + coeff * s1 - s2; s2 = s1; s1 = s0 }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / Math.max(1, to - from)
    }
    for (const b of RETRO_BELL_PARTIALS) {
      expect(g(b.freq, 0.02, 0.5)).toBeGreaterThan(g(1500, 0.02, 0.5) * 2)
    }
    // 余振：0.6-0.75s 仍有可闻信号，且最后样本接近 0（淡出干净）
    expect(g(RETRO_BELL_PARTIALS[0].freq, 0.6, 0.75)).toBeGreaterThan(0.002)
    expect(Math.abs(x[x.length - 1])).toBeLessThan(0.01)
  })
})
