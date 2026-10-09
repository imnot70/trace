/** 所见即所得（Live Preview）渲染 Widget 集。
 *  原则：所有渲染产物与右侧预览同一管道（md.render / katex / DOMPurify / markdown.css），
 *  按「源文本」做 LRU 缓存避免组词/高频输入下重复渲染（设计文档 D6） */
import { EditorView, WidgetType } from '@codemirror/view'
import katex from 'katex'
import { md, sanitizeHtml } from '../markdown'
import { getFrontmatterTags, setFrontmatterTags } from '@shared/noteTags'

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

/** 无序列表标记：把 `-` / `*` / `+` 渲染为圆点（次级色，不参与文本选择）。
 *  有序列表保留源编号，不走本 widget（见 decorations 的 ListItem 分支） */
export class BulletWidget extends WidgetType {
  eq(_other: BulletWidget): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'lp-bullet'
    span.textContent = '•'
    span.setAttribute('aria-hidden', 'true')
    return span
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
    readonly broken: boolean,
    /** 引用目标名（FR-2.4.27：Alt+Click 悬浮预览的自定义事件载荷；display 可能是别名） */
    readonly name = ''
  ) {
    super()
  }
  eq(other: WikilinkWidget): boolean {
    return other.display === this.display && other.broken === this.broken && other.name === this.name
  }
  toDOM(): HTMLElement {
    const a = document.createElement('span')
    a.className = this.broken ? 'lp-wikilink lp-wikilink-broken' : 'lp-wikilink'
    a.textContent = this.display
    // Alt+Click = 悬浮预览（FR-2.4.27）：在事件源发出信号并阻断冒泡——CM 对原子区
    // mousedown 的内置处理（落光标 → 回落源码）不经过我们的 domEventHandlers 分流，
    // 在元素上拦截最可靠；单击（无 Alt）不拦，保持落光标回落编辑
    a.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (!this.name) return
      e.preventDefault()
      e.stopPropagation()
      a.dispatchEvent(
        new CustomEvent('trace-wikilink-preview', { bubbles: true, detail: { name: this.name } })
      )
    })
    return a
  }
}

/** frontmatter 标签胶囊数据：颜色来自标签定义快照（LivePreviewConfig.tagColors），未登记标签无色 */
export interface FrontmatterTagVM {
  name: string
  color?: string
}

/**
 * frontmatter 折叠摘要（FR-2.6.17 胶囊化）：标签以彩色胶囊展示，可点 × 移除、
 * 点「＋ 标签」呼出打标签弹窗（经冒泡自定义事件由 MarkdownEditor 承接）；
 * 无标签时退回「N 行元数据」摘要。所有交互走事务写回缓冲区（自动保存落盘），
 * 与复选框 widget 同一套 mousedown 竞态规避（等 click 会被光标定位展开源码抢走）。
 */
export class FrontmatterWidget extends WidgetType {
  constructor(
    readonly lineCount: number,
    readonly tags: FrontmatterTagVM[]
  ) {
    super()
  }
  eq(other: FrontmatterWidget): boolean {
    if (other.lineCount !== this.lineCount || other.tags.length !== this.tags.length) return false
    // 颜色也在比较内：改色后（配置重算 → 新实例）eq 失配才会重建 DOM
    return this.tags.every((t, i) => other.tags[i].name === t.name && other.tags[i].color === t.color)
  }
  toDOM(view: EditorView): HTMLElement {
    const div = document.createElement('div')
    div.className = 'lp-frontmatter'
    const tag = document.createElement('span')
    tag.className = 'lp-frontmatter-badge'
    tag.textContent = 'frontmatter'
    div.appendChild(tag)
    if (this.tags.length > 0) {
      for (const t of this.tags) {
        const pill = document.createElement('span')
        pill.className = 'lp-frontmatter-capsule'
        const dot = document.createElement('span')
        dot.className = 'lp-frontmatter-capsule-dot'
        if (t.color) dot.style.background = t.color
        pill.appendChild(dot)
        const name = document.createElement('span')
        name.className = 'lp-frontmatter-capsule-name'
        name.textContent = t.name
        pill.appendChild(name)
        const x = document.createElement('span')
        x.className = 'lp-frontmatter-capsule-x'
        x.textContent = '×'
        x.title = '移除该标签'
        x.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.stopPropagation()
          removeFrontmatterTag(view, t.name)
        })
        pill.appendChild(x)
        div.appendChild(pill)
      }
    } else {
      const text = document.createElement('span')
      text.textContent = `${this.lineCount} 行元数据`
      div.appendChild(text)
    }
    const add = document.createElement('span')
    add.className = 'lp-frontmatter-add'
    add.textContent = '＋ 标签'
    add.title = '添加标签'
    add.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      // 冒泡到编辑器容器（MarkdownEditor 监听后打开打标签弹窗——widget 在 CM 管辖外无法直接挂 Vue 弹窗）
      div.dispatchEvent(new CustomEvent('trace-frontmatter-add-tag', { bubbles: true }))
    })
    div.appendChild(add)
    return div
  }
  // 事件完全由 widget 自己处理，CM 不要再做光标定位
  ignoreEvent(): boolean {
    return true
  }
}

/**
 * 事务写回 frontmatter tags：对整篇文本计算 tag 映射后的新内容，再按公共前 / 后缀
 * 收敛成最小替换区间（光标与撤销粒度稳定，正文零触碰）。YAML 解析失败静默放弃
 * （setFrontmatterTags 返回 null，与 TagPickerDialog 的缓冲区路径同一保护）。
 */
export function rewriteFrontmatterTags(view: EditorView, map: (names: string[]) => string[]): void {
  const oldStr = view.state.doc.toString()
  const updated = setFrontmatterTags(oldStr, map(getFrontmatterTags(oldStr)))
  if (updated === null || updated === oldStr) return
  const minLen = Math.min(oldStr.length, updated.length)
  let start = 0
  while (start < minLen && oldStr[start] === updated[start]) start++
  let endOld = oldStr.length
  let endNew = updated.length
  while (endOld > start && endNew > start && oldStr[endOld - 1] === updated[endNew - 1]) {
    endOld--
    endNew--
  }
  view.dispatch({
    changes: { from: start, to: endOld, insert: updated.slice(start, endNew) },
    userEvent: 'input'
  })
}

/** 移除 frontmatter 中的一个标签（大小写不敏感；FR-2.6.17 胶囊 ×） */
export function removeFrontmatterTag(view: EditorView, name: string): void {
  const lower = name.toLowerCase()
  rewriteFrontmatterTags(view, (names) => names.filter((n) => n.toLowerCase() !== lower))
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
