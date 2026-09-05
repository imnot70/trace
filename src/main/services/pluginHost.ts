import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../lib/logger'
import { JsonStore } from '../lib/jsonStore'
import type { AppSettings, PluginInfo } from '@shared/types'

/** 插件清单（plugins/<id>/manifest.json） */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  /** 入口文件（CommonJS，相对插件目录），可选 */
  main?: string
  /** 声明需要的权限，v1 仅供审阅展示 */
  permissions?: string[]
}

export interface PluginContext {
  /** 向用户显示一条通知 */
  notify(message: string): void
  logger: typeof logger
}

interface LoadedPlugin {
  manifest: PluginManifest
  error: string | null
  deactivate?: () => void
}

export type ModuleLoader = (modulePath: string) => unknown

/**
 * 插件宿主（v1 骨架）：
 * - 扫描 userData/plugins 目录下各插件的 manifest.json
 * - 首次运行时放入一个示例插件供参考
 * - 仅当设置中开启「启用插件」且插件被启用时才执行其入口
 */
export class PluginHost {
  private loaded = new Map<string, LoadedPlugin>()

  constructor(
    private pluginsDir: string,
    private sampleDir: string | null,
    private settings: JsonStore<AppSettings>,
    private makeContext: () => PluginContext,
    private loadModule: ModuleLoader
  ) {}

  /** 确保目录存在并放入示例插件 */
  init(): void {
    try {
      fs.mkdirSync(this.pluginsDir, { recursive: true })
      if (this.sampleDir && fs.existsSync(path.join(this.sampleDir, 'manifest.json'))) {
        const sampleTarget = path.join(this.pluginsDir, 'sample')
        if (!fs.existsSync(sampleTarget)) {
          fs.cpSync(this.sampleDir, sampleTarget, { recursive: true })
        }
      }
    } catch (e) {
      logger.warn('初始化插件目录失败', e)
    }
  }

  discover(): PluginInfo[] {
    const result: PluginInfo[] = []
    let dirs: string[] = []
    try {
      dirs = fs
        .readdirSync(this.pluginsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return result
    }
    for (const dir of dirs) {
      try {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(this.pluginsDir, dir, 'manifest.json'), 'utf-8')
        ) as PluginManifest
        if (!manifest.id || !manifest.name || !manifest.version) continue
        const state = this.loaded.get(manifest.id)
        result.push({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? '',
          enabled: this.settings.get().pluginEnabled[manifest.id] ?? false,
          loaded: this.settings.get().enablePlugins ? state !== undefined && !state.error : false,
          error: state?.error ?? null
        })
      } catch {
        logger.warn(`跳过无效插件目录：${dir}`)
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id))
  }

  setEnabled(id: string, enabled: boolean): void {
    this.settings.update((s) => {
      s.pluginEnabled[id] = enabled
    })
    if (enabled) this.activate(id)
    else this.deactivate(id)
  }

  /** 按设置加载全部启用的插件（设置页开启「启用插件」时调用） */
  activateAll(): void {
    if (!this.settings.get().enablePlugins) return
    for (const info of this.discover()) {
      if (info.enabled) this.activate(info.id)
    }
  }

  private activate(id: string): void {
    if (this.loaded.has(id)) return
    try {
      const dir = path.join(this.pluginsDir, id)
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as PluginManifest
      let deactivate: (() => void) | undefined
      if (manifest.main) {
        const mod = this.loadModule(path.join(dir, manifest.main)) as {
          activate?: (ctx: PluginContext) => void | (() => void)
        }
        const ret = mod.activate?.(this.makeContext())
        if (typeof ret === 'function') deactivate = ret
      }
      this.loaded.set(id, { manifest, error: null, deactivate })
      logger.info(`插件已加载：${id}`)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      logger.error(`插件加载失败：${id}`, e)
      this.loaded.set(id, { manifest: { id, name: id, version: '0.0.0' }, error })
    }
  }

  private deactivate(id: string): void {
    const state = this.loaded.get(id)
    if (!state) return
    try {
      state.deactivate?.()
    } catch (e) {
      logger.warn(`插件停用失败：${id}`, e)
    }
    this.loaded.delete(id)
  }
}
