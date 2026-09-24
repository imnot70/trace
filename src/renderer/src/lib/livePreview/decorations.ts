/** 所见即所得（Live Preview）装饰计算核心。
 *  遍历 Lezer 语法树（@codemirror/lang-markdown 的 markdownLanguage，含 GFM 扩展），
 *  对非光标区生成装饰：隐藏语法标记 / 行级样式 / 块级渲染 Widget。
 *  computeDecorations 为纯函数（state + 可视区间 → 装饰集），便于单元测试；
 *  光标与任一装饰区间相交 → 该区间本次不装饰（回落源码，设计文档 D3） */
import { Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, Facet, type Range, type Text } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { getFrontmatterTags } from '@shared/noteTags'
import { resolveAssetUrl } from '../markdown'
import {
  BulletWidget,
  CheckboxWidget,
  FrontmatterWidget,
  HrWidget,
  ImageWidget,
  MathWidget,
  RenderedBlockWidget,
  WikilinkWidget,
  renderBlockHtml
} from './widgets'

export interface LivePreviewConfig {
  /** 所见即所得开关：false 时扩展结构仍挂载（StateField 不可经 Compartment 增删），计算直接短路 */
  enabled: boolean
  vault: string
  notePath: string
  /** 双链可解析性（同步近似：查侧栏树，与 [[ 补全同一数据源） */
  resolveName(name: string): boolean
  /** Ctrl+Click 打开库内笔记 */
  openNote(target: { vault: string; path: string; name: string }): void
  /** Ctrl+Click 打开外部链接 */
  openExternal(url: string): void
}

// Facet 用 combine 取单值：一个视图只挂一份 livePreview 配置
export const livePreviewFacet = Facet.define<LivePreviewConfig, LivePreviewConfig>({
  combine: (v) => v[0]
})

export type ClickTarget =
  | { from: number; to: number; kind: 'wikilink'; name: string }
  | { from: number; to: number; kind: 'link'; url: string }

interface SimpleRange {
  from: number
  to: number
}

const deco = Decoration

/** 光标/选区与 [from, to] 相交（含贴边）→ 回落源码 */
function occupied(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true
  }
  return false
}

function overlaps(list: SimpleRange[], from: number, to: number): boolean {
  return list.some((r) => from < r.to && to > r.from)
}

/** 标记类装饰的回落判定：光标/选区落在 pos **所在行** 即整行回落源码。
 *  与标题 / 加粗的「节点区间相交」判定不同——列表标记、任务框、引用标记在行内是
 *  「半结构」元素，若只按自身区间判定，会出现同一行「标记渲染 + 正文源码」的割裂观感 */
function lineBusy(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  return occupied(state, line.from, line.to)
}

/**
 * 强调类标记（加粗 / 斜体 / 删除线 / 行内码）的露出判定：**只有真的贴到定界符本身**才回落源码——
 * 光标进入标记内部（多字符标记的两个字符之间：`~~` 两字之间）、紧贴标记外侧（打开标记之前 /
 * 闭合标记之后），或选区与标记相交（选中了标记）。
 *
 * 与 `occupied`（节点区间相交）的区别：光标位于**内容里**（含内容两端）不再露出标记，
 * 否则在文字里打字时定界符与渲染样式同时可见，观感噪杂（2026-09-24 用户实测反馈：
 * 编辑 `~~删除~~` 时删除线与两端的波浪号叠在一起）。定界符仍可编辑——方向键向内多按一下、
 * 或直接拖选跨越标记即露出；一字符标记（反引号）靠「紧贴外侧」露出。
 */
function markTouched(state: EditorState, marks: SimpleRange[]): boolean {
  if (marks.length === 0) return false
  const first = marks[0]
  const last = marks[marks.length - 1]
  for (const r of state.selection.ranges) {
    if (r.from < r.to) {
      // 选区：与定界符**严格重叠**才算（含端点贴边不算——选中内容本身的端点正好贴着标记，
      // 若按端点相交判定，选中「加粗文字」就会把两侧 ** 露出来，与光标规则不一致）
      if (overlaps(marks, r.from, r.to)) return true
    } else {
      const p = r.from
      if (p === first.from || p === last.to) return true // 紧贴外侧
      if (marks.some((m) => p > m.from && p < m.to)) return true // 标记内部
    }
  }
  return false
}

/** 列表项的第一个 ListMark（`-` / `*` / `+` / `1.` / `1)`），无则返回 null */
function listMarkOf(node: SyntaxNode): SyntaxNode | null {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'ListMark') return c
  }
  return null
}

/** 列表项是否为 GFM 任务项（`- [ ]`）：语法树结构为 ListItem → Task → TaskMarker */
function isTaskItem(node: SyntaxNode): boolean {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'Task') return true
  }
  return false
}

/** frontmatter 区间（文档以 --- 开头且有闭合行）；无闭合不装饰（容错） */
function frontmatterRange(doc: Text): (SimpleRange & { text: string; lines: number }) | null {
  if (doc.lines < 2) return null
  const first = doc.line(1)
  if (first.text.trimEnd() !== '---') return null
  for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
    const line = doc.line(n)
    if (/^(---|\.\.\.)\s*$/.test(line.text)) {
      return { from: 0, to: line.to, text: doc.sliceString(first.to + 1, line.from), lines: n }
    }
  }
  return null
}

interface BlockMathRange extends SimpleRange {
  tex: string
}

/** 块级公式 $$...$$ 区间扫描（与围栏代码互斥；围栏内不识别公式）。
 *  行内公式由装饰阶段逐行正则处理，此处只收整块区间。
 *  列表项内的 $$ 行（`- $$` / `2. $$`）先剥掉一层列表标记再识别，否则起始 $$ 漏判、
 *  闭合 $$ 被误认成起始，会把两个公式之间的全部内容错配成一个「公式」 */
function scanBlocks(doc: Text): BlockMathRange[] {
  const mathRanges: BlockMathRange[] = []
  let openMathLine = 0
  let fenceFrom = -1
  let fenceMarker = ''
  const stripMarker = (s: string): string => s.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '')
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const rawTrimmed = line.text.trim()
    const stripped = stripMarker(rawTrimmed)
    const fence = /^(`{3,}|~{3,})/.exec(line.text)
    if (fenceFrom >= 0) {
      if (fence && fence[1][0] === fenceMarker[0]) {
        fenceFrom = -1
        fenceMarker = ''
      }
      continue
    }
    if (fence) {
      fenceFrom = line.from
      fenceMarker = fence[1]
      continue
    }
    if (openMathLine > 0) {
      if (/^\$\$\s*$/.test(stripped)) {
        mathRanges.push({ from: doc.line(openMathLine).from, to: line.to, tex: doc.sliceString(doc.line(openMathLine).to + 1, line.from) })
        openMathLine = 0
      }
      continue
    }
    if (/^\$\$\s*$/.test(stripped)) {
      openMathLine = i
    } else if (stripped.startsWith('$$') && stripped.endsWith('$$') && stripped.length > 4) {
      // 单行 $$…$$：仅顶行首（无列表标记）时按块级处理——块级 widget 无法从行中段
      // 开始替换；带列表标记的交给行内正则渲染为行内公式
      if (rawTrimmed.startsWith('$$')) {
        mathRanges.push({ from: line.from, to: line.to, tex: stripped.slice(2, -2) })
      }
    }
  }
  // 未闭合的块级公式不装饰（源码呈现，等闭合后生效）
  return mathRanges
}

/** 收集节点下全部 XxxMark 子节点的区间 */
function childMarks(node: SyntaxNode): SimpleRange[] {
  const marks: SimpleRange[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (/Mark$/.test(c.name)) marks.push({ from: c.from, to: c.to })
  }
  return marks
}

export interface ComputeResult {
  decorations: DecorationSet
  atomic: DecorationSet
  targets: ClickTarget[]
}

/** 块级装饰（frontmatter / 块级公式 / 表格 / HTML 块 / HR）：
 *  CM 规定 block 装饰只能由 StateField 提供（ViewPlugin 会被抛
 *  "Block decorations may not be specified via plugins"），因此独立计算、覆盖全文档 */
export function computeBlockDecorations(
  state: EditorState,
  cfg: LivePreviewConfig | undefined
): { decorations: DecorationSet; atomic: DecorationSet } {
  if (!cfg?.enabled) return { decorations: deco.none, atomic: deco.none }
  const doc = state.doc
  const decorations: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []

  const pushBlock = (from: number, to: number, widget: Parameters<typeof Decoration.replace>[0]['widget']): void => {
    const lineFrom = doc.lineAt(from).from
    const lineTo = doc.lineAt(to).to
    const d = deco.replace({ widget, block: true })
    decorations.push(d.range(lineFrom, lineTo))
    atomic.push(d.range(lineFrom, lineTo))
  }

  // ---- frontmatter：折叠为一行摘要 ----
  const fm = frontmatterRange(doc)
  if (fm && !occupied(state, fm.from, fm.to)) {
    const tags = getFrontmatterTags(doc.sliceString(0, fm.to))
    pushBlock(0, fm.to, new FrontmatterWidget(tags.length ? `标签：${tags.join('、')}` : '', fm.lines))
  }

  // ---- 块级公式（与 frontmatter 互斥） ----
  for (const m of scanBlocks(doc)) {
    if (fm && m.from < fm.to && m.to > fm.from) continue
    if (occupied(state, m.from, m.to)) continue
    pushBlock(m.from, m.to, new MathWidget(m.tex.trim(), true))
  }

  // ---- 表格 / HTML 块 / 水平分隔线（语法树整树遍历，块级节点量少成本低） ----
  // 注意：occupied 只对将要装饰的叶子块判断，不能拦截容器节点（Document/Paragraph 等），
  // 否则光标落在任何祖先区间内都会让整棵子树被跳过；frontmatter 的剪枝同理，
  // 必须是「节点完全落在区间内」（写成交集会连根剪掉，详见下面的注释）
  syntaxTree(state).iterate({
    from: 0,
    to: doc.length,
    enter: (ref) => {
      // 只跳过 frontmatter 内部的节点：Document 根节点与它「相交」但不「包含于」它
      if (fm && ref.from >= fm.from && ref.to <= fm.to) return false
      switch (ref.name) {
        case 'Table': {
          if (occupied(state, ref.from, ref.to)) return false
          const html = renderBlockHtml(doc.sliceString(ref.from, ref.to))
          if (html.includes('<table')) pushBlock(ref.from, ref.to, new RenderedBlockWidget(html, 'table'))
          return false
        }
        case 'HTMLBlock': {
          if (occupied(state, ref.from, ref.to)) return false
          const html = renderBlockHtml(doc.sliceString(ref.from, ref.to))
          if (html) pushBlock(ref.from, ref.to, new RenderedBlockWidget(html, 'html'))
          return false
        }
        case 'HorizontalRule': {
          if (occupied(state, ref.from, ref.to)) return false
          pushBlock(ref.from, ref.to, new HrWidget())
          return false
        }
      }
      return true
    }
  })

  return { decorations: deco.set(decorations, true), atomic: deco.set(atomic, true) }
}

/** 行内装饰（标题/粗斜/删除线/行内码/链接/双链/任务框/图片/行内公式）：
 *  ViewPlugin 按 visibleRanges 增量计算，光标相交的节点回落源码（D3） */
export function computeInlineDecorations(
  state: EditorState,
  ranges: readonly SimpleRange[],
  cfg: LivePreviewConfig | undefined
): ComputeResult {
  if (!cfg?.enabled || ranges.length === 0) {
    return { decorations: deco.none, atomic: deco.none, targets: [] }
  }
  const doc = state.doc
  const decorations: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []
  const targets: ClickTarget[] = []
  const codeRanges: SimpleRange[] = [] // 行内码 / 围栏 / HTML 块：正则扫描的排除区

  const pushReplace = (from: number, to: number, spec: Parameters<typeof Decoration.replace>[0] = {}): void => {
    const d = deco.replace(spec)
    decorations.push(d.range(from, to))
    atomic.push(d.range(from, to))
  }

  // ---- frontmatter 与块级公式区间：行内扫描需排除（块级呈现由 StateField 负责） ----
  const fm = frontmatterRange(doc)
  const fmRange: SimpleRange | null = fm ? { from: fm.from, to: fm.to } : null
  const mathRanges = scanBlocks(doc)

  // ---- 语法树遍历 ----
  const deferredLinks: SyntaxNode[] = []
  const headingRe = /^ATXHeading([1-6])$/
  const setextRe = /^SetextHeading([12])$/
  /** 已处理的标记起始位置：跨可视区间边界的节点会被重复进入，重复施加相同 replace 会构成重叠装饰 */
  const seenMarks = new Set<number>()

  for (const vis of ranges) {
    syntaxTree(state).iterate({
      from: vis.from,
      to: vis.to,
      enter: (ref) => {
        // frontmatter 区间（被误解析为 SetextHeading2 的 --- 块）内的树节点全部跳过。
        // ⚠️ 判定必须是「节点完全落在 frontmatter 内」：若写成区间「相交」，
        // Document 根节点（0..doc.length）必然与它相交 → 整棵树在根节点被剪掉，
        // 一切依赖语法树的装饰（列表 / 引用 / 表格 / HTML 块 / 水平线 / 行内样式）全部消失
        // （实测：带 frontmatter 的笔记在所见即所得下只剩块级公式还能渲染）。
        // 同理不能对 mathRanges 做同类剪枝——Document / Paragraph 等祖先节点必然覆盖公式块区间；
        // 行内正则扫描已自带 mathRanges 排除
        if (fmRange && ref.from >= fmRange.from && ref.to <= fmRange.to) return false
        const heading = headingRe.exec(ref.name)
        const setext = setextRe.exec(ref.name)
        if (heading || setext) {
          const level = heading ? heading[1] : setext![1]
          const line = doc.lineAt(ref.from)
          decorations.push(deco.line({ class: `lp-heading lp-h${level}` }).range(line.from))
          if (heading) {
            const m = /^#{1,6}[ \t]+/.exec(doc.sliceString(ref.from, Math.min(ref.to, line.to)))
            if (m && !occupied(state, ref.from, ref.to)) {
              decorations.push(deco.replace({}).range(ref.from, ref.from + m[0].length))
            }
          }
          return false
        }
        switch (ref.name) {
          case 'Blockquote': {
            for (let n = doc.lineAt(ref.from).number; n <= doc.lineAt(ref.to).number; n++) {
              decorations.push(deco.line({ class: 'lp-quote' }).range(doc.line(n).from))
            }
            return true
          }
          case 'FencedCode': {
            codeRanges.push({ from: ref.from, to: ref.to })
            for (let n = doc.lineAt(ref.from).number; n <= doc.lineAt(ref.to).number; n++) {
              decorations.push(deco.line({ class: 'lp-fence' }).range(doc.line(n).from))
            }
            return false
          }
          case 'HTMLBlock': {
            codeRanges.push({ from: ref.from, to: ref.to })
            return false
          }
          case 'StrongEmphasis':
          case 'Emphasis':
          case 'Strikethrough':
          case 'InlineCode': {
            if (ref.name === 'InlineCode') codeRanges.push({ from: ref.from, to: ref.to })
            const node = ref.node
            const marks = childMarks(node)
            if (marks.length >= 2) {
              const first = marks[0]
              const last = marks[marks.length - 1]
              if (last.from > first.to) {
                const cls =
                  ref.name === 'StrongEmphasis'
                    ? 'lp-strong'
                    : ref.name === 'Emphasis'
                      ? 'lp-em'
                      : ref.name === 'Strikethrough'
                        ? 'lp-strike'
                        : 'lp-inline-code'
                decorations.push(deco.mark({ class: cls }).range(first.to, last.from))
              }
              if (!markTouched(state, marks)) {
                for (const mk of marks) decorations.push(deco.replace({}).range(mk.from, mk.to))
              }
            }
            return false
          }
          case 'ListItem': {
            // 列表标记：无序 → 圆点 widget；任务项 → 标记（含其后一个空格）由复选框取代；
            // 有序 → 保留源编号（编号本身即渲染形态）。光标在本行时整个列表项回落源码
            const mark = listMarkOf(ref.node)
            if (mark && !seenMarks.has(mark.from)) {
              seenMarks.add(mark.from)
              if (!lineBusy(state, mark.from)) {
                const isOrdered = /^\d/.test(doc.sliceString(mark.from, mark.to))
                if (isTaskItem(ref.node)) {
                  const to = doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to
                  pushReplace(mark.from, to)
                } else if (!isOrdered) {
                  pushReplace(mark.from, mark.to, { widget: new BulletWidget() })
                }
              }
            }
            return true
          }
          case 'QuoteMark': {
            // 引用标记：连同其后一个空格隐藏（只隐藏 `>` 会残留前导空格，与引用条缩进叠加后文字偏右）
            if (!seenMarks.has(ref.from)) {
              seenMarks.add(ref.from)
              if (!lineBusy(state, ref.from)) {
                const to = doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to
                pushReplace(ref.from, to)
              }
            }
            return false
          }
          case 'TaskMarker': {
            if (ref.to - ref.from === 3 && !lineBusy(state, ref.from)) {
              const ch = doc.sliceString(ref.from, ref.to)
              if (ch === '[ ]' || ch === '[x]' || ch === '[X]') {
                pushReplace(ref.from, ref.to, { widget: new CheckboxWidget(ch[1] !== ' ', ref.from) })
              }
            }
            return false
          }
          case 'Image': {
            if (!occupied(state, ref.from, ref.to)) {
              const node = ref.node
              let url = ''
              for (let c = node.firstChild; c; c = c.nextSibling) {
                if (c.name === 'URL') url = doc.sliceString(c.from, c.to)
              }
              const altMatch = /\[([^\]]*)\]/.exec(doc.sliceString(ref.from, ref.to))
              const resolved = resolveAssetUrl(cfg.vault, cfg.notePath, url)
              pushReplace(ref.from, ref.to, { widget: new ImageWidget(resolved ?? url, altMatch?.[1] ?? '') })
            }
            return false
          }
          case 'Link': {
            deferredLinks.push(ref.node)
            return true
          }
        }
        return true
      }
    })
  }

  // ---- 双链（正则，树上无节点）与行内公式（排除代码/公式块/双链区间） ----
  const wikilinks: (SimpleRange & { name: string; display: string })[] = []
  const wikilinkRe = /\[\[([^\][\n]+)\]\]/g
  // 双美元优先：`$$x$$` 完整匹配（含列表项内带前缀的单行公式），避免只吃内层 `$x$`
  // 而残留外侧 `$` 符号
  const inlineMathRe = /\$\$([^$]+?)\$\$|\$([^\s$](?:[^$\n]*[^\s$])?)\$/g
  for (const vis of ranges) {
    for (let n = doc.lineAt(vis.from).number; n <= doc.lineAt(vis.to).number; n++) {
      const line = doc.line(n)
      if (line.to < vis.from || line.from > vis.to) continue
      let m: RegExpExecArray | null
      wikilinkRe.lastIndex = 0
      while ((m = wikilinkRe.exec(line.text))) {
        const from = line.from + m.index
        const to = from + m[0].length
        if (overlaps(codeRanges, from, to) || overlaps(mathRanges, from, to)) continue
        const inner = m[1]
        const pipe = inner.indexOf('|')
        const name = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
        const display = ((pipe >= 0 ? inner.slice(pipe + 1) : name) || name).trim()
        if (!name) continue
        wikilinks.push({ from, to, name, display })
      }
      inlineMathRe.lastIndex = 0
      while ((m = inlineMathRe.exec(line.text))) {
        const from = line.from + m.index
        const to = from + m[0].length
        if (overlaps(codeRanges, from, to) || overlaps(mathRanges, from, to) || overlaps(wikilinks, from, to)) continue
        if (!occupied(state, from, to)) {
          pushReplace(from, to, { widget: new MathWidget((m[1] ?? m[2]).trim(), false) })
        }
      }
    }
  }

  // ---- 双链 Widget（压过树上被误解析出的 Link 节点） ----
  for (const w of wikilinks) {
    if (occupied(state, w.from, w.to)) continue
    pushReplace(w.from, w.to, { widget: new WikilinkWidget(w.display, !cfg.resolveName(w.name)) })
    targets.push({ from: w.from, to: w.to, kind: 'wikilink', name: w.name })
  }

  // ---- 普通 [链接](url)：隐藏 [ 与 ](url)，文本着链接色；被双链覆盖的跳过 ----
  for (const node of deferredLinks) {
    if (overlaps(wikilinks, node.from, node.to)) continue
    const marks = childMarks(node)
    let url = ''
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name === 'URL') url = doc.sliceString(c.from, c.to)
    }
    if (marks.length >= 2) {
      const open = marks[0]
      const closeFrom = marks[1].from
      if (closeFrom > open.to) {
        decorations.push(deco.mark({ class: 'lp-link' }).range(open.to, closeFrom))
      }
      if (url && !occupied(state, node.from, node.to)) {
        decorations.push(deco.replace({}).range(open.from, open.to))
        decorations.push(deco.replace({}).range(closeFrom, node.to))
      }
    }
    if (url) targets.push({ from: node.from, to: node.to, kind: 'link', url })
  }

  return {
    decorations: deco.set(decorations, true),
    atomic: deco.set(atomic, true),
    targets
  }
}
