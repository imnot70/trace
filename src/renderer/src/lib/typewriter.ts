import { Transaction, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/**
 * 打字机模式：光标始终锚定在编辑区固定高度处，输入时表现为「文字移动、光标不动」。
 *
 * 实现要点（见 requirements/2026-09-23_flow-mode/flow-mode_design.md）：
 * - 留白：加在**内容层**（`.cm-content` 内联 padding）——paddingTop = ratio × 视口高（首行也能
 *   到达锚点线）、paddingBottom = (1 − ratio) × 视口高（末行同理）。
 *   注意不可加在滚动层（`.cm-scroller`）：该元素高度由内容撑开，给它加 padding 会把它自身撑高
 *   （盒子超过父容器、滚动几何错乱），且读它自己的 clientHeight 会形成反馈放大；
 *   加在内容层时滚动层盒子稳定，行号 gutter 由 CM6 按内容坐标定位、自动跟随（实测对齐）。
 * - 锚定：屏幕坐标差值法（`coordsAtPos` 与滚动容器的 rect 求差），不依赖 `scrollIntoView`
 *   的 start/center/end 语义（它表达不了「80% 处」）。
 * - 时机：仅输入 / 删除 / 撤销重做 / 光标移动或点击定位时重锚；用户滚动、拖选中、
 *   输入法组词期间一律不干预（规则表见设计文档第 3 节）。
 */

export type TypewriterMode = 'off' | 'center' | 'bottom'

/** 锚点比例：光标行在编辑区可视高度中的目标位置（0 = 顶边，1 = 底边） */
export const ANCHOR_RATIO: Record<'center' | 'bottom', number> = {
  center: 0.5,
  /** 距底边 20%：给输入法候选框留下落空间，避免贴底的视觉压迫（需求 D4） */
  bottom: 0.8
}

/** 模式 → 锚点比例；关闭时为 null */
export function anchorRatioFor(mode: TypewriterMode): number | null {
  return mode === 'off' ? null : ANCHOR_RATIO[mode]
}

/**
 * 目标滚动位置：把光标行的屏幕坐标对齐到视口 ratio 处（纯函数，可单测）。
 * 返回「相对当前滚动位置需要移动的距离」叠加后的目标值。
 */
export function anchorScrollTop(
  cursorTop: number,
  viewportTop: number,
  viewportHeight: number,
  currentScrollTop: number,
  ratio: number
): number {
  return currentScrollTop + (cursorTop - (viewportTop + viewportHeight * ratio))
}

/** 打字机留白：上下各撑出锚点所需空间（纯函数，可单测） */
export function typewriterPadding(
  ratio: number,
  viewportHeight: number
): { top: number; bottom: number } {
  return {
    top: Math.round(viewportHeight * ratio),
    bottom: Math.round(viewportHeight * (1 - ratio))
  }
}

/**
 * 该 userEvent 是否应触发重锚（纯函数，可单测）。
 * 覆盖：输入 / 删除 / 撤销重做 / 光标移动与点击定位；
 * 不覆盖：程序化写入（无 userEvent）、用户滚动（不产生事务）。
 */
export function isAnchorEvent(userEvent: string): boolean {
  return /^(input|delete|undo|redo|select|move)\b/.test(userEvent)
}

/**
 * 组装打字机扩展。模式为 off 时返回空扩展（由 Compartment 重配置挂载/摘除）。
 */
export function typewriter(mode: TypewriterMode): Extension {
  const ratio = anchorRatioFor(mode)
  if (ratio === null) return []

  return ViewPlugin.fromClass(
    class {
      private raf = 0
      /** 鼠标拖选中：拖选期间不重锚（连续滚动会造成眩晕），mouseup 后补一次 */
      private dragging = false
      private resizeObserver: ResizeObserver | null = null

      constructor(private view: EditorView) {
        this.applyPadding()
        if (typeof ResizeObserver !== 'undefined') {
          this.resizeObserver = new ResizeObserver(() => {
            this.applyPadding()
            this.schedule()
          })
          this.resizeObserver.observe(view.scrollDOM)
        }
        view.dom.addEventListener('mousedown', this.onMouseDown, true)
        // mouseup 可能落在编辑器之外（拖出窗口），挂到 window 才能稳定收到
        window.addEventListener('mouseup', this.onMouseUp, true)
        view.dom.addEventListener('compositionend', this.onCompositionEnd)
      }

      private onMouseDown = (): void => {
        this.dragging = true
      }

      private onMouseUp = (): void => {
        if (!this.dragging) return
        this.dragging = false
        this.schedule()
      }

      /** 输入法组词结束：组词期间冻结，结束时补一次锚定 */
      private onCompositionEnd = (): void => {
        this.schedule()
      }

      /** 留白量随视口尺寸变化（窗口缩放 / 分栏拖拽 / 栏宽调整） */
      private applyPadding(): void {
        const height = this.view.scrollDOM.clientHeight
        if (!height) return
        const { top, bottom } = typewriterPadding(ratio, height)
        this.view.contentDOM.style.paddingTop = `${top}px`
        this.view.contentDOM.style.paddingBottom = `${bottom}px`
      }

      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.selectionSet) return
        // 组词中（中文输入法 IME）：光标位置是临时态，跟随滚动会导致候选框抖动
        if (this.view.composing || this.dragging) return
        const relevant = update.transactions.some((tr) =>
          isAnchorEvent(tr.annotation(Transaction.userEvent) ?? '')
        )
        if (relevant) this.schedule()
      }

      /** rAF 合并：一帧内多次变更只滚动一次 */
      private schedule(): void {
        if (this.raf) return
        this.raf = requestAnimationFrame(() => {
          this.raf = 0
          this.anchor()
        })
      }

      private anchor(): void {
        const head = this.view.state.selection.main.head
        const coords = this.view.coordsAtPos(head)
        if (!coords) return
        const scroller = this.view.scrollDOM
        const rect = scroller.getBoundingClientRect()
        const target = anchorScrollTop(
          coords.top,
          rect.top,
          scroller.clientHeight,
          scroller.scrollTop,
          ratio
        )
        // 亚像素差异不滚动，避免抖动
        if (Math.abs(target - scroller.scrollTop) < 0.5) return
        scroller.scrollTop = target
      }

      destroy(): void {
        if (this.raf) cancelAnimationFrame(this.raf)
        this.resizeObserver?.disconnect()
        this.view.dom.removeEventListener('mousedown', this.onMouseDown, true)
        window.removeEventListener('mouseup', this.onMouseUp, true)
        this.view.dom.removeEventListener('compositionend', this.onCompositionEnd)
        // 清零留白：关闭打字机后滚动行为必须与常规完全一致（验收标准 10）
        this.view.contentDOM.style.removeProperty('padding-top')
        this.view.contentDOM.style.removeProperty('padding-bottom')
      }
    }
  )
}
