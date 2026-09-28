/**
 * Vim 编辑模式集成（FR-2.4.23）。基于 @replit/codemirror-vim（CM6 生态唯一成熟的
 * vim 实现，Replit 维护；立项调研误记为「官方 @codemirror/vim」——该包在 npm 上不存在）。
 *
 * 该包不经 CM keymap，而是用 EditorView.domEventHandlers 在 keydown 上直接接管：
 * 已映射的键会被拦截并 preventDefault，不会穿透给后续 handler。因此「应用键位优先」
 * 不能靠扩展顺序或 Prec 实现，必须用 Vim.unmap 从其全局键位表显式卸载冲突键。
 *
 * 键位冲突策略（2026-09-28 用户拍板）：
 * - 应用优先：vim 的 <C-f> <C-b> <C-e> <C-i> <C-n> <C-t>（翻页 / 翻页 / 下滚一行 /
 *   跳转前进 / 补全下一项 / 缩进标签）与应用的 Ctrl+F 查找、Ctrl+B 加粗、Ctrl+I 斜体、
 *   Ctrl+E 编辑形态、Ctrl+N 新建、Ctrl+T 表格相撞——一律卸载，让给应用键位；
 * - vim 保留应用未占用的键：<C-d>/<C-u> 半页滚动、<C-y> 上滚一行、<C-o> 跳回与
 *   insert 临时 normal、<C-r> 重做、<C-v> 块可视、<C-w> 删词（insert）、
 *   <C-a>/<C-x> 数字自增减（应用无菜单加速键，Ctrl+W 无占用）；
 * - Alt 系 vim 不绑定，无冲突；
 * - Esc：浮层类（浮层侧栏 / 悬浮预览 / 各弹窗 / 补全 / 查找面板）仍由应用级分级链先消费；
 *   无浮层且编辑器聚焦时让位 vim 返回 normal——退出心流改用 Alt+W / 顶栏咖啡杯
 *   （判定函数 shouldYieldEscapeToVim，App.vue 的 onEscape 心流分支调用）。
 */
import type { Extension, TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { ViewPlugin, keymap } from '@codemirror/view'
import { getCM, vim, Vim, type MotionFn } from '@replit/codemirror-vim'
import { crossBlockLanding } from './livePreview/smartMove'
import { renderedBlockRanges } from './livePreview/decorations'

/** CM5 适配层实例（订阅 `vim-mode-change` 事件用） */
export const getVimCM = getCM

/** vim 事务的 userEvent 注解（2026-09-28 用户实测：vim 下打字机锚定失效）。
 *  适配层绕过 CM 输入管线直接 view.dispatch，事务**不带任何 userEvent**——按注解分流的
 *  消费者（打字机锚定的 isAnchorEvent 等）对 vim 全部失明：normal 移动（j/k）不重锚、
 *  normal 编辑（x/dd/o/p）只剩会被滚动冷却吞掉的软调度路径。insert 模式打字走 DOM
 *  输入管线自带 input.type，故只有 normal / visual 动线受影响。 */
export const VIM_INPUT_EVENT = 'input.trace-vim'
export const VIM_SELECT_EVENT = 'select.trace-vim'

/** 给 vim 驱动的 dispatch 补 userEvent 注解（每 view 一次；包装层挂在 buildVimExtension
 *  的插件里随 vim 生命周期挂摘）。仅当事务产生于 vim 操作内（包内 findKey 的
 *  cm.operation 包裹置位 curOp.isVimOp）且 spec 未带注解时归类：有 changes → 编辑、
 *  纯选区 → 移动；vim 之外的 dispatch（含打字机自身的 scrollIntoView）原样透传。
 *  vim 关闭后适配层随之移除（getCM 为 null），包装层恒走透传分支，无副作用。 */
function annotateVimDispatch(view: EditorView): void {
  const host = view as unknown as { __traceVimDispatchAnnotated?: boolean }
  if (host.__traceVimDispatchAnnotated) return
  host.__traceVimDispatchAnnotated = true
  const origin = view.dispatch.bind(view) as (...args: unknown[]) => void
  // dispatch 有 (tr) / (...specs) 两个重载；适配层恒传普通 spec 对象，宽松签名包装即可
  ;(view as unknown as { dispatch: unknown }).dispatch = (...args: unknown[]) => {
    const cm = getCM(view)
    if (!cm?.curOp?.isVimOp) return origin(...args)
    return origin(
      ...args.map((arg) => {
        const spec = arg as TransactionSpec
        if (spec.userEvent) return arg
        return { ...spec, userEvent: spec.changes != null ? VIM_INPUT_EVENT : VIM_SELECT_EVENT }
      })
    )
  }
}

/** 让渡给应用的 vim 键（CM5 键名记法；卸载后穿透给应用层键位） */
export const VIM_YIELDED_KEYS = ['<C-f>', '<C-b>', '<C-e>', '<C-i>', '<C-n>', '<C-t>'] as const

/** 卸载是否已执行过（unmap 作用于包内全局键位表，与编辑器实例无关，做一次即可） */
let yieldedKeysRemoved = false

/** 垂直移动 motion 是否已注册（mapCommand / defineMotion 同为包内全局注册表操作，做一次即可） */
let verticalMotionsPatched = false

/**
 * 跨块修正的垂直移动 motion（方案 A：让 j/k 能进入渲染中的块级公式）。
 *
 * 包内默认 moveByLines 的护城河机制：findPosV（→ cm6.moveVertically 坐标扫描）遇到
 * 渲染中的块 widget 直接落到远端，posV.line 超出「理想行」（head.line ± repeat）→
 * hasMarkedText 判真 → 落点被 posV（远端）劫持，整块被跳过。
 * 本 motion 逐行复刻 moveByLines 的粘滞列 / 文档边缘语义，唯一改动是在
 * hasMarkedText 调和之前把 posV 拉回被飞跃块的近端边界（crossBlockLanding）——
 * 近端行 ≤ 理想行，调和回到「理想行」文档语义：光标落进公式源码（occupied 触发回落），
 * 计数（3j）按文档行推进，语义与 Obsidian 一致。
 *
 * 只以 context: normal / visual 映射（operatorPending 不映射）：dj/dw 等操作符仍走
 * 包内默认 motion——操作符区间按远端截断（删过整块）是合理的删除语义。
 * 可视模式的选区扩展（含 V 行选 / Ctrl+V 块选）由包内 evalInput → updateCmSelection
 * 既有机制自理，motion 只需返回落点。
 */
const traceMoveByLines: MotionFn = (cm, head, motionArgs, vim) => {
  const view: EditorView = cm.cm6
  const forward = motionArgs.forward !== false
  // 粘滞列：上一个动作也是本 motion 时沿用 lastHPos，否则以当前列重置（同包内 moveByLines）
  let endCh = head.ch
  if (vim.lastMotion === traceMoveByLines) {
    endCh = vim.lastHPos
  } else {
    vim.lastHPos = endCh
  }
  const repeat = motionArgs.repeat + (motionArgs.repeatOffset || 0)
  let line = forward ? head.line + repeat : head.line - repeat
  const first = cm.firstLine()
  const last = cm.lastLine()
  const posV = cm.findPosV(head, forward ? repeat : -repeat, 'line', vim.lastHSPos)
  // —— 方案 A 唯一的语义改动：跨块修正 posV ——
  const corrected = crossBlockLanding(
    cm.indexFromPos(head),
    cm.indexFromPos(posV),
    renderedBlockRanges(view.state),
    forward ? 1 : -1
  )
  if (corrected != null) {
    const correctedLine = view.state.doc.lineAt(corrected)
    posV.line = correctedLine.number - 1
    posV.ch = corrected - correctedLine.from
  }
  const hasMarkedText = forward ? posV.line > line : posV.line < line
  if (hasMarkedText) {
    line = posV.line
    endCh = posV.ch
  }
  // 文档边缘：同包内 moveToStartOfLine / moveToEol(keepHPos) 语义（越界由包内 clip 兜底）
  if (line < first && head.line === first) {
    return { line: head.line, ch: 0 }
  } else if (line > last && head.line === last) {
    return { line: head.line + motionArgs.repeat - 1, ch: Infinity }
  }
  // 粘滞列像素坐标：落点在渲染块内时 coordsAtPos 为 null（left 为 0）——保留旧值
  // 比写 0 更接近真实列（回落源码后列号不变）
  const coords = cm.charCoords({ line, ch: endCh }, 'div')
  if (coords.left) vim.lastHSPos = coords.left
  return { line, ch: endCh }
}

/** 注册 j/k 的跨块修正 motion（normal + visual 各一条；operatorPending 不映射保 dj 语义）。
 *  mapCommand 是 unshift 进包内全局键位表：同 context 下先于默认 moveByLines 命中 */
function patchVerticalMotions(): void {
  if (verticalMotionsPatched) return
  verticalMotionsPatched = true
  Vim.defineMotion('traceMoveByLines', traceMoveByLines)
  for (const context of ['normal', 'visual'] as const) {
    Vim.mapCommand('j', 'motion', 'traceMoveByLines', { forward: true, linewise: true }, { context })
    Vim.mapCommand('k', 'motion', 'traceMoveByLines', { forward: false, linewise: true }, { context })
  }
}

/** 包内 unmap 的实际运行时签名允许省略 ctx（d.ts 声明为必选，缺省 = 匹配无 context 的全局条目） */
type UnmapFn = (lhs: string, ctx?: string) => unknown

/** 卸载应用占用的键：同一键可能在多个 context 有条目，循环删到无残留（无匹配时返回假值） */
function removeYieldedKeys(): void {
  if (yieldedKeysRemoved) return
  yieldedKeysRemoved = true
  const unmap = Vim.unmap as unknown as UnmapFn
  for (const key of VIM_YIELDED_KEYS) {
    while (true) {
      if (!unmap(key)) break
    }
  }
}

/**
 * Esc 的 Ctrl+[ 等价键（标准 vim，ASCII 0x1B 同源）：包内 defaultKeymap 虽有
 * `<C-[>` → `<Esc>` 的 keyToKey 映射，但 CM 基础装配（traceSetup 的 defaultKeymap）
 * 自带 `{ key: "Mod-[", run: indentLess }`——keymap 层先命中即停，该映射形同虚设。
 * vim 启用时经 vimCompartment 挂更高优先级的 `Ctrl-[` 绑定转发给 vim；
 * 非 vim 用户（compartment 为空）保持 indentLess 行为不变。
 */
export function handleEscapeKey(view: EditorView): boolean {
  const cm = getCM(view)
  if (!cm?.state.vim) return false
  Vim.handleKey(cm, '<Esc>', 'user')
  return true
}

/** 构建 vim 扩展（挂入 vimCompartment；首次调用时完成冲突键卸载与垂直 motion 注册） */
export function buildVimExtension(): Extension {
  removeYieldedKeys()
  patchVerticalMotions()
  return [
    vim(),
    // Ctrl-[ → vim 的 Esc（含退出 insert / 退出 visual）；须高于基础 keymap 的 Mod-[ indentLess
    Prec.high(keymap.of([{ key: 'Ctrl-[', run: handleEscapeKey }])),
    // vim 事务的 userEvent 注解补全（打字机锚定等按注解分流的消费者依赖它）
    ViewPlugin.fromClass(
      class {
        constructor(view: EditorView) {
          annotateVimDispatch(view)
        }
      }
    )
  ]
}

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual line' | 'visual block'

/**
 * 读取当前 vim 模式（经 CM5 适配层 `cm.state.vim.mode`，由包内 `vim-mode-change` 事件维护）。
 * vim 未挂载时适配层不存在或 state.vim 为空 → 返回 null。
 */
export function readVimMode(view: EditorView): VimMode | null {
  const cm = getCM(view)
  const vimState = cm?.state.vim
  if (!cm || !vimState) return null
  return (vimState.mode ?? 'normal') as VimMode
}

/** 徽标文案：模式名大写化（visual line / block 缩写，避免胶囊过宽） */
export function formatVimModeLabel(mode: VimMode): string {
  if (mode === 'visual line') return 'V-LINE'
  if (mode === 'visual block') return 'V-BLOCK'
  return mode.toUpperCase()
}

/**
 * Esc 让位判定（纯函数，供 App.vue 的分级链与单测使用）：vim 开启且编辑器聚焦时，
 * Esc 让给 vim 返回 normal（心流退出改走 Alt+W / 顶栏咖啡杯）；焦点不在编辑器
 * （如悬浮预览 / 工具栏按钮）时维持现有应用级回退，行为不变。
 */
export function shouldYieldEscapeToVim(vimEnabled: boolean, editorFocused: boolean): boolean {
  return vimEnabled && editorFocused
}
