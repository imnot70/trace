import { describe, expect, it } from 'vitest'
import { createDoubleShiftDetector, DOUBLE_SHIFT_WINDOW_MS } from '../src/renderer/src/lib/doubleShift'

/** 构造仅含检测器关心的字段的伪键盘事件 */
function ev(p: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'Shift',
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...p
  } as KeyboardEvent
}

/** 可手动推进的时钟 */
function fakeClock() {
  let t = 1000
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

function setup() {
  const clock = fakeClock()
  let fired = 0
  const detector = createDoubleShiftDetector(() => fired++, clock.now)
  return { detector, advance: clock.advance, fired: () => fired }
}

describe('Double-Shift 检测（FR-2.9.11 当前库搜索）', () => {
  it('窗口内连按两次触发一次', () => {
    const s = setup()
    expect(s.detector.onKeyDown(ev())).toBe(false)
    s.advance(100)
    expect(s.detector.onKeyDown(ev())).toBe(true)
    expect(s.fired()).toBe(1)
  })

  it('超过时间窗不触发（≥ 350ms）', () => {
    const s = setup()
    s.detector.onKeyDown(ev())
    s.advance(DOUBLE_SHIFT_WINDOW_MS)
    expect(s.detector.onKeyDown(ev())).toBe(false)
    expect(s.fired()).toBe(0)
  })

  it('单次按下不触发', () => {
    const s = setup()
    s.detector.onKeyDown(ev())
    expect(s.fired()).toBe(0)
  })

  it('中间按过其他键则计数清零', () => {
    const s = setup()
    s.detector.onKeyDown(ev())
    s.detector.onKeyDown(ev({ key: 'a' }))
    s.advance(50)
    expect(s.detector.onKeyDown(ev())).toBe(false)
    expect(s.fired()).toBe(0)
  })

  it('长按重复（repeat）不参与计数', () => {
    const s = setup()
    s.detector.onKeyDown(ev())
    s.detector.onKeyDown(ev({ repeat: true }))
    s.advance(50)
    expect(s.detector.onKeyDown(ev())).toBe(false)
    expect(s.fired()).toBe(0)
  })

  it('输入法组词中的 Shift 清零（中文输入法切换中英文常用 Shift）', () => {
    const s = setup()
    s.detector.onKeyDown(ev())
    s.detector.onKeyDown(ev({ isComposing: true }))
    s.advance(50)
    expect(s.detector.onKeyDown(ev())).toBe(false)
    expect(s.fired()).toBe(0)
  })

  it('带其他修饰键的 Shift 不计数（Ctrl+Shift+H 等快捷键不受干扰）', () => {
    const s = setup()
    s.detector.onKeyDown(ev())
    s.detector.onKeyDown(ev({ ctrlKey: true }))
    s.advance(50)
    expect(s.detector.onKeyDown(ev())).toBe(false)
    expect(s.fired()).toBe(0)
  })

  it('触发后自动重置，需重新连按', () => {
    const s = setup()
    s.detector.onKeyDown(ev())
    s.advance(50)
    expect(s.detector.onKeyDown(ev())).toBe(true)
    s.advance(50)
    expect(s.detector.onKeyDown(ev())).toBe(false)
    expect(s.fired()).toBe(1)
  })

  it('reset 手动清零', () => {
    const s = setup()
    s.detector.onKeyDown(ev())
    s.detector.reset()
    s.advance(50)
    expect(s.detector.onKeyDown(ev())).toBe(false)
    expect(s.fired()).toBe(0)
  })
})
