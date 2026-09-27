import { Transaction, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/**
 * 打字机模式：光标始终锚定在编辑区固定高度处，输入时表现为「文字移动、光标不动」。
 *
 * 实现要点（见 ai/requirements/2026-09-23_flow-mode/ 与
 * ai/requirements/2026-09-27_typewriter-padding-redesign/）：
 * - 锚定：屏幕坐标差值法（`coordsAtPos` 与滚动容器的 rect 求差），不依赖 `scrollIntoView`
 *   的 start/center/end 语义（它表达不了「80% 处」）。
 * - 时机：仅输入 / 删除 / 撤销重做 / 光标移动或点击定位时重锚；用户滚动、拖选中、
 *   输入法组词期间一律不干预（规则表见 flow-mode 设计文档第 3 节）。
 * - 留白（2026-09-27 重设计）：本扩展**只提供规则不提供数值**——theme 给
 *   `.cm-content` 挂 `padding-top: var(--tw-pad-top, 0px)`，数值由 EditorView（Vue 层）
 *   按 形态比例 × 滚动区高度 计算并写在编辑卡 `:style` 上。切到「关」时扩展随 compartment
 *   摘除，theme 规则被 CM 自动移除，padding 无条件回基线——**清理路径不存在于 JS 中**，
 *   「退出心流 / 关闭后留白残留」在机制上不可能发生（此前内联样式 + destroy() 清理的方案
 *   依赖 JS 时序，真机上出现过残留，见设计文档 1.1）。
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

/** 打字机留白：上下各撑出锚点所需空间（纯函数，可单测；数值消费者在 EditorView） */
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
 * theme 随扩展同生共死：摘除即失去 padding 规则，无需任何 JS 清理（见文件头注释）。
 */
export function typewriter(mode: TypewriterMode): Extension {
  const ratio = anchorRatioFor(mode)
  if (ratio === null) return []

  const paddingTheme = EditorView.theme({
    '.cm-content': {
      paddingTop: 'var(--tw-pad-top, 0px)',
      paddingBottom: 'var(--tw-pad-bottom, 0px)'
    }
  })

  return [
    paddingTheme,
    ViewPlugin.fromClass(
      class {
        private raf = 0
        /** destroy() 后拒绝一切迟到回调（已入队的 RO 投递 / rAF）：只可能误触发滚动 */
        private destroyed = false
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
          if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver((entries) => {
              // disconnect() 后仍可能收到一次已入队的空投递（迟到的僵尸回调）——早退
              if (this.destroyed || entries.length === 0) return
              // 组词期间（中文输入法 IME）内容层高度会随组词文本增减（折行变化）触发本回调，
              // 此时**绝不重锚**：锚定的程序化滚动会移动组词行、破坏 Chromium 的组词锚点
              //（真机五笔实测：候选框脱落、上屏「测试」与编码双写且顺序随机、随机删除后续
              // 若干行——2026-09-27 用户反馈）。组词结束由 compositionend 补锚兜底。
              if (this.view.composing) return
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
          if (this.destroyed) return
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

        /** 输入法组词结束：组词期间冻结（见 RO 回调注释），结束后**延两帧**补一次锚定——
         *  第一帧让 CM 完成提交事务与自身测量，避免用提交中途的临时几何算锚点
         *  （真机五笔实测：提交后立即锚定曾把光标甩到视口顶部，2026-09-27 用户反馈） */
        private onCompositionEnd = (): void => {
          if (this.destroyed) return
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!this.destroyed && !this.view.composing) this.schedule(true)
            })
          })
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
          if (this.destroyed) return
          if (!force && Date.now() < this.userScrollUntil) return
          if (this.raf) return
          this.raf = requestAnimationFrame(() => {
            this.raf = 0
            // 排队期间进入组词：同样冻结（组词中的滚动会破坏组词锚点，见 RO 回调注释）
            if (this.view.composing) return
            this.anchor()
          })
        }

        private anchor(): void {
          if (this.destroyed) return
          const head = this.view.state.selection.main.head
          const coords = this.view.coordsAtPos(head)
          if (!coords) {
            // 光标不在已渲染范围内 → coordsAtPos 返回 null，没有任何屏幕坐标可算。
            // 切进心流时常见：留白写入让内容整体下移，而此刻编辑器还停在原滚动位置，
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
          this.destroyed = true
          if (this.raf) cancelAnimationFrame(this.raf)
          this.resizeObserver?.disconnect()
          this.view.dom.removeEventListener('mousedown', this.onMouseDown, true)
          window.removeEventListener('mouseup', this.onMouseUp, true)
          this.view.dom.removeEventListener('compositionend', this.onCompositionEnd)
          // 留白不需要清理：padding 规则随扩展（theme）一起被 CM 移除（文件头注释）。
          // 这里只补上此前漏删的 scroll 监听（模式每次切换泄漏一个闭包，2026-09-27 审查发现）
          this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
        }
      }
    )
  ]
}
