import { describe, expect, it, vi, afterEach } from 'vitest'

/**
 * 窗口玻璃效果应用逻辑：
 * - Windows：仅窗口不透明度（透明窗口会剥离原生标题栏，材质一律不可见）
 * - macOS：vibrancy / 关闭
 * - Linux：透明背景色（依赖桌面合成器）
 */
import { applyWindowGlassEffect } from '../src/main/services/windowEffect'
import type { AppSettings } from '../src/shared/types'

interface MockWin {
  isDestroyed: () => boolean
  setOpacity: (v: number) => void
  setBackgroundMaterial: (m: string) => void
  setVibrancy: (v: string | null) => void
  setBackgroundColor: (c: string) => void
}

function mockWindow(): MockWin & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {}
  const record = (name: string) => (...args: unknown[]) => {
    calls[name] = calls[name] ?? []
    calls[name].push(args)
  }
  return {
    calls,
    isDestroyed: () => false,
    setOpacity: record('setOpacity'),
    setBackgroundMaterial: record('setBackgroundMaterial'),
    setVibrancy: record('setVibrancy'),
    setBackgroundColor: record('setBackgroundColor')
  }
}

function settings(patch: Partial<AppSettings>): AppSettings {
  return {
    windowGlassEffect: 'auto',
    windowOpacity: 100,
    theme: 'system',
    ...patch
  } as AppSettings

}

/** windowEffect 内联读取 process.platform，stub 后需还原 */
function stubPlatform(value: string): void {
  vi.stubGlobal('process', { ...process, platform: value })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('applyWindowGlassEffect · win32', () => {
  it('仅应用透明度，不设置任何背景材质', () => {
    stubPlatform('win32')
    const win = mockWindow()
    applyWindowGlassEffect(win as never, settings({ windowGlassEffect: 'mica', windowOpacity: 80 }))
    expect(win.calls.setOpacity).toEqual([[0.8]])
    expect(win.calls.setBackgroundMaterial).toBeUndefined()
    expect(win.calls.setVibrancy).toBeUndefined()
  })

  it('透明度 100 时重置为 1.0', () => {
    stubPlatform('win32')
    const win = mockWindow()
    applyWindowGlassEffect(win as never, settings({ windowGlassEffect: 'auto', windowOpacity: 100 }))
    expect(win.calls.setOpacity).toEqual([[1.0]])
  })

  it('效果为 none 时同样只应用透明度', () => {
    stubPlatform('win32')
    const win = mockWindow()
    applyWindowGlassEffect(win as never, settings({ windowGlassEffect: 'none', windowOpacity: 100 }))
    expect(win.calls.setOpacity).toEqual([[1.0]])
    expect(win.calls.setBackgroundMaterial).toBeUndefined()
  })
})

describe('applyWindowGlassEffect · darwin', () => {
  it('auto 按主题应用 vibrancy', () => {
    stubPlatform('darwin')
    const win = mockWindow()
    applyWindowGlassEffect(win as never, settings({ windowGlassEffect: 'auto', theme: 'dark' }))
    expect(win.calls.setVibrancy).toEqual([['dark']])
  })

  it('none 时移除 vibrancy', () => {
    stubPlatform('darwin')
    const win = mockWindow()
    applyWindowGlassEffect(win as never, settings({ windowGlassEffect: 'none' }))
    expect(win.calls.setVibrancy).toEqual([[null]])
  })
})

describe('applyWindowGlassEffect · linux', () => {
  it('auto 时设置透明背景色（依赖合成器）', () => {
    stubPlatform('linux')
    const win = mockWindow()
    applyWindowGlassEffect(win as never, settings({ windowGlassEffect: 'auto' }))
    expect(win.calls.setBackgroundColor).toEqual([['#00000000']])
    expect(win.calls.setBackgroundMaterial).toBeUndefined()
  })

  it('none 时不设置背景色', () => {
    stubPlatform('linux')
    const win = mockWindow()
    applyWindowGlassEffect(win as never, settings({ windowGlassEffect: 'none' }))
    expect(win.calls.setBackgroundColor).toBeUndefined()
  })
})

describe('applyWindowGlassEffect · 边界', () => {
  it('窗口已销毁时不做任何调用', () => {
    stubPlatform('win32')
    const win = mockWindow()
    win.isDestroyed = () => true
    applyWindowGlassEffect(win as never, settings({ windowOpacity: 50 }))
    expect(win.calls.setOpacity).toBeUndefined()
  })
})
