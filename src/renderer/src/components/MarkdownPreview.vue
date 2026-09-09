<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DOMPurify from 'dompurify'
import { md } from '../lib/markdown'

const props = defineProps<{
  content: string
  /** 当前笔记库（用于解析相对图片路径） */
  vault: string
  /** 当前笔记相对路径（用于解析相对图片路径） */
  notePath: string
  fontSize: number
}>()

const emit = defineEmits<{
  /** 库内笔记链接被点击（悬浮预览等容器负责关闭自身并打开笔记） */
  (e: 'open-note', target: { vault: string; path: string; name: string }): void
}>()

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

function noteName(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base
}

/** 相对路径 .md 链接打上 data-internal（含解析后的库内路径），点击走应用内打开 */
function rewriteInternalLinks(html: string): string {
  return html.replace(/<a\b[^>]*\shref="([^"]*)"[^>]*>/g, (match, href: string) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(href)
    } catch {
      decoded = href
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('/') || decoded.startsWith('#')) return match
    if (!decoded.toLowerCase().endsWith('.md')) return match
    const rel = resolveRelRef(props.notePath, decoded)
    return match.replace(' href="', ` data-internal="${rel.replace(/"/g, '&quot;')}" href="`)
  })
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
    // 管道顺序：markdown-it 渲染（含 KaTeX/高亮）→ DOMPurify 白名单净化 → 相对链接/图片改写。
    // 净化剥除脚本与事件属性（默认），并显式禁用表单/样式注入/base 等视觉钓鱼与
    // 导航劫持向量（DOMPurify 默认保留合法的 form/input，此处收紧；CSP form-action 兜底）。
    // 笔记经 git 同步传播，内嵌 HTML 必须过净化再进 v-html。
    const sanitized = DOMPurify.sanitize(md.render(props.content ?? ''), {
      FORBID_TAGS: ['style', 'base', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'meta', 'link'],
      FORBID_ATTR: ['srcdoc', 'target']
    })
    return rewriteImages(rewriteInternalLinks(sanitized))
  } catch {
    return `<p style="color:var(--danger)">渲染出错，请检查 Markdown 语法</p>`
  }
})

const rootRef = ref<HTMLElement | null>(null)

// ---------- 行级滚动同步：data-source-line 块索引与双向定位 ----------
/** 有序的 [行号, offsetTop] 块索引（随渲染重建） */
function blockIndex(): { line: number; top: number }[] {
  const els = rootRef.value?.querySelectorAll('[data-source-line]')
  if (!els) return []
  return [...els].map((el) => ({
    line: Number((el as HTMLElement).dataset.sourceLine),
    top: (el as HTMLElement).offsetTop
  }))
}

/** 编辑器→预览：按可视首行（0 基）与行内像素偏移设置预览滚动位置 */
function syncToLine(line: number, lineOffsetRatio: number): void {
  const root = rootRef.value
  if (!root) return
  const blocks = blockIndex()
  if (blocks.length === 0) return
  // 目标块 = 行号 <= line 的最后一个（最近前驱块）
  let target = blocks[0]
  for (const b of blocks) {
    if (b.line <= line) target = b
    else break
  }
  // 块内比例折算（一个源行可对应超高块，如长代码块）
  const blockHeight = nextBlockHeight(blocks, target)
  root.scrollTop = target.top + blockHeight * Math.min(1, Math.max(0, lineOffsetRatio))
}

function nextBlockHeight(blocks: { line: number; top: number }[], target: { line: number; top: number }): number {
  const idx = blocks.indexOf(target)
  const next = blocks[idx + 1]
  return next ? Math.max(1, next.top - target.top) : 200
}

/** 预览→编辑器：当前滚动位置对应的源码行号（0 基），供编辑器滚动到该行 */
function lineAtScrollTop(): number | null {
  const root = rootRef.value
  if (!root) return null
  const top = root.scrollTop
  const blocks = blockIndex()
  if (blocks.length === 0) return null
  let target = blocks[0]
  for (const b of blocks) {
    if (b.top <= top + 1) target = b
    else break
  }
  return target.line
}

defineExpose({ syncToLine, lineAtScrollTop, scrollElement: rootRef })

// ---------- 链接点击：统一委托，外部走系统浏览器，库内笔记走应用内打开 ----------

function onPreviewClick(e: MouseEvent): void {
  const anchor = (e.target as HTMLElement).closest?.('a')
  if (!anchor) return
  // 全部阻止默认：应用窗口绝不被链接导航带走
  e.preventDefault()
  const internal = anchor.getAttribute('data-internal')
  if (internal) {
    if (anchor.hasAttribute('data-broken')) {
      ElMessage.warning(`笔记不存在：${internal}`)
      return
    }
    emit('open-note', { vault: props.vault, path: internal, name: noteName(internal) })
    return
  }
  const href = anchor.getAttribute('href') ?? ''
  if (/^https?:/i.test(href)) {
    // window.open → 主进程 setWindowOpenHandler → shell.openExternal（系统浏览器）
    window.open(href, '_blank', 'noopener,noreferrer')
  }
  // 其他（#锚点、mailto: 等）本期不处理，仅阻止默认
}

// ---------- 断链校验：渲染后异步检查库内链接是否存在，不存在标记删除线 ----------
let brokenSeq = 0
watch(
  html,
  async () => {
    await nextTick()
    const seq = ++brokenSeq
    const links = [...(rootRef.value?.querySelectorAll('a[data-internal]:not([data-broken])') ?? [])]
    for (const link of links) {
      const path = link.getAttribute('data-internal')
      if (!path) continue
      const result = await window.trace.readNote(props.vault, path)
      if (seq !== brokenSeq) return // 渲染已更新，丢弃本轮结果
      if (!result.ok) link.setAttribute('data-broken', '')
    }
  },
  { immediate: true }
)
</script>

<template>
  <div
    ref="rootRef"
    class="preview-pane markdown-body"
    :style="{ '--preview-font-size': `${fontSize}px` }"
    v-html="html"
    @click="onPreviewClick"
  ></div>
</template>
