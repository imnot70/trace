/**
 * 心流模式（Flow Mode）的纯逻辑：写作栏宽映射与打字机形态推导。
 * 会话状态（进入 / 退出的快照还原）在 app store；视图层只消费这里的纯函数。
 * 见 requirements/2026-09-23_flow-mode/。
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
 * 心流模式内实际生效的打字机形态：
 * - 用户已选高位 / 低位 → 沿用其偏好（心流不覆盖用户的选择）；
 * - 用户选的是关闭 → 心流模式内默认开启「低位」（创作场景的默认形态）。
 * 注意：这里只做「推导」，不改写设置项本身——退出心流后，非心流场景仍按设置走，
 * 因此无需快照与还原（区别于侧栏 / 专注 / 预览 / 编辑形态这四项会话状态）。
 */
export function effectiveTypewriterMode(
  flowMode: boolean,
  mode: TypewriterMode,
  flowDefault: 'center' | 'bottom' = 'bottom'
): TypewriterMode {
  if (!flowMode) return mode
  return mode === 'off' ? flowDefault : mode
}
