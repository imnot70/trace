import { describe, expect, it } from 'vitest'
import { Vim } from '@replit/codemirror-vim'
import {
  buildVimExtension,
  formatVimModeLabel,
  shouldYieldEscapeToVim,
  VIM_YIELDED_KEYS
} from '../src/renderer/src/lib/vimMode'

describe('Vim 模式：Esc 让位判定（FR-2.4.23 拍板：浮层优先、心流退出让位）', () => {
  it('vim 未开启时不让位（应用级 Esc 回退行为完全不变）', () => {
    expect(shouldYieldEscapeToVim(false, true)).toBe(false)
    expect(shouldYieldEscapeToVim(false, false)).toBe(false)
  })

  it('vim 开启且编辑器聚焦：Esc 让位给 vim（返回 normal，退出心流走 Alt+W）', () => {
    expect(shouldYieldEscapeToVim(true, true)).toBe(true)
  })

  it('vim 开启但焦点不在编辑器：不让位（维持 Esc 退出心流等现有动线）', () => {
    expect(shouldYieldEscapeToVim(true, false)).toBe(false)
  })
})

describe('Vim 模式：键位冲突卸载（应用优先）', () => {
  it('让渡键清单恰为与应用相撞的六键（CM5 记法）', () => {
    expect(VIM_YIELDED_KEYS).toEqual(['<C-f>', '<C-b>', '<C-e>', '<C-i>', '<C-n>', '<C-t>'])
  })

  it('构建扩展幂等且不抛错（返回 CM 扩展）', () => {
    const ext = buildVimExtension()
    expect(ext).toBeTruthy()
    expect(() => buildVimExtension()).not.toThrow()
  })

  it('构建扩展后，让渡键已从包内全局键位表移除（再次 unmap 无匹配）', () => {
    buildVimExtension()
    // 包内 unmap 的运行时签名允许省略 ctx（d.ts 声明为必选）
    const unmap = Vim.unmap as unknown as (lhs: string, ctx?: string) => unknown
    for (const key of VIM_YIELDED_KEYS) {
      expect(unmap(key)).toBeFalsy()
    }
  })
})

describe('Vim 模式：徽标文案', () => {
  it('基础模式大写化', () => {
    expect(formatVimModeLabel('normal')).toBe('NORMAL')
    expect(formatVimModeLabel('insert')).toBe('INSERT')
    expect(formatVimModeLabel('visual')).toBe('VISUAL')
  })

  it('子模式缩写（避免胶囊过宽）', () => {
    expect(formatVimModeLabel('visual line')).toBe('V-LINE')
    expect(formatVimModeLabel('visual block')).toBe('V-BLOCK')
  })
})
