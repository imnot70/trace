import DOMPurify from 'dompurify'
import { md } from './markdown'
import { stripFrontmatter } from '@shared/noteTags'

/** 与生产净化配置一致（MarkdownPreview.vue），导出沿用同一安全边界 */
export const SANITIZE_CONFIG = {
  FORBID_TAGS: ['style', 'base', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'meta', 'link'],
  FORBID_ATTR: ['srcdoc', 'target']
}

/** 相对路径解析为库内路径（POSIX 风格，与 MarkdownPreview.resolveRelRef 同规则） */
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

/**
 * 生成导出用的笔记 HTML 正文（无 <html> 外壳）：
 * markdown 渲染 → DOMPurify 净化 → 库内图片经 fetchImageBase64 内联为 data URL（PDF 自包含）。
 * fetchImageBase64 由调用方注入（渲染进程走 window.trace.fs.readImage）。
 */
export async function renderNoteHtml(
  content: string,
  notePath: string,
  fetchImageBase64: (relPath: string) => Promise<{ ok: boolean; mime?: string; base64?: string }>
): Promise<string> {
  // frontmatter 属元数据，不进导出内容
  const rendered = md.render(stripFrontmatter(content ?? ''))
  const sanitized = DOMPurifySanitize(rendered)

  // 库内图片 → data URL
  const imgRe = /<img\b[^>]*\ssrc="([^"]*)"[^>]*>/g
  const jobs: Promise<void>[] = []
  const replacements = new Map<string, string>()
  for (const m of sanitized.matchAll(imgRe)) {
    const src = m[1]
    if (/^[a-z]+:/i.test(src) || src.startsWith('/') || src.startsWith('#')) continue
    if (src.startsWith('data:')) continue
    let rel: string
    try {
      rel = resolveRelRef(notePath, decodeURIComponent(src))
    } catch {
      rel = resolveRelRef(notePath, src)
    }
    jobs.push(
      fetchImageBase64(rel)
        .then((r) => {
          if (r.ok && r.base64) replacements.set(src, `data:${r.mime};base64,${r.base64}`)
        })
        .catch(() => undefined)
    )
  }
  await Promise.all(jobs)

  let out = sanitized
  for (const [src, dataUrl] of replacements) out = out.split(`src="${src}"`).join(`src="${dataUrl}"`)
  return out
}

function DOMPurifySanitize(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}
