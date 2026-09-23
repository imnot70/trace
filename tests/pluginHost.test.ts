import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginHost, type RuntimeHandle, type RuntimeSpawner } from '../src/main/services/pluginHost'
import type { PluginStorageService } from '../src/main/services/pluginStorage'
import { exportPluginZip } from '../src/main/services/pluginPackage'
import type { GatewayServices } from '../src/main/services/pluginGateway'
import { JsonStore } from '../src/main/lib/jsonStore'
import type { AppSettings } from '../src/shared/types'
import type { HostToPlugin, PluginToHost } from '../src/main/plugin-runtime/protocol'

/**
 * 插件宿主 v2 生命周期集成测试（进程内桩运行时）：
 * 桩按 bridge 协议真实走一遍 activate / rpc-call / 网关 / rpc-result / 命令 / 崩溃守护，
 * 但不 fork 真实 utilityProcess（vitest 无 electron）。
 */

let tmp: string
let settings: JsonStore<AppSettings>
let notifications: string[]
const logs: string[] = []

class FakeRuntime implements RuntimeHandle {
  readonly posted: HostToPlugin[] = []
  readonly events: Extract<HostToPlugin, { t: 'event' }>[] = []
  killed = false
  private messageCb: ((m: PluginToHost) => void) | null = null
  private exitCb: ((code: number) => void) | null = null
  private rpcSeq = 0
  private rpcWaiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private pluginDeactivate: (() => void) | null = null
  private commands: { id: string; title: string; handler: (...args: unknown[]) => unknown }[] = []
  readonly pluginDirPath: string
  readonly pluginId: string

  constructor(pluginDirPath: string, pluginId: string) {
    this.pluginDirPath = pluginDirPath
    this.pluginId = pluginId
  }

  post(msg: HostToPlugin): void {
    this.posted.push(msg)
    if (msg.t === 'activate') void this.runActivate(msg)
    else if (msg.t === 'rpc-result') {
      const w = this.rpcWaiters.get(msg.id)
      if (w) {
        this.rpcWaiters.delete(msg.id)
        if (msg.ok) w.resolve(msg.result)
        else w.reject(new Error(msg.error ?? '调用失败'))
      }
    } else if (msg.t === 'event') {
      this.events.push(msg)
    } else if (msg.t === 'invoke-command') {
      void this.runCommand(msg)
    } else if (msg.t === 'deactivate') {
      this.deactivatePlugin()
      this.messageCb?.({ t: 'deactivated' })
      this.exitCb?.(0)
    }
  }

  onMessage(cb: (m: PluginToHost) => void): void {
    this.messageCb = cb
  }

  onExit(cb: (code: number) => void): void {
    this.exitCb = cb
  }

  kill(): void {
    if (this.killed) return
    this.killed = true
    this.exitCb?.(0)
  }

  /** 测试辅助：模拟进程崩溃 */
  simulateCrash(code = 1): void {
    this.exitCb?.(code)
  }

  private call(domain: string, method: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.rpcSeq
      this.rpcWaiters.set(id, { resolve, reject })
      this.messageCb?.({ t: 'rpc-call', id, domain, method, args })
    })
  }

  private buildCtx(): Record<string, unknown> {
    // 箭头函数词法捕获 this，无需别名
    const call = (domain: string, method: string, args: unknown[]): Promise<unknown> =>
      this.call(domain, method, args)
    return {
      notify: (message: string) => call('notifications', 'notify', [String(message)]),
      logger: {
        info: (...a: unknown[]) => void call('logger', 'info', a).catch(() => {}),
        warn: (...a: unknown[]) => void call('logger', 'warn', a).catch(() => {}),
        error: (...a: unknown[]) => void call('logger', 'error', a).catch(() => {})
      },
      notes: {
        vaults: () => call('notes:read', 'vaults', []),
        list: (v: string) => call('notes:read', 'list', [v]),
        tree: (v: string) => call('notes:read', 'tree', [v]),
        read: (v: string, p: string) => call('notes:read', 'read', [v, p]),
        write: (v: string, p: string, c: string, o?: { expectedHash?: string | null }) =>
          call('notes:write', 'write', [v, p, c, o]),
        create: (v: string, pp: string, n: string, c?: string) => call('notes:write', 'create', [v, pp, n, c])
      },
      on: () => {},
      off: () => {},
      registerCommand: (cmd: { id: string; title: string; handler: (...args: unknown[]) => unknown }) => {
        // 与 bridge 一致：完整命令 id = <插件id>.<命令id>
        const full = { ...cmd, id: `${this.pluginId}.${cmd.id}` }
        this.commands.push(full)
        return full.id
      }
    }
  }

  private async runActivate(msg: Extract<HostToPlugin, { t: 'activate' }>): Promise<void> {
    this.commands = []
    try {
      const code = fs.readFileSync(path.resolve(this.pluginDirPath, msg.entry), 'utf-8')
      const moduleObj = { exports: {} as Record<string, unknown> }
      const fn = new Function('module', 'exports', code)
      fn(moduleObj, moduleObj.exports)
      const activate = moduleObj.exports.activate as ((ctx: unknown) => void | (() => void)) | undefined
      if (typeof activate !== 'function') throw new Error('入口未导出 activate(ctx)')
      const ret = activate(this.buildCtx())
      this.pluginDeactivate = typeof ret === 'function' ? ret : null
      this.messageCb?.({ t: 'activated', commands: this.commands.map((c) => ({ id: c.id, title: c.title })) })
    } catch (e) {
      this.messageCb?.({ t: 'activate-error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  private async runCommand(msg: Extract<HostToPlugin, { t: 'invoke-command' }>): Promise<void> {
    const cmd = this.commands.find((c) => c.id === msg.commandId)
    if (!cmd) {
      this.messageCb?.({ t: 'command-result', id: msg.id, ok: false, error: `命令不存在：${msg.commandId}` })
      return
    }
    try {
      await Promise.resolve(cmd.handler(...msg.args))
      this.messageCb?.({ t: 'command-result', id: msg.id, ok: true })
    } catch (e) {
      this.messageCb?.({ t: 'command-result', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  deactivatePlugin(): void {
    this.pluginDeactivate?.()
  }
}

function makeHost(): {
  host: PluginHost
  runtimes: FakeRuntime[]
  clearedStorages: string[]
  statusUpdates: string[]
  toolbarBroadcasts: { icon: string; title: string; command: string; pluginId: string }[][]
} {
  const runtimes: FakeRuntime[] = []
  const clearedStorages: string[] = []
  const statusUpdates: string[] = []
  const toolbarBroadcasts: { icon: string; title: string; command: string; pluginId: string }[][] = []
  const gateway: GatewayServices = {
    listVaultNames: () => ['vault-a'],
    vaultPath: (name) => (name === 'vault-a' ? path.join(tmp, 'ws', name) : null),
    listTree: () => [],
    readNote: (_v, p) => ({ ok: true, content: `内容-${p}`, hash: 'h1' }),
    writeNote: (_v, p, c) => ({ ok: true, hash: `h2-${p}-${c.length}` }),
    createNote: (_v, pp, n) => ({ ok: true, path: pp ? `${pp}/${n}` : n }),
    notifyUser: (m) => notifications.push(m),
    log: (level, pluginId, args) => logs.push(`${level}:${pluginId}:${args.join(' ')}`),
    setStatus: (pluginId, text) => statusUpdates.push(`${pluginId}:${text}`),
    clearStatus: (pluginId) => statusUpdates.push(`${pluginId}:CLEAR`),
    getStorage: () => ({
      get: (key) => ({ ok: true, value: key in storageData ? storageData[key] : null }),
      set: (key, value) => {
        storageData[key] = value
        return { ok: true }
      },
      delete: (key) => {
        delete storageData[key]
        return { ok: true }
      },
      keys: () => ({ ok: true, keys: Object.keys(storageData) })
    })
  }
  const storageData: Record<string, unknown> = {}
  const spawner: RuntimeSpawner = (_bridge, pluginId, pluginDir) => {
    const rt = new FakeRuntime(pluginDir, pluginId)
    runtimes.push(rt)
    return rt
  }
  const host = new PluginHost({
    pluginsDir: path.join(tmp, 'plugins'),
    sampleDir: null,
    settings,
    bridgePath: '/bridge.js',
    spawnRuntime: spawner,
    gateway,
    storage: {
      backend: () => ({
        get: (key: string) => ({ ok: true, value: key in storageData ? storageData[key] : null }),
        set: (key: string, value: unknown) => {
          storageData[key] = value
          return { ok: true }
        },
        delete: (key: string) => {
          delete storageData[key]
          return { ok: true }
        },
        keys: () => ({ ok: true, keys: Object.keys(storageData) })
      }),
      usageBytes: () => 0,
      clear: (pluginId: string) => {
        clearedStorages.push(pluginId)
      }
    } as unknown as PluginStorageService,
    stagingDir: path.join(tmp, 'staging'),
    logPath: null,
    broadcastToolbars: (items) => toolbarBroadcasts.push(items),
    onPluginStopped: () => {}
  })
  return { host, runtimes, clearedStorages, statusUpdates, toolbarBroadcasts }
}

function installPlugin(
  id: string,
  mainJs: string,
  permissions: string[] = [],
  manifestExtra: Record<string, unknown> = {}
): void {
  const dir = path.join(tmp, 'plugins', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ id, name: '示例插件', version: '1.0.0', description: 'd', main: 'main.js', permissions, ...manifestExtra })
  )
  fs.writeFileSync(path.join(dir, 'main.js'), mainJs)
}

/**
 * 等待异步激活完成（activate 消息 -> 插件执行 -> activated 回报）。
 * 全链路只有微任务，因此纯微任务冲刷即可——setImmediate 在 fake timers 下不会触发。
 */
async function flush(times = 60): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-plugin2-'))
  settings = new JsonStore<AppSettings>(path.join(tmp, 'settings.json'), {
    workspaceRoot: tmp,
    theme: 'system',
    themePreset: 'default',
    editorFontSize: 15,
    autoSave: true,
    zenHideTopbar: false,
    attachmentsDir: 'attachments',
    proxyUrl: '',
    trashRetentionDays: 30,
    trashMaxEntries: 0,
    autoSyncMode: 'off',
    autoSyncIntervalMin: 5,
    enablePlugins: false,
    pluginEnabled: {},
    pluginPermissionsConfirmed: {},
    gitSource: null,
    windowGlassEffect: 'auto',
    windowOpacity: 100,
    sidebarMenus: { recents: true, favorites: true, tags: true, unresolved: true, trash: true },
    showBacklinks: true,
    defaultEditMode: 'source',
    typewriterMode: 'off',
    flowLineWidth: 'medium',
  })
  notifications = []
  logs.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('PluginHost v2 · 权限确认流程', () => {
  it('声明权限的插件未经确认时拒绝启用并返回权限清单', () => {
    const { host, runtimes } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = () => {}', ['notes:read'])
    const r = host.setEnabled('sample', true)
    expect(r.ok).toBe(false)
    expect(r.needsConfirmation).toBe(true)
    expect(r.permissions).toEqual(['notes:read'])
    expect(runtimes).toHaveLength(0)
    expect(host.discover()[0]).toMatchObject({ enabled: false, permissionsConfirmed: false })
  })

  it('confirmEnable 记录确认并激活插件', async () => {
    const { host, runtimes } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = () => {}', ['notifications'])
    expect(host.confirmEnable('sample').ok).toBe(true)
    await flush()
    expect(runtimes).toHaveLength(1)
    const info = host.discover()[0]
    expect(info).toMatchObject({ enabled: true, running: true, permissionsConfirmed: true })
  })

  it('manifest 权限集合变化后需重新确认', () => {
    const { host } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = () => {}', ['notifications'])
    expect(host.confirmEnable('sample').ok).toBe(true)
    // 模拟升级后新增权限
    installPlugin('sample', 'exports.activate = () => {}', ['notifications', 'notes:write'])
    const info = host.discover()[0]
    expect(info.permissionsConfirmed).toBe(false)
    const r = host.setEnabled('sample', true)
    expect(r.needsConfirmation).toBe(true)
  })

  it('无权限声明的插件直接启用，无需确认', async () => {
    const { host, runtimes } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = () => {}')
    const r = host.setEnabled('sample', true)
    expect(r.ok).toBe(true)
    await flush()
    expect(runtimes).toHaveLength(1)
  })
})

describe('PluginHost v2 · 进程隔离与能力调用', () => {
  it('插件 ctx.notify 经网关送达用户通知', async () => {
    const { host } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = (ctx) => { ctx.notify("hello") }', ['notifications'])
    host.confirmEnable('sample')
    await flush()
    expect(notifications).toEqual(['hello'])
  })

  it('未声明的权限调用被网关拒绝', async () => {
    const { host } = makeHost()
    host.init()
    // 插件只有 notifications 权限却调用 notes.read，捕获拒绝信息后再通知
    installPlugin(
      'sample',
      `exports.activate = async (ctx) => {
         try { await ctx.notes.read('vault-a', 'a.md'); ctx.notify('should-not-happen') }
         catch (e) { ctx.notify('拒绝：' + e.message) }
       }`,
      ['notifications']
    )
    host.confirmEnable('sample')
    await flush()
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain('拒绝')
    expect(notifications[0]).toContain('notes:read')
  })

  it('activate 抛错记录错误且不进入崩溃重启', async () => {
    const { host, runtimes } = makeHost()
    host.init()
    installPlugin('sample', 'throw new Error("boom")')
    host.setEnabled('sample', true)
    await flush()
    const info = host.discover()[0]
    expect(info.running).toBe(false)
    expect(info.error).toContain('boom')
    expect(runtimes[0].killed).toBe(true)
  })

  it('无效入口（未导出 activate）报激活错误', async () => {
    const { host } = makeHost()
    host.init()
    installPlugin('sample', 'module.exports = {}')
    host.setEnabled('sample', true)
    await flush()
    expect(host.discover()[0].error).toContain('activate')
  })

  it('停用插件：进程被终止、命令清空', async () => {
    const { host, runtimes } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = () => {}')
    host.setEnabled('sample', true)
    await flush()
    expect(host.discover()[0].running).toBe(true)
    host.setEnabled('sample', false)
    await flush()
    const info = host.discover()[0]
    expect(info).toMatchObject({ enabled: false, running: false })
    expect(runtimes[0].killed).toBe(true)
  })
})

describe('PluginHost v2 · 命令', () => {
  it('激活时上报命令，invokeCommand 触发执行', async () => {
    const { host } = makeHost()
    host.init()
    installPlugin(
      'sample',
      `exports.activate = (ctx) => {
         ctx.registerCommand({ id: 'hello', title: '打招呼', handler: () => { ctx.notify('命令执行了') } })
       }`,
      ['notifications']
    )
    host.confirmEnable('sample')
    await flush()
    expect(host.discover()[0].commands).toEqual([{ id: 'sample.hello', title: '打招呼' }])

    const r = await host.invokeCommand('sample.hello')
    expect(r.ok).toBe(true)
    expect(notifications).toEqual(['命令执行了'])
  })

  it('不存在的命令返回错误', async () => {
    const { host } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = () => {}')
    host.setEnabled('sample', true)
    await flush()
    const r = await host.invokeCommand('sample.nope')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })
})

describe('PluginHost v2 · 崩溃守护', () => {
  it('崩溃后指数退避重启，恢复运行', async () => {
    vi.useFakeTimers()
    const { host, runtimes } = makeHost()
    host.init()
    settings.update((s) => {
      s.enablePlugins = true
    })
    installPlugin('sample', 'exports.activate = () => {}')
    host.setEnabled('sample', true)
    await flush()

    runtimes[0].simulateCrash(1)
    await flush()
    expect(host.discover()[0].crashCount).toBe(1)
    expect(host.discover()[0].running).toBe(false)

    // 退避 1s 后重启
    await vi.advanceTimersByTimeAsync(1100)
    await flush()
    expect(runtimes.length).toBe(2)
    expect(host.discover()[0].running).toBe(true)
  })

  it('连续崩溃 5 次后自动停用', async () => {
    vi.useFakeTimers()
    const { host, runtimes } = makeHost()
    host.init()
    settings.update((s) => {
      s.enablePlugins = true
    })
    installPlugin('sample', 'exports.activate = () => {}')
    host.setEnabled('sample', true)
    await flush()

    let backoff = 1000
    for (let crash = 1; crash <= 5; crash++) {
      const current = runtimes[runtimes.length - 1]
      current.simulateCrash(2)
      await flush()
      if (crash < 5) {
        await vi.advanceTimersByTimeAsync(backoff + 100)
        await flush()
        backoff *= 2
      }
    }
    const info = host.discover()[0]
    expect(info.enabled).toBe(false)
    expect(info.running).toBe(false)
    expect(info.error).toContain('连续崩溃')
    expect(info.crashCount).toBe(5)
    expect(settings.get().pluginEnabled['sample']).toBe(false)
  })

  it('手动停用后崩溃计数清零', async () => {
    vi.useFakeTimers()
    const { host, runtimes } = makeHost()
    host.init()
    settings.update((s) => {
      s.enablePlugins = true
    })
    installPlugin('sample', 'exports.activate = () => {}')
    host.setEnabled('sample', true)
    await flush()
    runtimes[0].simulateCrash(1)
    await flush()
    expect(host.discover()[0].crashCount).toBe(1)
    host.setEnabled('sample', false)
    host.setEnabled('sample', true)
    await flush()
    expect(host.discover()[0].crashCount).toBe(0)
  })
})

describe('PluginHost v2 · M2 卸载与导入', () => {
  function writeZipFor(dirName: string, id: string, version: string, permissions: string[]): string {
    const dir = path.join(tmp, 'zipsrc', dirName)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ id, name: '导入插件', version, description: 'd', main: 'main.js', permissions })
    )
    fs.writeFileSync(path.join(dir, 'main.js'), 'exports.activate = () => {}')
    const zipPath = path.join(tmp, `${dirName}.trace-plugin`)
    exportPluginZip(dir, zipPath)
    return zipPath
  }

  it('崩溃历史写入 discover（时间 + 退出码）', async () => {
    vi.useFakeTimers()
    const { host, runtimes } = makeHost()
    host.init()
    settings.update((st) => {
      st.enablePlugins = true
    })
    installPlugin('sample', 'exports.activate = () => {}')
    host.setEnabled('sample', true)
    await flush()
    runtimes[0].simulateCrash(3)
    await flush()
    const history = host.discover()[0].crashHistory
    expect(history).toHaveLength(1)
    expect(history[0].code).toBe(3)
    expect(new Date(history[0].at).getTime()).toBeGreaterThan(0)
  })

  it('卸载：停用 + 删目录 + 清权限记录与私有存储', async () => {
    const { host, runtimes, clearedStorages } = makeHost()
    host.init()
    settings.update((st) => {
      st.enablePlugins = true
    })
    installPlugin('sample', 'exports.activate = () => {}', ['notifications'])
    host.confirmEnable('sample')
    await flush()
    expect(fs.existsSync(path.join(tmp, 'plugins', 'sample'))).toBe(true)

    const r = host.uninstall('sample')
    expect(r.ok).toBe(true)
    await flush()
    expect(fs.existsSync(path.join(tmp, 'plugins', 'sample'))).toBe(false)
    expect(runtimes[0].killed).toBe(true)
    expect(clearedStorages).toEqual(['sample'])
    expect(settings.get().pluginEnabled['sample']).toBeUndefined()
    expect(settings.get().pluginPermissionsConfirmed?.['sample']).toBeUndefined()
    expect(host.discover()).toHaveLength(0)
  })

  it('导入：暂存 → 确认安装（新插件，保持停用）', () => {
    const { host } = makeHost()
    host.init()
    const zipPath = writeZipFor('newplug', 'newplug', '1.0.0', ['notifications'])
    const r = host.beginImport(zipPath)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.isUpgrade).toBe(false)

    const c = host.confirmImport(r.importId)
    expect(c.ok).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'plugins', 'newplug', 'main.js'))).toBe(true)
    // 未启用偏好 → 安装后保持停用
    expect(host.discover()[0].enabled).toBe(false)
  })

  it('导入升级：原启用且权限不变 → 覆盖安装并重新激活', async () => {
    vi.useFakeTimers()
    const { host, runtimes } = makeHost()
    host.init()
    settings.update((st) => {
      st.enablePlugins = true
    })
    installPlugin('upg', 'exports.activate = () => {}', ['notifications'])
    host.confirmEnable('upg')
    await flush()
    expect(host.discover()[0].running).toBe(true)

    const zipPath = writeZipFor('upg-new', 'upg', '2.0.0', ['notifications'])
    const r = host.beginImport(zipPath)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.isUpgrade).toBe(true)

    const c = host.confirmImport(r.importId)
    expect(c.ok).toBe(true)
    expect(c.needsConfirmation).toBeUndefined()
    expect(fs.readFileSync(path.join(tmp, 'plugins', 'upg', 'manifest.json'), 'utf-8')).toContain('2.0.0')
    // 权限未变化 → 自动重新激活
    const info = host.discover()[0]
    expect(info).toMatchObject({ version: '2.0.0', running: true })
    expect(runtimes[0].killed).toBe(true) // 旧进程已被停用终止；最后一个是重新激活的新进程
  })

  it('导入升级：权限变化 → 要求重新确认且开关关闭', async () => {
    vi.useFakeTimers()
    const { host } = makeHost()
    host.init()
    settings.update((st) => {
      st.enablePlugins = true
    })
    installPlugin('chg', 'exports.activate = () => {}', ['notifications'])
    host.confirmEnable('chg')
    await flush()

    const zipPath = writeZipFor('chg-new', 'chg', '2.0.0', ['notifications', 'notes:read'])
    const r = host.beginImport(zipPath)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const c = host.confirmImport(r.importId)
    expect(c.ok).toBe(true)
    expect(c.needsConfirmation).toBe(true)
    expect(c.permissions).toEqual(['notifications', 'notes:read'])
    const info = host.discover()[0]
    expect(info.enabled).toBe(false)
    expect(info.permissionsConfirmed).toBe(false)
  })

  it('取消导入清理暂存目录', () => {
    const { host } = makeHost()
    host.init()
    const zipPath = writeZipFor('cancelme', 'cancelme', '1.0.0', [])
    const r = host.beginImport(zipPath)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    host.cancelImport(r.importId)
    expect(fs.existsSync(path.join(tmp, 'staging'))).toBe(true) // 目录本身在，暂存内容已清
    const leftovers = fs
      .readdirSync(path.join(tmp, 'staging'))
      .filter((n) => n.startsWith('cancelme'))
    expect(leftovers).toHaveLength(0)
  })
})

describe('PluginHost v2 · M3 声明式贡献点', () => {
  it('editor:toolbar：声明权限且命令已注册时，discover 返回工具栏按钮并广播', async () => {
    const { host, toolbarBroadcasts } = makeHost()
    host.init()
    settings.update((st) => {
      st.enablePlugins = true
    })
    installPlugin(
      'sample',
      `exports.activate = (ctx) => {
         ctx.registerCommand({ id: 'stats', title: '统计', handler: () => {} })
       }`,
      ['editor:toolbar'],
      { contributions: { toolbar: [{ icon: '∑', title: '统计字数', command: 'stats' }] } }
    )
    host.confirmEnable('sample')
    await flush()

    const info = host.discover()[0]
    expect(info.toolbar).toEqual([{ icon: '∑', title: '统计字数', command: 'sample.stats', pluginId: 'sample' }])
    // 至少一次广播包含该按钮
    expect(toolbarBroadcasts.some((items) => items.some((t) => t.command === 'sample.stats'))).toBe(true)
  })

  it('未声明 editor:toolbar 权限或命令不存在时不出按钮', async () => {
    const { host } = makeHost()
    host.init()
    settings.update((st) => {
      st.enablePlugins = true
    })
    // 有命令但无权限
    installPlugin(
      'a',
      `exports.activate = (ctx) => { ctx.registerCommand({ id: 'x', title: 'x', handler: () => {} }) }`,
      [],
      { contributions: { toolbar: [{ icon: 'A', title: 'A', command: 'x' }] } }
    )
    host.confirmEnable('a')
    await flush()
    expect(host.discover().find((p) => p.id === 'a')?.toolbar).toEqual([])

    // 有权限但命令未注册
    installPlugin('b', 'exports.activate = () => {}', ['editor:toolbar'], {
      contributions: { toolbar: [{ icon: 'B', title: 'B', command: 'ghost' }] }
    })
    host.confirmEnable('b')
    await flush()
    expect(host.discover().find((p) => p.id === 'b')?.toolbar).toEqual([])
  })

  it('插件停止后工具栏按钮消失（广播为空）', async () => {
    vi.useFakeTimers()
    const { host, toolbarBroadcasts } = makeHost()
    host.init()
    settings.update((st) => {
      st.enablePlugins = true
    })
    installPlugin(
      'sample',
      `exports.activate = (ctx) => { ctx.registerCommand({ id: 'x', title: 'x', handler: () => {} }) }`,
      ['editor:toolbar'],
      { contributions: { toolbar: [{ icon: 'X', title: 'X', command: 'x' }] } }
    )
    host.confirmEnable('sample')
    await flush()
    expect(host.discover()[0].toolbar).toHaveLength(1)

    host.setEnabled('sample', false)
    await flush()
    expect(host.discover()[0].toolbar).toEqual([])
    const last = toolbarBroadcasts[toolbarBroadcasts.length - 1]
    expect(last).toEqual([])
  })
})

describe('PluginHost v2 · 事件广播', () => {
  function activateWithEvents(): { host: PluginHost; rt: FakeRuntime } {
    const { host, runtimes } = makeHost()
    host.init()
    settings.update((s) => {
      s.enablePlugins = true
    })
    installPlugin('sample', 'exports.activate = () => {}', ['events'])
    host.confirmEnable('sample')
    return { host, rt: runtimes[0] }
  }

  it('向声明 events 权限的插件广播事件', async () => {
    const { host, rt } = activateWithEvents()
    await flush()
    host.emitEvent('note:saved', { vault: 'v', path: 'a.md' })
    expect(rt.events).toEqual([{ t: 'event', event: 'note:saved', payload: { vault: 'v', path: 'a.md' } }])
  })

  it('未声明 events 权限的插件收不到事件', async () => {
    const { host, runtimes } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = () => {}')
    host.setEnabled('sample', true)
    await flush()
    host.emitEvent('note:saved', { vault: 'v', path: 'a.md' })
    expect(runtimes[0].events).toHaveLength(0)
  })

  it('vault:changed 高频事件合并为一条（保留最新 payload）', async () => {
    vi.useFakeTimers()
    const { host, rt } = activateWithEvents()
    await flush()
    host.emitEvent('vault:changed', { vault: 'v', round: 1 })
    host.emitEvent('vault:changed', { vault: 'v', round: 2 })
    host.emitEvent('vault:changed', { vault: 'v', round: 3 })
    expect(rt.events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(350)
    expect(rt.events).toHaveLength(1)
    expect(rt.events[0].payload).toEqual({ vault: 'v', round: 3 })
  })

  it('停用后不再收到事件', async () => {
    const { host, rt } = activateWithEvents()
    await flush()
    host.setEnabled('sample', false)
    await flush()
    host.emitEvent('note:saved', { vault: 'v', path: 'a.md' })
    expect(rt.events).toHaveLength(0)
  })
})

describe('PluginHost v2 · 发现与清单', () => {
  it('无效 manifest 的目录被跳过', () => {
    const { host } = makeHost()
    host.init()
    const bad = path.join(tmp, 'plugins', 'bad')
    fs.mkdirSync(bad, { recursive: true })
    fs.writeFileSync(path.join(bad, 'manifest.json'), 'not json')
    expect(host.discover()).toHaveLength(0)
  })

  it('缺 main 的清单插件标记为已加载但不启动进程', async () => {
    const { host, runtimes } = makeHost()
    host.init()
    installPlugin('sample', 'exports.activate = () => {}', [], { main: undefined })
    const r = host.setEnabled('sample', true)
    expect(r.ok).toBe(true)
    await flush()
    expect(runtimes).toHaveLength(0)
    expect(host.discover()[0].running).toBe(false)
    expect(host.discover()[0].error).toBeNull()
  })
})
