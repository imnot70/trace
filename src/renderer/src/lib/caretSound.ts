/**
 * 心流模式回车音效：Web Audio 程序合成的键盘音色。
 * 无音频文件、零安装包体积、无版权问题；音色与触发契约见 ai/requirements/2026-09-23_flow-mode/flow-mode_design.md。
 *
 * 四种音色（设置项 flowSoundVariant；后三者均按用户提供的实录音效实测特征合成）：
 * - carriage 推回车「棘轮」：约 0.26s 的一串齿（间隔 9ms 渐密到 6ms、振幅渐强）；
 * - bell     回车铃「叮」：2742 / 6527 / 9700 / 11449Hz 四个分音，余振约 0.7s；
 * - retro    复古打字机「回车」：三段结构——
 *           ① 按键：宽带咔（5-12kHz）+ 四个微冲击 + 字锤/纸卷共振（1.2k / 2.9kHz）+ 延迟 12ms 的机体「咚」（96/182Hz）；
 *           ② 70ms 推回车：约 0.26s / 30 余颗棘轮齿（间隔 9ms 渐密到 6ms、振幅渐强，实测间隔 6-10ms）；
 *           ③ 240ms 回车铃：2742 / 6527 / 9700 / 11449Hz 四个分音，衰减 0.33-0.63s（整段 1.0s，末尾 60ms 淡出）。
 *           不随包音频文件，仅按实测声学特征重建（分析与比对见 flow-mode_design.md 第 10.5–10.8 节）；
 * - rotate  轮换：每次回车依次使用上面三种，避免长时间写作的重复感。
 * 说明：旧的木质 / 金属 / 打字机棘齿三种音色已于 2026-09-24 下线，设置项旧值在启动时迁移到 retro。
 */

export type SoundVariant = 'carriage' | 'bell' | 'retro' | 'rotate'

/** 可轮换的具体音色（rotate 会在这几者间循环） */
export const CONCRETE_VARIANTS = ['carriage', 'bell', 'retro'] as const
export type ConcreteVariant = (typeof CONCRETE_VARIANTS)[number]

/** 连续回车的限流窗口：窗口内的重复触发直接丢弃（避免机关枪） */
export const SOUND_MIN_INTERVAL_MS = 120

/** 音量上限系数：主增益 = volume/100 × 0.5，留足余量防爆音 */
const GAIN_SCALE = 0.5

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

/** 连续换行的判定窗口（毫秒）：与上一次「回车插入」的间隔小于它即视为同一次连续换行 */
export const CONSECUTIVE_RETURN_WINDOW_MS = 800

export interface ReturnGateState {
  /** 上一次「回车插入」的时刻（不论是否发声） */
  lastReturnAt: number
  /** 上一次实际发声的时刻 */
  lastPlayedAt: number
}

export interface ReturnGateResult {
  play: boolean
  next: ReturnGateState
}

/**
 * 是否应为本次回车发声（纯函数，可单测）。
 * 两道闸：① 限流窗口 SOUND_MIN_INTERVAL_MS（始终生效，防机关枪）；
 * ② `skipConsecutive` 开启时，与上一次回车插入相隔小于 CONSECUTIVE_RETURN_WINDOW_MS → 视为
 *    「快速连续换行」（例如连按回车加空行），只有这一串的第一次发声；
 * 注意 `lastReturnAt` 每次都会推进：这样连续一串换行只响第一声，而不是每 800ms 响一次。
 */
export function gateReturn(
  now: number,
  state: ReturnGateState,
  skipConsecutive: boolean
): ReturnGateResult {
  const next: ReturnGateState = { lastReturnAt: now, lastPlayedAt: state.lastPlayedAt }
  if (!shouldPlayReturn(now, state.lastPlayedAt)) return { play: false, next }
  if (skipConsecutive && now - state.lastReturnAt < CONSECUTIVE_RETURN_WINDOW_MS) {
    return { play: false, next }
  }
  next.lastPlayedAt = now
  return { play: true, next }
}

export interface RatchetClick {
  t: number
  freq: number
  amp: number
}

export interface RetroParams {
  /** 高频「咔」的衰减时间常数（秒） */
  clickDecay: number
  /** 字锤（~2.9kHz）与纸卷（~1.2kHz）共振的频率与衰减 */
  midFreq: number
  midDecay: number
  plankFreq: number
  plankDecay: number
  /** 机体「咚」的两个频率、相对咔的延迟与余振时间常数 */
  bodyFreq1: number
  bodyFreq2: number
  thunkDelay: number
  thunkDecay: number
  /** 回车铃的整体失谐（±） */
  bellDetune: number
}

export function retroParams(rand: () => number = Math.random): RetroParams {
  const jitter = (base: number, pct: number): number => base * (1 + (rand() * 2 - 1) * pct)
  return {
    clickDecay: jitter(0.0048, 0.18),
    midFreq: jitter(2900, 0.06),
    midDecay: jitter(0.016, 0.15),
    plankFreq: jitter(1200, 0.06),
    plankDecay: jitter(0.02, 0.15),
    bodyFreq1: jitter(96, 0.07),
    bodyFreq2: jitter(182, 0.07),
    thunkDelay: jitter(0.012, 0.25),
    thunkDecay: jitter(0.09, 0.15),
    bellDetune: 1 + (rand() * 2 - 1) * 0.004
  }
}

/** 整段「回车」的时长（秒）：咔 → 推回车 → 铃的余振（按用户听感反馈：棘轮加倍、铃余音 +50%） */
export const RETRO_DURATION_S = 1.0
/** 推回车（棘轮）的起始与时长（0.13s 加倍为 0.26s） */
export const RETRO_PUSH_START_S = 0.07
export const RETRO_PUSH_DURATION_S = 0.26
/** 回车铃的起始（推回车进行中开始响，与实录音效一致） */
export const RETRO_BELL_START_S = 0.24
/** 缓冲末尾的淡出时长（秒）：铃的余振被截断处需要淡出，否则会有咔哒声 */
export const RETRO_FADE_OUT_S = 0.06

/** 按键的微冲击（实录音效单次按键在 100-190ms 内有 9 个能量峰：键帽 / 连杆 / 字锤 / 纸卷相继撞击） */
const RETRO_IMPACTS = [
  { t: 0, amp: 1, tone: 1 },
  { t: 0.007, amp: 0.42, tone: 0.6 },
  { t: 0.014, amp: 0.3, tone: 0.5 },
  { t: 0.023, amp: 0.2, tone: 0.4 }
] as const

/**
 * 回车铃的分音（实测：2742 / 6527 / 9700 / 11449Hz，衰减 0.22–0.42s）。
 * 铃在实录音效里是「高频亮 ting + 中频泛音」，这里保留四个分音以还原那种清脆感。
 */
export const RETRO_BELL_PARTIALS = [
  { freq: 2742, amp: 0.575, decay: 0.63 },
  { freq: 6527, amp: 0.345, decay: 0.51 },
  { freq: 9700, amp: 0.276, decay: 0.42 },
  { freq: 11449, amp: 0.15, decay: 0.33 }
] as const

/**
 * 推回车的棘轮齿序列（纯函数，可单测）：~0.13s 内约 15 颗，间隔由 9ms 渐密到 6ms，
 * 振幅渐强（推杆越推越顺手的观感）。实测：连续段尾部 916-1000ms 的能量峰间隔 6-10ms。
 */
export function returnRatchetSchedule(
  rand: () => number = Math.random,
  durationSec = RETRO_PUSH_DURATION_S
): RatchetClick[] {
  const clicks: RatchetClick[] = []
  let t = 0
  while (t < durationSec) {
    const progress = t / durationSec
    const gap = (0.009 - 0.003 * progress) * (1 + (rand() - 0.5) * 0.3)
    clicks.push({
      t,
      freq: 900 + rand() * 800,
      amp: 0.5 + 0.5 * Math.min(1, progress * 1.4)
    })
    t += Math.max(0.004, gap)
  }
  return clicks
}

/** 末尾淡出（避免缓冲截断产生咔哒） */
function fadeOut(buf: Float32Array, sampleRate: number, seconds: number): void {
  const fade = Math.min(buf.length, Math.floor(sampleRate * seconds))
  for (let i = 0; i < fade; i++) buf[buf.length - fade + i] *= 1 - (i + 1) / fade
}

/** 峰值归一化到 0.95 */
function normalize(buf: Float32Array): void {
  let peak = 0
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
  if (peak > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] / peak) * 0.95
}

/** 独立「棘轮（推回车）」的时长（秒） */
export const RETRO_PUSH_ONLY_DURATION_S = 0.3
/** 独立「回车铃」的时长（秒） */
export const RETRO_BELL_ONLY_DURATION_S = 0.8

/** 三层波形（长度 = RETRO_DURATION_S）：按键（含机体咚）/ 推回车棘轮 / 回车铃 */
function retroLayers(sampleRate: number, rand: () => number): { strike: Float32Array; push: Float32Array; bell: Float32Array } {
  const p = retroParams(rand)
  const n = Math.max(1, Math.floor(sampleRate * RETRO_DURATION_S))

  // 连续噪声床：一阶高通（去低频轰鸣）+ 一阶低通（收 10kHz 以上毛刺）
  const noise = new Float32Array(n)
  let hpPrevIn = 0
  let hpPrevOut = 0
  let lp = 0
  for (let i = 0; i < n; i++) {
    const raw = rand() * 2 - 1
    const hp = raw - hpPrevIn + 0.86 * hpPrevOut
    hpPrevIn = raw
    hpPrevOut = hp
    lp += (hp - lp) * 0.72
    noise[i] = lp
  }

  const tau = 2 * Math.PI
  const push = returnRatchetSchedule(rand)
  const bell = RETRO_BELL_PARTIALS.map((b) => ({ ...b, freq: b.freq * p.bellDetune }))

  const strike = new Float32Array(n)
  const pushLayer = new Float32Array(n)
  const bellLayer = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    // ① 按键（含微冲击）+ 机体「咚」
    for (const im of RETRO_IMPACTS) {
      const dt = t - im.t
      if (dt < 0 || dt > 0.08) continue
      strike[i] += noise[i] * Math.exp(-dt / (p.clickDecay * (0.6 + 0.4 * im.tone))) * 2.9 * im.amp
      strike[i] += Math.sin(tau * 520 * dt) * Math.exp(-dt / 0.018) * 0.3 * im.tone
      strike[i] += Math.sin(tau * p.plankFreq * dt) * Math.exp(-dt / p.plankDecay) * 0.72 * im.tone
      strike[i] += Math.sin(tau * p.midFreq * dt) * Math.exp(-dt / p.midDecay) * 0.95 * im.tone
    }
    const dThunk = t - p.thunkDelay
    if (dThunk > 0) {
      const env = Math.exp(-dThunk / p.thunkDecay) * (1 - Math.exp(-dThunk / 0.004))
      strike[i] += (Math.sin(tau * p.bodyFreq1 * dThunk) * 0.16 + Math.sin(tau * p.bodyFreq2 * dThunk) * 0.09) * env
    }
    // ② 推回车的棘轮齿
    for (const c of push) {
      const dt = t - (RETRO_PUSH_START_S + c.t)
      if (dt < 0 || dt > 0.025) continue
      pushLayer[i] += noise[i] * Math.exp(-dt / 0.004) * 0.9 * c.amp
      pushLayer[i] += Math.sin(tau * c.freq * dt) * Math.exp(-dt / 0.0018) * 1.3 * c.amp
    }
    // ③ 回车铃（四个分音，各自的指数衰减）
    const dBell = t - RETRO_BELL_START_S
    if (dBell > 0) {
      const attack = 1 - Math.exp(-dBell / 0.0015) // 1.5ms 起音，避免爆音
      for (const b of bell) bellLayer[i] += Math.sin(tau * b.freq * dBell) * Math.exp(-dBell / b.decay) * b.amp * attack
    }
  }

  return { strike, push: pushLayer, bell: bellLayer }
}

/**
 * 渲染一次「复古打字机回车」波形（纯函数，可单测）。三段结构（实测见设计文档 10.5–10.8）：
 * ① 0ms  按键：噪声脉冲（一阶高通 + 低通整形）+ 四个微冲击 + 字锤 / 纸卷共振 + 延迟 12ms 的机体「咚」；
 * ② 70ms 推回车：约 35 颗棘轮齿（噪声 + 木质共振，间隔 9ms 渐密到 6ms、振幅渐强）；
 * ③ 240ms 回车铃：四个分音（2.7k / 6.5k / 9.7k / 11.4kHz）各自指数衰减，整段 1.0s、末尾 60ms 淡出。
 */
export function renderRetroReturn(sampleRate: number, rand: () => number = Math.random): Float32Array {
  const n = Math.max(1, Math.floor(sampleRate * RETRO_DURATION_S))
  const { strike, push: pushLayer, bell: bellLayer } = retroLayers(sampleRate, rand)
  const pushStart = Math.floor(sampleRate * RETRO_PUSH_START_S)

  // 三层合成：**按键定标**——按键是这一声的起手，必须保持全局最强；
  // 棘轮与铃的峰值分别限制在按键峰值的 0.6 / 0.8 以内（噪声床的随机尖峰否则会把按键压小，
  // 实测约 30% 的噪声种子下棘轮会盖过按键）
  const layerPeak = (a: Float32Array, from: number, to: number): number => {
    let pk = 0
    for (let i = from; i < to; i++) pk = Math.max(pk, Math.abs(a[i]))
    return pk
  }
  const strikePeak = layerPeak(strike, 0, n) || 1
  let pushGain = Math.min(1, (strikePeak * 0.6) / (layerPeak(pushLayer, pushStart, n) || 1))
  let bellGain = Math.min(1, (strikePeak * 0.8) / (layerPeak(bellLayer, 0, n) || 1))
  // 棘轮与铃有时间重叠（240-330ms 两者同时在响），叠加后仍可能超过按键 → 按叠加峰值再压一档
  let overlapPeak = 0
  for (let i = 0; i < n; i++) overlapPeak = Math.max(overlapPeak, Math.abs(pushLayer[i] * pushGain + bellLayer[i] * bellGain))
  if (overlapPeak > strikePeak * 0.85) {
    const k = (strikePeak * 0.85) / overlapPeak
    pushGain *= k
    bellGain *= k
  }

  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = strike[i] + pushLayer[i] * pushGain + bellLayer[i] * bellGain

  fadeOut(out, sampleRate, RETRO_FADE_OUT_S) // 铃的余振被缓冲截断，直接切会有咔哒声
  normalize(out)
  return out
}

/**
 * 独立「棘轮（推回车）」音色（纯函数，可单测）：把推回车那一段单独成声（0.3s），
 * 起点对齐到 0、末尾 30ms 淡出、峰值归一化——与「复古打字机」里的棘轮同一套合成参数。
 */
export function renderRetroPush(sampleRate: number, rand: () => number = Math.random): Float32Array {
  const { push } = retroLayers(sampleRate, rand)
  const n = Math.max(1, Math.floor(sampleRate * RETRO_PUSH_ONLY_DURATION_S))
  const shift = Math.floor(sampleRate * RETRO_PUSH_START_S)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const src = i + shift
    out[i] = src < push.length ? push[src] : 0
  }
  fadeOut(out, sampleRate, 0.03)
  normalize(out)
  return out
}

/**
 * 独立「回车铃」音色（纯函数，可单测）：把铃单独成声（0.8s），起点对齐到 0、
 * 末尾 60ms 淡出、峰值归一化——与「复古打字机」里的铃同一套分音与衰减。
 */
export function renderRetroBell(sampleRate: number, rand: () => number = Math.random): Float32Array {
  const { bell } = retroLayers(sampleRate, rand)
  const n = Math.max(1, Math.floor(sampleRate * RETRO_BELL_ONLY_DURATION_S))
  const shift = Math.floor(sampleRate * RETRO_BELL_START_S)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const src = i + shift
    out[i] = src < bell.length ? bell[src] : 0
  }
  fadeOut(out, sampleRate, RETRO_FADE_OUT_S)
  normalize(out)
  return out
}

export interface CaretSound {
  /**
   * 播放一次回车音；volumePct 为 0-100。
   * opts.skipConsecutive：连续换行屏蔽（一串快速换行只有第一次发声，见 gateReturn）
   */
  playReturn(volumePct: number, variant?: SoundVariant, opts?: { skipConsecutive?: boolean }): void
  /** 释放音频上下文（关闭音效 / 组件卸载时调用） */
  dispose(): void
}

/** 创建回车音效合成器（AudioContext 懒创建：首次播放时才建，打字本身即用户手势，满足自动播放策略） */
export function createCaretSound(): CaretSound {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let lastReturnAt = 0
  let lastPlayedAt = 0
  let rotateIndex = 0
  /** 正在播放的节点：同一音色再次触发时先停掉上一声，避免叠加成噪音（异种音色可共存） */
  const active = new Map<ConcreteVariant, AudioScheduledSourceNode[]>()
  /** 波形缓存：三种音色各渲染一次（按 `${variant}@${sampleRate}` 键），避免每次回车重算 */
  const buffers = new Map<string, AudioBuffer>()

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

  // ---------- 波形缓存与播放（三种音色同一套路径：单缓冲 + 速率抖动 + 高频滚降） ----------
  const ensureBuffer = (variant: ConcreteVariant): AudioBuffer | null => {
    if (!ctx) return null
    const key = `${variant}@${ctx.sampleRate}`
    const cached = buffers.get(key)
    if (cached) return cached
    const render = variant === 'carriage' ? renderRetroPush : variant === 'bell' ? renderRetroBell : renderRetroReturn
    const data = render(ctx.sampleRate)
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate)
    buffer.getChannelData(0).set(data)
    buffers.set(key, buffer)
    return buffer
  }

  const playBuffer = (variant: ConcreteVariant, gain: number, lowpass: number): void => {
    if (!ctx || !master) return
    const buffer = ensureBuffer(variant)
    if (!buffer) return
    const now = ctx.currentTime
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.04 // ±4% 速率抖动（铃与棘轮的音高随之微变）
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = lowpass // 实录音效在 12kHz 以上能量很低，收一点毛刺
    const env = ctx.createGain()
    env.gain.setValueAtTime(gain, now)
    source.connect(tone).connect(env).connect(master)
    source.start(now)
    source.onended = () => {
      source.disconnect()
      tone.disconnect()
      env.disconnect()
    }
    trackVoice(variant, source)
  }

  return {
    playReturn(volumePct: number, variant: SoundVariant = 'retro', opts?: { skipConsecutive?: boolean }): void {
      const volume = Math.min(100, Math.max(0, volumePct))
      if (volume <= 0) return
      const now = performance.now()
      const gate = gateReturn(now, { lastReturnAt, lastPlayedAt }, opts?.skipConsecutive ?? false)
      lastReturnAt = gate.next.lastReturnAt
      lastPlayedAt = gate.next.lastPlayedAt
      if (!gate.play) return
      if (!ensureContext() || !ctx) return

      const picked = resolveVariant(variant, rotateIndex)
      rotateIndex = picked.nextIndex
      const scale = (volume / 100) * GAIN_SCALE
      switch (picked.variant) {
        case 'carriage':
          playBuffer('carriage', 0.95 * scale, 11000)
          break
        case 'bell':
          playBuffer('bell', 0.95 * scale, 13000)
          break
        default:
          // retro：三段完整回车（旧版音色的过期值也会落到这里，见启动时的设置迁移）
          playBuffer('retro', 0.95 * scale, 11000)
      }
    },

    dispose(): void {
      lastReturnAt = 0
      lastPlayedAt = 0
      rotateIndex = 0
      buffers.clear()
      active.clear()
      const closing = ctx
      ctx = null
      master = null
      if (closing && closing.state !== 'closed') void closing.close()
    }
  }
}
