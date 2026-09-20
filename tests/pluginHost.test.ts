import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginHost, type RuntimeHandle, type RuntimeSpawner } from '../src/main/services/pluginHost'
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

function makeHost(): { host: PluginHost; runtimes: FakeRuntime[] } {
  const runtimes: FakeRuntime[] = []
  const gateway: GatewayServices = {
    listVaultNames: () => ['vault-a'],
    vaultPath: (name) => (name === 'vault-a' ? path.join(tmp, 'ws', name) : null),
    listTree: () => [],
    readNote: (_v, p) => ({ ok: true, content: `内容-${p}`, hash: 'h1' }),
    writeNote: (_v, p, c) => ({ ok: true, hash: `h2-${p}-${c.length}` }),
    createNote: (_v, pp, n) => ({ ok: true, path: pp ? `${pp}/${n}` : n }),
    notifyUser: (m) => notifications.push(m),
    log: (level, pluginId, args) => logs.push(`${level}:${pluginId}:${args.join(' ')}`)
  }
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
    gateway
  })
  return { host, runtimes }
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
    showBacklinks: true
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
