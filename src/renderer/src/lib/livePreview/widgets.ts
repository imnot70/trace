/** 所见即所得（Live Preview）渲染 Widget 集。
 *  原则：所有渲染产物与右侧预览同一管道（md.render / katex / DOMPurify / markdown.css），
 *  按「源文本」做 LRU 缓存避免组词/高频输入下重复渲染（设计文档 D6） */
import { EditorView, WidgetType } from '@codemirror/view'
import katex from 'katex'
import { md, sanitizeHtml } from '../markdown'

/** 简易 LRU：命中即提到队尾，超容量淘汰最旧（键为源文本，文档变更靠文本失配自然失效） */
class LruCache<V> {
  private map = new Map<string, V>()
  constructor(private readonly cap: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }
  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }
}

const mathCache = new LruCache<string>(200)
const blockHtmlCache = new LruCache<string>(200)

/** KaTeX 公式（block = 块级 $$...$$，inline = 行内 $...$），渲染失败输出 katex-error 红字 */
export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly block: boolean
  ) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.block === this.block
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement(this.block ? 'div' : 'span')
    wrap.className = this.block ? 'lp-math lp-math-block markdown-body' : 'lp-math'
    let html = mathCache.get(this.tex)
    if (html === undefined) {
      html = katex.renderToString(this.tex, { throwOnError: false, output: 'html' })
      mathCache.set(this.tex, html)
    }
    wrap.innerHTML = html
    return wrap
  }
}

/** GFM 任务复选框：点击写回源码 `[ ]`↔`[x]`（走正常变更→自动保存流程）。
 *  mousedown 即处理并阻止默认行为——若等 click，光标定位会把该行展开成源码、
 *  widget 被移除，click 永远不会落在原 DOM 上（与下拉菜单闪影同类竞态） */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number
  ) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = 'task-item-checkbox lp-task-box'
    if (this.checked) box.setAttribute('data-checked', 'true')
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', this.checked ? 'true' : 'false')
    box.title = '点击切换勾选状态'
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      toggleTaskAt(view, this.pos)
    })
    return box
  }
  // 事件完全由 widget 自己处理，CM 不要再做光标定位
  ignoreEvent(): boolean {
    return true
  }
}

/** 任务勾选写回：pos 处应为 `[ ]` / `[x]`，翻转中括号内的标记字符 */
export function toggleTaskAt(view: EditorView, pos: number): void {
  const text = view.state.doc.sliceString(pos, pos + 3)
  if (text !== '[ ]' && text !== '[x]' && text !== '[X]') return
  const next = text === '[ ]' ? 'x' : text[1].toLowerCase() === 'x' ? ' ' : 'x'
  view.dispatch({
    changes: { from: pos + 1, to: pos + 2, insert: next },
    userEvent: 'input'
  })
}

/** 图片：src 已由装饰层解析为 trace-vault:// 地址；加载失败回退 alt 占位文本 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'lp-image'
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.addEventListener('error', () => {
      wrap.classList.add('lp-image-broken')
      wrap.textContent = `![${this.alt}]`
    })
    wrap.appendChild(img)
    return wrap
  }
}

/** 整块渲染的块级 Widget（表格 / 内嵌 HTML 块）：html 由装饰层用
 *  sanitizeHtml(md.render(源文本)) 预渲染并缓存——与预览逐字节同管道 */
export class RenderedBlockWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly kind: 'table' | 'html'
  ) {
    super()
  }
  eq(other: RenderedBlockWidget): boolean {
    return other.html === this.html && other.kind === this.kind
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = `markdown-body lp-block lp-block-${this.kind}`
    div.innerHTML = this.html
    return div
  }
}

/** 水平分隔线 */
export class HrWidget extends WidgetType {
  eq(_other: HrWidget): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'lp-hr markdown-body'
    div.appendChild(document.createElement('hr'))
    return div
  }
}

/** 双链：可解析显示笔记名（链接色），断链加删除线；Ctrl+Click 打开由全局委托处理 */
export class WikilinkWidget extends WidgetType {
  constructor(
    readonly display: string,
    readonly broken: boolean
  ) {
    super()
  }
  eq(other: WikilinkWidget): boolean {
    return other.display === this.display && other.broken === this.broken
  }
  toDOM(): HTMLElement {
    const a = document.createElement('span')
    a.className = this.broken ? 'lp-wikilink lp-wikilink-broken' : 'lp-wikilink'
    a.textContent = this.display
    return a
  }
}

/** frontmatter 折叠摘要：一行展示标签等元数据，光标进入展开源码 */
export class FrontmatterWidget extends WidgetType {
  constructor(
    readonly summary: string,
    readonly lineCount: number
  ) {
    super()
  }
  eq(other: FrontmatterWidget): boolean {
    return other.summary === this.summary && other.lineCount === this.lineCount
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'lp-frontmatter'
    const tag = document.createElement('span')
    tag.className = 'lp-frontmatter-badge'
    tag.textContent = 'frontmatter'
    div.appendChild(tag)
    const text = document.createElement('span')
    text.textContent = this.summary || `${this.lineCount} 行元数据`
    div.appendChild(text)
    return div
  }
}

/** 块级源文本 → 净化渲染 HTML（表格/HTML 块共用，与预览同一管道），LRU 缓存 */
export function renderBlockHtml(src: string): string {
  const cached = blockHtmlCache.get(src)
  if (cached !== undefined) return cached
  let html: string
  try {
    html = sanitizeHtml(md.render(src))
  } catch {
    html = ''
  }
  blockHtmlCache.set(src, html)
  return html
}
