/**
 * 心流模式回车音效：Web Audio 程序合成的键盘音色。
 * 无音频文件、零安装包体积、无版权问题；音色与触发契约见 ai/requirements/2026-09-23_flow-mode/flow-mode_design.md。
 *
 * 四种音色（设置项 flowSoundVariant；后三者均按用户提供的实录音效实测特征合成）：
 * - carriage 推回车「棘轮」：约 0.26s 的一串齿（间隔 9ms 渐密到 6ms、振幅渐强）；
 * - bell     回车铃「叮」：2742 / 6527 / 9700 / 11449Hz 四个分音，余振约 0.7s
 *           （2026-09-27 按用户反馈：尾部颤音衰减 +15%、颤音段音量 +10%、整段放长到 0.95s、
 *           末段 0.3s 余弦渐弱收尾）；
 * - retro    复古打字机「回车」：四段结构（2026-09-27 按用户提供的参考音频全量复刻，分析见 10.14）——
 *           ① 0ms 按键：宽带咔 + 实测 14 个微冲击（间隔 2-8ms、42ms 处最强）+ 字锤/纸卷共振（0.75k / 1.2kHz）+ 延迟 ~590ms 的到位「咚」（165/275Hz）；
 *           ② 380ms 推回车：约 0.19s / 50 颗细密棘轮齿（间隔 2-5ms、振幅渐强；实测齿间隔 1-6ms）；
 *           ③ 590ms 到位「咚」：低频机体撞击 + 高频瞬态（参考 0.70s 处的 162/275/750Hz 成分）；
 *           ④ 890ms 回车铃：2743 / 6528 / 11449Hz 分音（9700 弱化），τ≈0.68s 自然衰减（参考实测），整段 1.55s。
 *           不随包音频文件，仅按实测声学特征重建（分析与比对见 flow-mode_design.md 第 10.14 节）；
 * - rotate  轮换：每次回车依次使用上面三种，避免长时间写作的重复感。
 * 说明：旧的木质 / 金属 / 打字机棘齿三种音色已于 2026-09-24 下线，设置项旧值在启动时迁移到 retro。
 */

export type SoundVariant = 'carriage' | 'bell' | 'retro' | 'rotate'

/** 可轮换的具体音色（rotate 会在这几者间循环） */
export const CONCRETE_VARIANTS = ['carriage', 'bell', 'retro'] as const
export type ConcreteVariant = (typeof CONCRETE_VARIANTS)[number]

/** 连续回车的限流窗口：窗口内的重复触发直接丢弃（避免机关枪） */
export const SOUND_MIN_INTERVAL_MS = 120

/** 音量上限系数：主增益 = volume/100 × 0.6（2026-09-27 用户反馈整体加大 20%，原 0.5；归一化后峰值 0.95×0.95×0.6 ≈ 0.54，仍有余量防爆音） */
const GAIN_SCALE = 0.6

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
    midFreq: jitter(1200, 0.06), // 字锤共振（参考按键窗实测 1120-1370Hz）
    midDecay: jitter(0.016, 0.15),
    plankFreq: jitter(750, 0.06), // 纸卷共振（参考 750Hz）
    plankDecay: jitter(0.02, 0.15),
    bodyFreq1: jitter(165, 0.07), // 到位「咚」（参考 0.70s 处 162/275Hz）
    bodyFreq2: jitter(275, 0.07),
    thunkDelay: jitter(0.59, 0.01), // 推车到位时刻（参考 0.70s - 按键 0.11s）
    thunkDecay: jitter(0.1, 0.12),
    bellDetune: 1 + (rand() * 2 - 1) * 0.004
  }
}

/** 整段「回车」的时长（秒）：咔 → 推回车 → 到位咚 → 铃余振（2026-09-27 按参考音频 1.695s 的
 *  实测时间轴复刻：按键 0-90ms、棘轮 380-570ms、咚 590ms、铃 890ms 起自然衰减） */
export const RETRO_DURATION_S = 1.55
/** 推回车（棘轮）的起始与时长（参考 0.49-0.68s，相对按键起点 0.38s 起、长 0.19s） */
export const RETRO_PUSH_START_S = 0.38
export const RETRO_PUSH_DURATION_S = 0.19
/** 「复古打字机」整声里棘轮去掉的开头颗数（2026-09-27 用户反馈减 2 颗；独立「推回车」音色不受影响） */
export const RETRO_RATCHET_SKIP_TEETH = 2
/** 回车铃的起始（参考 1.00s 铃正式鸣响，相对按键起点 0.89s） */
export const RETRO_BELL_START_S = 0.89
/** 复古打字机里铃的衰减缩放（2026-09-27 参考比对：参考「叮」的 RMS 峰后 100ms 掉 ~80%，
 *  快衰减 + 微弱长尾；独立「回车铃」保持 1.15 慢衰减的已确认口径，两路径各自缩放） */
export const BELL_DECAY_SCALE_RETRO = 0.22
/** 缓冲末尾的淡出时长（秒）：铃的余振被截断处需要淡出，否则会有咔哒声 */
export const RETRO_FADE_OUT_S = 0.06

/** 独立「回车铃」专属：尾部颤音衰减放长系数（+15%，2026-09-27 用户反馈「过于短促、
 *  人耳只能听到尖锐部分」——四个分音的衰减时间常数统一 ×1.15，余振听感更长；
 *  仅作用于独立「回车铃」，复古打字机里的铃保持 2026-09-26 试听确认过的口径） */
export const BELL_TAIL_DECAY_SCALE = 1.15
/** 独立「回车铃」专属：颤音段音量提升（+10%，起音段不变） */
export const BELL_TAIL_GAIN = 1.1
/** 颤音段音量爬升的起点与过渡时长（秒）：起音 80ms 后开始爬升、60ms 平滑过渡避免台阶感 */
export const BELL_TAIL_RAMP_START_S = 0.08
export const BELL_TAIL_RAMP_S = 0.06
/** 末段余音渐弱的时长（秒）：0.3s 余弦缓降 1→0（2026-09-27 二轮反馈「最后有些戛然而止」
 *  ——长度不变，收尾从 60ms 线性淡出改为更长的余弦曲线，听感是「融进安静」而非「被切断」） */
export const BELL_TAIL_OFF_S = 0.3

/** 按键的微冲击（2026-09-27 参考音频实测：0-90ms 内 14 个能量峰，间隔 2-8ms、42ms 处最强；
 *  amp 按实测峰值 / 0.058 归一） */
const RETRO_IMPACTS = [
  { t: 0.002, amp: 0.36, tone: 1 },
  { t: 0.004, amp: 0.34, tone: 1 },
  { t: 0.006, amp: 0.41, tone: 1 },
  { t: 0.008, amp: 0.47, tone: 1 },
  { t: 0.012, amp: 0.36, tone: 0.9 },
  { t: 0.015, amp: 0.48, tone: 0.9 },
  { t: 0.024, amp: 0.59, tone: 0.85 },
  { t: 0.032, amp: 1, tone: 0.8 },
  { t: 0.04, amp: 0.64, tone: 0.8 },
  { t: 0.045, amp: 0.53, tone: 0.75 },
  { t: 0.051, amp: 0.31, tone: 0.7 },
  { t: 0.054, amp: 0.55, tone: 0.7 },
  { t: 0.072, amp: 0.48, tone: 0.65 },
  { t: 0.078, amp: 0.38, tone: 0.65 }
] as const

/**
 * 回车铃的分音（实测：2742 / 6527 / 9700 / 11449Hz，衰减 0.22–0.42s）。
 * 铃在实录音效里是「高频亮 ting + 中频泛音」，这里保留四个分音以还原那种清脆感。
 */
export const RETRO_BELL_PARTIALS = [
  // 参考第二响的成分排序 6530 > 11450 > 2740（2026-09-27 实测）：主音是高频对，
  // 2743 幅度低但 τ 最长（微弱长余振的担当）；9700 不显著仅保留
  { freq: 2743, amp: 0.3, decay: 0.68 },
  { freq: 6528, amp: 0.575, decay: 0.4 },
  { freq: 9700, amp: 0.12, decay: 0.32 },
  { freq: 11449, amp: 0.28, decay: 0.28 }
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
    // 参考实测齿间隔以 1-6ms 为主（较旧参考更细密）：基线 4.5ms 渐收到 2ms、±40% 抖动
    const gap = (0.0045 - 0.0025 * progress) * (1 + (rand() - 0.5) * 0.8)
    clicks.push({
      t,
      freq: 1500 + rand() * 1200, // 参考「铁皮」棘轮的金属高频（1.5-2.7kHz）
      amp: 0.4 + 0.6 * Math.min(1, progress * 1.3)
    })
    t += Math.max(0.0008, gap)
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

/** 独立「棘轮（推回车）」的时长（秒）：对齐新参考的棘轮段 0.19s + 余量 */
export const RETRO_PUSH_ONLY_DURATION_S = 0.22
/** 独立「回车铃」的时长（秒）：0.8 → 0.95（2026-09-27 颤音衰减放长 15% 后按原截断比例
 *  同步放长缓冲，避免更长的尾音被硬截在半途） */
export const RETRO_BELL_ONLY_DURATION_S = 0.95

/** 铃分音层（纯渲染，可单测；导出供调音对比测试）：四个分音各自指数衰减 + 1.5ms 起音。
 *  n = 采样点数；decayScale 缩放全部衰减时间常数（独立回车铃 +15% 用，复古打字机传 1）。
 *  铃不依赖噪声床，独立生成即可与三段合成共用同一套参数。 */
export function renderBellLayer(
  sampleRate: number,
  p: RetroParams,
  n: number,
  decayScale: number,
  startDelayS = 0
): Float32Array {
  const out = new Float32Array(n)
  const tau = 2 * Math.PI
  const bell = RETRO_BELL_PARTIALS.map((b) => ({ ...b, freq: b.freq * p.bellDetune }))
  for (let i = 0; i < n; i++) {
    const dBell = i / sampleRate - startDelayS
    if (dBell < 0) continue
    const attack = 1 - Math.exp(-dBell / 0.0015) // 1.5ms 起音，避免爆音
    // 双指数包络：快主音（听感的「叮」）+ 6% 幅度的五倍慢尾（参考里 2743Hz 的微弱长余振）
    for (const b of bell) {
      const d = b.decay * decayScale
      const envelope = Math.exp(-dBell / d) + 0.06 * Math.exp(-dBell / (d * 5))
      out[i] += Math.sin(tau * b.freq * dBell) * envelope * b.amp * attack
    }
  }
  return out
}

/** 三层波形（长度 = RETRO_DURATION_S）：按键（含机体咚）/ 推回车棘轮 / 回车铃。
 *  skipRatchetTeeth：去掉棘轮序列开头 N 颗——独立「推回车」音色保持完整序列，
 *  「复古打字机」整声按用户反馈减 2 颗（2026-09-27） */
function retroLayers(sampleRate: number, rand: () => number, skipRatchetTeeth = 0): { strike: Float32Array; push: Float32Array; bell: Float32Array } {
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
    lp += (hp - lp) * 0.85
    noise[i] = lp
  }

  const tau = 2 * Math.PI
  const push = returnRatchetSchedule(rand).slice(skipRatchetTeeth)

  const strike = new Float32Array(n)
  const pushLayer = new Float32Array(n)
  // 铃在 890ms（推车到位后）才起振——参考时间轴，快衰减口径；独立「回车铃」用 startDelay 0 自行成声
  const bellLayer = renderBellLayer(sampleRate, p, n, BELL_DECAY_SCALE_RETRO, RETRO_BELL_START_S)

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
      strike[i] += (Math.sin(tau * p.bodyFreq1 * dThunk) * 0.24 + Math.sin(tau * p.bodyFreq2 * dThunk) * 0.14) * env
    }
    // ② 推回车的棘轮齿
    for (const c of push) {
      const dt = t - (RETRO_PUSH_START_S + c.t)
      if (dt < 0 || dt > 0.025) continue
      pushLayer[i] += noise[i] * Math.exp(-dt / 0.004) * 0.9 * c.amp
      pushLayer[i] += Math.sin(tau * c.freq * dt) * Math.exp(-dt / 0.0018) * 1.3 * c.amp
    }
  }

  return { strike, push: pushLayer, bell: bellLayer }
}

/**
 * 渲染一次「复古打字机回车」波形（纯函数，可单测）。四段结构（2026-09-27 按参考音频实测复刻，见设计文档 10.14）：
 * ① 0ms   按键：噪声脉冲（一阶高通 + 低通整形）+ 实测 14 个微冲击 + 字锤 / 纸卷共振；
 * ② 380ms 推回车：约 50 颗细密棘轮齿（间隔 2-5ms、振幅渐强；开头 2 颗去掉）；
 * ③ 590ms 到位「咚」：低频机体撞击（165/275Hz）；
 * ④ 890ms 回车铃：分音（2.7k / 6.5k / 9.7k弱 / 11.4kHz）按 τ≈0.68s 自然衰减，整段 1.55s、末尾 60ms 淡出。
 */
export function renderRetroReturn(sampleRate: number, rand: () => number = Math.random): Float32Array {
  const n = Math.max(1, Math.floor(sampleRate * RETRO_DURATION_S))
  const { strike, push: pushLayer, bell: bellLayer } = retroLayers(sampleRate, rand, RETRO_RATCHET_SKIP_TEETH)
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
 * 独立「回车铃」音色（纯函数，可单测）：单独成声（0.95s），起点对齐到 0、末尾 60ms 淡出、
 * 峰值归一化。2026-09-27 按用户反馈调整「过于短促、只听得到尖锐起音」：
 * ① 尾部颤音衰减时间常数 ×1.15（余振更长），缓冲同步放长到 0.95s 避免硬截；
 * ② 起音 80ms 后的颤音段音量 +10%（60ms 平滑爬升）——在**归一化之后**施加，
 *    否则位于起音处的全局峰值归一化会把相对提升抵消掉；尾段振幅远低于峰值，无削波风险。
 * ③ 末段 0.3s 余弦渐弱收尾（二轮反馈「戛然而止」）——在颤音提升之后施加，终点精确为 0。
 * 复古打字机整声里的铃不受影响（其口径 2026-09-26 试听确认过）。
 */
export function renderRetroBell(sampleRate: number, rand: () => number = Math.random): Float32Array {
  const p = retroParams(rand)
  const n = Math.max(1, Math.floor(sampleRate * RETRO_BELL_ONLY_DURATION_S))
  const out = renderBellLayer(sampleRate, p, n, BELL_TAIL_DECAY_SCALE)
  normalize(out)
  applyBellTailGain(out, sampleRate)
  applyBellTailOff(out, sampleRate)
  return out
}

/** 末段余音渐弱（纯函数，可单测）：末尾 BELL_TAIL_OFF_S 内余弦缓降 1→0。
 *  余弦端点导数为 0——起点无台阶、终点无咔哒；曲线前半下降慢、后半快，
 *  与指数衰减叠加后听感是「逐渐沉入安静」而不是戛然而止 */
export function applyBellTailOff(buf: Float32Array, sampleRate: number): void {
  const off = Math.min(buf.length, Math.floor(sampleRate * BELL_TAIL_OFF_S))
  const from = buf.length - off
  for (let i = from; i < buf.length; i++) {
    const x = (i - from) / off
    buf[i] *= 0.5 * (1 + Math.cos(Math.PI * x))
  }
}

/** 颤音段音量提升（纯函数，可单测）：[起点, 起点+过渡) 线性爬升到 +10%，其后全段乘定值。
 *  必须在归一化之后调用——峰值在起音处，先提升再归一会被整体缩放抵消 */
export function applyBellTailGain(buf: Float32Array, sampleRate: number): void {
  const rampFrom = Math.min(buf.length, Math.floor(sampleRate * BELL_TAIL_RAMP_START_S))
  const rampTo = Math.min(buf.length, Math.floor(sampleRate * (BELL_TAIL_RAMP_START_S + BELL_TAIL_RAMP_S)))
  const span = Math.max(1, rampTo - rampFrom)
  for (let i = rampFrom; i < rampTo; i++) buf[i] *= 1 + (BELL_TAIL_GAIN - 1) * ((i - rampFrom) / span)
  for (let i = rampTo; i < buf.length; i++) buf[i] *= BELL_TAIL_GAIN
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
