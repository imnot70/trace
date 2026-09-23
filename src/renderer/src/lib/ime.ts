import { EditorView, ViewPlugin } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/**
 * 输入法组词期间：让组词所在行不参与折行（「右侧缓冲区」）。
 *
 * 背景：组词中的拼音（拉丁字母）比上屏后的汉字宽得多（`khy` ≈ 4 个汉字宽，而「中文」只有 2 个字），
 * 折行按 DOM 中的实际文本计算，于是组词时先折行、上屏后文本变短又取消折行——视觉上内容跳一下。
 * 组词期不折行 = 组词期的行数就是上屏后的行数，只在最终文本确实超长时才折行（必要的一次）。
 *
 * ⚠️ 实现红线：**绝不触发 CodeMirror 的 DOM 协调**。
 * 曾用「行装饰（Decoration.line）」实现：CM6 收到装饰变更后会重建该行 DOM，而组词中的文本节点一被重建，
 * Chromium 就丢失组词锚点——按空格选定候选时拼音无法替换成汉字，被当作普通文本提交（中文输入失效）。
 * 该缺陷在 CDP 的合成组词事件（imeSetComposition）下测不出来，只有真实输入法才会触发。
 * 因此这里只用**内联样式**（设 style 属性不改变任何节点结构），且：
 *   1. 只在 compositionstart 施加（此刻组词文本尚未进入 DOM，最安全）；
 *   2. 清理延迟到 compositionend 之后（避开上屏提交窗口，提交期间改 DOM 同样可能打断）。
 *
 * 另需把内容层宽度钉住：nowrap 会让组词行的固有宽度变大、撑宽 `.cm-content`（实测 591px → 914px），
 * 反而让上方其它长行重新折行、造成更大跳动；钉的是当前实测值，本身不产生尺寸变化。
 */
export function imeNoWrap(): Extension {
  /** 一键开关：若某些输入法平台出现异常，置 false 即可完全关闭该优化 */
  const ENABLED = true
  if (!ENABLED) return []

  return ViewPlugin.fromClass(
    class {
      private lineEl: HTMLElement | null = null
      /** 组词序号：清理是延迟执行的，用它避免清掉紧随其后的下一次组词 */
      private seq = 0

      constructor(private view: EditorView) {
        view.contentDOM.addEventListener('compositionstart', this.onStart)
        view.contentDOM.addEventListener('compositionend', this.onEnd)
      }

      private onStart = (): void => {
        this.seq++
        const content = this.view.contentDOM
        const width = content.getBoundingClientRect().width
        if (width > 0 && !content.style.width) content.style.width = `${width}px`
        this.view.dom.classList.add('cm-ime-active')
        this.lineEl = this.currentLine()
        this.lineEl?.style.setProperty('white-space', 'nowrap')
      }

      private onEnd = (): void => {
        const seq = this.seq
        // 延迟清理：compositionend 之后仍有上屏提交动作在进行，此刻改 DOM 可能打断提交
        // （50ms ≈ 3 帧，足够越过提交流程；延迟期间布局保持稳定，观感无差别）
        setTimeout(() => {
          if (seq !== this.seq) return
          this.cleanup()
        }, 50)
      }

      private cleanup(): void {
        this.lineEl?.style.removeProperty('white-space')
        this.lineEl = null
        this.view.dom.classList.remove('cm-ime-active')
        this.view.contentDOM.style.removeProperty('width')
      }

      /** 组词所在行：走浏览器 Selection（原生、不经过 CM6），组词文本必在光标所在行内 */
      private currentLine(): HTMLElement | null {
        const sel = window.getSelection()
        const node = sel?.anchorNode ?? null
        if (!node) return null
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
        return el?.closest?.('.cm-line') ?? null
      }

      destroy(): void {
        this.view.contentDOM.removeEventListener('compositionstart', this.onStart)
        this.view.contentDOM.removeEventListener('compositionend', this.onEnd)
        this.cleanup()
      }
    }
  )
}
