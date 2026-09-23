import { describe, expect, it } from 'vitest'

/**
 * 打字机模式纯函数单元测试：锚点比例、目标滚动位置、留白量、重锚事件判定。
 * 交互行为（不干预滚动 / 组词冻结 / 拖选挂起）依赖 CodeMirror 视图，见设计文档手动清单。
 */
import {
  ANCHOR_RATIO,
  anchorRatioFor,
  anchorScrollTop,
  isAnchorEvent,
  typewriterPadding
} from '../src/renderer/src/lib/typewriter'

describe('打字机模式：锚点比例', () => {
  it('高位居中 0.5，低位距底边 20%', () => {
    expect(anchorRatioFor('center')).toBe(0.5)
    expect(anchorRatioFor('bottom')).toBe(0.8)
    expect(ANCHOR_RATIO.center).toBe(0.5)
  })

  it('关闭时无锚点', () => {
    expect(anchorRatioFor('off')).toBeNull()
  })
})

describe('打字机模式：目标滚动位置', () => {
  const viewportTop = 100
  const viewportHeight = 800

  it('光标高于锚点线：向下滚动（滚动量增加）', () => {
    // 光标在视口顶部（y=100），目标锚点线 = 100 + 800×0.5 = 500
    const target = anchorScrollTop(100, viewportTop, viewportHeight, 0, 0.5)
    expect(target).toBe(0 + (100 - 500)) // = -400 → 由浏览器钳制为 0
  })

  it('光标低于锚点线：向上滚动（滚动量减少）', () => {
    // 光标在 y=900，锚点线 500 → 需要把内容往上推 400
    const target = anchorScrollTop(900, viewportTop, viewportHeight, 1000, 0.5)
    expect(target).toBe(1400)
  })

  it('光标恰在锚点线：滚动位置不变（幂等）', () => {
    // 当前滚动 1000、光标屏幕位置 = 锚点线时，目标位置应等于当前值
    const lineAt = viewportTop + viewportHeight * 0.8
    expect(anchorScrollTop(lineAt, viewportTop, viewportHeight, 1000, 0.8)).toBe(1000)
  })

  it('低位锚点比高位滚动更多（同一光标位置）', () => {
    const cursorTop = 900
    const center = anchorScrollTop(cursorTop, viewportTop, viewportHeight, 1000, 0.5)
    const bottom = anchorScrollTop(cursorTop, viewportTop, viewportHeight, 1000, 0.8)
    // 低位锚点线更低（560 → 锚点线 740），光标相对锚点线更靠下 → 需要滚动得更多
    expect(bottom).toBe(1000 + (900 - (100 + 640)))
    expect(bottom).toBeLessThan(center)
  })
})

describe('打字机模式：留白量', () => {
  it('高位：上下各半（首行与末行都能到达锚点）', () => {
    expect(typewriterPadding(0.5, 800)).toEqual({ top: 400, bottom: 400 })
  })

  it('低位：上少下多（0.8 → 上 640 / 下 160）', () => {
    expect(typewriterPadding(0.8, 800)).toEqual({ top: 640, bottom: 160 })
  })

  it('上下留白之和恒等于视口高', () => {
    for (const ratio of [0.5, 0.8]) {
      const { top, bottom } = typewriterPadding(ratio, 1000)
      expect(top + bottom).toBe(1000)
    }
  })
})

describe('打字机模式：重锚事件判定', () => {
  it('输入 / 删除 / 撤销重做 / 光标移动与点击均触发重锚', () => {
    for (const ev of [
      'input.type',
      'input.paste',
      'delete.backward',
      'undo',
      'redo',
      'select',
      'select.pointer',
      'move'
    ]) {
      expect(isAnchorEvent(ev), ev).toBe(true)
    }
  })

  it('程序化写入（无 userEvent）与未知事件不触发', () => {
    expect(isAnchorEvent('')).toBe(false)
    expect(isAnchorEvent('inputting')).toBe(false) // 前缀相似但不是该类别
    expect(isAnchorEvent('deleteMe')).toBe(false)
  })

  it('裸类别名同样匹配（CM6 的 undo / redo 即为无后缀的裸名）', () => {
    expect(isAnchorEvent('input')).toBe(true)
    expect(isAnchorEvent('undo')).toBe(true)
  })
})
