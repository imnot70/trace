/**
 * 名称校验：主进程与渲染进程共用，保证前后端规则一致。
 */

/** 子目录最大层数（不含笔记库本身） */
export const MAX_DIR_DEPTH = 6

export type ItemKind = 'vault' | 'dir' | 'note'

const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001F]/

const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
])

/** 用户输入的笔记名 -> 实际文件名（无 .md 后缀时补上） */
export function noteFileName(input: string): string {
  const trimmed = input.trim()
  return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`
}

/** 笔记文件名 -> 显示名（去掉 .md 后缀） */
export function noteDisplayName(fileName: string): string {
  return fileName.toLowerCase().endsWith('.md') ? fileName.slice(0, -3) : fileName
}

/**
 * 校验名称格式，返回错误信息（中文）或 null 表示通过。
 * name 为用户输入；笔记会先按显示名校验。
 */
export function checkNameFormat(rawName: string, kind: ItemKind): string | null {
  const name = kind === 'note' ? noteDisplayName(rawName) : rawName.trim()
  if (!name) return '名称不能为空'
  if (name.startsWith('.')) return '名称不能以点开头'
  if (INVALID_CHARS.test(name)) return '名称不能包含 \\ / : * ? " < > | 等字符'
  if (name !== name.trim() || name.endsWith('.') || name.startsWith(' ')) {
    return '名称不能以空格或点开头、结尾'
  }
  if (RESERVED_NAMES.has(name.toUpperCase())) return '该名称为系统保留名称，请更换'
  if (name.length > 100) return '名称过长（最多 100 个字符）'
  return null
}

/** 检查与已有名称是否重复（大小写不敏感，兼容 Mac/Windows 文件系统） */
export function checkDuplicate(name: string, existing: string[], kind: ItemKind): string | null {
  const target = (kind === 'note' ? noteDisplayName(name) : name.trim()).toLowerCase()
  const hit = existing.some((e) => e.toLowerCase() === target)
  return hit ? '名称已存在，请更换' : null
}

/** 一键校验：格式 + 重复 */
export function validateName(
  rawName: string,
  kind: ItemKind,
  existing: string[]
): string | null {
  return checkNameFormat(rawName, kind) ?? checkDuplicate(rawName, existing, kind)
}

/** 相对路径深度：'' -> 0，'a' -> 1，'a/b' -> 2 */
export function relDepth(relPath: string): number {
  if (!relPath) return 0
  return relPath.split('/').filter(Boolean).length
}

/**
 * 附件目录设置：多级 POSIX 相对路径（如 media/image），逐段校验。
 * 返回规范化目录（无首尾斜杠）；空输入回退默认值 attachments。
 */
export const DEFAULT_ATTACH_DIR = 'attachments'

export function normalizeAttachDir(
  input: string,
  maxDepth = 4
): { ok: true; dir: string } | { ok: false; error: string } {
  const segs = (input ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
  if (segs.length === 0) return { ok: true, dir: DEFAULT_ATTACH_DIR }
  if (segs.length > maxDepth) return { ok: false, error: `附件目录最多 ${maxDepth} 层` }
  for (const seg of segs) {
    if (seg === '.' || seg === '..') return { ok: false, error: '目录中不能包含 . 或 ..' }
    const invalid = checkNameFormat(seg, 'dir')
    if (invalid) return { ok: false, error: `「${seg}」${invalid}` }
  }
  return { ok: true, dir: segs.join('/') }
}

/**
 * 代理地址规范化与校验：http://[user:pass@]host:port（host 也可为 IP/域名）。
 * 空/空白输入视为不使用代理（返回空串）。
 */
export function normalizeProxyUrl(
  input: string
): { ok: true; url: string } | { ok: false; error: string } {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: true, url: '' }
  const m = raw.match(/^(http|https):\/\/([^/]+)$/i)
  if (!m) {
    return { ok: false, error: '格式应为 http://[用户名:密码@]主机:端口，例如 http://127.0.0.1:7890' }
  }
  const hostPart = m[2]
  // 主机:端口（凭据部分允许更多字符，取最后一段作为 host:port）
  const lastAt = hostPart.lastIndexOf('@')
  const hostPort = lastAt >= 0 ? hostPart.slice(lastAt + 1) : hostPart
  const lastColon = hostPort.lastIndexOf(':')
  const host = lastColon >= 0 ? hostPort.slice(0, lastColon) : hostPort
  const portStr = lastColon >= 0 ? hostPort.slice(lastColon + 1) : ''
  if (!host) return { ok: false, error: '代理主机不能为空' }
  if (!/^\d{1,5}$/.test(portStr) || Number(portStr) < 1 || Number(portStr) > 65535) {
    return { ok: false, error: '代理端口需为 1–65535 的数字' }
  }
  return { ok: true, url: raw }
}
