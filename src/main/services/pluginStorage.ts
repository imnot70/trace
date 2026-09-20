import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../lib/logger'

/**
 * 插件私有 KV 存储（M2，设计第 4 节 settings:persist）：
 * - 每个插件一个 JSON 文件：userData/plugin-data/<插件id>.json（应用数据目录，绝不写入笔记库）
 * - 键值均受大小上限约束；值必须是 JSON 可序列化对象
 * - 卸载插件时随权限记录一并清除（见 PluginHost.uninstall）
 */

export interface PluginStorageBackend {
  get(key: string): { ok: true; value: unknown } | { ok: false; error: string }
  set(key: string, value: unknown): { ok: boolean; error?: string }
  delete(key: string): { ok: boolean; error?: string }
  keys(): { ok: true; keys: string[] } | { ok: false; error: string }
}

export interface StorageLimits {
  maxValueBytes: number
  maxTotalBytes: number
  maxKeyLength: number
}

export const DEFAULT_STORAGE_LIMITS: StorageLimits = {
  maxValueBytes: 256 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxKeyLength: 200
}

function fail(error: string) {
  return { ok: false as const, error }
}

export class PluginStorageService {
  constructor(
    private rootDir: string,
    private limits: StorageLimits = DEFAULT_STORAGE_LIMITS
  ) {}

  private fileFor(pluginId: string): string {
    return path.join(this.rootDir, `${pluginId}.json`)
  }

  private read(pluginId: string): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.fileFor(pluginId), 'utf-8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private write(pluginId: string, data: Record<string, unknown>): void {
    fs.mkdirSync(this.rootDir, { recursive: true })
    const tmp = `${this.fileFor(pluginId)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmp, this.fileFor(pluginId))
  }

  private validateKey(key: unknown): string | null {
    if (typeof key !== 'string' || key.length === 0) return '存储键不能为空'
    if (key.length > this.limits.maxKeyLength) return `存储键过长（上限 ${this.limits.maxKeyLength} 字符）`
    return null
  }

  backend(pluginId: string): PluginStorageBackend {
    // 插件 id 已在安装时校验（目录名即 id），此处再防御一次路径拼接
    if (!/^[a-zA-Z0-9_-]+$/.test(pluginId)) throw new Error(`非法插件 id：${pluginId}`)
    return {
      get: (key) => {
        const keyErr = this.validateKey(key)
        if (keyErr) return fail(keyErr)
        const data = this.read(pluginId)
        return { ok: true, value: key in data ? data[key] : null }
      },
      set: (key, value) => {
        const keyErr = this.validateKey(key)
        if (keyErr) return fail(keyErr)
        if (value === undefined) return fail('存储值不能是 undefined')
        let serialized: string
        try {
          serialized = JSON.stringify(value)
        } catch {
          return fail('存储值必须是 JSON 可序列化的')
        }
        if (serialized.length > this.limits.maxValueBytes) {
          return fail(`单个存储值超出上限（${Math.floor(this.limits.maxValueBytes / 1024)}KB）`)
        }
        const data = this.read(pluginId)
        data[key] = value
        if (JSON.stringify(data).length > this.limits.maxTotalBytes) {
          return fail(`插件存储总量超出上限（${Math.floor(this.limits.maxTotalBytes / 1024)}KB）`)
        }
        try {
          this.write(pluginId, data)
        } catch (e) {
          logger.warn(`插件存储写入失败：${pluginId}`, e)
          return fail('存储写入失败')
        }
        return { ok: true }
      },
      delete: (key) => {
        const keyErr = this.validateKey(key)
        if (keyErr) return fail(keyErr)
        const data = this.read(pluginId)
        delete data[key]
        try {
          this.write(pluginId, data)
        } catch (e) {
          logger.warn(`插件存储删除失败：${pluginId}`, e)
          return fail('存储写入失败')
        }
        return { ok: true }
      },
      keys: () => {
        const data = this.read(pluginId)
        return { ok: true, keys: Object.keys(data) }
      }
    }
  }

  /** 插件存储占用字节数（无存储文件时为 0） */
  usageBytes(pluginId: string): number {
    try {
      return fs.statSync(this.fileFor(pluginId)).size
    } catch {
      return 0
    }
  }

  /** 卸载插件时清除其全部私有存储 */
  clear(pluginId: string): void {
    try {
      fs.rmSync(this.fileFor(pluginId), { force: true })
    } catch (e) {
      logger.warn(`清除插件存储失败：${pluginId}`, e)
    }
  }
}
