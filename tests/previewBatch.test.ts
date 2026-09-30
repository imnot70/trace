import { describe, expect, it } from 'vitest'
import { buildWindowTitle } from '../src/renderer/src/lib/windowTitle'
import { wikilinkNameAt, wikilinkSpanAt } from '../src/renderer/src/lib/wikiTarget'

describe('窗口标题跟随当前笔记（FR-2.10.7）', () => {
  const cur = { vault: '测试库', name: '随笔' }
  it('常规：纯笔记名（2026-09-30 修订：去掉应用名后缀避免与内容区误解）', () => {
    expect(buildWindowTitle(cur, false)).toBe('随笔')
  })
  it('心流：「库名 / 笔记名」（顶栏隐藏后标题让给路径）', () => {
    expect(buildWindowTitle(cur, true)).toBe('测试库 / 随笔')
  })
  it('无笔记恢复默认', () => {
    expect(buildWindowTitle(null, false)).toBe('Trace 笔迹')
    expect(buildWindowTitle(null, true)).toBe('Trace 笔迹')
  })
})

describe('光标处双链识别（FR-2.4.27 Alt+Enter 悬浮预览）', () => {
  const line = '前文 [[随笔|草稿名]] 后文 [[dir/笔记]] 尾'
  it('内部命中：取 | 前为目标名', () => {
    expect(wikilinkNameAt(line, 6)).toBe('随笔')
    expect(wikilinkNameAt(line, 10)).toBe('随笔')
    expect(wikilinkNameAt(line, 22)).toBe('dir/笔记')
  })
  it('严格内部：边界（括号上）不命中', () => {
    expect(wikilinkNameAt(line, 3)).toBeNull() // 首 [
    expect(wikilinkNameAt(line, 13)).toBeNull() // 尾 ] 后
    expect(wikilinkNameAt(line, 0)).toBeNull()
  })
  it('行外偏移 / 无双链 → null；空目标名 → null', () => {
    expect(wikilinkNameAt(line, 100)).toBeNull()
    expect(wikilinkNameAt('普通文本', 2)).toBeNull()
    expect(wikilinkNameAt('[[]]', 2)).toBeNull()
  })
})

describe('光标处双链 span（FR-2.4.27 复验：引用内落引用分流）', () => {
  const line = '前 [[随笔]] 中 [[dir/笔记]] 尾'
  it('span 命中：name + 起止偏移（start 指 [、end 越 ]）', () => {
    expect(wikilinkSpanAt(line, 4)).toEqual({ name: '随笔', start: 2, end: 8 })
    expect(wikilinkSpanAt(line, 16)).toEqual({ name: 'dir/笔记', start: 11, end: 21 })
  })
  it('边界与外部 → null（与 wikilinkNameAt 同口径）', () => {
    expect(wikilinkSpanAt(line, 2)).toBeNull()
    expect(wikilinkSpanAt(line, 9)).toBeNull()
    expect(wikilinkSpanAt(line, 0)).toBeNull()
  })
})
