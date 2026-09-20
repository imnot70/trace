import type { PluginManifest } from '../services/pluginManifest'

/**
 * 主进程 <-> 插件进程（utilityProcess）RPC 协议。
 * 双向消息经 MessagePort（主进程 child.postMessage / 插件进程 process.parentPort）传输。
 * 每个插件进程只运行一个插件，协议以「一个激活会话」为单位。
 */

/** 主进程 -> 插件进程 */
export type HostToPlugin =
  /** 激活：加载入口并调用 activate(ctx)；commands 在 activated 回报中声明 */
  | { t: 'activate'; entry: string; manifest: PluginManifest }
  /** 请求停用（插件应回调 deactivated 后自行退出；宿主 5s 超时强杀） */
  | { t: 'deactivate' }
  /**
   * 能力调用（ctx.*）的结果。fatal=true 表示权限违规 / 未知能力域（设计要求直接抛错），
   * bridge 侧转为 reject；其余为业务结果（resolve 为 { ok, ... } 对象，业务失败不 reject）。
   */
  | { t: 'rpc-result'; id: number; ok: boolean; fatal?: boolean; result?: unknown; error?: string }
  /** 事件广播（宿主侧已按权限过滤） */
  | { t: 'event'; event: PluginEventName; payload: unknown }
  /** 调用插件注册的命令 */
  | { t: 'invoke-command'; id: number; commandId: string; args: unknown[] }

/** 插件进程 -> 主进程 */
export type PluginToHost =
  | { t: 'activated'; commands: { id: string; title: string }[] }
  | { t: 'activate-error'; error: string }
  | { t: 'deactivated' }
  /** ctx 能力调用（网关按 manifest.permissions 校验后转发真实服务） */
  | { t: 'rpc-call'; id: number; domain: string; method: string; args: unknown[] }
  | { t: 'command-result'; id: number; ok: boolean; error?: string }

/** Tier 1 事件名（plugin-design.md 第 4 节；bridge 侧白名单一致） */
export const PLUGIN_EVENTS = ['note:saved', 'note:opened', 'vault:changed', 'sync:done'] as const

export type PluginEventName = (typeof PLUGIN_EVENTS)[number]

export function isPluginEventName(v: string): v is PluginEventName {
  return (PLUGIN_EVENTS as readonly string[]).includes(v)
}

/** RPC 单次调用超时（毫秒）——设计第 5 节默认 5s */
export const RPC_TIMEOUT_MS = 5000
/** 命令执行超时（毫秒）：命令常包含笔记读写，放宽到 10s */
export const COMMAND_TIMEOUT_MS = 10000
/** activate 完成等待（毫秒） */
export const ACTIVATE_TIMEOUT_MS = 10000
/** deactivate 宽限（毫秒），超时强杀 */
export const DEACTIVATE_TIMEOUT_MS = 5000
/** RPC 传输的笔记内容上限（字符数，约 4MB UTF-8），防止单插件拖垮 IPC */
export const MAX_NOTE_CONTENT_CHARS = 4_000_000
