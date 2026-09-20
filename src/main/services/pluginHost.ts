import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../lib/logger'
import { JsonStore } from '../lib/jsonStore'
import type { AppSettings, PluginCommandInfo, PluginCrashRecord, PluginInfo } from '@shared/types'
import type { PluginManifest } from './pluginManifest'
import { isValidManifest } from './pluginManifest'
import { dispatchCapabilityCall, type GatewayServices } from './pluginGateway'
import { stagePluginZip, installStaged, exportPluginZip, type StagedPlugin } from './pluginPackage'
import type { PluginStorageService } from './pluginStorage'
import type { HostToPlugin, PluginToHost, PluginEventName } from '../plugin-runtime/protocol'
import {
  ACTIVATE_TIMEOUT_MS,
  DEACTIVATE_TIMEOUT_MS
} from '../plugin-runtime/protocol'

/** 插件运行时句柄（生产 = electron utilityProcess 适配；测试 = 进程内桩） */
export interface RuntimeHandle {
  post(msg: HostToPlugin): void
  onMessage(cb: (msg: PluginToHost) => void): void
  onExit(cb: (code: number) => void): void
  kill(): void
}

export type RuntimeSpawner = (bridgePath: string, pluginId: string, pluginDir: string) => RuntimeHandle

export interface PluginHostDeps {
  pluginsDir: string
  /** 内置示例插件目录（首启复制用） */
  sampleDir: string | null
  settings: JsonStore<AppSettings>
  /** bridge 脚本绝对路径（out/main/bridge.js） */
  bridgePath: string
  spawnRuntime: RuntimeSpawner
  gateway: GatewayServices
  /** 插件私有存储服务（settings:persist） */
  storage: PluginStorageService
  /** 导入暂存目录（userData/plugin-staging） */
  stagingDir: string
  /** 主进程日志文件路径（详情页日志查看用；可为 null） */
  logPath: string | null
}

interface PluginState {
  manifest: PluginManifest
  runtime: RuntimeHandle | null
  running: boolean
  error: string | null
  /** 本轮启用期内连续崩溃次数 */
  crashCount: number
  /** 崩溃历史（最近在前，最多 10 条） */
  crashes: { at: number; code: number }[]
  /** 守护重启定时器 */
  restartTimer: NodeJS.Timeout | null
  /** 正在走停用流程（exit 视为正常） */
  stopping: boolean
  commands: PluginCommandInfo[]
  /** 事件节流：vault:changed 合并定时器（timer 上挂 __payload 暂存最新事件） */
  coalesceTimer: NodeJS.Timeout | null
  /** 每轮重启等待 activated 的超时定时器 */
  activateTimer: NodeJS.Timeout | null
  /** 待决命令调用（invokeCommand 的完成回调） */
  commandResolvers: Map<number, { resolve: (r: { ok: boolean; error?: string }) => void; timer: NodeJS.Timeout }>
}

function emptyState(manifest: PluginManifest, error: string | null): PluginState {
  return {
    manifest,
    runtime: null,
    running: false,
    error,
    crashCount: 0,
    crashes: [],
    restartTimer: null,
    stopping: false,
    commands: [],
    coalesceTimer: null,
    activateTimer: null,
    commandResolvers: new Map()
  }
}

/** 连续崩溃上限：达到即自动停用（设计第 5 节） */
const MAX_CONSECUTIVE_CRASHES = 5
/** 守护重启退避基数（毫秒）：1s, 2s, 4s, 8s */
const RESTART_BACKOFF_BASE_MS = 1000
function manifestPermissions(m: PluginManifest): string[] {
  return Array.isArray(m.permissions) ? m.permissions.filter((p) => typeof p === 'string') : []
}

function samePermissionSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((p) => set.has(p))
}

/**
 * 插件宿主 v2（M1）：
 * - 每个启用的插件一个 utilityProcess（bridge.js 承载插件代码），进程隔离
 * - 能力网关：ctx 调用按 manifest.permissions 过滤后转发真实服务
 * - 崩溃守护：指数退避重启，连续 5 次转「已停用 + 错误」
 * - 权限确认：启用前 manifest 声明必须与已确认集合一致，不一致需用户重新确认
 */
export class PluginHost {
  private states = new Map<string, PluginState>()
  private pendingImports = new Map<string, StagedPlugin>()
  private deps: PluginHostDeps

  constructor(deps: PluginHostDeps) {
    this.deps = deps
  }

  private get settings(): JsonStore<AppSettings> {
    return this.deps.settings
  }

  /** 确保目录存在并放入示例插件（示例版本更新时覆盖，运行中的插件除外） */
  init(): void {
    try {
      fs.mkdirSync(this.deps.pluginsDir, { recursive: true })
      const sample = this.deps.sampleDir
      if (sample && fs.existsSync(path.join(sample, 'manifest.json'))) {
        const target = path.join(this.deps.pluginsDir, 'sample')
        const shouldCopy =
          !fs.existsSync(path.join(target, 'manifest.json')) ||
          this.isSampleNewer(sample, target)
        if (shouldCopy) {
          fs.rmSync(target, { recursive: true, force: true })
          fs.cpSync(sample, target, { recursive: true })
          logger.info('已内置/更新示例插件')
        }
      }
    } catch (e) {
      logger.warn('初始化插件目录失败', e)
    }
  }

  private isSampleNewer(sampleDir: string, targetDir: string): boolean {
    try {
      const parse = (p: string): number[] => {
        const m = JSON.parse(fs.readFileSync(p, 'utf-8')) as { version?: string }
        return (m.version ?? '0').split('.').map((n) => parseInt(n, 10) || 0)
      }
      const a = parse(path.join(sampleDir, 'manifest.json'))
      const b = parse(path.join(targetDir, 'manifest.json'))
      for (let i = 0; i < 3; i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
      }
      return false
    } catch {
      return false
    }
  }

  private pluginDir(id: string): string {
    return path.join(this.deps.pluginsDir, id)
  }

  private readManifest(id: string): PluginManifest | null {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(this.pluginDir(id), 'manifest.json'), 'utf-8')) as PluginManifest
      return isValidManifest(m) ? m : null
    } catch {
      return null
    }
  }

  /** id -> 目录名扫描（目录名即插件 id） */
  discover(): PluginInfo[] {
    const result: PluginInfo[] = []
    let dirs: string[] = []
    try {
      dirs = fs
        .readdirSync(this.deps.pluginsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return result
    }
    for (const dir of dirs) {
      const manifest = this.readManifest(dir)
      if (!manifest) {
        logger.warn(`跳过无效插件目录：${dir}`)
        continue
      }
      const declared = manifestPermissions(manifest)
      const state = this.states.get(manifest.id)
      result.push({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        permissions: declared,
        permissionsConfirmed: this.isPermissionConfirmed(manifest.id, declared),
        enabled: this.settings.get().pluginEnabled[manifest.id] ?? false,
        running: state?.running ?? false,
        error: state?.error ?? null,
        crashCount: state?.crashCount ?? 0,
        crashHistory: (state?.crashes ?? []).map((c) => ({ at: new Date(c.at).toISOString(), code: c.code })),
        commands: state?.running ? state.commands : []
      })
    }
    return result.sort((a, b) => a.id.localeCompare(b.id))
  }

  private confirmedPermissions(id: string): string[] {
    return this.settings.get().pluginPermissionsConfirmed?.[id] ?? []
  }

  private isPermissionConfirmed(id: string, declared: string[]): boolean {
    if (declared.length === 0) return true
    return samePermissionSet(declared, this.confirmedPermissions(id))
  }

  /**
   * 启用检查：权限未确认时返回 needsConfirmation（渲染端弹权限对话框后调 confirmEnablePlugin）。
   * 停用直接放行。
   */
  setEnabled(id: string, enabled: boolean): { ok: boolean; needsConfirmation?: boolean; permissions?: string[]; error?: string } {
    if (!enabled) {
      this.settings.update((s) => {
        s.pluginEnabled[id] = false
      })
      this.deactivate(id)
      return { ok: true }
    }
    const manifest = this.readManifest(id)
    if (!manifest) return { ok: false, error: `插件清单无效：${id}` }
    const declared = manifestPermissions(manifest)
    if (!this.isPermissionConfirmed(id, declared)) {
      return { ok: false, needsConfirmation: true, permissions: declared }
    }
    this.settings.update((s) => {
      s.pluginEnabled[id] = true
    })
    this.activate(id)
    return { ok: true }
  }

  /** 记录权限确认并启用（确认集合 = 当前 manifest 声明） */
  confirmEnable(id: string): { ok: boolean; error?: string } {
    const manifest = this.readManifest(id)
    if (!manifest) return { ok: false, error: `插件清单无效：${id}` }
    const declared = manifestPermissions(manifest)
    this.settings.update((s) => {
      s.pluginPermissionsConfirmed = { ...(s.pluginPermissionsConfirmed ?? {}), [id]: declared }
      s.pluginEnabled[id] = true
    })
    this.activate(id)
    return { ok: true }
  }

  /** 按设置激活全部启用且权限已确认的插件（应用启动时调用） */
  activateAll(): void {
    if (!this.settings.get().enablePlugins) return
    for (const info of this.discover()) {
      if (info.enabled && info.permissionsConfirmed) this.activate(info.id)
    }
  }

  // ---------- 进程管理 ----------

  /**
   * 激活插件进程。preserveCrashCount：崩溃守护的重启路径保留计数，
   * 用户手动启停则归零（「本轮启用期内」语义）。
   */
  private activate(id: string, preserveCrashCount = false): void {
    const existing = this.states.get(id)
    if (existing?.running) return

    const manifest = this.readManifest(id)
    if (!manifest) {
      this.states.set(id, emptyState({ id, name: id, version: '0.0.0' }, `插件清单无效：${id}`))
      return
    }
    if (!manifest.main) {
      // 纯清单插件（无可执行入口）：无需进程
      this.states.set(id, emptyState(manifest, null))
      logger.info(`插件无执行入口，按清单加载：${id}`)
      return
    }

    // 清理旧状态的守护定时器
    if (existing?.restartTimer) clearTimeout(existing.restartTimer)

    const state: PluginState = {
      ...emptyState(manifest, null),
      crashCount: preserveCrashCount ? existing?.crashCount ?? 0 : 0,
      crashes: preserveCrashCount ? existing?.crashes ?? [] : []
    }
    this.states.set(id, state)

    let runtime: RuntimeHandle
    try {
      runtime = this.deps.spawnRuntime(this.deps.bridgePath, id, this.pluginDir(id))
    } catch (e) {
      state.error = `插件进程启动失败：${e instanceof Error ? e.message : String(e)}`
      logger.error(`插件进程启动失败：${id}`, e)
      return
    }
    state.runtime = runtime

    runtime.onMessage((msg) => this.onRuntimeMessage(id, msg))
    runtime.onExit((code) => this.onRuntimeExit(id, code))

    // activate 超时守护
    state.activateTimer = setTimeout(() => {
      if (state.running || state.runtime !== runtime) return
      state.error = `activate 超时（${ACTIVATE_TIMEOUT_MS}ms），已终止插件进程`
      logger.warn(`插件 activate 超时：${id}`)
      state.stopping = true
      this.killRuntime(state, id)
      state.runtime = null
    }, ACTIVATE_TIMEOUT_MS)

    runtime.post({ t: 'activate', entry: manifest.main, manifest })
    logger.info(`插件进程已启动：${id}`)
  }

  private onRuntimeMessage(id: string, msg: PluginToHost): void {
    const state = this.states.get(id)
    if (!state) return
    switch (msg.t) {
      case 'activated': {
        if (state.activateTimer) {
          clearTimeout(state.activateTimer)
          state.activateTimer = null
        }
        state.running = true
        state.commands = msg.commands.map((c) => ({ id: c.id, title: c.title }))
        state.error = null
        logger.info(`插件已激活：${id}（命令 ${msg.commands.length} 个）`)
        break
      }
      case 'activate-error': {
        if (state.activateTimer) {
          clearTimeout(state.activateTimer)
          state.activateTimer = null
        }
        state.error = msg.error
        // 入口级失败是确定性错误，不进入崩溃重启循环；
        // 主动终止前标记 stopping，避免 exit 被守护误计为崩溃
        state.stopping = true
        logger.error(`插件激活失败：${id}：${msg.error}`)
        this.killRuntime(state, id)
        state.runtime = null
        break
      }
      case 'rpc-call': {
        const permissions = new Set(manifestPermissions(state.manifest))
        const result = dispatchCapabilityCall(msg, permissions, this.deps.gateway, id)
        state.runtime?.post({
          t: 'rpc-result',
          id: msg.id,
          ok: result.ok,
          fatal: !result.ok,
          result: result.result,
          error: result.error
        })
        break
      }
      case 'command-result': {
        const resolver = state.commandResolvers.get(msg.id)
        if (resolver) {
          clearTimeout(resolver.timer)
          state.commandResolvers.delete(msg.id)
          resolver.resolve(msg.ok ? { ok: true } : { ok: false, error: msg.error })
        }
        break
      }
      case 'deactivated': {
        // 插件已完成停用回调：立即收尾（强制终止兜底进程），exit 随后到达视为正常
        if (state.activateTimer) {
          clearTimeout(state.activateTimer)
          state.activateTimer = null
        }
        if (state.coalesceTimer) {
          clearTimeout(state.coalesceTimer)
          state.coalesceTimer = null
        }
        state.running = false
        state.commands = []
        const rt = state.runtime
        state.runtime = null
        if (rt) {
          try {
            rt.kill()
          } catch (e) {
            logger.warn(`插件进程终止失败：${id}`, e)
          }
        }
        break
      }
      default:
        break
    }
  }

  private onRuntimeExit(id: string, code: number): void {
    const state = this.states.get(id)
    if (!state) return
    if (state.activateTimer) {
      clearTimeout(state.activateTimer)
      state.activateTimer = null
    }
    if (state.coalesceTimer) {
      clearTimeout(state.coalesceTimer)
      state.coalesceTimer = null
    }
    state.runtime = null
    state.commands = []

    if (state.stopping || !this.settings.get().pluginEnabled[id]) {
      // 正常停用
      state.running = false
      state.stopping = false
      return
    }

    // 崩溃守护：指数退避重启，连续 5 次自动停用
    state.crashCount += 1
    state.crashes.unshift({ at: Date.now(), code })
    if (state.crashes.length > 10) state.crashes.pop()
    state.running = false
    state.error = `插件进程异常退出（code ${code}），第 ${state.crashCount} 次崩溃`
    logger.warn(`插件进程崩溃：${id}（连续第 ${state.crashCount} 次，code ${code}）`)

    if (state.crashCount >= MAX_CONSECUTIVE_CRASHES) {
      state.error = `连续崩溃 ${state.crashCount} 次，已自动停用`
      this.settings.update((s) => {
        s.pluginEnabled[id] = false
      })
      logger.warn(`插件连续崩溃达到上限，已自动停用：${id}`)
      return
    }

    const backoff = RESTART_BACKOFF_BASE_MS * 2 ** (state.crashCount - 1)
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null
      if (this.settings.get().pluginEnabled[id] && this.settings.get().enablePlugins) {
        logger.info(`守护重启插件：${id}（退避 ${backoff}ms）`)
        this.activate(id, true)
      }
    }, backoff)
  }

  private killRuntime(state: PluginState, id: string): void {
    try {
      state.runtime?.kill()
    } catch (e) {
      logger.warn(`插件进程终止失败：${id}`, e)
    }
  }

  private deactivate(id: string): void {
    const state = this.states.get(id)
    if (!state) return
    if (state.restartTimer) {
      clearTimeout(state.restartTimer)
      state.restartTimer = null
    }
    if (state.activateTimer) {
      clearTimeout(state.activateTimer)
      state.activateTimer = null
    }
    if (state.coalesceTimer) {
      clearTimeout(state.coalesceTimer)
      state.coalesceTimer = null
    }
    // 手动停用 = 错误与崩溃计数归零（重新启用视为全新一轮）
    state.error = null
    state.crashCount = 0
    state.commands = []
    for (const [, resolver] of state.commandResolvers) {
      clearTimeout(resolver.timer)
      resolver.resolve({ ok: false, error: '插件已停用' })
    }
    state.commandResolvers.clear()

    if (!state.runtime) {
      this.states.delete(id)
      return
    }
    state.stopping = true
    state.runtime.post({ t: 'deactivate' })
    // deactivate 5s 超时强杀（设计第 5 节）
    const runtime = state.runtime
    const timer = setTimeout(() => {
      if (this.states.get(id)?.runtime === runtime) {
        logger.warn(`插件停用超时，强制终止进程：${id}`)
        this.killRuntime(state, id)
      }
    }, DEACTIVATE_TIMEOUT_MS)
    timer.unref?.()
  }

  // ---------- 事件广播 ----------

  /**
   * 向声明了 events 权限的运行中插件广播事件。
   * vault:changed 高频事件按插件合并（300ms 尾沿，保留最新 payload）；其余直传。
   */
  emitEvent(event: PluginEventName, payload: unknown): void {
    for (const state of this.states.values()) {
      if (!state.running || !state.runtime) continue
      if (!manifestPermissions(state.manifest).includes('events')) continue
      if (event === 'vault:changed') {
        this.scheduleCoalescedVaultChanged(state, payload)
        continue
      }
      state.runtime.post({ t: 'event', event, payload })
    }
  }

  private scheduleCoalescedVaultChanged(state: PluginState, payload: unknown): void {
    const pending = state.coalesceTimer as unknown as { __payload?: unknown } | null
    if (pending) {
      pending.__payload = payload
      return
    }
    const timer = setTimeout(() => {
      const t = state.coalesceTimer as unknown as { __payload?: unknown } | null
      state.coalesceTimer = null
      if (state.running && state.runtime && t) {
        state.runtime.post({ t: 'event', event: 'vault:changed', payload: t.__payload })
      }
    }, 300)
    ;(timer as unknown as { __payload: unknown }).__payload = payload
    state.coalesceTimer = timer
  }

  /** 运行插件命令（设置页触发）；超时由宿主兜底（bridge 侧另有命令超时） */
  invokeCommand(commandId: string, timeoutMs = 10000): Promise<{ ok: boolean; error?: string }> {
    const dotIdx = commandId.indexOf('.')
    const pluginId = dotIdx > 0 ? commandId.slice(0, dotIdx) : ''
    const state = pluginId ? this.states.get(pluginId) : undefined
    if (!state?.running || !state.runtime) {
      return Promise.resolve({ ok: false, error: '插件未运行' })
    }
    if (!state.commands.some((c) => c.id === commandId)) {
      return Promise.resolve({ ok: false, error: `命令不存在：${commandId}` })
    }
    const invokeId = ++PluginHost.invokeSeq
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.commandResolvers.delete(invokeId)
        resolve({ ok: false, error: `命令执行超时（${timeoutMs}ms）` })
      }, timeoutMs)
      state.commandResolvers.set(invokeId, { resolve, timer })
      state.runtime?.post({ t: 'invoke-command', id: invokeId, commandId, args: [] })
    })
  }

  private static invokeSeq = 0

  // ---------- M2：卸载 / 打包导入导出 / 详情 ----------

  /**
   * 卸载插件：停用（含强杀等待）+ 删除目录 + 清权限记录与启用开关 + 清私有存储。
   * 设计第 5 节：卸载 = 停用 + 删目录 + 清权限记录与私有存储。
   */
  uninstall(id: string): { ok: boolean; error?: string } {
    if (!fs.existsSync(this.pluginDir(id))) {
      // 目录已不在：仍清理元数据（残留状态的自愈）
      this.deactivate(id)
      this.states.delete(id)
      this.clearPluginMeta(id)
      this.deps.storage.clear(id)
      return { ok: true }
    }
    this.deactivate(id)
    this.states.delete(id)
    try {
      fs.rmSync(this.pluginDir(id), { recursive: true, force: true })
    } catch (e) {
      return { ok: false, error: `删除插件目录失败：${e instanceof Error ? e.message : String(e)}` }
    }
    this.clearPluginMeta(id)
    this.deps.storage.clear(id)
    logger.info(`插件已卸载：${id}`)
    return { ok: true }
  }

  private clearPluginMeta(id: string): void {
    this.settings.update((s) => {
      delete s.pluginEnabled[id]
      if (s.pluginPermissionsConfirmed) delete s.pluginPermissionsConfirmed[id]
    })
  }

  /**
   * 导入第一步：解析 .trace-plugin 并解压暂存，返回预览信息。
   * 权限确认由渲染端对话框完成（本地包必须提示「未经 Trace 市场审阅」）。
   */
  beginImport(zipPath: string): { ok: true; importId: string; manifest: PluginManifest; isUpgrade: boolean } | { ok: false; error: string } {
    try {
      fs.mkdirSync(this.deps.stagingDir, { recursive: true })
      const staged: StagedPlugin = stagePluginZip(zipPath, this.deps.stagingDir)
      const importId = randomUUID()
      this.pendingImports.set(importId, staged)
      const isUpgrade = fs.existsSync(this.pluginDir(staged.manifest.id))
      return { ok: true, importId, manifest: staged.manifest, isUpgrade }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  cancelImport(importId: string): void {
    const staged = this.pendingImports.get(importId)
    if (!staged) return
    this.pendingImports.delete(importId)
    fs.rmSync(staged.stagingPath, { recursive: true, force: true })
  }

  /**
   * 导入第二步：确认安装。目标已存在（升级）时先停用旧进程再整体替换；
   * 原插件处于启用状态时，安装后按权限确认状态重新激活。
   */
  confirmImport(importId: string): {
    ok: boolean
    id?: string
    needsConfirmation?: boolean
    permissions?: string[]
    error?: string
  } {
    const staged = this.pendingImports.get(importId)
    if (!staged) return { ok: false, error: '导入会话不存在或已过期' }
    const id = staged.manifest.id
    const wasEnabled = this.settings.get().pluginEnabled[id] ?? false
    try {
      if (wasEnabled || this.states.has(id)) this.deactivate(id)
      this.states.delete(id)
      installStaged(staged.stagingPath, this.deps.pluginsDir, id)
    } catch (e) {
      return { ok: false, error: `安装失败：${e instanceof Error ? e.message : String(e)}` }
    } finally {
      this.cancelImport(importId)
    }
    logger.info(`插件包已安装：${id} v${staged.manifest.version}${wasEnabled ? '（升级，原为启用）' : ''}`)

    if (wasEnabled) {
      const r = this.setEnabled(id, true)
      if (!r.ok) {
        // 权限变化：开关保持关闭，待用户重新确认后启用
        this.settings.update((st) => {
          st.pluginEnabled[id] = false
        })
        return { ok: true, id, needsConfirmation: true, permissions: r.permissions ?? [] }
      }
    }
    return { ok: true, id }
  }

  /** 导出插件目录为 .trace-plugin 文件 */
  exportPlugin(id: string, outZipPath: string): { ok: boolean; error?: string } {
    if (!fs.existsSync(this.pluginDir(id))) return { ok: false, error: `插件不存在：${id}` }
    try {
      exportPluginZip(this.pluginDir(id), outZipPath)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: `导出失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /** 插件详情：信息 + 崩溃历史 + 日志行 + 私有存储占用 */
  detail(id: string): { ok: boolean; detail?: {
    info: PluginInfo
    crashes: PluginCrashRecord[]
    logs: string[]
    storageBytes: number
  }; error?: string } {
    const manifest = this.readManifest(id)
    if (!manifest) return { ok: false, error: `插件不存在：${id}` }
    const info = this.discover().find((p) => p.id === id)
    if (!info) return { ok: false, error: `插件不存在：${id}` }
    return {
      ok: true,
      detail: {
        info,
        crashes: info.crashHistory,
        logs: this.readPluginLogLines(id),
        storageBytes: this.deps.storage.usageBytes(id)
      }
    }
  }

  /** 从主进程日志尾部提取该插件最近的输出行（最多 200 行） */
  private readPluginLogLines(id: string): string[] {
    const logPath = this.deps.logPath
    if (!logPath || !fs.existsSync(logPath)) return []
    try {
      const stat = fs.statSync(logPath)
      const readSize = Math.min(stat.size, 512 * 1024)
      const fd = fs.openSync(logPath, 'r')
      try {
        const buf = Buffer.alloc(readSize)
        fs.readSync(fd, buf, 0, readSize, stat.size - readSize)
        const marker = `[插件 ${id}]`
        return buf
          .toString('utf-8')
          .split('\n')
          .filter((line) => line.includes(marker))
          .slice(-200)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return []
    }
  }
}
