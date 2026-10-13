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

// ---------- 正文内联 #标签（FR-2.6.18，只读识别） ----------

/**
 * 正文标签识别正则（单一定义源，识别 / 索引 / 重写 / 渲染四处共用）：
 * `#` 后 1–64 个 Unicode 字母 / 数字 / 下划线 / 连字符；前一字符不得为
 * 字母数字下划线（C#5、abc#d）、#（##标题、连续标签）、&（&#123; 实体）、
 * /（URL 片段 x.com/#a、路径 a/b#c）；名称后不得紧跟同类字符（后向边界——
 * 否则 65 字符串会在 64 处截断出一个假标签）。行首 `# ` 是 ATX 标题（井号后
 * 有空格）天然不匹配；`#标题`（无空格）按标签识别——与 CommonMark 标题定义一致。
 */
export const BODY_TAG_RE = /(?<![\p{L}\p{N}_#&/-])#([\p{L}\p{N}_-]{1,64})(?![\p{L}\p{N}_-])/gu

/** 识别候选归一：截除尾部 -/_ 后为空则无效（如 `#标签-，` 截为「标签」） */
function normalizeBodyTagCandidate(raw: string): string | null {
  const name = raw.replace(/[-_]+$/, '')
  return name || null
}

/**
 * 逐行扫描正文（frontmatter 已剥除）：跳过围栏代码块（``` / ~~~ 状态机），
 * 行内码 `…` 掩码后再识别——回调收到的行文本已做行内码掩码。
 */
function scanTaggableLines(body: string, visit: (line: string) => void): void {
  const lines = body.split(/\r?\n/)
  let fenceMark: string | null = null
  for (const line of lines) {
    if (fenceMark) {
      if (new RegExp(`^\\s*${fenceMark}`).test(line)) fenceMark = null
      continue
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(line)
    if (open) {
      fenceMark = open[1]
      continue
    }
    visit(line)
  }
}

/** 读取正文中的内联 #标签（唯一识别口径；篇内大小写不敏感去重，保留首现写法） */
export function getBodyTags(content: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  scanTaggableLines(stripFrontmatter(content), (line) => {
    if (!line.includes('#')) return
    const cleaned = line.replace(/`[^`\n]*`/g, ' ')
    for (const m of cleaned.matchAll(BODY_TAG_RE)) {
      const name = normalizeBodyTagCandidate(m[1])
      if (!name) continue
      const key = name.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(name)
      }
    }
  })
  return out
}

/** 笔记标签并集口径（FR-2.6.18）：frontmatter tags ∪ 正文 #标签，篇内大小写不敏感去重（frontmatter 写法优先） */
export function getNoteTags(content: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of getFrontmatterTags(content)) {
    const key = tag.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(tag)
    }
  }
  for (const tag of getBodyTags(content)) {
    const key = tag.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(tag)
    }
  }
  return out
}

/**
 * 全库改名 / 合并 / 删除时的正文扫写（FR-2.6.18 闭环正确性，D4）：
 * 把正文里识别为 fromLower（大小写不敏感）的 #标签 改写为 #to；to 为 null 时整体移除。
 * frontmatter 区、围栏代码块、行内码一律不触碰（行内码区间单独计算避开，掩码不落盘）。
 * 无匹配时返回原文（调用方以引用相等判断跳过写入）。
 */
export function rewriteBodyTag(content: string, fromLower: string, to: string | null): string {
  const fmMatch = FRONTMATTER_RE.exec(content)
  const head = fmMatch ? fmMatch[0] : ''
  const body = fmMatch ? content.slice(fmMatch[0].length) : content
  const segments = body.split(/(\r?\n)/)
  let fenceMark: string | null = null
  let changed = false
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (/^\r?\n$/.test(seg)) continue
    if (fenceMark) {
      if (new RegExp(`^\\s*${fenceMark}`).test(seg)) fenceMark = null
      continue
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(seg)
    if (open) {
      fenceMark = open[1]
      continue
    }
    if (!seg.includes('#')) continue
    // 行内码区间先记录，命中区间内的匹配跳过（原文改写，掩码只用于识别路径）
    const codeSpans: [number, number][] = []
    for (const cm of seg.matchAll(/`[^`\n]*`/g)) codeSpans.push([cm.index, cm.index + cm[0].length])
    const inCode = (pos: number): boolean => codeSpans.some(([s, e]) => pos >= s && pos < e)
    let result = ''
    let last = 0
    for (const m of seg.matchAll(BODY_TAG_RE)) {
      const start = m.index
      if (inCode(start)) continue
      const name = normalizeBodyTagCandidate(m[1])
      if (!name || name.toLowerCase() !== fromLower) continue
      result += seg.slice(last, start)
      if (to !== null) result += `#${to}`
      last = start + m[0].length
      changed = true
    }
    if (last > 0) segments[i] = result + seg.slice(last)
  }
  return changed ? head + segments.join('') : content
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
