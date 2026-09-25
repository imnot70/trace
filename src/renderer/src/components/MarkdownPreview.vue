<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { md, resolveAssetUrl, resolveRelRef, sanitizeHtml } from '../lib/markdown'
import { noteDisplayName, openWikilinkByName } from '../lib/wikilink'
import { maskFrontmatter } from '@shared/noteTags'

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

/** POSIX 风格相对路径解析与图片协议改写在 lib/markdown（预览 / 编辑器所见即所得共用） */

function noteName(path: string): string {
  return noteDisplayName(path)
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
    // 锚点链接：#开头 → data-internal="#anchor"
    if (decoded.startsWith('#')) {
      return match.replace(' href="', ` data-internal="${decoded.replace(/"/g, '&quot;')}" href="`)
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('/')) return match
    // [[双链]] 链接：带 data-wikilink 属性
    if (match.includes('data-wikilink')) {
      const wikilink = match.match(/data-wikilink="([^"]*)"/)?.[1] ?? ''
      if (wikilink) {
        const resolved = wikilinkResolutions.get(wikilink)
        if (resolved && resolved.length > 0) {
          return match.replace(' href="', ` data-internal="${resolved[0].replace(/"/g, '&quot;')}" href="`)
        }
        // 未解析到时标记为断链
        return match.replace(' href="', ` data-internal="${wikilink.replace(/"/g, '&quot;')}" data-broken href="`)
      }
    }
    if (!decoded.toLowerCase().endsWith('.md')) return match
    const rel = resolveRelRef(props.notePath, decoded)
    return match.replace(' href="', ` data-internal="${rel.replace(/"/g, '&quot;')}" href="`)
  })
}

/** 相对路径图片改写为 trace-vault:// 协议 */
function rewriteImages(html: string): string {
  return html.replace(/<img[^>]*\ssrc="([^"]*)"[^>]*>/g, (match, src: string) => {
    const resolved = resolveAssetUrl(props.vault, props.notePath, src)
    return resolved ? match.replace(src, resolved) : match
  })
}

// [[双链]] 解析结果缓存：wikilink名 → 同名候选路径列表（0 个 = 断链，>1 个 = 需消歧）
const wikilinkResolutions = new Map<string, string[]>()
let wikilinkSeq = 0

/** 异步解析所有 [[双链]] 链接，设置 data-internal / data-ambiguous */
async function resolveWikilinks(): Promise<void> {
  const seq = ++wikilinkSeq
  await nextTick()
  if (seq !== wikilinkSeq) return
  const links = rootRef.value?.querySelectorAll('a[data-wikilink]') ?? []
  for (const link of links) {
    if (seq !== wikilinkSeq) return
    const name = link.getAttribute('data-wikilink')
    if (!name) continue
    if (wikilinkResolutions.has(name)) {
      applyResolution(link, wikilinkResolutions.get(name)!)
      continue
    }
    const result = await window.trace.resolveByNameCandidates(props.vault, name)
    if (seq !== wikilinkSeq) return
    const paths = result.ok && result.paths ? result.paths : []
    if (paths.length > 0) {
      wikilinkResolutions.set(name, paths)
      applyResolution(link, paths)
    }
  }
  if (seq !== wikilinkSeq) return
  checkBrokenLinks()
}

/** 把解析结果落到链接上：data-internal 取首个候选，多候选标记 data-ambiguous 供点击消歧 */
function applyResolution(link: Element, paths: string[]): void {
  link.setAttribute('data-internal', paths[0])
  link.removeAttribute('data-broken')
  if (paths.length > 1) link.setAttribute('data-ambiguous', '')
  else link.removeAttribute('data-ambiguous')
}

const html = computed(() => {
  try {
    // 管道顺序：掩码 frontmatter（保留行号映射，行级滚动同步不错位）→ markdown-it 渲染（含 KaTeX/高亮）
    // → DOMPurify 白名单净化（sanitizeHtml，与导出 HTML / 编辑器所见即所得共用）→ 相对链接/图片改写
    const sanitized = sanitizeHtml(md.render(maskFrontmatter(props.content ?? '')))
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
  if (next) return Math.max(1, next.top - target.top)
  // 目标是最后一个块：下一块的 offsetTop 不存在，改用**块自身渲染高度**折算块内比例。
  // 固定回退 200px 会在「文档尾部是一个超高块」（长段落 / 长代码块）时把块内比例
  // 压缩到几乎为 0——同步到的位置远早于编辑器实际位置（实测预览停在 4.6% 而非 ~87%）。
  const el = rootRef.value?.querySelector(`[data-source-line="${target.line}"]`) as HTMLElement | null
  return el ? Math.max(1, el.offsetHeight) : 200
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
  e.preventDefault()
  const internal = anchor.getAttribute('data-internal')
  if (internal) {
    // 页内锚点跳转
    if (internal.startsWith('#')) {
      const anchorId = decodeURIComponent(internal.slice(1))
      const target = rootRef.value?.querySelector(`[id="${CSS.escape(anchorId)}"]`)
      if (target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth' })
      else ElMessage.warning(`锚点不存在：${anchorId}`)
      return
    }
    if (anchor.hasAttribute('data-broken')) {
      ElMessage.warning(`笔记不存在：${internal}`)
      return
    }
    if (anchor.hasAttribute('data-ambiguous')) {
      void openAmbiguousPicker(anchor.getAttribute('data-wikilink') ?? internal)
      return
    }
    emit('open-note', { vault: props.vault, path: internal, name: noteName(internal) })
    return
  }
  const href = anchor.getAttribute('href') ?? ''
  if (/^https?:/i.test(href)) {
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}

// ---------- 断链校验：渲染后异步检查库内链接是否存在，不存在标记删除线 ----------
let brokenSeq = 0
function checkBrokenLinks(): void {
  void (async () => {
    await nextTick()
    const seq = ++brokenSeq
    const links = [...(rootRef.value?.querySelectorAll('a[data-internal]:not([data-broken])') ?? [])]
    for (const link of links) {
      const p = link.getAttribute('data-internal')
      if (!p || p.startsWith('#')) continue // 跳过锚点
      const result = await window.trace.readNote(props.vault, p)
      if (seq !== brokenSeq) return
      if (!result.ok) link.setAttribute('data-broken', '')
    }
  })()
}

// ---------- 双链同名消歧：点击多候选链接时列出全部同名笔记供选择（共享逻辑见 lib/wikilink） ----------
function openAmbiguousPicker(name: string): void {
  void openWikilinkByName(props.vault, name, (target) => emit('open-note', target))
}

watch(
  html,
  () => {
    wikilinkResolutions.clear()
    void resolveWikilinks()
    checkBrokenLinks()
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
