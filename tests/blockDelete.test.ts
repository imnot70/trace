// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { blockRangeAt, blockDeleteRange } from '../src/renderer/src/lib/blockDelete'

function mkState(doc: string, pos: number): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })], selection: { anchor: pos } })
}

describe('blockRangeAt：光标所在块级内容（FR-2.4.30）', () => {
  it('围栏代码块：光标在围栏行 / 内容行 / 尾栏均命中整块', () => {
    const doc = '前文\n\n```js\nconst a = 1\n```\n\n后文'
    const open = doc.indexOf('```js')
    const inner = doc.indexOf('const a')
    const close = doc.indexOf('```', open + 1)
    for (const pos of [open + 1, inner, close + 1]) {
      const r = blockRangeAt(mkState(doc, pos), pos)
      expect(r, 'pos=' + pos).toEqual({ from: open, to: close + 3 })
    }
  })

  it('$$ 公式块：scanBlocks 行扫描命中（lezer 无数学节点）', () => {
    const doc = '前文\n\n$$\nE=mc^2\n$$\n\n后文'
    const open = doc.indexOf('$$')
    const inner = doc.indexOf('E=mc')
    const close = doc.indexOf('$$', open + 1)
    for (const pos of [open + 1, inner]) {
      const r = blockRangeAt(mkState(doc, pos), pos)
      expect(r, 'pos=' + pos).toEqual({ from: open, to: close + 2 })
    }
  })

  it('表格（语法树 Table 节点）', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const pos = doc.indexOf('| 1 |')
    const r = blockRangeAt(mkState(doc, pos), pos)
    expect(r).toEqual({ from: 0, to: doc.length })
  })

  it('HTML 块', () => {
    const doc = '前文\n\n<div>块</div>\n\n后文'
    const pos = doc.indexOf('<div>')
    const r = blockRangeAt(mkState(doc, pos), pos)
    expect(r).not.toBeNull()
    expect(doc.slice(r!.from, r!.to)).toContain('<div>块</div>')
  })

  it('frontmatter：光标在头部区域命中整个头部', () => {
    const doc = '---\ntags: [a]\n---\n\n正文'
    const pos = doc.indexOf('tags')
    const r = blockRangeAt(mkState(doc, pos), pos)
    expect(r).toEqual({ from: 0, to: doc.indexOf('---', 3) + 3 })
  })

  it('普通段落 / 空行不在块内（返回 null）', () => {
    const doc = '前文\n\n```js\nconst a = 1\n```\n\n后文'
    expect(blockRangeAt(mkState(doc, 1), 1)).toBeNull() // 前文
    expect(blockRangeAt(mkState(doc, doc.indexOf('后文')), doc.indexOf('后文'))).toBeNull()
  })

  it('普通文字内的行内码 / 加粗不算块', () => {
    const doc = '文字 `code` 与 **粗体**'
    expect(blockRangeAt(mkState(doc, doc.indexOf('code')), doc.indexOf('code'))).toBeNull()
  })
})

describe('blockDeleteRange：空行吞并（FR-2.4.30）', () => {
  it('块前后都有换行：吞掉块后一个换行（不留双空行）', () => {
    const doc = 'A\n\n```\nc\n```\n\nB'
    const state = mkState(doc, doc.indexOf('c'))
    const block = blockRangeAt(state, doc.indexOf('c'))!
    expect(blockDeleteRange(state.doc, block)).toEqual({ from: doc.indexOf('```'), to: doc.indexOf('```', doc.indexOf('```') + 1) + 4 })
  })

  it('块在文档末尾（后无换行）：原样返回', () => {
    const doc = 'A\n\n```\nc\n```'
    const state = mkState(doc, doc.indexOf('c'))
    const block = blockRangeAt(state, doc.indexOf('c'))!
    expect(blockDeleteRange(state.doc, block)).toEqual(block)
  })
})
