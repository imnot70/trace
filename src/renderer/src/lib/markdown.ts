/** Markdown 渲染管道（独立模块便于单测）：highlight.js 语言注册 + markdown-it 实例
 *  + KaTeX(texmath) + 源码行号注入（data-source-line，供编辑器/预览双向行级滚动同步） */
import MarkdownIt from 'markdown-it'
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

md.core.ruler.push('trace_source_line', (state) => {
  for (const token of state.tokens) {
    if (token.map && !token.hidden && token.nesting !== -1 && token.attrSet) {
      token.attrSet('data-source-line', String(token.map[0]))
    }
  }
})

export { md }
