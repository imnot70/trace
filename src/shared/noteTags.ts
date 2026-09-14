import { load as yamlLoad, dump as yamlDump } from 'js-yaml'

/**
 * 笔记 frontmatter 中标签（tags）的读取与写入。
 *
 * 设计要点：
 * - 标签存储在笔记 YAML frontmatter 的 `tags` 键（字符串数组），随文件移动 / 重命名 / 外部编辑天然跟随；
 * - 解析失败时读取返回空数组、写入返回 null（调用方应报错放弃），绝不静默破坏用户已有 frontmatter；
 * - 写入只增删 `tags` 键，frontmatter 其余键原样保留（经 YAML round-trip，键序不变、注释会丢失——已知行为）。
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

interface FrontmatterBlock {
  attrs: Record<string, unknown>
  /** frontmatter 之后的正文 */
  body: string
}

function splitFrontmatter(content: string): FrontmatterBlock | null {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return null
  try {
    const parsed: unknown = yamlLoad(match[1])
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { attrs: parsed as Record<string, unknown>, body: content.slice(match[0].length) }
    }
    return { attrs: {}, body: content.slice(match[0].length) }
  } catch {
    return null // YAML 非法
  }
}

/** 读取笔记 frontmatter 中的 tags（无 / 非法 / 缺失时返回空数组） */
export function getFrontmatterTags(content: string): string[] {
  const block = splitFrontmatter(content)
  if (!block) return []
  const raw = block.attrs.tags
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : []
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
  return []
}

/**
 * 将 frontmatter 块掩码为等宽空白（保留换行数与行位置，正文不变）。
 * 供预览渲染使用：隐藏 frontmatter 的同时保持「源码行号 → 预览元素」的行级滚动同步映射不错位。
 */
export function maskFrontmatter(content: string): string {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return content
  return match[0].replace(/[^\n]/g, ' ') + content.slice(match[0].length)
}

/** 去除 frontmatter 块，仅返回正文（供摘要等不需要行对齐的场景使用） */
export function stripFrontmatter(content: string): string {
  const match = FRONTMATTER_RE.exec(content)
  return match ? content.slice(match[0].length) : content
}

/**
 * 写入笔记 frontmatter 的 tags。
 * 返回新的完整笔记内容；已有 frontmatter 的 YAML 非法时返回 null（调用方放弃写入）。
 * tags 为空数组时移除 tags 键；frontmatter 因此为空时整体移除 frontmatter 块。
 */
export function setFrontmatterTags(content: string, tags: string[]): string | null {
  const match = FRONTMATTER_RE.exec(content)
  const body = match ? content.slice(match[0].length) : content

  if (!match) {
    // 无 frontmatter：无标签则原样返回，有则新建
    if (tags.length === 0) return content
    const dumped = yamlDump({ tags }, { lineWidth: -1 })
    return `---\n${dumped}---\n${body}`
  }

  const block = splitFrontmatter(content)
  if (!block) return null // 已有 frontmatter 但 YAML 非法：放弃写入，保护原文
  const attrs: Record<string, unknown> = { ...block.attrs }

  if (tags.length === 0) delete attrs.tags
  else attrs.tags = [...tags]

  if (Object.keys(attrs).length === 0) return body // frontmatter 无任何键：整体移除
  const dumped = yamlDump(attrs, { lineWidth: -1 })
  return `---\n${dumped}---\n${body}`
}
