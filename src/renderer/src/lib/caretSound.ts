/**
 * 心流模式回车音效：Web Audio 程序合成的键盘音色。
 * 无音频文件、零安装包体积、无版权问题；音色与触发契约见 requirements/2026-09-23_flow-mode/flow-mode_design.md。
 *
 * 四种音色（设置项 flowSoundVariant）：
 * - wood    木质「thock」：噪声脉冲 ~2kHz 带通（咔）+ 正弦 ~140Hz 指数衰减（木），最接近薄膜键盘；
 * - metal   金属「叮」：FM 合成（载波 ~1.5kHz，调制比 2.76、调制指数快速衰减）+ 短回声（90ms 延迟、0.28 反馈），
 *           回声在 ~0.27s 内衰减到不可闻；
 * - ratchet 打字机「唰」：0.8s 的棘齿声——一串细碎的木质咔哒（间隔由 14ms 渐密到 9ms），
 *           模拟指甲划过木齿 / 老式打字机拉回车；
 * - rotate  轮换：每次回车依次使用上面三种，避免长时间写作的重复感。
 */

export type SoundVariant = 'wood' | 'metal' | 'ratchet' | 'rotate'

/** 可轮换的具体音色（rotate 会在这三者间循环） */
export const CONCRETE_VARIANTS = ['wood', 'metal', 'ratchet'] as const
export type ConcreteVariant = (typeof CONCRETE_VARIANTS)[number]

/** 连续回车的限流窗口：窗口内的重复触发直接丢弃（避免机关枪） */
export const SOUND_MIN_INTERVAL_MS = 120

/** 音量上限系数：主增益 = volume/100 × 0.5，留足余量防爆音 */
const GAIN_SCALE = 0.5

/** 棘齿音总时长（秒） */
export const RATCHET_DURATION_S = 0.8

/** 是否应当发声（纯函数，可单测） */
export function shouldPlayReturn(now: number, lastPlayAt: number): boolean {
  return now - lastPlayAt >= SOUND_MIN_INTERVAL_MS
}

/**
 * 解析本次实际使用的音色（纯函数，可单测）。
 * rotate 按顺序轮换：返回本次音色与下一个待用下标。
 */
export function resolveVariant(
  variant: SoundVariant,
  rotateIndex: number
): { variant: ConcreteVariant; nextIndex: number } {
  if (variant !== 'rotate') return { variant, nextIndex: rotateIndex }
  const pick = CONCRETE_VARIANTS[rotateIndex % CONCRETE_VARIANTS.length]
  return { variant: pick, nextIndex: (rotateIndex + 1) % CONCRETE_VARIANTS.length }
}

/** 木质音色参数：±6% 抖动，避免连续回车听起来像机器 */
export function synthParams(rand: () => number = Math.random): {
  clickFreq: number
  bodyFreq: number
} {
  const jitter = (): number => 1 + (rand() * 2 - 1) * 0.06
  return { clickFreq: 2000 * jitter(), bodyFreq: 140 * jitter() }
}

/** 棘齿声的一颗「齿」（纯函数，可单测）：起始时刻、木质共振频率、振幅 */
export interface RatchetClick {
  t: number
  freq: number
  amp: number
}

/**
 * 生成棘齿声的齿序列（纯函数，可单测）。
 * 间隔由 0.014s 渐密到 0.009s（划过的加速感），带 ±12% 抖动避免听出周期；
 * 振幅呈中间略强的包络（起手与收尾自然）。
 */
export function ratchetSchedule(
  rand: () => number = Math.random,
  durationSec = RATCHET_DURATION_S
): RatchetClick[] {
  const clicks: RatchetClick[] = []
  let t = 0
  while (t < durationSec) {
    const progress = t / durationSec
    const gap = (0.014 - 0.005 * progress) * (1 + (rand() - 0.5) * 0.24)
    clicks.push({
      t,
      freq: 700 + rand() * 900,
      amp: 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, progress * 1.1))
    })
    t += Math.max(0.004, gap)
  }
  return clicks
}

export interface CaretSound {
  /** 播放一次回车音；volumePct 为 0-100 */
  playReturn(volumePct: number, variant?: SoundVariant): void
  /** 释放音频上下文（关闭音效 / 组件卸载时调用） */
  dispose(): void
}

/** 创建回车音效合成器（AudioContext 懒创建：首次播放时才建，打字本身即用户手势，满足自动播放策略） */
export function createCaretSound(): CaretSound {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let lastPlayAt = 0
  let rotateIndex = 0
  /** 正在播放的节点：同一音色再次触发时先停掉上一声，避免叠加成噪音（异种音色可共存） */
  const active = new Map<ConcreteVariant, AudioScheduledSourceNode[]>()
  /** 棘齿噪声缓冲按采样率缓存，避免每次回车重新生成 0.8s 样本 */
  let ratchetBuffer: AudioBuffer | null = null

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

  const trackVoice = (variant: ConcreteVariant, node: AudioScheduledSourceNode): void => {
    for (const old of active.get(variant) ?? []) {
      try {
        old.stop()
      } catch {
        /* 已停止 */
      }
    }
    active.set(variant, [node])
  }

  // ---------- 木质：噪声「咔」+ 低频「木」 ----------
  const clickComponent = (frequency: number, gain: number, variant: ConcreteVariant): void => {
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
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.038)

    source.connect(band).connect(env).connect(master)
    source.start(now)
    source.stop(now + duration)
    source.onended = () => {
      source.disconnect()
      band.disconnect()
      env.disconnect()
    }
    trackVoice(variant, source)
  }

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

  // ---------- 金属：FM 敲击 + 短回声 ----------
  const metalComponent = (gain: number): void => {
    if (!ctx || !master) return
    const now = ctx.currentTime
    const jitter = 1 + (Math.random() * 2 - 1) * 0.05
    const carrierFreq = 1500 * jitter

    const carrier = ctx.createOscillator()
    carrier.type = 'sine'
    carrier.frequency.value = carrierFreq
    const modulator = ctx.createOscillator()
    modulator.type = 'sine'
    modulator.frequency.value = carrierFreq * 2.76 // 非整数比 → 金属泛音
    const modDepth = ctx.createGain()
    modDepth.gain.setValueAtTime(carrierFreq * 1.8, now) // 起始调制指数高：敲击瞬间泛音丰富
    modDepth.gain.exponentialRampToValueAtTime(1, now + 0.12) // 快速收敛 → 尾音变纯净
    modulator.connect(modDepth).connect(carrier.frequency)

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(0.7 * gain, now + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)

    carrier.connect(env)
    env.connect(master) // 干信号
    // 回声：90ms 延迟 + 0.28 反馈 + 低通，尾巴约 0.27s 内衰减殆尽
    const delay = ctx.createDelay(0.5)
    delay.delayTime.value = 0.09
    const feedback = ctx.createGain()
    feedback.gain.value = 0.28
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 2600
    env.connect(delay)
    delay.connect(damp)
    damp.connect(feedback)
    feedback.connect(delay)
    damp.connect(master)

    carrier.start(now)
    carrier.stop(now + 0.24)
    modulator.start(now)
    modulator.stop(now + 0.24)
    carrier.onended = () => {
      carrier.disconnect()
      modulator.disconnect()
      modDepth.disconnect()
      env.disconnect()
      delay.disconnect()
      feedback.disconnect()
      damp.disconnect()
    }
    trackVoice('metal', carrier)
  }

  // ---------- 打字机棘齿：「唰」 ----------
  const ensureRatchetBuffer = (): AudioBuffer | null => {
    if (!ctx) return null
    if (ratchetBuffer) return ratchetBuffer
    const sr = ctx.sampleRate
    const length = Math.floor(sr * RATCHET_DURATION_S)
    const buffer = ctx.createBuffer(1, length, sr)
    const data = buffer.getChannelData(0)
    const clicks = ratchetSchedule(Math.random, RATCHET_DURATION_S)
    const clickSamples = Math.max(1, Math.floor(sr * 0.006)) // 每齿 6ms
    for (const click of clicks) {
      const start = Math.floor(click.t * sr)
      const decay = sr * 0.0015 // 1.5ms 衰减：木质「笃」
      for (let i = 0; i < clickSamples && start + i < length; i++) {
        const env = Math.exp(-i / decay)
        const phase = (2 * Math.PI * click.freq * i) / sr
        // 噪声给「擦」感，正弦给木质共振
        data[start + i] += click.amp * env * (0.55 * (Math.random() * 2 - 1) + 0.45 * Math.sin(phase))
      }
    }
    ratchetBuffer = buffer
    return buffer
  }

  const ratchetComponent = (gain: number): void => {
    if (!ctx || !master) return
    const buffer = ensureRatchetBuffer()
    if (!buffer) return
    const now = ctx.currentTime
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.04 // ±4% 速率抖动
    // 齿声偏干，只留一点高频滚降（低频正弦分量本就有限）
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 5200
    const env = ctx.createGain()
    env.gain.setValueAtTime(gain, now)
    source.connect(tone).connect(env).connect(master)
    source.start(now)
    source.onended = () => {
      source.disconnect()
      tone.disconnect()
      env.disconnect()
    }
    trackVoice('ratchet', source)
  }

  return {
    playReturn(volumePct: number, variant: SoundVariant = 'wood'): void {
      const volume = Math.min(100, Math.max(0, volumePct))
      if (volume <= 0) return
      const now = performance.now()
      if (!shouldPlayReturn(now, lastPlayAt)) return
      if (!ensureContext() || !ctx) return
      lastPlayAt = now

      const picked = resolveVariant(variant, rotateIndex)
      rotateIndex = picked.nextIndex
      const scale = (volume / 100) * GAIN_SCALE
      switch (picked.variant) {
        case 'metal':
          metalComponent(scale)
          break
        case 'ratchet':
          ratchetComponent(0.9 * scale)
          break
        default: {
          const { clickFreq, bodyFreq } = synthParams()
          clickComponent(clickFreq, 0.9 * scale, 'wood')
          bodyComponent(bodyFreq, 0.42 * scale)
        }
      }
    },

    dispose(): void {
      lastPlayAt = 0
      rotateIndex = 0
      ratchetBuffer = null
      active.clear()
      const closing = ctx
      ctx = null
      master = null
      if (closing && closing.state !== 'closed') void closing.close()
    }
  }
}
