import fs from 'node:fs'
import path from 'node:path'
import { logger } from './logger'

/** JsonStore 可选项 */
export interface JsonStoreOptions {
  /**
   * schema 版本号（写入文件供迁移判定）。不传 = 1。
   * 读取时文件里缺 schemaVersion 视为 0（旧版数据），按需经 migrate 升级。
   */
  version?: number
  /**
   * 迁移钩子：把 fromVersion 时代的旧数据改写成当前形态（原地修改并返回）。
   * 迁移发生在与默认值深合并之前——旧键可以先清理再合并。
   */
  migrate?: (data: Record<string, unknown>, fromVersion: number) => Record<string, unknown>
}

/** 递归合并：对象逐键深入，数组与原始值整体覆盖；undefined 不覆盖 */
function deepMerge<T>(base: T, override: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(override)) {
    const b = (base as Record<string, unknown>)[key]
    if (
      b !== null && typeof b === 'object' && !Array.isArray(b) &&
      value !== null && typeof value === 'object' && !Array.isArray(value)
    ) {
      deepMerge(b, value as Record<string, unknown>)
    } else if (value !== undefined) {
      ;(base as Record<string, unknown>)[key] = value
    }
  }
  return base
}

/**
 * JSON 持久化（应用元数据底座）：
 * - 写入原子（tmp + fsync + rename），崩溃不会留下半截文件；
 * - 读取与默认值**深合并**——新版本给嵌套默认值加键不会被旧数据整体顶掉；
 * - 文件损坏时保留 `.bak` 现场再回退默认值（不再静默丢数据）；
 * - schemaVersion + migrate：旧数据升级有统一入口（原先迁移散落各处 ad-hoc）。
 */
export class JsonStore<T extends object> {
  private data: T

  constructor(
    private filePath: string,
    private defaults: T,
    private options: JsonStoreOptions = {}
  ) {
    this.data = this.load()
  }

  private load(): T {
    let raw: string | null = null
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8')
    } catch {
      /* 文件不存在（首次启动），走默认值 */
    }
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const { schemaVersion, ...rest } = parsed
        const fromVersion = typeof schemaVersion === 'number' ? schemaVersion : 0
        const migrated = this.options.migrate ? this.options.migrate(rest, fromVersion) : rest
        return deepMerge(structuredClone(this.defaults), migrated)
      } catch (e) {
        // 损坏现场保留一份供用户抢救，再回退默认值
        try {
          fs.copyFileSync(this.filePath, `${this.filePath}.bak`)
          logger.warn(`JSON 数据损坏，已备份到 ${this.filePath}.bak 并回退默认值`, e)
        } catch {
          logger.warn('JSON 数据损坏且备份失败，回退默认值', e)
        }
      }
    }
    return structuredClone(this.defaults)
  }

  get(): T {
    return this.data
  }

  update(mutate: (data: T) => void): T {
    mutate(this.data)
    this.save()
    return this.data
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, JSON.stringify({ schemaVersion: this.options.version ?? 1, ...this.data }, null, 2))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, this.filePath)
  }
}
