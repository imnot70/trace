<script setup lang="ts">
import { computed } from 'vue'
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

const props = defineProps<{
  content: string
  /** 当前笔记库（用于解析相对图片路径） */
  vault: string
  /** 当前笔记相对路径（用于解析相对图片路径） */
  notePath: string
  fontSize: number
}>()

// 代码块语法高亮：交由 highlight.js 生成 hljs-* 类名（配色见 markdown.css，随主题变量切换）
// 未识别语言或高亮失败时回退为转义后的纯文本
function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(code, lang) {
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

// 外链新窗口打开
const defaultLink =
  md.renderer.rules.link_open ??
  ((tokens: any[], idx: number, options: any, _env: unknown, self: any) =>
    self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noreferrer')
  return defaultLink(tokens, idx, options, env, self)
}

/** POSIX 风格相对路径解析（渲染进程无 node:path，自己实现最小版本） */
function resolveRelRef(notePath: string, ref: string): string {
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

/** 相对路径图片改写为 trace-vault:// 协议 */
function rewriteImages(html: string): string {
  return html.replace(/<img[^>]*\ssrc="([^"]*)"[^>]*>/g, (match, src: string) => {
    if (/^[a-z]+:/i.test(src) || src.startsWith('/') || src.startsWith('#')) return match
    const rel = resolveRelRef(props.notePath, decodeURIComponent(src))
    return match.replace(
      src,
      `trace-vault://${encodeURIComponent(props.vault)}/${rel
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    )
  })
}

const html = computed(() => {
  try {
    return rewriteImages(md.render(props.content ?? ''))
  } catch {
    return `<p style="color:var(--danger)">渲染出错，请检查 Markdown 语法</p>`
  }
})
</script>

<template>
  <div
    class="preview-pane markdown-body"
    :style="{ '--preview-font-size': `${fontSize}px` }"
    v-html="html"
  ></div>
</template>
