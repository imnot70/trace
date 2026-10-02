/**
 * 行删除与块删除（FR-2.4.30）：编辑器快捷键的纯逻辑。
 * - blockRangeAt：光标所在「块级内容」的范围——围栏代码块 / $$ 公式块 / HTML 块 / 表格 /
 *   frontmatter（与所见即所得的块级渲染同源：语法树节点 + scanBlocks 行扫描）；
 *   引用 / 列表等结构不在块定义内（删行已覆盖，整删易误伤）。
 * - 扩张规则：块前后都有空行时吞掉块后一个换行，避免删除后残留连续空行。
 * 命令接线（键位 Ctrl+Shift+K / Alt+D）在 MarkdownEditor 的应用级 keymap。
 */
import type { EditorState } from '@codemirror/state'
import type { Text } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { frontmatterRange, scanBlocks } from './livePreview/decorations'

export interface SimpleRange {
  from: number
  to: number
}

const BLOCK_NODES = ['FencedCode', 'HTMLBlock', 'Table']

/** 光标所在块级内容的范围；不在任何块内返回 null */
export function blockRangeAt(state: EditorState, pos: number): SimpleRange | null {
  const doc = state.doc
  // frontmatter（自定义识别——lezer 把 --- 解析为 Setext，不可靠）
  const fm = frontmatterRange(doc)
  if (fm && pos >= fm.from && pos <= fm.to) return { from: fm.from, to: fm.to }
  // $$ 公式块（scanBlocks 行扫描；与公式块渲染同源）
  for (const m of scanBlocks(doc)) {
    if (pos >= m.from && pos <= m.to) return { from: m.from, to: m.to }
  }
  // 语法树容器块：光标处向上找最近的块级节点。块起始边界处 resolveInner(pos, -1)
  // 可能解到 HTMLBlock 内嵌 Document 的外层 Document（跳过 HTMLBlock 本身，实测）——
  // 兜底再探 pos + 1（块至少三个字符，+1 仍在块内）
  for (const probe of [pos, pos + 1]) {
    let node = syntaxTree(state).resolveInner(probe, -1)
    for (let i = 0; i < 10 && node; i++) {
      if (BLOCK_NODES.includes(node.name)) return { from: node.from, to: node.to }
      if (!node.parent) break
      node = node.parent
    }
  }
  return null
}

/**
 * 块删除的最终范围：块范围 + 空行吞并——块前后都有换行时把块后的换行一并删除
 * （doc = 'A\n\n```\nc\n```\n\nB' 删块 → 'A\n\nB'，不留双空行）。
 */
export function blockDeleteRange(doc: Text, block: SimpleRange): SimpleRange {
  const beforeNl = block.from > 0 && doc.sliceString(block.from - 1, block.from) === '\n'
  const afterNl = block.to < doc.length && doc.sliceString(block.to, block.to + 1) === '\n'
  if (beforeNl && afterNl) return { from: block.from, to: block.to + 1 }
  return block
}
