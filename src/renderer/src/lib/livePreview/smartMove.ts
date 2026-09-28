/** 所见即所得下键盘垂直移动的跨块修正（方案 A，2026-09-28 交接实施）。
 *
 *  根因（handoff-2026-09-28 第二节的实验定位）：渲染中的块级 widget 是
 *  `Decoration.replace({ block: true })` 的原子区，CM6 `moveVertically` 的坐标扫描
 *  （posAtCoords 的 scanY 循环）遇到 widget 块会直接跳到对侧（向下落到其后的文本行、
 *  向上落到其前），光标从不触碰公式区间 → `occupied` 永不触发源码回落，
 *  `↓`/`↑` 与 Vim 的 `j`/`k`（经 findPosV → moveVertically 同路径）整块跳过。
 *  点击可进入（posAtCoords 对 widget 按上半/下半返回贴边位置），故缺口只在键盘动线显形。
 *
 *  修法：移动前后 head 分居某「渲染中」块两侧（飞跃）时，把落点改为近端边界——
 *  向下 → 块首（from）、向上 → 块尾（to）；贴边后 occupied 触发回落，
 *  光标落在源码内，行为与 Obsidian 一致。行内公式的原子区在一行内（l/h 贴边即回落），
 *  不经过本路径，勿动行内装饰。 */
import { EditorSelection } from '@codemirror/state'
import { cursorLineDown, cursorLineUp } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { renderedBlockRanges, type SimpleRange } from './decorations'

/**
 * 跨块判定与近端落点（纯函数，随 tests/smartMove.test.ts 覆盖）。
 * oldHead → newHead 分居某渲染块区间两侧（本次移动飞跃了该块）时返回近端边界
 * （dir=1 → 块首 from；dir=-1 → 块尾 to），无飞跃返回 null。
 * ranges 须为文档序（renderedBlockRanges 的产出序）：一次移动连跨多块时，
 * 向下取**首个**被飞跃块（文档序最先命中即离起点最近），向上取**最后一个**
 * （离起点最近）——落点总是进入离起点最近的那块源码。
 * newHead 恰等于远端边界（向下 == to / 向上 == from）也算飞跃——坐标扫描落在
 * widget 内时会按方向返回远端边界值。
 */
export function crossBlockLanding(
  oldHead: number,
  newHead: number,
  ranges: readonly SimpleRange[],
  dir: 1 | -1
): number | null {
  let landing: number | null = null
  for (const r of ranges) {
    if (dir === 1) {
      if (oldHead < r.from && newHead > r.from) return r.from
    } else if (oldHead > r.to && newHead < r.to) {
      landing = r.to
    }
  }
  return landing
}

/**
 * 非 Vim 垂直移动入口（↑ / ↓ keymap 绑定的 run）：
 * 无渲染块（含所见即所得关、心流 / 源码模式）返回 false 放行默认键位——
 * 必须与默认行为完全等价（验收标准 4）；有渲染块时执行默认移动，
 * 对飞跃了块的落点改写为近端边界（贴边 → occupied 回落，块打回源码、光标在源码内）。
 * 无论是否修正都返回 true：移动已由本函数完成，不能让 defaultKeymap 再走一次。
 */
export function smartVerticalMove(view: EditorView, dir: 1 | -1): boolean {
  const blocks = renderedBlockRanges(view.state)
  if (blocks.length === 0) return false
  const oldHead = view.state.selection.main.head
  const moved = dir === 1 ? cursorLineDown(view) : cursorLineUp(view)
  if (!moved) return false // 文档边缘等无法移动：交回键位链（与默认命令返回 false 一致）
  const landing = crossBlockLanding(oldHead, view.state.selection.main.head, blocks, dir)
  if (landing != null) {
    view.dispatch({ selection: EditorSelection.cursor(landing), scrollIntoView: true })
  }
  return true
}
