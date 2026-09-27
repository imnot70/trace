/**
 * Double-Shift 连按检测（FR-2.9.11 当前库搜索触发）。
 *
 * 抽成纯状态机的原因：检测规则有多个边界（时间窗、中间键、repeat、输入法组词），
 * window keydown 里内联写无法单测。用法：
 *
 *   const detector = createDoubleShiftDetector(() => openSearch())
 *   window.addEventListener('keydown', detector.onKeyDown)
 *
 * 规则：
 * - 只认 Shift 主键按下（keydown key === 'Shift'）且非长按重复（e.repeat）；
 * - 两次按下间隔 < DOUBLE_SHIFT_WINDOW_MS 才触发，触发后自动重置；
 * - 期间按过任何其他键、或任一次按下发生在输入法组词中（e.isComposing，中文输入法
 *   切换中英文常用 Shift），计数清零；
 * - 修饰键组合（Ctrl+Shift 等）中的 Shift 也算「其他键」：keydown 事件本身带 ctrlKey
 *   等标志，onKeyDown 一并拒绝，避免 Ctrl+Shift+H 之类快捷键误积累计数。
 */

/** 两次 Shift 按下的最大间隔（毫秒） */
export const DOUBLE_SHIFT_WINDOW_MS = 350

export interface DoubleShiftDetector {
  /** 挂在 window keydown（冒泡阶段）上；返回 true 表示本次按下触发了 Double-Shift */
  onKeyDown: (e: KeyboardEvent) => boolean
  /** 手动清零（对话框打开 / 视图切换等场景防误触时调用） */
  reset: () => void
}

export function createDoubleShiftDetector(
  onTrigger: () => void,
  /** 时钟可注入（单测控制时间窗）；默认真实时钟 */
  now: () => number = Date.now
): DoubleShiftDetector {
  let lastShiftAt = 0

  return {
    onKeyDown(e: KeyboardEvent): boolean {
      if (e.isComposing) {
        lastShiftAt = 0
        return false
      }
      if (e.key !== 'Shift' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
        lastShiftAt = 0
        return false
      }
      const t = now()
      const hit = lastShiftAt > 0 && t - lastShiftAt < DOUBLE_SHIFT_WINDOW_MS
      lastShiftAt = hit ? 0 : t
      if (hit) {
        onTrigger()
        return true
      }
      return false
    },
    reset(): void {
      lastShiftAt = 0
    }
  }
}
