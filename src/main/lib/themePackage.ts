import type { ThemePackage } from '@shared/types'

/** 主题可覆盖的 CSS 变量白名单（与 presets.ts 中的变量集保持一致） */
export const THEME_VARIABLE_WHITELIST: readonly string[] = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-hover',
  '--bg-active',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--border-color',
  '--accent',
  '--accent-soft',
  '--danger',
  '--code-bg',
  '--hljs-base',
  '--hljs-comment',
  '--hljs-keyword',
  '--hljs-string',
  '--hljs-number',
  '--hljs-title'
]

const RESERVED_IDS = new Set(['default', 'warm', 'cool', 'high-contrast'])
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
// 禁用 ; : { } < > " ' \ 等结构字符，阻断 CSS 声明逃逸与 url() 外链
const VALUE_PATTERN = /^[#a-zA-Z0-9(),.%\s/-]+$/
const MAX_VALUE_LEN = 64
const MAX_NAME_LEN = 30

export function isValidThemeId(id: string): boolean {
  return ID_PATTERN.test(id)
}

function normalizeVars(
  input: unknown,
  label: string
): { ok: boolean; vars?: Record<string, string>; error?: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `${label} 必须是对象` }
  }
  const vars: Record<string, string> = {}
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!THEME_VARIABLE_WHITELIST.includes(key)) {
      return { ok: false, error: `未知变量 ${key}` }
    }
    if (
      typeof raw !== 'string' ||
      raw.length === 0 ||
      raw.length > MAX_VALUE_LEN ||
      !VALUE_PATTERN.test(raw) ||
      raw.toLowerCase().includes('url(')
    ) {
      return { ok: false, error: `变量 ${key} 的值非法` }
    }
    vars[key] = raw
  }
  return { ok: true, vars }
}

/** 校验并规范化主题包；仅保留 id/name/light/dark，杜绝脏字段回灌 */
export function validateThemePackage(
  raw: unknown
): { ok: boolean; theme?: ThemePackage; error?: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '主题文件必须是 JSON 对象' }
  }
  const obj = raw as Record<string, unknown>
  const allowedKeys = ['id', 'name', 'light', 'dark']
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) return { ok: false, error: `未知字段 ${key}` }
  }
  const id = typeof obj.id === 'string' ? obj.id : ''
  if (!isValidThemeId(id)) {
    return { ok: false, error: 'id 需为小写字母、数字或连字符，且以字母或数字开头' }
  }
  if (RESERVED_IDS.has(id)) return { ok: false, error: `id「${id}」为内置保留主题` }
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  if (!name || name.length > MAX_NAME_LEN) {
    return { ok: false, error: `name 需为 1–${MAX_NAME_LEN} 个字符` }
  }
  if (!('light' in obj) || !('dark' in obj)) return { ok: false, error: '缺少 light 或 dark' }
  const light = normalizeVars(obj.light, 'light')
  if (!light.ok) return { ok: false, error: light.error }
  const dark = normalizeVars(obj.dark, 'dark')
  if (!dark.ok) return { ok: false, error: dark.error }
  return { ok: true, theme: { id, name, light: light.vars!, dark: dark.vars! } }
}
