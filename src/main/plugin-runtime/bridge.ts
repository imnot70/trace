/**
 * 插件进程桥接脚本（utilityProcess 入口）：
 * - 接收宿主 'activate'，以受限 require（requireGuard）加载插件入口并调用 activate(ctx)
 * - ctx 的每个方法代理为 rpc-call 消息 -> 主进程能力网关 -> 按权限过滤后转发真实服务
 * - 对插件作者保持简单：看到的仍是 exports.activate(ctx)，感觉不到 RPC
 *
 * 一个插件进程只运行一个插件；本脚本不依赖 electron（纯 Node + process.parentPort）。
 */
import path from 'node:path'
import Module from 'node:module'
import {
  COMMAND_TIMEOUT_MS,
  MAX_NOTE_CONTENT_CHARS,
  RPC_TIMEOUT_MS,
  isPluginEventName
} from './protocol'
import { guardedRequire } from './requireGuard'
import type { HostToPlugin, PluginToHost } from './protocol'

// ---------- utility process 消息通道 ----------

interface ParentPort {
  on(event: 'message', cb: (e: { data: HostToPlugin }) => void): void
  postMessage(value: PluginToHost): void
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort

function send(message: PluginToHost): void {
  parentPort.postMessage(message)
}

// ---------- 插件目录（fork 时以 cwd/argv 传入） ----------

const pluginIdArg = process.argv.find((a) => a.startsWith('--plugin-id='))
const pluginDirArg = process.argv.find((a) => a.startsWith('--plugin-dir='))
const PLUGIN_ID = pluginIdArg ? pluginIdArg.slice('--plugin-id='.length) : 'unknown'
const PLUGIN_DIR = pluginDirArg ? path.resolve(pluginDirArg.slice('--plugin-dir='.length)) : process.cwd()

// ---------- RPC ----------

let rpcSeq = 0
const pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function rpcCall(domain: string, method: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++rpcSeq
    const timer = setTimeout(() => {
      pendingRpc.delete(id)
      reject(new Error(`能力调用超时（${RPC_TIMEOUT_MS}ms）：${domain}.${method}`))
    }, RPC_TIMEOUT_MS)
    pendingRpc.set(id, { resolve, reject, timer })
    send({ t: 'rpc-call', id, domain, method, args })
  })
}

async function rpcCallSized(domain: string, method: string, args: unknown[]): Promise<unknown> {
  for (const a of args) {
    if (typeof a === 'string' && a.length > MAX_NOTE_CONTENT_CHARS) {
      throw new Error(`内容超出单次调用上限（${MAX_NOTE_CONTENT_CHARS} 字符）`)
    }
  }
  const result = await rpcCall(domain, method, args)
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content?: unknown }).content
    if (typeof content === 'string' && content.length > MAX_NOTE_CONTENT_CHARS) {
      throw new Error(`返回内容超出单次调用上限（${MAX_NOTE_CONTENT_CHARS} 字符）`)
    }
  }
  return result
}

// ---------- 事件与命令注册表 ----------

const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()
const commandHandlers = new Map<string, { title: string; handler: (...args: unknown[]) => unknown }>()

/** 合法命令 id：字母数字连字符下划线（拼接完整 id：<插件id>.<命令id>） */
function sanitizeCommandId(id: string): string {
  const clean = String(id).replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${PLUGIN_ID}.${clean}`
}

// ---------- ctx 构造 ----------

function buildContext(): Record<string, unknown> {
  const logger = {
    info: (...args: unknown[]) => void rpcCall('logger', 'info', args).catch(() => {}),
    warn: (...args: unknown[]) => void rpcCall('logger', 'warn', args).catch(() => {}),
    error: (...args: unknown[]) => void rpcCall('logger', 'error', args).catch(() => {})
  }
  return {
    notify: (message: string) => rpcCall('notifications', 'notify', [String(message)]),
    logger,
    notes: {
      vaults: () => rpcCallSized('notes:read', 'vaults', []),
      list: (vault: string) => rpcCallSized('notes:read', 'list', [vault]),
      tree: (vault: string) => rpcCallSized('notes:read', 'tree', [vault]),
      read: (vault: string, relPath: string) => rpcCallSized('notes:read', 'read', [vault, relPath]),
      write: (vault: string, relPath: string, content: string, opts?: { expectedHash?: string | null }) =>
        rpcCallSized('notes:write', 'write', [vault, relPath, content, opts]),
      create: (vault: string, parentPath: string, name: string, content?: string) =>
        rpcCallSized('notes:write', 'create', [vault, parentPath, name, content])
    },
    storage: {
      get: (key: string) => rpcCall('storage', 'get', [String(key)]),
      set: (key: string, value: unknown) => rpcCallSized('storage', 'set', [String(key), value]),
      delete: (key: string) => rpcCall('storage', 'delete', [String(key)]),
      keys: () => rpcCall('storage', 'keys', [])
    },
    on: (event: string, handler: (payload: unknown) => void) => {
      if (!isPluginEventName(event) || typeof handler !== 'function') {
        throw new Error(`无效的事件订阅：${String(event)}`)
      }
      let set = eventHandlers.get(event)
      if (!set) {
        set = new Set()
        eventHandlers.set(event, set)
      }
      set.add(handler)
    },
    off: (event: string, handler: (payload: unknown) => void) => {
      eventHandlers.get(event)?.delete(handler)
    },
    registerCommand: (cmd: { id: string; title: string; handler: (...args: unknown[]) => unknown }) => {
      if (!cmd || typeof cmd.handler !== 'function') {
        throw new Error('registerCommand 需要 { id, title, handler }')
      }
      const fullId = sanitizeCommandId(cmd.id)
      commandHandlers.set(fullId, { title: String(cmd.title ?? fullId), handler: cmd.handler })
      return fullId
    }
  }
}

// ---------- 受限 require ----------

let guardInstalled = false

/** Module._load 是 Node 未公开 API，@types/node 未声明，这里做最小类型化 */
type ModuleLoad = (request: string, parent?: Module | null, isMain?: boolean) => unknown
function getModuleLoad(): ModuleLoad {
  return (Module as unknown as { _load: ModuleLoad })._load
}
function setModuleLoad(fn: ModuleLoad): void {
  ;(Module as unknown as { _load: ModuleLoad })._load = fn
}

/** 把 Module._load 替换为白名单守卫（仅影响此后本进程内的 require） */
function installRequireGuard(): void {
  if (guardInstalled) return
  guardInstalled = true
  const originalLoad = getModuleLoad()
  setModuleLoad(function patchedLoad(request, parent, isMain) {
    const parentDir = parent && parent.filename ? path.dirname(parent.filename) : PLUGIN_DIR
    return guardedRequire(request, parentDir, PLUGIN_DIR, (resolved) =>
      originalLoad.call(Module, resolved, parent, isMain)
    )
  })
}

// ---------- 消息处理 ----------

let deactivateFn: (() => void) | null = null

async function handleActivate(msg: Extract<HostToPlugin, { t: 'activate' }>): Promise<void> {
  commandHandlers.clear()
  eventHandlers.clear()
  try {
    installRequireGuard()
    const entry = path.resolve(PLUGIN_DIR, msg.entry || msg.manifest.main || 'main.js')
    const mod = getModuleLoad()(entry, null, false) as {
      activate?: (ctx: Record<string, unknown>) => void | (() => void)
    }
    if (typeof mod?.activate !== 'function') {
      throw new Error('入口未导出 activate(ctx)')
    }
    const ret = mod.activate(buildContext())
    deactivateFn = typeof ret === 'function' ? ret : null
    send({
      t: 'activated',
      commands: [...commandHandlers.entries()].map(([id, c]) => ({ id, title: c.title }))
    })
  } catch (e) {
    send({ t: 'activate-error', error: e instanceof Error ? e.message : String(e) })
  }
}

function handleDeactivate(): void {
  try {
    deactivateFn?.()
  } catch (e) {
    // 停用失败不影响流程：宿主有超时强杀兜底
    console.error('[plugin-bridge] deactivate 抛错', e)
  }
  deactivateFn = null
  send({ t: 'deactivated' })
}

async function handleInvokeCommand(msg: Extract<HostToPlugin, { t: 'invoke-command' }>): Promise<void> {
  const cmd = commandHandlers.get(msg.commandId)
  if (!cmd) {
    send({ t: 'command-result', id: msg.id, ok: false, error: `命令不存在：${msg.commandId}` })
    return
  }
  try {
    await Promise.race([
      Promise.resolve(cmd.handler(...msg.args)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`命令执行超时（${COMMAND_TIMEOUT_MS}ms）`)), COMMAND_TIMEOUT_MS))
    ])
    send({ t: 'command-result', id: msg.id, ok: true })
  } catch (e) {
    send({ t: 'command-result', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

parentPort.on('message', (e) => {
  const msg = e.data
  switch (msg.t) {
    case 'activate':
      void handleActivate(msg)
      break
    case 'deactivate':
      handleDeactivate()
      break
    case 'rpc-result': {
      const p = pendingRpc.get(msg.id)
      if (!p) return
      clearTimeout(p.timer)
      pendingRpc.delete(msg.id)
      // 权限违规 / 未知能力域 → reject（设计：未声明能力直接抛错）；
      // 业务失败（重名、冲突等）→ resolve { ok:false, error } 由插件判断
      if (msg.fatal) p.reject(new Error(msg.error ?? '能力调用失败'))
      else p.resolve(msg.result)
      break
    }
    case 'event': {
      const set = eventHandlers.get(msg.event)
      if (!set) return
      for (const handler of set) {
        try {
          handler(msg.payload)
        } catch (err) {
          // 插件事件处理器抛错不影响其他处理器与进程存活
          console.error('[plugin-bridge] 事件处理器抛错', err)
        }
      }
      break
    }
    case 'invoke-command':
      void handleInvokeCommand(msg)
      break
  }
})
