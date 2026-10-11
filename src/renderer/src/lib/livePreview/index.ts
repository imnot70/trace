/** 所见即所得（Live Preview）扩展装配：StateField（块级装饰）+ ViewPlugin（行内装饰）
 *  + 原子区间 + Ctrl+Click 委托 + 主题。
 *  用法：livePreview({ vault, notePath, resolveName, openNote, openExternal })，
 *  由 MarkdownEditor 经 Compartment 挂载/摘除（模式切换零重建，光标滚动自然保持） */
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { type Extension } from '@codemirror/state'
import { resolveRelRef } from '../markdown'
import { noteDisplayName, openWikilinkByName } from '../wikilink'
import {
  computeInlineDecorations,
  livePreviewFacet,
  lpBlockField,
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

// 块级装饰 StateField（lpBlockField）与 renderedBlockRanges 定义在 decorations.ts
//（见其处注释：tests/** 的主进程 tsconfig 编译安全依赖链）

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
    if (event.button !== 0) return false
    // 单击保持默认（落光标 → 双链 widget 回落源码，点击编辑入口）；Ctrl/Cmd = 打开跳转、
    // Alt = 悬浮预览（FR-2.4.27：预览让编辑，修饰键分流）
    const altPreview = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
    if (!(event.ctrlKey || event.metaKey || altPreview)) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) return false
    // 原子 widget（双链 / 链接渲染态）上点击时 posAtCoords 返回区间外相邻位置，
    // 相邻 ±1 容差重试——否则修饰键点击渲染态链接经常不命中
    const lp = view.plugin(lpPlugin)
    const target = lp?.findTarget(pos) ?? (pos > 0 ? lp?.findTarget(pos - 1) : null) ?? lp?.findTarget(pos + 1)
    if (!target) return false
    const cfg = view.state.facet(livePreviewFacet)
    event.preventDefault()
    if (target.kind === 'wikilink') {
      if (altPreview) void openWikilinkByName(cfg.vault, target.name, cfg.previewNote)
      else void openWikilinkByName(cfg.vault, target.name, cfg.openNote)
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
// ⚠️ 与 markdown.css 是同一套内容排版的两半（FR-2.9.14）：标题 / 引用 / 代码的样式改动
// 必须两处同批——历史上「只改预览一套」导致所见即所得与预览漂移
const lpTheme = EditorView.theme({
  '.cm-line.lp-heading': {
    fontWeight: '600',
    lineHeight: '1.4'
  },
  // 衬线标题 h1–h3（FR-2.9.14，与 markdown.css 同批）：去 GitHub 式下边框，h1 补 1.35 行高
  '.cm-line.lp-h1': {
    fontSize: '1.7em',
    fontFamily: 'var(--font-head)',
    fontWeight: '700',
    lineHeight: '1.35',
    letterSpacing: '0.005em'
  },
  '.cm-line.lp-h2': { fontSize: '1.4em', fontFamily: 'var(--font-head)', fontWeight: '700' },
  '.cm-line.lp-h3': { fontSize: '1.2em', fontFamily: 'var(--font-head)', fontWeight: '700' },
  '.cm-line.lp-h4, .cm-line.lp-h5, .cm-line.lp-h6': { fontSize: '1.1em' },
  // 引用条（FR-2.9.14）：accent 弱化条 + 极淡 accent 底，与预览 blockquote 同源；
  // CM 按行涂色（连续引用行的底无缝相接），不做右圆角（逐行圆角会锯齿）
  '.cm-line.lp-quote': {
    borderLeft: '3px solid color-mix(in srgb, var(--accent) 45%, transparent)',
    paddingLeft: '10px',
    backgroundColor: 'color-mix(in srgb, var(--accent) 5%, transparent)',
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
  // padding / max-width / background 必须显式归零：widget 带 markdown-body 类是为了排版，
  // 但该类还带卡片级 padding: 20px 28px 48px、max-width: 860px 与纸面底色 --content-bg
  // （预览卡片的留白 / 限宽 / 纸面），照搬到 widget 上会让水平线上下不对称（实测 20/48）、
  // 表格被限宽；底色不归零则心流换纸色时表格 / 公式块会糊一块默认纸色
  '.lp-math-block': {
    margin: '0',
    padding: '0.5em 0',
    maxWidth: 'none',
    background: 'transparent',
    display: 'flow-root',
    whiteSpace: 'normal',
    textAlign: 'center',
    overflowX: 'auto'
  },
  '.lp-block': {
    margin: '0',
    padding: '0.4em 0',
    maxWidth: 'none',
    background: 'transparent',
    display: 'flow-root',
    whiteSpace: 'normal'
  },
  '.lp-block > :first-child': { marginTop: '0' },
  '.lp-block > :last-child': { marginBottom: '0' },
  '.lp-hr': {
    margin: '0',
    padding: '0',
    maxWidth: 'none',
    background: 'transparent',
    display: 'flow-root',
    whiteSpace: 'normal'
  },
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
  },
  // 标签胶囊（FR-2.6.17）：× 默认弱化，悬浮胶囊时显现；颜色圆点 inline style 注入
  '.lp-frontmatter-capsule': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '1px 8px',
    borderRadius: '10px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    fontSize: '0.9em',
    color: 'var(--text-primary)',
    lineHeight: '1.5'
  },
  '.lp-frontmatter-capsule-dot': {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    flexShrink: '0',
    backgroundColor: 'var(--text-tertiary)'
  },
  '.lp-frontmatter-capsule-name': {
    maxWidth: '160px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  '.lp-frontmatter-capsule-x': {
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    fontSize: '1.05em',
    lineHeight: '1',
    opacity: '0',
    transition: 'opacity 0.12s'
  },
  '.lp-frontmatter-capsule:hover .lp-frontmatter-capsule-x': {
    opacity: '1'
  },
  '.lp-frontmatter-capsule-x:hover': {
    color: 'var(--danger)'
  },
  '.lp-frontmatter-add': {
    cursor: 'pointer',
    fontSize: '0.85em',
    color: 'var(--text-tertiary)',
    padding: '1px 6px',
    borderRadius: '10px',
    border: '1px dashed var(--border-color)'
  },
  '.lp-frontmatter-add:hover': {
    color: 'var(--accent)',
    borderColor: 'var(--accent)'
  }
})

/** 组装所见即所得扩展（配置经 Facet 注入，Compartment 重配置即可换库/换笔记） */
export function livePreview(cfg: LivePreviewConfig): Extension {
  return [livePreviewFacet.of(cfg), lpBlockField, lpPlugin, lpAtomicPlugin, clickHandler, lpTheme]
}
