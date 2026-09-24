// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  computeBlockDecorations,
  computeInlineDecorations,
  type LivePreviewConfig
} from '../src/renderer/src/lib/livePreview/decorations'
import {
  BulletWidget,
  CheckboxWidget,
  FrontmatterWidget,
  ImageWidget,
  MathWidget,
  RenderedBlockWidget,
  WikilinkWidget,
  toggleTaskAt
} from '../src/renderer/src/lib/livePreview/widgets'

interface Collected {
  from: number
  to: number
  spec: Record<string, unknown>
}

function mkState(doc: string, cursor?: number): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
    selection: cursor === undefined ? undefined : { anchor: cursor }
  })
}

const cfg: LivePreviewConfig = {
  enabled: true,
  vault: 'vaultA',
  notePath: 'notes/a.md',
  resolveName: (name: string) => name === '存在',
  openNote: vi.fn(),
  openExternal: vi.fn()
}

function collect(state: EditorState, set: DecorationSet): Collected[] {
  const out: Collected[] = []
  set.between(0, state.doc.length, (from: number, to: number, value: Decoration) => {
    out.push({ from, to, spec: value.spec as Record<string, unknown> })
  })
  return out
}

const allRanges = (state: EditorState) => [{ from: 0, to: state.doc.length }]

/** 标记隐藏装饰 = 无 widget、无 class 的空 spec replace */
function hiddenAt(marks: Collected[], from: number, to: number): boolean {
  return marks.some(
    (c) => c.from === from && c.to === to && Object.keys(c.spec).length === 0
  )
}

function widgetsOf(state: EditorState, set: DecorationSet): unknown[] {
  return collect(state, set)
    .map((c) => c.spec)
    .filter((s) => typeof s === 'object' && s !== null && 'widget' in s)
    .map((s) => (s as { widget: unknown }).widget)
}

describe('所见即所得装饰：光标回落（D3）', () => {
  it('标题：光标不在行内时隐藏 # 标记并加行级标题样式；光标在行内时标记回落源码', () => {
    const doc = '# 标题一\n\n正文'
    const state = mkState(doc, doc.length) // 光标在文末（标题行外）
    const r = computeInlineDecorations(state, allRanges(state), cfg)
    const marks = collect(state, r.decorations)
    // # 标记被替换隐藏
    expect(hiddenAt(marks, 0, 2)).toBe(true)
    // 行级标题样式（lp-h1）
    expect(marks.some((c) => c.from === 0 && String(c.spec.class ?? '').includes('lp-h1'))).toBe(true)

    const onLine = mkState(doc, 4) // 光标在标题行内
    const r2 = computeInlineDecorations(onLine, allRanges(onLine), cfg)
    const marks2 = collect(onLine, r2.decorations)
    expect(hiddenAt(marks2, 0, 2)).toBe(false)
    expect(marks2.some((c) => String(c.spec.class ?? '').includes('lp-h1'))).toBe(true)
  })

  it('加粗：两侧 ** 在内容内不露出；光标贴到 / 进入标记或选中标记时才回落', () => {
    const doc = '前文 **加粗文字** 后文'
    const open = doc.indexOf('**') // 3
    const state = mkState(doc, doc.length)
    const r = computeInlineDecorations(state, allRanges(state), cfg)
    const marks = collect(state, r.decorations)
    expect([0, 1].filter((i) => hiddenAt(marks, 3 + i * 6, 5 + i * 6)).length).toBe(2)
    expect(marks.some((c) => String(c.spec.class ?? '') === 'lp-strong')).toBe(true)

    const hiddenCount = (cursor: number) => {
      const s = mkState(doc, cursor)
      return collect(s, computeInlineDecorations(s, allRanges(s), cfg).decorations).filter(
        (c) => Object.keys(c.spec).length === 0 && c.to - c.from === 2
      ).length
    }
    expect(hiddenCount(doc.length)).toBe(2) // 区间之外 → 隐藏
    expect(hiddenCount(open + 4)).toBe(2) // 内容中间 → 隐藏（本次调整：不再露出）
    expect(hiddenCount(open + 2)).toBe(2) // 内容开头（标记内侧） → 隐藏
    expect(hiddenCount(open + 6)).toBe(2) // 内容末尾（标记内侧） → 隐藏
    expect(hiddenCount(open)).toBe(0) // 紧贴打开标记之前 → 露出
    expect(hiddenCount(open + 1)).toBe(0) // 打开标记内部（** 之间） → 露出
    expect(hiddenCount(open + 8)).toBe(0) // 紧贴闭合标记之后 → 露出

    // 选中内容（含跨越标记）时才露出：选中「加粗文字」本身不露出
    const sel = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage })],
      selection: { anchor: open + 2, head: open + 6 }
    })
    const selMarks = collect(sel, computeInlineDecorations(sel, allRanges(sel), cfg).decorations)
    expect(selMarks.filter((c) => Object.keys(c.spec).length === 0 && c.to - c.from === 2).length).toBe(2)
    // 选区跨越定界符（选中到内容之外）→ 露出
    const sel2 = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage })],
      selection: { anchor: open, head: open + 8 }
    })
    const sel2Marks = collect(sel2, computeInlineDecorations(sel2, allRanges(sel2), cfg).decorations)
    expect(sel2Marks.filter((c) => Object.keys(c.spec).length === 0 && c.to - c.from === 2).length).toBe(0)
  })

  it('删除线：内容内保持渲染（只剩删除线），贴到/选中 ~~ 才露出源码', () => {
    const doc = '前文 ~~删除内容~~ 后文'
    const open = doc.indexOf('~~')
    const hiddenTildes = (cursor: number) => {
      const s = mkState(doc, cursor)
      return collect(s, computeInlineDecorations(s, allRanges(s), cfg).decorations).filter(
        (c) => Object.keys(c.spec).length === 0 && c.to - c.from === 2
      ).length
    }
    // 内容里（中间 / 两端）都保持渲染——用户实测反馈的场景
    expect(hiddenTildes(open + 4)).toBe(2)
    expect(hiddenTildes(open + 2)).toBe(2)
    expect(hiddenTildes(open + 6)).toBe(2)
    // 贴到标记才露出
    expect(hiddenTildes(open)).toBe(0)
    expect(hiddenTildes(open + 1)).toBe(0)
    expect(hiddenTildes(open + 8)).toBe(0)
    // 删除线样式始终作用于内容
    const s = mkState(doc, open + 4)
    expect(
      collect(s, computeInlineDecorations(s, allRanges(s), cfg).decorations).some(
        (c) => String(c.spec.class ?? '') === 'lp-strike'
      )
    ).toBe(true)
  })

  it('行内代码：反引号在内容内不露出；光标贴到反引号外侧或选中标记时回落', () => {
    const doc = '行内 `code` 演示'
    const open = doc.indexOf('`')
    const state = mkState(doc, doc.length)
    const marks = collect(state, computeInlineDecorations(state, allRanges(state), cfg).decorations)
    expect(marks.filter((c) => Object.keys(c.spec).length === 0 && c.to - c.from === 1).length).toBe(2)
    expect(marks.some((c) => String(c.spec.class ?? '') === 'lp-inline-code')).toBe(true)

    const hiddenBackticks = (cursor: number) => {
      const s = mkState(doc, cursor)
      return collect(s, computeInlineDecorations(s, allRanges(s), cfg).decorations).filter(
        (c) => Object.keys(c.spec).length === 0 && c.to - c.from === 1
      ).length
    }
    expect(hiddenBackticks(open + 2)).toBe(2) // 内容内（code 里）→ 隐藏
    expect(hiddenBackticks(open)).toBe(0) // 紧贴反引号之前 → 露出
    expect(hiddenBackticks(open + 6)).toBe(0) // 紧贴闭合反引号之后 → 露出
  })

  it('行内代码：内容加 lp-inline-code，反引号在内容内保持隐藏', () => {
    const doc = '行内 `code` 演示'
    const state = mkState(doc, doc.length)
    const marks = collect(state, computeInlineDecorations(state, allRanges(state), cfg).decorations)
    expect(marks.filter((c) => Object.keys(c.spec).length === 0 && c.to - c.from === 1).length).toBe(2)
    expect(marks.some((c) => String(c.spec.class ?? '') === 'lp-inline-code')).toBe(true)
    const inside = mkState(doc, 5)
    const marks2 = collect(inside, computeInlineDecorations(inside, allRanges(inside), cfg).decorations)
    expect(marks2.some((c) => String(c.spec.class ?? '') === 'lp-inline-code')).toBe(true)
    expect(marks2.filter((c) => Object.keys(c.spec).length === 0 && c.to - c.from === 1).length).toBe(2)
  })
})

describe('所见即所得装饰：公式与块级渲染', () => {
  it('行内公式 → MathWidget（inline）；行内码中的 $ 不误判', () => {
    const doc = '公式 $E=mc^2$ 与 `$f(x)$ 代码中的伪公式`'
    const state = mkState(doc, doc.length)
    const r = computeInlineDecorations(state, allRanges(state), cfg)
    const widgets = widgetsOf(state, r.decorations)
    const math = widgets.filter((w) => w instanceof MathWidget)
    expect(math.length).toBe(1)
    expect((math[0] as MathWidget).tex).toBe('E=mc^2')
    expect((math[0] as MathWidget).block).toBe(false)
  })

  it('带列表标记的单行 $$…$$ 不做块级（由行内正则渲染为行内公式）', () => {
    const doc = '- 结论：$$E=mc^2$$'
    const state = mkState(doc, 0) // 光标避开公式区间（文末贴边也视作占用）
    const r = computeBlockDecorations(state, cfg)
    expect(widgetsOf(state, r.decorations).length).toBe(0)
    const inline = widgetsOf(state, computeInlineDecorations(state, allRanges(state), cfg).decorations).filter(
      (w) => w instanceof MathWidget
    ) as MathWidget[]
    expect(inline.length).toBe(1)
    expect(inline[0].block).toBe(false)
    expect(inline[0].tex).toBe('E=mc^2')
  })

  it('块级公式 $$…$$ → 块级 MathWidget，tex 为多行内容', () => {
    const doc = '前段\n\n$$\nE=mc^2\n$$\n\n后段'
    const state = mkState(doc, doc.length)
    const r = computeBlockDecorations(state, cfg)
    const math = widgetsOf(state, r.decorations).filter((w) => w instanceof MathWidget) as MathWidget[]
    expect(math.length).toBe(1)
    expect(math[0].block).toBe(true)
    expect(math[0].tex).toBe('E=mc^2')
  })

  it('表格：光标不在块内时渲染为 RenderedBlockWidget(table)，光标进入回落源码', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n\n正文'
    const state = mkState(doc, doc.length)
    const r = computeBlockDecorations(state, cfg)
    const table = widgetsOf(state, r.decorations).find((w) => w instanceof RenderedBlockWidget) as RenderedBlockWidget
    expect(table).toBeTruthy()
    expect(table.kind).toBe('table')
    expect(table.html).toContain('<table')

    const inside = mkState(doc, 2) // 光标在表格内
    const r2 = computeBlockDecorations(inside, cfg)
    expect(widgetsOf(inside, r2.decorations).filter((w) => w instanceof RenderedBlockWidget).length).toBe(0)
  })

  it('列表项内多行块级公式：剥标记识别，不错配吞掉后续内容', () => {
    const doc = '- 第一项\n- $$\n  x^2\n  $$\n- 第三项'
    const state = mkState(doc, doc.length)
    const r = computeBlockDecorations(state, cfg)
    const math = widgetsOf(state, r.decorations).filter((w) => w instanceof MathWidget) as MathWidget[]
    expect(math.length).toBe(1)
    expect(math[0].block).toBe(true)
    expect(math[0].tex).toBe('x^2')
    // 覆盖范围仅公式三行，不吞「第三项」
    const collected: { from: number; to: number }[] = []
    r.decorations.between(0, state.doc.length, (f, t) => {
      collected.push({ from: f, to: t })
    })
    const thirdItemPos = doc.indexOf('- 第三项')
    expect(collected.every((c) => c.to <= thirdItemPos)).toBe(true)
  })

  it('有序列表项内多行块级公式同样识别', () => {
    const doc = '1. 第一项\n2. $$\n   x^2\n   $$\n3. 第三项'
    const state = mkState(doc, doc.length)
    const math = widgetsOf(state, computeBlockDecorations(state, cfg).decorations).filter(
      (w) => w instanceof MathWidget
    ) as MathWidget[]
    expect(math.length).toBe(1)
    expect(math[0].tex).toBe('x^2')
  })

  it('frontmatter：折叠为 FrontmatterWidget 并提取标签；无闭合时保持源码', () => {
    const doc = '---\ntags: [工作, 随笔]\n---\n\n# 正文'
    const state = mkState(doc, doc.length)
    const fm = widgetsOf(state, computeBlockDecorations(state, cfg).decorations).find(
      (w) => w instanceof FrontmatterWidget
    ) as FrontmatterWidget
    expect(fm).toBeTruthy()
    expect(fm.summary).toContain('工作')

    const brokenDoc = '---\ntags: [x]\n\n# 无闭合'
    const broken = mkState(brokenDoc, brokenDoc.length)
    const r2 = computeBlockDecorations(broken, cfg)
    expect(widgetsOf(broken, r2.decorations).filter((w) => w instanceof FrontmatterWidget).length).toBe(0)
  })

  it('frontmatter 之后的正文仍正常装饰（回归：剪枝不得在根节点把整棵树剪掉）', () => {
    const doc = '---\ntags: [工作]\n---\n\n# 正文\n\n- 列表项\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    const state = mkState(doc, 0) // 光标在首行（frontmatter 内），正文各行均不在光标行上
    // 行内装饰：标题标记隐藏 + 列表圆点
    const inline = computeInlineDecorations(state, allRanges(state), cfg).decorations
    const marks = collect(state, inline)
    const headingFrom = doc.indexOf('# 正文')
    expect(hiddenAt(marks, headingFrom, headingFrom + 2)).toBe(true)
    expect(widgetsOf(state, inline).some((w) => w instanceof BulletWidget)).toBe(true)
    // 块级装饰：表格 widget 仍渲染
    expect(
      widgetsOf(state, computeBlockDecorations(state, cfg).decorations).filter(
        (w) => w instanceof RenderedBlockWidget
      ).length
    ).toBeGreaterThan(0)
  })

  it('图片：resolveAssetUrl 成功时 widget src 为 trace-vault:// 协议', () => {
    const doc = '前文 ![截图](assets/shot.png) 后文'
    const state = mkState(doc, doc.length)
    const img = widgetsOf(state, computeInlineDecorations(state, allRanges(state), cfg).decorations).find(
      (w) => w instanceof ImageWidget
    ) as ImageWidget
    expect(img).toBeTruthy()
    expect(img.src).toContain('trace-vault://vaultA/')
    expect(img.alt).toBe('截图')
  })
})

describe('所见即所得装饰：双链与链接', () => {
  it('双链：可解析显示笔记名，断链标记 broken；点击目标登记为 wikilink', () => {
    const doc = '见 [[存在]] 与 [[不存在]]'
    const state = mkState(doc, 0) // 光标避开双链区间（文档以 ]] 结尾，贴边也视作占用）
    const r = computeInlineDecorations(state, allRanges(state), cfg)
    const links = widgetsOf(state, r.decorations).filter((w) => w instanceof WikilinkWidget) as WikilinkWidget[]
    expect(links.length).toBe(2)
    expect(links.map((w) => w.broken)).toEqual([false, true])
    expect(r.targets.filter((t) => t.kind === 'wikilink').map((t) => (t as { name: string }).name)).toEqual(['存在', '不存在'])
  })

  it('普通链接：[ 与 ](url) 隐藏、文本 lp-link、登记 link 目标', () => {
    const doc = '文档 [官网](https://example.com) 结束'
    const state = mkState(doc, doc.length)
    const r = computeInlineDecorations(state, allRanges(state), cfg)
    const marks = collect(state, r.decorations)
    expect(marks.some((c) => String(c.spec.class ?? '') === 'lp-link')).toBe(true)
    expect(r.targets.some((t) => t.kind === 'link' && (t as { url: string }).url === 'https://example.com')).toBe(true)
  })
})

describe('列表 / 引用标记渲染', () => {
  it('无序列表：非光标行 `-` → 圆点 widget；光标行回落源码', () => {
    const doc = '- 普通项\n- 第二项'
    const state = mkState(doc, doc.length) // 光标在第 2 行
    const marks = collect(state, computeInlineDecorations(state, allRanges(state), cfg).decorations)
    // 第 1 行（0..1）标记被替换为 BulletWidget
    const bullet = marks.find((c) => c.from === 0 && c.to === 1)
    expect(bullet?.spec.widget).toBeInstanceOf(BulletWidget)
    // 第 2 行是光标行 → 标记回落源码（无 0..1 行偏移的替换；第 2 行标记起始为 5）
    expect(marks.some((c) => c.from === 5 && c.to === 6)).toBe(false)
  })

  it('有序列表：保留源编号，不加任何标记装饰', () => {
    const doc = '1. 第一项\n2. 第二项'
    const state = mkState(doc, doc.length)
    const marks = collect(state, computeInlineDecorations(state, allRanges(state), cfg).decorations)
    expect(marks.some((c) => c.from === 0 && c.to === 2)).toBe(false)
  })

  it('任务列表：`- ` 与复选框互换——非光标行隐藏标记 + 复选框；光标行整体回落源码', () => {
    const doc = '- [ ] 待办\n- [x] 完成'
    const state = mkState(doc, doc.length) // 光标在第 2 行
    const marks = collect(state, computeInlineDecorations(state, allRanges(state), cfg).decorations)
    // 第 1 行：`- `（0..2）隐藏 + `[ ]`（2..5）→ CheckboxWidget
    expect(hiddenAt(marks, 0, 2)).toBe(true)
    const box = marks.find((c) => c.from === 2 && c.to === 5)
    expect(box?.spec.widget).toBeInstanceOf(CheckboxWidget)
    expect((box?.spec.widget as CheckboxWidget).checked).toBe(false)
    // 第 2 行是光标行：`- ` 与 `[x]` 都回落源码
    expect(hiddenAt(marks, 9, 11)).toBe(false)
    expect(marks.some((c) => c.from === 11 && c.to === 14)).toBe(false)
  })

  it('引用：非光标行 `> ` 连同后随空格隐藏；多行逐行生效；光标行回落', () => {
    const doc = '> 引用一\n> 引用二'
    const state = mkState(doc, doc.length) // 光标在第 2 行
    const marks = collect(state, computeInlineDecorations(state, allRanges(state), cfg).decorations)
    expect(hiddenAt(marks, 0, 2)).toBe(true) // `> ` 隐藏（含后随空格）
    expect(hiddenAt(marks, 6, 8)).toBe(false) // 光标行不隐藏
  })

  it('嵌套引用：逐层标记各自隐藏', () => {
    const doc = '> > 内层引用\n\n尾行'
    const state = mkState(doc, doc.length)
    const marks = collect(state, computeInlineDecorations(state, allRanges(state), cfg).decorations)
    expect(hiddenAt(marks, 0, 2)).toBe(true)
    expect(hiddenAt(marks, 2, 4)).toBe(true)
  })
})

describe('任务勾选写回', () => {
  it('TaskMarker → CheckboxWidget；toggleTaskAt 翻转源码勾选字符', () => {
    // 光标放在中间空行：两行任务项都不是光标行 → 都渲染为复选框
    const doc = '- [ ] 待办\n\n- [x] 完成'
    const state = mkState(doc, 9)
    const boxes = widgetsOf(state, computeInlineDecorations(state, allRanges(state), cfg).decorations).filter(
      (w) => w instanceof CheckboxWidget
    ) as CheckboxWidget[]
    expect(boxes.map((b) => b.checked)).toEqual([false, true])

    // 模拟点击第一个：应把 [ ] 改为 [x]
    let newDoc = doc
    const viewLike = {
      state,
      dispatch: (spec: { changes: { from: number; to: number; insert: string } }) => {
        newDoc = doc.slice(0, spec.changes.from) + spec.changes.insert + doc.slice(spec.changes.to)
      }
    } as unknown as EditorView
    toggleTaskAt(viewLike, boxes[0].pos)
    expect(newDoc).toContain('- [x] 待办')
  })
})
