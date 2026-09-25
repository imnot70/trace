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
      /** 光标不在已渲染范围内时已补过一次「滚进视野」，避免反复请求（见 anchor） */
      private nudged = false
      /** 用户滚动冷却期：滚轮 / 触控板滚动进入未测量区域会触发 CM 测量 → 内容层尺寸变化
       *  → RO / geometryChanged 被动触发重锚 → 拉回光标行（2026-09-26 用户实测：心流 +
       *  打字机向下滚一段距离后被弹回，违背「用户滚动绝不干预」规则）。冷却窗口内抑制
       *  一切被动触发；输入 / 点击定位触发的重锚不受限（见 schedule 的 force） */
      private userScrollUntil = 0
      /** 锚定自身的程序化滚动标记：anchor() 写 scrollTop 也会触发 scroll 事件，不得误判为用户滚动 */
      private programmaticUntil = 0

      constructor(private view: EditorView) {
        this.applyPadding()
        if (typeof ResizeObserver !== 'undefined') {
          this.resizeObserver = new ResizeObserver(() => {
            this.applyPadding()
            this.schedule()
          })
          this.resizeObserver.observe(view.scrollDOM)
          // 同时观察**内容层**（2026-09-24 补，用户实测反馈驱动）：字号调整、切进心流后的
          // 所见即所得重排、块级 widget / 图片的尺寸变化都会改变内容层盒子，但这类变化
          // **既没有 CM 事务、也不改滚动容器尺寸**——CM 与只看 scrollDOM 的 RO 都不会知道，
          // 锚点会静默失效（实测：字号 15→26 后光标从锚点漂到视口外且再不回来）。
          this.resizeObserver.observe(view.contentDOM)
        }
        view.dom.addEventListener('mousedown', this.onMouseDown, true)
        // mouseup 可能落在编辑器之外（拖出窗口），挂到 window 才能稳定收到
        window.addEventListener('mouseup', this.onMouseUp, true)
        view.dom.addEventListener('compositionend', this.onCompositionEnd)
        view.scrollDOM.addEventListener('scroll', this.onScroll)
        // 新挂载时补一次锚定：本扩展会在「进入心流（设置里是关闭 → 心流内低位）」时被新建，
        // 以及「打开笔记 / 切换打字机形态」时随视图创建；构造函数跑在 DOM 更新之前
        // （Vue 的 pre-flush watcher 里 dispatch reconfigure），故只排一帧 rAF，等几何落定再量。
        // 没有这一步时，切进心流只会写入留白（内容整体下移）而不校正滚动，光标会停在锚点之外。
        this.schedule(true)
      }

      /** 用户滚动判定：锚定自身的程序化滚动（programmaticUntil 窗口内）不算 */
      private onScroll = (): void => {
        if (Date.now() < this.programmaticUntil) return
        this.userScrollUntil = Date.now() + 800
      }

      private onMouseDown = (): void => {
        this.dragging = true
      }

      private onMouseUp = (): void => {
        if (!this.dragging) return
        this.dragging = false
        this.schedule(true)
      }

      /** 输入法组词结束：组词期间冻结，结束时补一次锚定 */
      private onCompositionEnd = (): void => {
        this.schedule(true)
      }

      /**
       * 留白量随视口尺寸变化（窗口缩放 / 分栏拖拽 / 栏宽调整）。
       * 写完先比较再写：既避免无谓的样式写入（每次写入都会触发回流），也让本方法可以在
       * 锚定前反复调用当作不变量校验（见 anchor）。
       */
      private applyPadding(): void {
        const height = this.view.scrollDOM.clientHeight
        if (!height) return
        const { top, bottom } = typewriterPadding(ratio, height)
        const style = this.view.contentDOM.style
        if (style.paddingTop !== `${top}px`) style.paddingTop = `${top}px`
        if (style.paddingBottom !== `${bottom}px`) style.paddingBottom = `${bottom}px`
      }

      update(update: ViewUpdate): void {
        // 组词中（中文输入法 IME）：光标位置是临时态，跟随滚动会导致候选框抖动
        if (this.view.composing || this.dragging) return
        // 输入 / 删除 / 撤销重做 / 光标移动与点击定位 → **强制重锚**（不受用户滚动冷却限制——
        // 设计规则是「下次输入才回到锚点」，输入本身即用户意图）。放在 geometryChanged 之前：
        // 输入也会置位几何标志，若先走软调度会被滚动冷却吞掉
        const relevant = update.transactions.some((tr) =>
          isAnchorEvent(tr.annotation(Transaction.userEvent) ?? '')
        )
        if (relevant) {
          this.schedule(true)
          return
        }
        // 几何变化 → 光标行在屏幕上的位置随之位移，锚点失效，需要重锚。CM 的语义是
        // 「文档被修改，或编辑器 / 其内部元素的尺寸变了」，**不含滚动**（滚动不会置位
        // Geometry / Height 标志），因此不会违反「用户滚动绝不干预」。
        // 这条覆盖了三类旧实现漏掉的情形，它们的共同点是「滚动容器尺寸没变 → ResizeObserver
        // 不再触发 → 没有任何重锚请求」，表现为进心流后光标停在锚点之外（2026-09-24 用户实测反馈）：
        //   ① 进入心流：编辑卡变宽变高 → 正文重新折行，行高与光标行的 y 位置整体改变；
        //   ② 模式切换后的延迟重排：切进心流会同时打开所见即所得，块级 widget / 公式的重新
        //      测量与渲染可能落在锚定之后的一两帧；
        //   ③ 图片 / 字体异步加载完成导致的回流。
        // 注意软调度：滚动诱发的测量也会置位几何标志（见 userScrollUntil 注释），冷却期内跳过
        if (update.geometryChanged) {
          this.schedule()
          return
        }
        if (!update.docChanged && !update.selectionSet) return
      }

      /** rAF 合并：一帧内多次变更只滚动一次。force = 用户输入 / 点击定位等显式触发，
       *  不受滚动冷却限制；被动触发（RO / geometryChanged / 挂载初锚之外的软调度）
       *  在用户滚动冷却窗口内跳过（FR-2.4.14 三轮实测：滚轮滚动后被弹回光标行） */
      private schedule(force = false): void {
        if (!force && Date.now() < this.userScrollUntil) return
        if (this.raf) return
        this.raf = requestAnimationFrame(() => {
          this.raf = 0
          this.anchor()
        })
      }

      private anchor(): void {
        // 留白是锚定成立的前提：光标上方内容不足时，靠 paddingTop = ratio × 视口高 才能把首行
        // 连同光标一起推到锚点线（否则「所需滚动位置为负」→ 只能被夹到 0，光标反而停在靠上处）。
        // 每次锚定前校验并补写，使留白成为一个自洽的不变量——任何导致它缺失或过期的路径
        // （某次尺寸变化没触发事件、样式被外部清掉、模式切换中途）都会在下一次锚定时自愈。
        this.applyPadding()
        const head = this.view.state.selection.main.head
        const coords = this.view.coordsAtPos(head)
        if (!coords) {
          // 光标不在已渲染范围内 → coordsAtPos 返回 null，没有任何屏幕坐标可算。
          // 切进心流时常见：新建插件写入留白让内容整体下移，而此刻编辑器还停在原滚动位置，
          // 光标可能整个落在视口之外；旧写法直接 return，于是锚定永久失效（直到用户下次输入）。
          // 补救：先请 CM 按高度图把它滚进视野（下一帧它必然已渲染），再做精确锚定。
          // 只补一次：既避免「滚了仍不可见 ↔ 反复滚动」互相触发，也避免与用户滚动抢方向。
          if (!this.nudged) {
            this.nudged = true
            this.programmaticUntil = Date.now() + 150
            this.view.dispatch({
              effects: EditorView.scrollIntoView(head, { y: 'center' })
            })
            this.schedule()
          }
          return
        }
        this.nudged = false
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
        // 标记程序化滚动：随后到来的 scroll 事件不得计入用户滚动冷却
        this.programmaticUntil = Date.now() + 150
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
