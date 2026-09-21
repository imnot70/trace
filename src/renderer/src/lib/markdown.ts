/** Markdown 渲染管道（独立模块便于单测）：highlight.js 语言注册 + markdown-it 实例
 *  + KaTeX(texmath) + 源码行号注入（data-source-line，供编辑器/预览双向行级滚动同步）
 *  + 共用净化（DOMPurify 收紧白名单，预览 / 导出 HTML / 编辑器所见即所得 Widget 三处同一套） */
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import markdownLang from 'highlight.js/lib/languages/markdown'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('markdown', markdownLang)
hljs.registerLanguage('java', java)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('go', go)

// 代码块语法高亮：交由 highlight.js 生成 hljs-* 类名（配色见 markdown.css，随主题变量切换）
// 未识别语言或高亮失败时回退为转义后的纯文本
function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  highlight(code: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        /* fall through */
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`
  }
})

md.use(texmath, { engine: katex, delimiters: 'dollars', katexOptions: { output: 'html' } })

// [[双链]] 语法：[[笔记名]] 或 [[路径|显示名]]
md.inline.ruler.push('wikilink', (state, silent) => {
  const src = state.src
  const pos = state.pos
  if (src.charCodeAt(pos) !== 0x5B || src.charCodeAt(pos + 1) !== 0x5B) return false // [[
  const end = src.indexOf(']]', pos + 2)
  if (end < 0) return false
  if (silent) return true

  const inner = src.slice(pos + 2, end)
  const pipeIdx = inner.indexOf('|')
  const path = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim()
  const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : path
  if (!path) return false

  const token = state.push('wikilink', 'a', 0)
  token.attrSet('data-wikilink', path)
  token.attrSet('href', `${path}.md`)
  token.content = display
  token.markup = '[[]]'
  state.pos = end + 2
  return true
})

md.renderer.rules.wikilink = (tokens, idx) => {
  const token = tokens[idx]
  const href = String(token.attrGet('href') ?? '')
  const wikilink = String(token.attrGet('data-wikilink') ?? '')
  const display = token.content
  return `<a data-wikilink="${escapeHtml(wikilink)}" href="${escapeHtml(href)}">${escapeHtml(display)}</a>`
}

// 块级 token 注入源码行号（0 基）：供编辑器/预览双向行级滚动同步定位。
// 仅顶层块（token.map 存在且非 hidden）；嵌套内层不加，查找时取最近前驱块。
// fence 高亮返回完整 <pre> 字符串时，markdown-it 会绕过 token attrs 渲染——
// 自定义 fence 渲染器把行号补进返回的 <pre> 标签
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const info = (token.info || '').trim().split(/\s+/)[0]
  let highlighted: string
  if (info && hljs.getLanguage(info)) {
    try {
      highlighted = `<pre class="hljs"><code>${hljs.highlight(token.content, { language: info, ignoreIllegals: true }).value}</code></pre>`
    } catch {
      highlighted = `<pre class="hljs"><code>${escapeHtml(token.content)}</code></pre>`
    }
  } else {
    highlighted = `<pre class="hljs"><code>${escapeHtml(token.content)}</code></pre>`
  }
  const line = token.map?.[0]
  const lineAttr = line != null ? ` data-source-line="${line}"` : ''
  return highlighted.replace('<pre', `<pre${lineAttr}`) + '\n'
}

// GFM 任务列表：列表项首行 [x] / [ ] 渲染为只读复选框（span 实现——不用 <input>，
// 与 DOMPurify 禁用清单冲突；笔记是文件，复选框点击不回写，仅展示勾选态）
md.core.ruler.push('trace_task_lists', (state) => {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== 'inline') continue
    if (tokens[i - 1].type !== 'paragraph_open') continue
    if (tokens[i - 2].type !== 'list_item_open') continue
    const children = tokens[i].children ?? []
    const first = children[0]
    if (!first || first.type !== 'text') continue
    const m = first.content.match(/^\[([ xX])\]\s+/)
    if (!m) continue
    const checked = m[1] !== ' '
    first.content = first.content.slice(m[0].length)
    const box = new state.Token('html_inline', '', 0)
    box.content = `<span class="task-item-checkbox"${checked ? ' data-checked="true"' : ''}></span>`
    children.unshift(box)
    tokens[i - 2].attrJoin('class', 'task-list-item')
    if (checked) tokens[i - 2].attrJoin('class', 'task-list-item-checked')
  }
})

md.core.ruler.push('trace_source_line', (state) => {
  for (const token of state.tokens) {
    if (token.map && !token.hidden && token.nesting !== -1 && token.attrSet) {
      token.attrSet('data-source-line', String(token.map[0]))
    }
  }
})

// 标题 id 生成：供页内锚点跳转和自动补全使用
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
}

const headingSeen = new Map<string, number>()
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  // 提取标题纯文本
  const inline = tokens[idx + 1]
  const text = inline?.children?.map((t: { content: string }) => t.content).join('') ?? ''
  let id = slugify(text)
  if (id) {
    const count = headingSeen.get(id) ?? 0
    headingSeen.set(id, count + 1)
    if (count > 0) id = `${id}-${count}`
    token.attrSet('id', id)
  }
  return self.renderToken(tokens, idx, options)
}

// 每次渲染重置 seen set
const origRender = md.render.bind(md)
md.render = (src: string, env?: Record<string, unknown>) => {
  headingSeen.clear()
  return origRender(src, env)
}

export { md }

/** 共用 HTML 净化：剥脚本与事件属性（DOMPurify 默认），并显式禁用表单/样式注入/base
 *  等视觉钓鱼与导航劫持向量（DOMPurify 默认保留合法的 form/input，此处收紧；CSP form-action 兜底）。
 *  笔记经 git 同步传播，内嵌 HTML 必须过净化再进 innerHTML / v-html */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'base', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'meta', 'link'],
    FORBID_ATTR: ['srcdoc', 'target']
  })
}

/** POSIX 风格相对路径解析（渲染进程无 node:path，自己实现最小版本）。
 *  返回相对库根的规范路径；协议链接与绝对路径原样返回 */
export function resolveRelRef(notePath: string, ref: string): string {
  const normRef = ref.split('\\').join('/')
  if (/^[a-z]+:/i.test(normRef) || normRef.startsWith('/')) return normRef
  const parts = (notePath || '').split('/')
  parts.pop()
  const segments = [...parts, ...normRef.split('/')]
  const stack: string[] = []
  for (const seg of segments) {
    if (!seg || seg === '.') continue
    if (seg === '..') stack.pop()
    else stack.push(seg)
  }
  return stack.join('/')
}

/** 相对路径图片/资源引用改写为 trace-vault:// 协议地址（协议链接、绝对路径、锚点返回 null） */
export function resolveAssetUrl(vault: string, notePath: string, src: string): string | null {
  if (/^[a-z]+:/i.test(src) || src.startsWith('/') || src.startsWith('#')) return null
  const rel = resolveRelRef(notePath, decodeURIComponent(src))
  return `trace-vault://${encodeURIComponent(vault)}/${rel
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
}
