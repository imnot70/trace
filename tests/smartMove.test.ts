// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { crossBlockLanding, smartVerticalMove } from '../src/renderer/src/lib/livePreview/smartMove'
import { livePreviewFacet, lpBlockField, type LivePreviewConfig } from '../src/renderer/src/lib/livePreview/decorations'
import type { SimpleRange } from '../src/renderer/src/lib/livePreview/decorations'

/** 块级公式区间（三行公式：$$ / b=c / $$），文档 "a\n$$\nb=c\n$$\nd" 的 1–3 行（0 基） */
const BLOCK: SimpleRange[] = [{ from: 2, to: 12 }]

describe('所见即所得垂直移动：跨块判定与近端落点（方案 A 纯函数）', () => {
  it('向下飞跃块：落点改为块首（from）——光标贴边触发源码回落', () => {
    // old 在块前（a 行中），new 被 widget 坐标扫描甩到块后
    expect(crossBlockLanding(1, 13, BLOCK, 1)).toBe(2)
  })

  it('向上飞跃块：落点改为块尾（to）', () => {
    // old 在块后（d 行中），new 被甩到块前
    expect(crossBlockLanding(13, 1, BLOCK, -1)).toBe(12)
  })

  it('new 恰为远端边界也算飞跃（坐标扫描落入 widget 时按方向返回远端边界值）', () => {
    expect(crossBlockLanding(1, 12, BLOCK, 1)).toBe(2) // 向下 new == to
    expect(crossBlockLanding(13, 2, BLOCK, -1)).toBe(12) // 向上 new == from
  })

  it('同侧移动（未飞跃）不修正：短距逐行移动保持默认行为', () => {
    expect(crossBlockLanding(0, 1, BLOCK, 1)).toBeNull() // 块前小步
    expect(crossBlockLanding(13, 14, BLOCK, -1)).toBeNull() // 块后小步（无块处）
  })

  it('old 在块内（源码回落态，块不在渲染区间表中）不修正', () => {
    expect(crossBlockLanding(5, 13, BLOCK, 1)).toBeNull()
    expect(crossBlockLanding(5, 1, BLOCK, -1)).toBeNull()
  })

  it('多块连跨取最近一块的近端（区间为文档序，向下取首个被飞跃的块首）', () => {
    const two: SimpleRange[] = [
      { from: 2, to: 6 },
      { from: 10, to: 14 }
    ]
    expect(crossBlockLanding(0, 20, two, 1)).toBe(2)
    expect(crossBlockLanding(20, 0, two, -1)).toBe(14)
  })

  it('单行块（水平线 / 单行公式）同样适用：贴边落点使该行回落源码', () => {
    const hr: SimpleRange[] = [{ from: 2, to: 5 }]
    expect(crossBlockLanding(0, 8, hr, 1)).toBe(2)
    expect(crossBlockLanding(8, 0, hr, -1)).toBe(5)
  })

  it('贴边起点不修正（old == from 向下 / old == to 向上：occupied 已回落，块不在表中）', () => {
    expect(crossBlockLanding(2, 13, BLOCK, 1)).toBeNull()
    expect(crossBlockLanding(12, 1, BLOCK, -1)).toBeNull()
  })
})

describe('所见即所得垂直移动：无渲染块时等价放行（验收标准 4）', () => {
  function createView(doc: string, enabled: boolean): EditorView {
    const cfg: LivePreviewConfig = {
      enabled,
      vault: 'v',
      notePath: 'n.md',
      resolveName: () => false,
      openNote: () => undefined,
      openExternal: () => undefined
    }
    // 只挂 facet + 块级 StateField（smartVerticalMove 的全部依赖）；不引装配层 index.ts——
    // tests/** 在主进程 tsconfig（无 DOM lib / window 增强）下编译，其依赖链（../wikilink）不测试安全
    return new EditorView({
      state: EditorState.create({ doc, extensions: [livePreviewFacet.of(cfg), lpBlockField] }),
      parent: document.body
    })
  }

  it('所见即所得关：smartVerticalMove 返回 false、选区不动（defaultKeymap 接管）', () => {
    const view = createView('a\nb', false)
    view.dispatch({ selection: { anchor: 0 } })
    expect(smartVerticalMove(view, 1)).toBe(false)
    expect(view.state.selection.main.head).toBe(0)
    view.destroy()
  })

  it('所见即所得开但无块级公式：返回 false 放行（纯文本笔记零变化）', () => {
    const view = createView('a\nb', true)
    view.dispatch({ selection: { anchor: 0 } })
    expect(smartVerticalMove(view, 1)).toBe(false)
    expect(view.state.selection.main.head).toBe(0)
    view.destroy()
  })
})
