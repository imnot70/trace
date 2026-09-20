import { MAX_NOTE_CONTENT_CHARS } from '../plugin-runtime/protocol'

/**
 * 能力网关：插件 ctx 调用按 manifest.permissions 过滤后转发真实服务。
 * 纯函数实现（无 electron 依赖），便于做权限过滤矩阵单元测试。
 *
 * 权限模型（D3 全局授权，plugin-design.md 第 4 节）：
 * - notifications / notes:read / notes:write / events 需 manifest 声明
 * - logger 与命令注册内置开放，不走权限
 */

export interface GatewayServices {
  /** 全部笔记库名称（notes.vaults / 兜底校验 vault 参数） */
  listVaultNames: () => string[]
  /** 库名 -> 磁盘路径；未知库返回 null */
  vaultPath: (vault: string) => string | null
  listTree: (vault: string) => unknown
  readNote: (vault: string, relPath: string) => { ok: true; content: string; hash: string } | { ok: false; error: string }
  writeNote: (vault: string, relPath: string, content: string, expectedHash: string | null) => { ok: boolean; error?: string; hash?: string }
  createNote: (vault: string, parentPath: string, name: string, content?: string) => { ok: boolean; error?: string; path?: string }
  /** 用户通知（编辑界面右上角提示） */
  notifyUser: (message: string) => void
  /** 结构化日志（脱敏由 lib/logger 统一处理） */
  log: (level: 'info' | 'warn' | 'error', pluginId: string, args: unknown[]) => void
}

/** 需要声明权限的能力域 -> 对应 permission 标识 */
export const PERMISSION_REQUIRED: Record<string, string> = {
  notifications: 'notifications',
  'notes:read': 'notes:read',
  'notes:write': 'notes:write'
}

export interface GatewayCall {
  domain: string
  method: string
  args: unknown[]
}

export interface GatewayResult {
  /** false = 致命错误（权限违规 / 未知能力域），bridge 侧 reject */
  ok: boolean
  /** 业务结果对象（{ ok, ... } 风格），仅在 ok=true 时有值 */
  result?: unknown
  error?: string
}

function fail(error: string): GatewayResult {
  return { ok: false, error }
}

/** 业务失败：RPC 层成功，业务对象 { ok:false, error } 交给插件判断 */
function businessFail(error: string): GatewayResult {
  return { ok: true, result: { ok: false, error } }
}

/** 校验库参数；非法或未知库返回错误文案，合法返回 null */
function vaultError(services: GatewayServices, vault: unknown): string | null {
  if (typeof vault !== 'string' || vault.length === 0) return '缺少笔记库参数'
  if (!services.vaultPath(vault)) return `笔记库不存在：${vault}`
  return null
}

function contentOf(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** 单次调用的内容大小上限（字符），防止单插件拖垮 IPC */
function checkContentSize(content: string | null): GatewayResult | null {
  if (content !== null && content.length > MAX_NOTE_CONTENT_CHARS) {
    return fail(`内容超出单次调用上限（${MAX_NOTE_CONTENT_CHARS} 字符）`)
  }
  return null
}

/**
 * 分发一次插件能力调用。任何未知域 / 未声明权限 / 非法参数都以
 * `{ ok: false, error }` 返回（bridge 侧转为 reject），绝不抛出。
 */
export function dispatchCapabilityCall(call: GatewayCall, permissions: ReadonlySet<string>, services: GatewayServices, pluginId: string): GatewayResult {
  const { domain, method } = call

  // 内置能力：日志（不暴露任何敏感信息，参数进 logger 前会被脱敏）
  if (domain === 'logger') {
    const level = method === 'warn' || method === 'error' ? method : 'info'
    services.log(level, pluginId, call.args)
    return { ok: true, result: null }
  }

  const required = PERMISSION_REQUIRED[domain]
  if (!required) return fail(`未知能力域：${domain}`)
  if (!permissions.has(required)) {
    return fail(`插件未声明权限「${required}」，已拒绝调用 ${domain}.${method}`)
  }

  try {
    switch (domain) {
      case 'notifications': {
        if (method !== 'notify') return fail(`未知方法：${domain}.${method}`)
        const message = contentOf(call.args[0])
        if (message === null || message.length === 0) return businessFail('通知内容不能为空')
        if (message.length > 500) return businessFail('通知内容过长（上限 500 字符）')
        services.notifyUser(message)
        return { ok: true, result: { ok: true } }
      }

      case 'notes:read': {
        if (method === 'vaults') {
          return { ok: true, result: { ok: true, vaults: services.listVaultNames() } }
        }
        if (method === 'list' || method === 'tree') {
          const vErr = vaultError(services, call.args[0])
          if (vErr) return businessFail(vErr)
          return { ok: true, result: { ok: true, tree: services.listTree(String(call.args[0])) } }
        }
        if (method === 'read') {
          const vErr = vaultError(services, call.args[0])
          if (vErr) return businessFail(vErr)
          const relPath = call.args[1]
          if (typeof relPath !== 'string' || relPath.length === 0) return businessFail('缺少笔记路径参数')
          const r = services.readNote(String(call.args[0]), relPath)
          if (!r.ok) return businessFail(r.error)
          const oversize = checkContentSize(r.content)
          if (oversize) return businessFail(oversize.error ?? '内容超限')
          return { ok: true, result: { ok: true, content: r.content, hash: r.hash } }
        }
        return fail(`未知方法：${domain}.${method}`)
      }

      case 'notes:write': {
        const vault = call.args[0]
        const vErr = vaultError(services, vault)
        if (vErr) return businessFail(vErr)
        const vaultName = String(vault)

        if (method === 'write') {
          const relPath = call.args[1]
          const content = contentOf(call.args[2])
          if (typeof relPath !== 'string' || relPath.length === 0) return businessFail('缺少笔记路径参数')
          if (content === null) return businessFail('笔记内容必须是字符串')
          const oversize = checkContentSize(content)
          if (oversize) return businessFail(oversize.error ?? '内容超限')
          const opts = call.args[3]
          const expectedHash =
            opts && typeof opts === 'object' && 'expectedHash' in opts && typeof (opts as { expectedHash?: unknown }).expectedHash === 'string'
              ? (opts as { expectedHash: string }).expectedHash
              : null
          const r = services.writeNote(vaultName, relPath, content, expectedHash)
          return r.ok
            ? { ok: true, result: { ok: true, hash: r.hash } }
            : businessFail(r.error ?? '写入失败')
        }

        if (method === 'create') {
          const parentPath = call.args[1]
          const name = call.args[2]
          const content = call.args.length >= 4 ? contentOf(call.args[3]) : ''
          if (typeof parentPath !== 'string') return businessFail('父文件夹参数必须是字符串')
          if (typeof name !== 'string' || name.length === 0) return businessFail('缺少笔记名参数')
          const oversize = content === null ? null : checkContentSize(content)
          if (oversize) return businessFail(oversize.error ?? '内容超限')
          const r = services.createNote(vaultName, parentPath, name, content ?? undefined)
          return r.ok
            ? { ok: true, result: { ok: true, path: r.path } }
            : businessFail(r.error ?? '创建失败')
        }

        return fail(`未知方法：${domain}.${method}`)
      }

      default:
        return fail(`未知能力域：${domain}`)
    }
  } catch (e) {
    // 服务层意外异常按业务失败交给插件（不影响进程存活）
    return businessFail(e instanceof Error ? e.message : String(e))
  }
}
