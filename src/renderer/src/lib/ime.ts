import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/**
 * 输入法组词期间：让组词所在行不参与折行。
 *
 * 背景：组词中的拼音（拉丁字母）比上屏后的汉字宽得多（`khy` ≈ 4 个汉字宽，而「中文」只有 2 个字），
 * 折行是浏览器按 DOM 中的实际文本计算的，于是组词时先折行、上屏后文本变短又取消折行——
 * 视觉上就是「跳一下」。改成组词期间 nowrap（文本横向溢出，见 main.css 的裁切规则），
 * 组词期的行数即上屏后的行数，切换时不再有折行往返；只有最终文本确实超长时才折行（必要的一次）。
 *
 * 实现：用行装饰在组词期间给该行加类（CM6 在组词中会冻结装饰重建，行元素稳定，
 * 直接改 DOM 类也不会碰组词文本节点）。
 *
 * ⚠️ 必须同时把内容层宽度钉在组词前的值：nowrap 会让组词行的固有宽度变大，
 * 把 `.cm-content` 的盒子撑宽（实测 591px → 914px），反而让上方其它长行重新折行、
 * 造成比原来更大的跳动。钉住宽度后，溢出不参与盒子计算，其它行纹丝不动。
 */
export function imeNoWrap(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private composing = false

      constructor(private view: EditorView) {
        this.decorations = Decoration.none
        view.contentDOM.addEventListener('compositionstart', this.onStart)
        view.contentDOM.addEventListener('compositionend', this.onEnd)
      }

      private onStart = (): void => {
        this.composing = true
        this.view.dom.classList.add('cm-ime-active')
        // 钉住内容层宽度（组词前的实测值），避免 nowrap 撑宽盒子影响其它行
        const width = this.view.contentDOM.getBoundingClientRect().width
        if (width > 0) this.view.contentDOM.style.width = `${width}px`
        this.rebuild()
      }

      private onEnd = (): void => {
        this.composing = false
        this.view.dom.classList.remove('cm-ime-active')
        this.view.contentDOM.style.removeProperty('width')
        this.decorations = Decoration.none
        // 触发一次重绘，让行类随之移除
        this.view.requestMeasure()
        this.view.dispatch({})
      }

      update(update: ViewUpdate): void {
        // 只认自己维护的组词标志，不看 view.composing：CM6 在 compositionend 之后
        // 还会短暂报告 composing=true（它等 MutationObserver 才复位），若参考它，
        // 结束时的重绘会把这个行类又加回去（实测残留）
        if (this.composing) this.rebuild()
        else if (this.decorations !== Decoration.none) this.decorations = Decoration.none
        void update
      }

      private rebuild(): void {
        if (!this.composing) {
          this.decorations = Decoration.none
          return
        }
        const pos = this.view.state.selection.main.head
        const line = this.view.state.doc.lineAt(pos)
        this.decorations = Decoration.set([
          Decoration.line({ class: 'cm-ime-composing' }).range(line.from)
        ])
      }

      destroy(): void {
        this.view.contentDOM.removeEventListener('compositionstart', this.onStart)
        this.view.contentDOM.removeEventListener('compositionend', this.onEnd)
        this.view.dom.classList.remove('cm-ime-active')
        this.view.contentDOM.style.removeProperty('width')
      }
    },
    { decorations: (v) => v.decorations }
  )

  return plugin
}
