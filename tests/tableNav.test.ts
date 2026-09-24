// @vitest-environment jsdom
//
// 注意：这里不创建真实 EditorView——jsdom 没有实现 getClientRects，
// CM 的测量阶段会抛错（仓库既有做法：用只含 state / dispatch / focus 的伪 view 测命令）
import { describe, expect, it } from 'vitest'
import { EditorState, type ChangeSpec, type EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { cellContent, columnCount, emptyRowText, tableAt, tableTab } from '../src/renderer/src/lib/tableNav'

const TABLE = ['前文', '', '| A | B | C |', '| --- | --- | --- |', '| 1 | 2 | 3 |', '', '后文'].join('\n')

interface FakeView {
  state: EditorState
  dispatch(spec: { changes?: ChangeSpec; selection?: EditorSelection | { anchor: number; head?: number } }): void
  focus(): void
}

function fakeView(doc: string, cursor: number): FakeView {
  let state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: cursor }
  })
  return {
    get state() {
      return state
    },
    dispatch(spec) {
      state = state.update(spec as Parameters<EditorState['update']>[0]).state
    },
    focus() {}
  }
}

const asView = (v: FakeView): EditorView => v as unknown as EditorView

const selectedText = (v: FakeView): string => {
  const sel = v.state.selection.main
  return v.state.doc.sliceString(sel.from, sel.to)
}

describe('表格内定位', () => {
  it('光标在表格内时取到单元格序列（行优先，含表头）', () => {
    const pos = TABLE.indexOf('2')
    const view = fakeView(TABLE, pos)
    const t = tableAt(view.state, pos)
    expect(t).not.toBeNull()
    expect(t!.cells.length).toBe(6) // 3 列表头 + 3 列数据
    expect(view.state.doc.sliceString(t!.cells[t!.index].from, t!.cells[t!.index].to)).toContain('2')
  })

  it('光标不在表格内返回 null', () => {
    const view = fakeView(TABLE, 0)
    expect(tableAt(view.state, 0)).toBeNull()
  })

  it('列数与空行文本', () => {
    const pos = TABLE.indexOf('A')
    const view = fakeView(TABLE, pos)
    const t = tableAt(view.state, pos)!
    expect(columnCount(view.state, t)).toBe(3)
    expect(emptyRowText(3)).toBe('|  |  |  |')
  })

  it('单元格内容区间去掉两端空白与竖线', () => {
    const doc = '|  A  |  B  |\n| --- | --- |'
    const view = fakeView(doc, doc.indexOf('A'))
    const t = tableAt(view.state, doc.indexOf('A'))!
    const content = cellContent(view.state, t.cells[0])
    expect(view.state.doc.sliceString(content.from, content.to)).toBe('A')
  })
})

describe('Tab 跳转', () => {
  it('Tab 依次前进；末格 Tab 追加一行（列数同表头）并跳到新行首格', () => {
    const view = fakeView(TABLE, TABLE.indexOf('A'))
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      expect(tableTab(asView(view), 1)).toBe(true)
      seen.push(selectedText(view))
    }
    expect(seen.slice(0, 5)).toEqual(['B', 'C', '1', '2', '3'])
    expect(seen[5]).toBe('') // 末格 Tab → 新行首格（空单元格）
    expect(view.state.doc.toString()).toContain('|  |  |  |')
    expect(view.state.doc.toString().split('\n').length).toBe(TABLE.split('\n').length + 1)
  })

  it('Shift+Tab 反向；首格 Shift+Tab 离开表格（到表格上一行行尾）', () => {
    const view = fakeView(TABLE, TABLE.indexOf('A'))
    expect(tableTab(asView(view), -1)).toBe(true)
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from - 1)
  })

  it('光标不在表格内时不接管（返回 false，交回默认行为）', () => {
    const view = fakeView(TABLE, 0)
    expect(tableTab(asView(view), 1)).toBe(false)
  })
})

describe('表格边界（点击渲染态表格后光标落在块边界）', () => {
  it('光标正好在表格起点 / 终点时仍判定为「在表格内」', () => {
    const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const t0 = tableAt(EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] }), 0)
    expect(t0).not.toBeNull()
    const tEnd = tableAt(EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] }), doc.length)
    expect(tEnd).not.toBeNull()
  })

  it('边界进入后 Tab 走向下一个单元格', () => {
    const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const view = fakeView(doc, 0)
    expect(tableTab(asView(view), 1)).toBe(true)
    expect(selectedText(view)).toBe('B')
  })
})
