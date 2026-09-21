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
 *  行内公式由装饰阶段逐行正则处理，此处只收整块区间 */
function scanBlocks(doc: Text): BlockMathRange[] {
  const mathRanges: BlockMathRange[] = []
  let openMathLine = 0
  let fenceFrom = -1
  let fenceMarker = ''
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const trimmed = line.text.trim()
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
      if (/^\$\$\s*$/.test(trimmed)) {
        mathRanges.push({ from: doc.line(openMathLine).from, to: line.to, tex: doc.sliceString(doc.line(openMathLine).to + 1, line.from) })
        openMathLine = 0
      }
      continue
    }
    if (/^\$\$\s*$/.test(trimmed)) {
      openMathLine = i
    } else if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
      mathRanges.push({ from: line.from, to: line.to, tex: trimmed.slice(2, -2) })
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
  // 否则光标落在任何祖先区间内都会让整棵子树被跳过
  syntaxTree(state).iterate({
    from: 0,
    to: doc.length,
    enter: (ref) => {
      if (fm && ref.from < fm.to && ref.to > fm.from) return false
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

  for (const vis of ranges) {
    syntaxTree(state).iterate({
      from: vis.from,
      to: vis.to,
      enter: (ref) => {
        // frontmatter 区间（被误解析为 SetextHeading2 的 --- 块）内的树节点全部跳过。
        // 注意：不能对 mathRanges 在此做同类剪枝——Document/Paragraph 等祖先节点区间
        // 必然覆盖公式块区间，整棵树会在根节点被剪掉；行内正则扫描自带 mathRanges 排除
        if (fmRange && ref.from < fmRange.to && ref.to > fmRange.from) return false
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
              if (!occupied(state, ref.from, ref.to)) {
                for (const mk of marks) decorations.push(deco.replace({}).range(mk.from, mk.to))
              }
            }
            return false
          }
          case 'TaskMarker': {
            if (ref.to - ref.from === 3 && !occupied(state, ref.from, ref.to)) {
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
  const inlineMathRe = /\$([^\s$](?:[^$\n]*[^\s$])?)\$/g
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
          pushReplace(from, to, { widget: new MathWidget(m[1], false) })
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
