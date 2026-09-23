/**
 * 心流模式回车音效：Web Audio 程序合成的机械「thock」。
 * 无音频文件、零安装包体积、无版权问题；音色参数见 requirements/2026-09-23_flow-mode/flow-mode_design.md 5.3。
 *
 * 两个分量：
 * - 「咔」：白噪声脉冲 12ms → 带通（≈1800Hz）→ 快速指数衰减——提供高频的键盘触感；
 * - 「木」：正弦 ≈140Hz → 指数衰减 80ms——提供低频的木质厚度。
 * 每次触发对频率与增益做 ±6% 随机微调，避免连续回车时听起来像机器。
 */

/** 连续回车的限流窗口：窗口内的重复触发直接丢弃（避免机关枪） */
export const SOUND_MIN_INTERVAL_MS = 120

/** 音量上限系数：主增益 = volume/100 × 0.5，留足余量防爆音 */
const GAIN_SCALE = 0.5

/** 是否应当发声（纯函数，可单测） */
export function shouldPlayReturn(now: number, lastPlayAt: number): boolean {
  return now - lastPlayAt >= SOUND_MIN_INTERVAL_MS
}

/** 单次触发的合成参数（纯函数；rand 注入便于单测） */
export function synthParams(rand: () => number = Math.random): {
  clickFreq: number
  bodyFreq: number
  jitter: number
} {
  // ±6% 抖动
  const jitter = () => 1 + (rand() * 2 - 1) * 0.06
  return { clickFreq: 1800 * jitter(), bodyFreq: 140 * jitter(), jitter: rand() * 2 - 1 }
}

export interface CaretSound {
  /** 播放一次回车音；volumePct 为 0-100 */
  playReturn(volumePct: number): void
  /** 释放音频上下文（关闭音效 / 组件卸载时调用） */
  dispose(): void
}

/** 创建回车音效合成器（AudioContext 懒创建：首次播放时才建，打字本身即用户手势，满足自动播放策略） */
export function createCaretSound(): CaretSound {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let lastPlayAt = 0

  const ensureContext = (): boolean => {
    if (ctx && master) {
      if (ctx.state === 'suspended') void ctx.resume()
      return true
    }
    try {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = 1
      master.connect(ctx.destination)
      return true
    } catch {
      // 环境不支持 Web Audio：静默降级（音效只是锦上添花，不影响写作）
      ctx = null
      master = null
      return false
    }
  }

  /** 一段噪声脉冲（「咔」） */
  const clickComponent = (frequency: number, gain: number): void => {
    if (!ctx || !master) return
    const duration = 0.012
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1

    const source = ctx.createBufferSource()
    source.buffer = buffer
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = frequency
    band.Q.value = 0.8
    const env = ctx.createGain()
    const now = ctx.currentTime
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(gain, now + 0.001)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.045)

    source.connect(band).connect(env).connect(master)
    source.start(now)
    source.stop(now + duration)
    source.onended = () => {
      source.disconnect()
      band.disconnect()
      env.disconnect()
    }
  }

  /** 一段低频正弦（「木」） */
  const bodyComponent = (frequency: number, gain: number): void => {
    if (!ctx || !master) return
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const env = ctx.createGain()
    const now = ctx.currentTime
    osc.frequency.value = frequency
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(gain, now + 0.004)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)

    osc.connect(env).connect(master)
    osc.start(now)
    osc.stop(now + 0.09)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
    }
  }

  return {
    playReturn(volumePct: number): void {
      const volume = Math.min(100, Math.max(0, volumePct))
      if (volume <= 0) return
      const now = performance.now()
      if (!shouldPlayReturn(now, lastPlayAt)) return
      if (!ensureContext() || !ctx) return
      lastPlayAt = now

      const { clickFreq, bodyFreq } = synthParams()
      const scale = (volume / 100) * GAIN_SCALE
      clickComponent(clickFreq, 0.9 * scale)
      bodyComponent(bodyFreq, 0.5 * scale)
    },

    dispose(): void {
      lastPlayAt = 0
      const closing = ctx
      ctx = null
      master = null
      if (closing && closing.state !== 'closed') void closing.close()
    }
  }
}
