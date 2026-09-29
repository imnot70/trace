/** 不可见字符治理的编辑器接线（FR-2.4.25）：粘贴归一化扩展 + 清理事务构造。
 *  纯逻辑在 lib/invisibleChars（字符集 / matcher / 扫描），本模块只做 CM 接线，
 *  不依赖 ElMessage / ElMessageBox——提示与确认框留在组件层，便于单测 */

import { EditorView } from '@codemirror/view'
import type { EditorState, Extension, Transaction } from '@codemirror/state'
import { collectDocInvisible, normalizeInvisibleChars } from './invisibleChars'

/** 粘贴事件处理（FR-2.4.25，供扩展与单测复用）：返回 true 表示已接管。
 *  有替换时 preventDefault + 自行 dispatch，并**手工补 `input.paste` 注解**——
 *  下游按 userEvent 分流的逻辑（打字机重锚排除 paste、vim 注解等）不受影响；
 *  零替换 / 纯文本为空 / 文件粘贴一律让路原生路径，零行为差 */
export function handleInvisiblePaste(
  event: {
    clipboardData: { files: { length: number }; getData(type: string): string } | null
    preventDefault(): void
  },
  view: { state: EditorState; dispatch(...specs: unknown[]): void },
  onClean?: (nbsp: number, zeroWidth: number) => void
): boolean {
  // 文件粘贴（截图等）让路：外层 Vue @paste 的既有职责
  if (event.clipboardData?.files.length) return false
  const raw = event.clipboardData?.getData('text/plain') ?? ''
  if (!raw) return false
  const { text, nbsp, zeroWidth } = normalizeInvisibleChars(raw)
  if (!nbsp && !zeroWidth) return false
  event.preventDefault()
  view.dispatch(view.state.replaceSelection(text), {
    userEvent: 'input.paste',
    scrollIntoView: true
  })
  onClean?.(nbsp, zeroWidth)
  return true
}

/** 粘贴归一化扩展（设计 §4，D5）：DOM paste 事件拦截。
 *  不用 EditorState.inputHandler——其实际调用点在 @codemirror/view 的 applyDOMChange，
 *  **所有 DOM 驱动的文本输入都经过它（含 IME 组词提交）**且签名不携带事件无法分流，
 *  在组词路径上动手脚是项目已踩过的雷（组词锚点破坏） */
export function invisiblePasteExtension(onClean?: (nbsp: number, zeroWidth: number) => void): Extension {
  return EditorView.domEventHandlers({
    paste: (event, view) => handleInvisiblePaste(event, view, onClean)
  })
}

/** 构造「清理本文不可见字符」事务（FR-2.4.25）：单事务写回（撤销 / 自动保存 /
 *  外部修改保护既有机制自然生效）；无污染返回 null。确认框与提示由调用方负责 */
export function buildCleanInvisibleTransaction(state: EditorState): Transaction | null {
  const { changes } = collectDocInvisible(state.doc)
  if (!changes.length) return null
  return state.update({ changes, userEvent: 'input.clean-invisible', scrollIntoView: true })
}
