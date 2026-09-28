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
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { getCM, vim, Vim } from '@replit/codemirror-vim'

/** CM5 适配层实例（订阅 `vim-mode-change` 事件用） */
export const getVimCM = getCM

/** 让渡给应用的 vim 键（CM5 键名记法；卸载后穿透给应用层键位） */
export const VIM_YIELDED_KEYS = ['<C-f>', '<C-b>', '<C-e>', '<C-i>', '<C-n>', '<C-t>'] as const

/** 卸载是否已执行过（unmap 作用于包内全局键位表，与编辑器实例无关，做一次即可） */
let yieldedKeysRemoved = false

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

/** 构建 vim 扩展（挂入 vimCompartment；首次调用时完成冲突键卸载） */
export function buildVimExtension(): Extension {
  removeYieldedKeys()
  return vim()
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
