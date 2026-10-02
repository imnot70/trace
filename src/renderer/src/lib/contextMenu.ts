/**
 * 右键上下文菜单（FR-2.4.28）纯逻辑：菜单模型类型 / 编辑器上下文判定 / 定位翻转。
 * resolveEditorMenu 产出**声明式**动作项（不带闭包，可单测），由 MarkdownEditor 接线层
 * 映射为真实动作；表面菜单（P2）在调用侧组装 MenuItemVM（带 action 闭包）。
 * 定位 / 判定规则与踩坑规避见设计文档 §3 / §8。
 */
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { syntaxTree } from '@codemirror/language'
import { wikilinkSpanAt } from './wikiTarget'

/** 菜单项视图模型（调用侧组装，action 为闭包）——store 与组件共用此类型 */
export interface MenuItemVM {
  label: string
  /** 右侧快捷键提示文本（纯展示，不绑定键位） */
  hint?: string
  danger?: boolean
  /** 该项之前渲染分隔线 */
  divided?: boolean
  disabled?: boolean
  action: () => void
}

/** 编辑器菜单的声明式动作（payload 随项携带；MarkdownEditor 负责映射为真实实现） */
export type EditorMenuAction =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'wikify'
  | 'openExternal'
  | 'copyLink'
  | 'openNote'
  | 'copyRef'
  | 'revealImage'
  | 'copyImagePath'

export interface EditorMenuItem {
  action: EditorMenuAction
  label: string
  hint?: string
  divided?: boolean
  disabled?: boolean
  /** openExternal / copyLink = 链接地址；openNote = 双链名；revealImage / copyImagePath = 图片引用 */
  payload?: string
}

/**
 * 编辑器右键菜单模型（FR-2.4.28）：按「剪贴板 → 选区格式 → 光标位置上下文」三节组装。
 * - 剪切 / 复制仅在非空选区时可用（禁用态占位保持菜单结构稳定）；
 * - 位置上下文优先级：双链（正则，lezer 无节点）→ Link（语法树，URL 非空才认——
 *   无 URL 的引用式方括号不弹链接项，与 0.13.0 误涂修复同口径）→ Image；
 * - 判定全程基于传入的 pos（调用方已按 D6 把光标挪到右键点或保留选区），不再读坐标。
 */
export function resolveEditorMenu(state: EditorState, pos: number): EditorMenuItem[] {
  const items: EditorMenuItem[] = []
  const sel = state.selection.main

  // ---- 剪贴板节 ----
  const hasSelection = !sel.empty
  items.push({ action: 'cut', label: '剪切', hint: 'Ctrl+X', disabled: !hasSelection })
  items.push({ action: 'copy', label: '复制', hint: 'Ctrl+C', disabled: !hasSelection })
  items.push({ action: 'paste', label: '粘贴', hint: 'Ctrl+V' })

  // ---- 选区格式节（D8：hint 照常标注，不为 Vim 区分） ----
  if (hasSelection) {
    items.push({ action: 'bold', label: '加粗', hint: 'Ctrl+B', divided: true })
    items.push({ action: 'italic', label: '斜体', hint: 'Ctrl+I' })
    items.push({ action: 'strike', label: '删除线', hint: 'Ctrl+Shift+X' })
    items.push({ action: 'inlineCode', label: '行内码' })
    items.push({ action: 'wikify', label: '转为双链' })
  }

  // ---- 光标位置上下文节 ----
  const line = state.doc.lineAt(pos)
  const col = pos - line.from

  const wl = wikilinkSpanAt(line.text, col)
  if (wl) {
    items.push({ action: 'openNote', payload: wl.name, label: '打开笔记', divided: true })
    items.push({ action: 'copyRef', payload: wl.name, label: '复制引用文本' })
  } else {
    const node = contextNodeAt(state, pos, 'Link')
    if (node) {
      const url = childText(state, node, 'URL')
      if (url) {
        items.push({ action: 'openExternal', payload: url, label: '打开链接', divided: true })
        items.push({ action: 'copyLink', payload: url, label: '复制链接地址' })
      }
    } else {
      const img = contextNodeAt(state, pos, 'Image')
      if (img) {
        const ref = childText(state, img, 'URL')
        if (ref) {
          items.push({ action: 'revealImage', payload: ref, label: '在附件目录中显示', divided: true })
          items.push({ action: 'copyImagePath', payload: ref, label: '复制图片路径' })
        }
      }
    }
  }
  return items
}

/** 在 pos 处向上找最近的指定类型语法节点（含 pos 自身判定用 resolveInner(pos, -1)） */
function contextNodeAt(state: EditorState, pos: number, name: string): SyntaxNode | null {
  let node = syntaxTree(state).resolveInner(pos, -1)
  for (let i = 0; i < 8 && node; i++) {
    if (node.name === name) return node
    if (!node.parent) break
    node = node.parent
  }
  return null
}

/** 取节点下指定类型子节点的文档文本（如 Link / Image 的 URL） */
function childText(state: EditorState, node: SyntaxNode, childName: string): string {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === childName) return state.sliceDoc(c.from, c.to)
  }
  return ''
}

/**
 * 菜单定位（近视口右缘 / 下缘翻转到指针左侧 / 上方，并钳制在视口内）。
 * 独立纯函数便于单测；pad 为视口安全边距。
 */
export function placeMenu(
  x: number,
  y: number,
  menuW: number,
  menuH: number,
  vw: number,
  vh: number,
  pad = 8
): { x: number; y: number } {
  const gap = 2
  let nx = x + gap
  let ny = y + gap
  if (nx + menuW > vw - pad) nx = Math.max(pad, x - menuW - gap)
  if (ny + menuH > vh - pad) ny = Math.max(pad, y - menuH - gap)
  return { x: nx, y: ny }
}
