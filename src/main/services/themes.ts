import fs from 'node:fs'
import path from 'node:path'
import type { ThemePackage } from '@shared/types'
import { isValidThemeId, validateThemePackage } from '../lib/themePackage'

/**
 * 自定义主题包：每个主题存 userData/themes/<id>.json。
 * - importFile 只读取并校验，不写盘（供渲染层先做覆盖确认）；
 * - save 落盘前再次校验（防御）；
 * - list 中损坏的单个文件静默跳过，不影响其余主题。
 */
export class ThemeService {
  constructor(private dir: string) {}

  list(): ThemePackage[] {
    let files: string[]
    try {
      files = fs.readdirSync(this.dir)
    } catch {
      return []
    }
    const themes: ThemePackage[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf-8'))
        const result = validateThemePackage(raw)
        if (result.ok && result.theme) themes.push(result.theme)
      } catch {
        /* 损坏文件：跳过 */
      }
    }
    return themes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  importFile(srcPath: string): { ok: boolean; theme?: ThemePackage; error?: string } {
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(srcPath, 'utf-8'))
    } catch {
      return { ok: false, error: '无法读取或解析该文件（需为合法 JSON）' }
    }
    return validateThemePackage(raw)
  }

  save(theme: ThemePackage): { ok: boolean; error?: string } {
    const result = validateThemePackage(theme)
    if (!result.ok || !result.theme) return { ok: false, error: result.error }
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      const target = path.join(this.dir, `${result.theme.id}.json`)
      const tmp = `${target}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(result.theme, null, 2), 'utf-8')
      fs.renameSync(tmp, target)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '写入失败' }
    }
  }

  remove(id: string): { ok: boolean; error?: string } {
    if (!isValidThemeId(id)) return { ok: false, error: '非法 id' }
    try {
      fs.rmSync(path.join(this.dir, `${id}.json`), { force: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '删除失败' }
    }
  }
}
