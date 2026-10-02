// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { resolveEditorMenu, placeMenu, type EditorMenuItem } from '../src/renderer/src/lib/contextMenu'

function mkState(doc: string, pos?: number, sel?: { from: number; to: number }): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
    selection: sel
      ? { anchor: sel.from, head: sel.to }
      : pos !== undefined
        ? { anchor: pos }
        : undefined
  })
}

const actions = (items: EditorMenuItem[]): string[] => items.map((i) => i.action)
const find = (items: EditorMenuItem[], action: string): EditorMenuItem | undefined =>
  items.find((i) => i.action === action)

describe('编辑器右键菜单模型 resolveEditorMenu（FR-2.4.28）', () => {
  it('无选中：剪切 / 复制禁用、粘贴可用；无格式节', () => {
    const state = mkState('普通段落文字\n', 4)
    const items = resolveEditorMenu(state, 4)
    expect(find(items, 'cut')?.disabled).toBe(true)
    expect(find(items, 'copy')?.disabled).toBe(true)
    expect(find(items, 'paste')?.disabled).toBeFalsy()
    expect(find(items, 'bold')).toBeUndefined()
  })

  it('有选中：剪切 / 复制可用 + 格式节五项（加粗/斜体/删除线/行内码/转为双链）', () => {
    const doc = '前面 选中文字 后面'
    const state = mkState(doc, undefined, { from: 3, to: 7 })
    const items = resolveEditorMenu(state, 5)
    expect(find(items, 'cut')?.disabled).toBe(false)
    expect(actions(items)).toEqual(
      expect.arrayContaining(['bold', 'italic', 'strike', 'inlineCode', 'wikify'])
    )
    // 格式节有分隔线（divided 在节首项）
    expect(find(items, 'bold')?.divided).toBe(true)
  })

  it('光标在双链上：打开笔记 + 复制引用文本（payload 为链名）', () => {
    const doc = '参见 [[日记/2026-09-30]] 的内容'
    const pos = doc.indexOf('09-30')
    const items = resolveEditorMenu(mkState(doc, pos), pos)
    expect(find(items, 'openNote')?.payload).toBe('日记/2026-09-30')
    expect(find(items, 'copyRef')?.divided).toBeFalsy()
    expect(find(items, 'openNote')?.divided).toBe(true)
    // 双链不弹链接项（无 URL 的 Link 不认，与 0.13.0 误涂修复同口径）
    expect(find(items, 'openExternal')).toBeUndefined()
  })

  it('光标在普通链接上：打开链接 + 复制链接地址（payload 为 URL）', () => {
    const doc = '看 [示例](https://example.com/a) 这个'
    const pos = doc.indexOf('example')
    const items = resolveEditorMenu(mkState(doc, pos), pos)
    expect(find(items, 'openExternal')?.payload).toBe('https://example.com/a')
    expect(find(items, 'copyLink')?.payload).toBe('https://example.com/a')
  })

  it('光标在图片上：在附件目录中显示 + 复制图片路径', () => {
    const doc = '![截图](attachments/1-x.png)'
    const pos = doc.indexOf('attachments')
    const items = resolveEditorMenu(mkState(doc, pos), pos)
    expect(find(items, 'revealImage')?.payload).toBe('attachments/1-x.png')
    expect(find(items, 'copyImagePath')?.payload).toBe('attachments/1-x.png')
  })

  it('位置节与选区可并存（先格式后位置，位置节带分隔线）', () => {
    const doc = '参见 [[目标]] 的内容'
    // 选区在前半、pos 落在双链上
    const wlStart = doc.indexOf('[[')
    const state = mkState(doc, wlStart + 3, { from: 0, to: 2 })
    const items = resolveEditorMenu(state, wlStart + 3)
    expect(find(items, 'bold')).toBeDefined()
    expect(find(items, 'openNote')?.payload).toBe('目标')
    expect(find(items, 'openNote')?.divided).toBe(true)
  })

  it('无上下文命中时只有剪贴板节（不弹空位节）', () => {
    const doc = '普通段落文字\n'
    const items = resolveEditorMenu(mkState(doc, 4), 4)
    expect(actions(items)).toEqual(['cut', 'copy', 'paste'])
  })
})

describe('菜单定位 placeMenu（FR-2.4.28 验收 5）', () => {
  const vw = 1000
  const vh = 800
  it('普通位置：指针右下 +2px', () => {
    expect(placeMenu(100, 100, 200, 300, vw, vh)).toEqual({ x: 102, y: 102 })
  })
  it('近右缘：翻转到指针左侧', () => {
    const r = placeMenu(950, 100, 200, 300, vw, vh)
    expect(r.x).toBe(950 - 200 - 2)
  })
  it('近下缘：翻转到指针上方', () => {
    const r = placeMenu(100, 700, 200, 300, vw, vh)
    expect(r.y).toBe(700 - 300 - 2)
  })
  it('翻转后仍越界（窗口极小）：钳制到安全边距', () => {
    const r = placeMenu(30, 30, 600, 900, 400, 300)
    expect(r.x).toBe(8)
    expect(r.y).toBe(8)
  })
})
