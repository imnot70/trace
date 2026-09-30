/**
 * 拖曳插入引用（FR-2.9.10 P3）的纯逻辑：笔记引用载荷的自定义 dataTransfer 类型、
 * 模态遮罩的拖曳期让行、D2 同名消歧决策。不依赖 Vue / CM 运行时——事件接线在
 * 四个源组件（VaultNode / SearchDialog / BacklinkPanel / QuickRefPicker）与
 * MarkdownEditor（drop 分流）/ EditorView（insertPreviewTarget），本模块便于单测。
 */

/** 自定义拖曳载荷类型。**刻意不带 text/plain**：CM6 原生 drop 管线会接管文本与文件，
 *  同时设 text/plain 会在 contentDOM 层被 CM 先插入一次（双插）；只带自定义类型时
 *  CM 认不出、不消费，事件完整落到编辑器根节点的 drop 分流。 */
export const NOTE_REF_MIME = 'application/x-trace-note-ref'

/** 拖曳载荷：path 统一带 .md（四个源天然带——树 node.path / 搜索 result.path /
 *  反向链接 item.path 均含扩展名，快速引用面板 targetOf() 已补 .md）。
 *  from = 'dialog'：来源是模态弹窗（搜索 / Alt+I）——编辑器侧据「来源弹窗 + 未按
 *  Alt」决定插入成功后是否关闭弹窗（插入即关默认 + Alt 拖入保留，FR-2.9.10 ⑤ D6） */
export interface NoteRefPayload {
  vault: string
  path: string
  name: string
  from?: 'dialog'
}

/** dataTransfer 的结构化最小接口（jsdom 无真 DataTransfer，便于单测打桩） */
interface DragData {
  types: readonly string[]
  setData(type: string, value: string): void
  getData(type: string): string
}

/** 拖曳是否携带笔记引用载荷（dragover 分流判定；dragover 阶段只能看 types，读不到内容） */
export function hasNoteRefDrag(dt: Pick<DragData, 'types'> | null | undefined): boolean {
  return !!dt && dt.types.includes(NOTE_REF_MIME)
}

/** 读取拖曳载荷：类型不含 / JSON 非法 / 字段缺失一律返回 null（调用方走既有分支）。
 *  from（来源标记）存在时保留——「插入即关」依据它判断来源是否为弹窗 */
export function readNoteRefDrag(dt: Pick<DragData, 'types' | 'getData'> | null | undefined): NoteRefPayload | null {
  if (!hasNoteRefDrag(dt)) return null
  try {
    const raw = JSON.parse(dt!.getData(NOTE_REF_MIME)) as Partial<NoteRefPayload>
    if (typeof raw?.vault === 'string' && typeof raw?.path === 'string' && typeof raw?.name === 'string') {
      return {
        vault: raw.vault,
        path: raw.path,
        name: raw.name,
        ...(raw.from === 'dialog' ? { from: 'dialog' as const } : {})
      }
    }
    return null
  } catch {
    return null
  }
}

/** 让行样式类（全局 styles/main.css：pointer-events: none，遮罩视觉不变） */
const MASK_YIELD_CLASS = 'drag-yield'
/** 弹窗隐藏类（拖曳期把弹窗整体藏掉，落点不再被遮挡；visibility 隐藏不参与命中测试） */
const DIALOG_HIDE_CLASS = 'drag-hide'
/** 需要让行的遮罩：EP 模态遮罩（el-dialog 在文档内 / append-to-body 均覆盖）+ 心流浮层侧栏 backdrop */
const MASK_SELECTOR = '.el-overlay, .sidebar-backdrop'

function visible(el: Element): boolean {
  return el.getClientRects().length > 0
}

/** 拖曳代数：每次让行递增；延后的隐藏回调凭代数判断自己是否仍然有效——拖曳若在
 *  定时器触发前已结束（恢复会再递增），过期回调不得把弹窗藏掉（那时没有 dragend 来救） */
let dragGeneration = 0
/** Alt 修饰键锁存：dragstart 时刻的状态。不信任 drop 事件的 altKey——真机上各平台
 *  对拖拽会话中的 Alt 处理不一（Windows 菜单键 / macOS Option / Linux WM），锁存
 *  「按住 Alt 再拖」的发起状态最可靠（约定手势，需求 D6） */
let dragAltLatch = false
/** drop 已被编辑器接住的标记：此时恢复职责移交给插入收口（onDropNoteRef 的 finally，
 *  与「关闭 / 保留」决策同拍执行）——若在 dragend 里照常恢复，弹窗会先回来再被关闭，
 *  闪现一帧（2026-09-30 真机反馈） */
let dropHandled = false

/** 拖曳期遮罩让行 + 弹窗隐藏：
 *  - 同步：可见遮罩加 drag-yield（pointer-events 放行），覆盖「dragstart → 弹窗隐藏
 *    生效前」的一拍窗口，落点即刻可穿透；
 *  - 延后一拍：可见 .el-overlay 加 drag-hide——拖曳期间弹窗整体藏掉，不再遮挡编辑器
 *    落点（visibility 隐藏不参与命中测试）。**不能同步隐藏**：dragstart 处理器内源元素
 *    所在子树变为不可见，会让 Chromium 拖拽发起的命中测试失败、拖曳静默取消（连
 *    dragstart 都不派发，见设计 §9.4）；拖拽发起完成后再隐藏即安全（拖影已快照）；
 *  - 恢复：dragend（取消拖曳 / 拖出编辑器）照常恢复；**drop 落到编辑器（带笔记引用
 *    载荷）时不恢复**——恢复移交给插入收口 finally，与关闭 / 保留决策同拍，无闪现；
 *    另设 800ms 兜底恢复（drop 已接住但收口异常未清理时兜底，正常流程先清理故为空操作），
 *    源组件无需各自清理。 */
export function beginNoteRefDrag(e: { dataTransfer: DragData | null; altKey?: boolean }, payload: NoteRefPayload): void {
  const dt = e.dataTransfer
  if (!dt) return
  dragAltLatch = e.altKey === true
  dropHandled = false
  dt.setData(NOTE_REF_MIME, JSON.stringify(payload))
  ;(dt as DragData & { effectAllowed: string }).effectAllowed = 'copy'
  yieldDropMasks()
}

/** 取走 Alt 锁存值（dragstart 时刻状态）并复位——drop 分流用；事件自带的 altKey
 *  与锁存值取或后仍可覆盖（平台若可靠交付中途按键，两者都不漏） */
export function consumeDragAltLatch(): boolean {
  const v = dragAltLatch
  dragAltLatch = false
  return v
}

/** 遮罩让行 + 弹窗隐藏 + 恢复（独立导出便于单测；恢复为幂等操作） */
export function yieldDropMasks(): void {
  restoreDropMasks()
  const gen = ++dragGeneration
  const yielded: Element[] = []
  for (const el of document.querySelectorAll(MASK_SELECTOR)) {
    if (!visible(el)) continue
    el.classList.add(MASK_YIELD_CLASS)
    yielded.push(el)
  }
  if (yielded.length === 0) return
  window.setTimeout(() => {
    if (gen !== dragGeneration) return
    for (const el of document.querySelectorAll('.el-overlay')) {
      if (visible(el)) el.classList.add(DIALOG_HIDE_CLASS)
    }
  }, 0)
  const onDropCapture = (e: DragEvent): void => {
    if (hasNoteRefDrag(e.dataTransfer)) {
      // 落到编辑器：恢复移交给插入收口 finally（同拍清理 / 关闭，无闪现）
      dropHandled = true
      window.setTimeout(() => {
        // 兜底：收口异常未清理时 800ms 后恢复（正常流程此时类已被清，空操作）
        restoreDropMasks()
      }, 800)
      return
    }
    restoreDropMasks()
  }
  const onDragendCapture = (): void => {
    cleanup()
    if (dropHandled) {
      dropHandled = false
      return
    }
    restoreDropMasks()
  }
  const cleanup = (): void => {
    document.removeEventListener('drop', onDropCapture, { capture: true })
    document.removeEventListener('dragend', onDragendCapture, { capture: true })
  }
  document.addEventListener('drop', onDropCapture, { capture: true })
  document.addEventListener('dragend', onDragendCapture, { capture: true })
}

export function restoreDropMasks(): void {
  dragGeneration++
  for (const el of document.querySelectorAll(MASK_SELECTOR)) {
    el.classList.remove(MASK_YIELD_CLASS, DIALOG_HIDE_CLASS)
  }
}

/**
 * D2 同名消歧决策（需求 D5）：引用目标在当前库内叶子名恰好 1 个候选 → 插叶子名；
 * 0 候选（笔记刚被删）或有重名 → 插完整路径（路径形式保留更多信息且解析唯一）。
 * @param paths resolveByNameCandidates 的返回（带 .md 的候选路径数组）
 */
export function preferNameInsert(paths: string[] | null | undefined): boolean {
  return paths?.length === 1
}
