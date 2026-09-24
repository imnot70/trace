/** 所见即所得（Live Preview）扩展装配：StateField（块级装饰）+ ViewPlugin（行内装饰）
 *  + 原子区间 + Ctrl+Click 委托 + 主题。
 *  用法：livePreview({ vault, notePath, resolveName, openNote, openExternal })，
 *  由 MarkdownEditor 经 Compartment 挂载/摘除（模式切换零重建，光标滚动自然保持） */
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { StateField, type Extension } from '@codemirror/state'
import { resolveRelRef } from '../markdown'
import { noteDisplayName, openWikilinkByName } from '../wikilink'
import {
  computeBlockDecorations,
  computeInlineDecorations,
  livePreviewFacet,
  type ClickTarget,
  type LivePreviewConfig
} from './decorations'

class LivePreviewPlugin {
  decorations: DecorationSet = Decoration.none
  atomic: DecorationSet = Decoration.none
  targets: ClickTarget[] = []

  constructor(view: EditorView) {
    this.rebuild(view)
  }

  update(update: ViewUpdate): void {
    // 组词（中文输入法）期间冻结装饰集：装饰会改写 DOM，打断 IME 会话导致候选框错位、
    // 拼音重复上屏（Obsidian 早期同类缺陷）；期间文档变化由 RangeSet.map 保持位置正确，
    // 组词结束后的首个 update 触发整体重建（设计文档 D6）
    if (update.view.composing) return
    // Compartment 重配置前后插件是同一实例（模块级单例），纯配置切换不带 doc/selection
    // 变化——必须显式比较 facet 引用（buildLivePreview 每次生成新配置对象）才能感知开关
    const cfgChanged = update.startState.facet(livePreviewFacet) !== update.state.facet(livePreviewFacet)
    if (cfgChanged || update.docChanged || update.selectionSet || update.viewportChanged) {
      this.rebuild(update.view)
    }
  }

  private rebuild(view: EditorView): void {
    const cfg = view.state.facet(livePreviewFacet)
    const r = computeInlineDecorations(view.state, view.visibleRanges, cfg)
    this.decorations = r.decorations
    this.atomic = r.atomic
    this.targets = r.targets
  }

  findTarget(pos: number): ClickTarget | null {
    return this.targets.find((t) => pos >= t.from && pos <= t.to) ?? null
  }
}

const lpPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations
})

// 块级装饰（frontmatter/公式块/表格/HTML 块/HR）必须经 StateField 提供（CM 硬性约束）；
// 光标落入块内时回落源码 → 随 docChanged / selection 重新计算，纯变化仅映射位置
const lpBlockField = StateField.define<{ decorations: DecorationSet; atomic: DecorationSet }>({
  create: (state) => computeBlockDecorations(state, state.facet(livePreviewFacet)),
  update(value, tr) {
    const cfgChanged = tr.startState.facet(livePreviewFacet) !== tr.state.facet(livePreviewFacet)
    if (cfgChanged || tr.docChanged || tr.selection) {
      return computeBlockDecorations(tr.state, tr.state.facet(livePreviewFacet))
    }
    return {
      decorations: value.decorations.map(tr.changes),
      atomic: value.atomic.map(tr.changes)
    }
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(f).atomic)
  ]
})

// 行内 widget（双链/图片/公式/任务框）的原子区间：光标不可落入，
// 点击即定位到边缘并触发该节点回落源码
const lpAtomicPlugin = ViewPlugin.fromClass(
  class {
    atomic: DecorationSet = Decoration.none
    constructor(view: EditorView) {
      this.rebuild(view)
    }
    update(update: ViewUpdate): void {
      if (update.view.composing) return
      const cfgChanged = update.startState.facet(livePreviewFacet) !== update.state.facet(livePreviewFacet)
      if (cfgChanged || update.docChanged || update.selectionSet || update.viewportChanged) {
        this.rebuild(update.view)
      }
    }
    private rebuild(view: EditorView): void {
      this.atomic = computeInlineDecorations(view.state, view.visibleRanges, view.state.facet(livePreviewFacet)).atomic
    }
  },
  {
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none)
  }
)

/** Ctrl/Cmd+Click：双链打开（无候选提示断链 / 多候选弹层消歧）、外部链接走系统浏览器、
 *  库内相对 .md 链接应用内打开——与预览的链接行为对齐 */
const clickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) return false
    const target = view.plugin(lpPlugin)?.findTarget(pos)
    if (!target) return false
    const cfg = view.state.facet(livePreviewFacet)
    event.preventDefault()
    if (target.kind === 'wikilink') {
      void openWikilinkByName(cfg.vault, target.name, cfg.openNote)
    } else if (/^https?:/i.test(target.url)) {
      cfg.openExternal(target.url)
    } else if (/\.md$/i.test(target.url.split('#')[0])) {
      const path = resolveRelRef(cfg.notePath, target.url.split('#')[0])
      cfg.openNote({ vault: cfg.vault, path, name: noteDisplayName(path) })
    }
    return true
  }
})

// 视觉对齐 markdown.css（预览同款语言，颜色全部走 CSS 变量）
const lpTheme = EditorView.theme({
  '.cm-line.lp-heading': {
    fontWeight: '600',
    lineHeight: '1.4'
  },
  '.cm-line.lp-h1': { fontSize: '1.7em', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.1em' },
  '.cm-line.lp-h2': { fontSize: '1.4em', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.08em' },
  '.cm-line.lp-h3': { fontSize: '1.2em' },
  '.cm-line.lp-h4, .cm-line.lp-h5, .cm-line.lp-h6': { fontSize: '1.1em' },
  '.cm-line.lp-quote': {
    borderLeft: '3px solid var(--border-color)',
    paddingLeft: '10px',
    color: 'var(--text-secondary)'
  },
  '.cm-line.lp-fence': {
    backgroundColor: 'var(--code-bg)'
  },
  '.lp-strong': { fontWeight: '600' },
  '.lp-em': { fontStyle: 'italic' },
  '.lp-strike': { textDecoration: 'line-through' },
  '.lp-inline-code': {
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
    fontSize: '0.88em',
    backgroundColor: 'var(--code-bg)',
    padding: '0.15em 0.4em',
    borderRadius: '4px'
  },
  '.lp-link': { color: 'var(--accent)' },
  '.lp-wikilink': { color: 'var(--accent)', cursor: 'pointer' },
  '.lp-wikilink-broken': { color: 'var(--text-tertiary)', textDecoration: 'line-through' },
  '.lp-image img': { maxWidth: '100%', maxHeight: '320px', borderRadius: '6px', verticalAlign: 'middle' },
  '.lp-image-broken': { color: 'var(--text-tertiary)' },
  '.lp-math .katex-error, .lp-math-block .katex-error': { color: 'var(--danger)' },
  // 块级 widget 的几何：垂直间距必须落在元素盒内（padding / flow-root 让内层首尾外边距不再折叠出去，
  // 容器高度即真实占位高度）。CM6 的行高记账取 widget 元素的 border-box、**不含外边距**——
  // 用 margin 做间距会让行高映射小于真实占位，其后所有行号 / 行号高亮整体上移
  // （实测：公式块 +15px、表格再 +12px，逐块累加）。
  // 间距数值与修正前保持一致：公式 0.5em、表格 / HTML 块 0.4em（内层首尾外边距清零，避免叠加）。
  // white-space：编辑器内容区是 break-spaces（源码要保留空白），而 widget 里是渲染产物——
  // 渲染 HTML 标签之间的换行 / 空白会被当成真实换行与空格（多出空行、把容器撑高），故还原为 normal。
  // padding / max-width 必须显式归零：widget 带 markdown-body 类是为了排版，但该类还带卡片级
  // padding: 20px 28px 48px 与 max-width: 860px（预览卡片的留白与限宽），照搬到 widget 上会
  // 让水平线上下不对称（实测 20/48）、表格被限宽
  '.lp-math-block': {
    margin: '0',
    padding: '0.5em 0',
    maxWidth: 'none',
    display: 'flow-root',
    whiteSpace: 'normal',
    textAlign: 'center',
    overflowX: 'auto'
  },
  '.lp-block': { margin: '0', padding: '0.4em 0', maxWidth: 'none', display: 'flow-root', whiteSpace: 'normal' },
  '.lp-block > :first-child': { marginTop: '0' },
  '.lp-block > :last-child': { marginBottom: '0' },
  '.lp-hr': { margin: '0', padding: '0', maxWidth: 'none', display: 'flow-root', whiteSpace: 'normal' },
  '.lp-bullet': { color: 'var(--text-secondary)', userSelect: 'none' },
  '.lp-frontmatter': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--text-tertiary)',
    fontSize: '0.92em',
    padding: '4px 10px',
    backgroundColor: 'var(--bg-tertiary)',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  '.lp-frontmatter-badge': {
    fontSize: '0.85em',
    padding: '0 6px',
    borderRadius: '4px',
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text-secondary)'
  }
})

/** 组装所见即所得扩展（配置经 Facet 注入，Compartment 重配置即可换库/换笔记） */
export function livePreview(cfg: LivePreviewConfig): Extension {
  return [livePreviewFacet.of(cfg), lpBlockField, lpPlugin, lpAtomicPlugin, clickHandler, lpTheme]
}
