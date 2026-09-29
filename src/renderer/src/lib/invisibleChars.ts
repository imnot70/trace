/** 不可见字符治理与任务标记容忍解析（FR-2.4.24 / FR-2.4.25）——单一定义源。
 *  背景（tech_product-interaction 教训 8，index 原待办 #11）：网页粘贴常把任务行里的
 *  空格换成 NBSP（U+00A0），预览（markdown-it）与所见即所得（lezer）两条解析管线都只认
 *  ASCII 空格，任务渲染整体失效。本模块提供：
 *  ① 任务标记的容忍匹配 matchTaskMarker（两管线共用同一判定口径）；
 *  ② 不可见字符归一化 normalizeInvisibleChars（粘贴归一化）；
 *  ③ 文档级扫描 collectDocInvisible（清理命令的确认计数与写回 change 同源）。
 *  设计与决策记录：ai/requirements/2026-09-29_task-marker-tolerance/
 *  本模块保持纯逻辑（不 import CM 运行时），CM 接线在 lib/invisibleEdits.ts */

import type { Text } from '@codemirror/state'

/** NBSP 类：粘贴 / 清理时替换为普通空格（U+202F 窄不换行空格，法文排版粘贴常见） */
const NBSP_LIKE = /[\u00a0\u202f]/g
/** 零宽字符：粘贴 / 清理时删除（零宽空格 / 词连接符 / BOM 即零宽不换行空格）。
 *  ⚠️ U+200D ZWJ 与 U+200C ZWNJ 绝不进本集合——前者是 emoji 序列的组成部分，
 *  后者是阿拉伯系文字的合法字母，动了毁字 */
const ZERO_WIDTH = /[\u200b\u2060\ufeff]/g

/** 任务标记的前导容忍集：\s 已含 NBSP / 窄 NBSP / BOM（JS \s 语义），零宽显式补入；
 *  与归一化集合口径一致地**不含 ZWJ / ZWNJ**——绝不越过合法文字成分去认任务标记 */
const TASK_SKIP = /^[\s\u200b\u2060]*/

export interface TaskMarkerMatch {
  /** `[x]` / `[X]` → true；`[ ]` 与括号内空白变体（D3：视为未勾选）→ false */
  checked: boolean
  /** `[` 在输入串中的下标 */
  start: number
  /** `]` 的下一个字符下标（恒 = start + 3） */
  end: number
  /** 标记与其后连续容忍空白之后的位置（渲染侧从此处切片正文，等价旧 `\s+` 贪婪吃空） */
  contentStart: number
}

/**
 * 从「列表项首段内容」识别 GFM 任务标记（容忍不可见字符，FR-2.4.24）。
 * 形态：可选前导不可见字符 + `[ ]/[x]/[X]`（括号内 NBSP / 窄 NBSP 视为未勾选）
 * + 至少一个分隔空白。行尾裸 `[x]`（无分隔）与非开头位置的 `[x]` 返回 null——
 * 与两管线既有 ASCII 行为逐字节一致：容忍只对「本已拒绝」的变体生效，不放宽 ASCII。
 */
export function matchTaskMarker(content: string): TaskMarkerMatch | null {
  const start = content.match(TASK_SKIP)![0].length
  if (content.charCodeAt(start) !== 0x5b /* [ */) return null
  const inner = content[start + 1]
  if (content[start + 2] !== ']') return null
  if (inner !== ' ' && inner !== 'x' && inner !== 'X' && inner !== '\u00a0' && inner !== '\u202f') {
    return null
  }
  const end = start + 3
  // 分隔符：`]` 后至少一个容忍空白（GFM 语义；lezer 守卫 [ \t] 与 markdown-it \s+ 同要求）
  if (!content.slice(end, end + 1).match(/^[\s\u200b\u2060]/)) return null
  const contentStart = end + content.slice(end).match(TASK_SKIP)![0].length
  return { checked: inner === 'x' || inner === 'X', start, end, contentStart }
}

export interface InvisibleCounts {
  /** NBSP / 窄 NBSP（将替换为普通空格） */
  nbsp: number
  /** 零宽字符（将删除） */
  zeroWidth: number
}

/** 归一化不可见字符（FR-2.4.25 粘贴归一化）：NBSP 类 → 空格，零宽 → 删除，其余原样 */
export function normalizeInvisibleChars(text: string): { text: string } & InvisibleCounts {
  let nbsp = 0
  let zeroWidth = 0
  const out = text
    .replace(NBSP_LIKE, () => {
      nbsp++
      return ' '
    })
    .replace(ZERO_WIDTH, () => {
      zeroWidth++
      return ''
    })
  return { text: out, nbsp, zeroWidth }
}

export interface InvisibleChange {
  from: number
  to: number
  insert: string
}

/** 全文扫描不可见字符（FR-2.4.25 清理命令）：计数与写回 change 同源产出，
 *  确认框数字不会与实际替换脱节。NBSP 类 → insert ' '，零宽 → insert ''；
 *  相邻同类字符合并为一个区间，避免碎片 change */
export function collectDocInvisible(doc: Text): InvisibleCounts & { changes: InvisibleChange[] } {
  const changes: InvisibleChange[] = []
  let nbsp = 0
  let zeroWidth = 0
  let cur: (InvisibleChange & { kind: 'nbsp' | 'zw' }) | null = null
  const flush = (): void => {
    if (cur) {
      changes.push({ from: cur.from, to: cur.to, insert: cur.insert })
      cur = null
    }
  }
  for (let pos = 0; pos < doc.length; ) {
    const line = doc.lineAt(pos)
    for (let i = 0; i < line.text.length; i++) {
      const ch = line.text[i]
      const isNbsp = ch === '\u00a0' || ch === '\u202f'
      const isZw = ch === '\u200b' || ch === '\u2060' || ch === '\ufeff'
      if (!isNbsp && !isZw) {
        flush()
        continue
      }
      if (isNbsp) nbsp++
      else zeroWidth++
      const kind = isNbsp ? 'nbsp' : 'zw'
      const at = line.from + i
      if (cur && cur.kind === kind && cur.to === at) {
        cur.to = at + 1
      } else {
        flush()
        cur = { kind, from: at, to: at + 1, insert: isNbsp ? ' ' : '' }
      }
    }
    flush()
    pos = line.to + 1
  }
  return { nbsp, zeroWidth, changes }
}
