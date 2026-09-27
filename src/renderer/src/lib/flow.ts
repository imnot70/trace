/**
 * 心流模式（Flow Mode）的纯逻辑：写作栏宽映射与打字机形态推导。
 * 会话状态（进入 / 退出的快照还原）在 app store；视图层只消费这里的纯函数。
 * 见 ai/requirements/2026-09-23_flow-mode/。
 */
import type { TypewriterMode } from './typewriter'

/** 写作栏宽档位 → 文本列宽度（em，随编辑器字号缩放；中文约 1 字 ≈ 1em） */
export const FLOW_MEASURE_EM: Record<'narrow' | 'medium' | 'wide', number> = {
  narrow: 32,
  medium: 42,
  wide: 52
}

export function flowMeasureEm(width: 'narrow' | 'medium' | 'wide'): number {
  return FLOW_MEASURE_EM[width] ?? FLOW_MEASURE_EM.medium
}

/**
 * 进入心流瞬间的打字机形态推导（2026-09-27 语义收窄：只在进入那一刻用一次）：
 * - 用户已选高位 / 低位 → 沿用其偏好（心流不覆盖用户的选择）；
 * - 用户选的是关闭 → 心流模式内默认开启「低位」（创作场景的默认形态）。
 * 进入后形态记录为 app store 的会话态 flowTypewriter，心流内 Alt+T 三态循环
 * （高 ↔ 低 ↔ 关，「关」真实生效）不再经过本函数——此前「关闭在心流内被强制映射为
 * 低位」导致「关」不可表达（设置与观感矛盾），见
 * ai/requirements/2026-09-27_typewriter-padding-redesign/ D2。
 */
export function effectiveTypewriterMode(
  flowMode: boolean,
  mode: TypewriterMode,
  flowDefault: 'center' | 'bottom' = 'bottom'
): TypewriterMode {
  if (!flowMode) return mode
  return mode === 'off' ? flowDefault : mode
}

/** 心流内 Alt+T 的三态循环：高位 → 低位 → 关 → 高位 …（纯函数，可单测） */
export function nextTypewriterCycle(mode: TypewriterMode): TypewriterMode {
  return mode === 'center' ? 'bottom' : mode === 'bottom' ? 'off' : 'center'
}
