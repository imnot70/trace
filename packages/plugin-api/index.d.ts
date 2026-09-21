/**
 * Trace（笔迹）插件 API 类型定义
 *
 * 用法：
 *   npm install -D trace-plugin-api
 *   // 在插件入口文件中：
 *   import type { PluginContext } from 'trace-plugin-api'
 *   export function activate(ctx: PluginContext): void { ... }
 *
 * 能力与权限对照（manifest.json 的 permissions 字段）：
 *   notifications   → ctx.notify
 *   notes:read      → ctx.notes.vaults / list / tree / read
 *   notes:write     → ctx.notes.create / write
 *   events          → ctx.on / ctx.off
 *   editor:toolbar  → manifest.contributions.toolbar（声明式工具栏按钮）
 *   ui:status       → ctx.status.set / clear
 *   settings:persist→ ctx.storage.get / set / delete / keys
 *   （无需声明）     → ctx.logger、ctx.registerCommand
 *
 * 错误约定：
 *   - 权限违规 / 未知能力：Promise reject（编程错误，应修代码）
 *   - 业务失败（重名、不存在、冲突、超限）：resolve 为 { ok: false, error }
 */

/** 业务结果统一形状 */
export interface OpResult {
  ok: boolean
  error?: string
}

/** 笔记树节点（list / tree 返回；name 不含 .md 后缀，path 含） */
export interface TreeNode {
  name: string
  path: string
  kind: 'dir' | 'note'
  children?: TreeNode[]
}

/** 事件名（events 权限） */
export type PluginEventName = 'note:saved' | 'note:opened' | 'vault:changed' | 'sync:done'

export interface NoteSavedPayload {
  vault: string
  path: string
}
export interface NoteOpenedPayload {
  vault: string
  path: string
}
export interface VaultChangedPayload {
  vault: string
  paths: string[]
}
export interface SyncDonePayload {
  vault: string
}

/** 通知（notifications 权限） */
export interface NotifyApi {
  (message: string): Promise<OpResult>
}

/** 日志（内置，无需权限；写入应用日志，前缀「[插件 <id>]」） */
export interface LoggerApi {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** 笔记读写 */
export interface NotesApi {
  /** 全部笔记库名 */
  vaults(): Promise<{ ok: true; vaults: string[] } | OpFail>
  /** 库内完整文件树 */
  list(vault: string): Promise<{ ok: true; tree: TreeNode[] } | OpFail>
  /** list 的别名 */
  tree(vault: string): Promise<{ ok: true; tree: TreeNode[] } | OpFail>
  /** 读取笔记全文；hash 可用于 write 的防覆盖 */
  read(vault: string, path: string): Promise<{ ok: true; content: string; hash: string } | OpFail>
  /** 覆盖写入；opts.expectedHash 传读取时的 hash 可防外部修改冲突 */
  write(
    vault: string,
    path: string,
    content: string,
    opts?: { expectedHash?: string | null }
  ): Promise<{ ok: true; hash: string } | OpFail>
  /** 新建笔记（父文件夹必须已存在）；content 可选初始内容 */
  create(vault: string, parentPath: string, name: string, content?: string): Promise<{ ok: true; path: string } | OpFail>
}

export interface OpFail {
  ok: false
  error: string
}

/** 私有 KV 存储（settings:persist 权限；按插件隔离，随卸载清除） */
export interface StorageApi {
  /** 读取；未设置时 value 为 null */
  get(key: string): Promise<{ ok: true; value: unknown } | OpFail>
  /** 写入；值必须 JSON 可序列化（键 ≤200 字符、单值 ≤256KB、总量 ≤1MB） */
  set(key: string, value: unknown): Promise<OpResult>
  delete(key: string): Promise<OpResult>
  keys(): Promise<{ ok: true; keys: string[] } | OpFail>
}

/** 侧栏底部状态区（ui:status 权限；每插件一行，文字 ≤120 字符） */
export interface StatusApi {
  set(text: string): Promise<OpResult>
  clear(): Promise<OpResult>
}

/** 命令注册（内置）。完整命令 id = `<插件id>.<命令id>` */
export interface CommandSpec {
  id: string
  title: string
  handler: (...args: unknown[]) => unknown
}

/** 插件能力对象（activate 的唯一入参） */
export interface PluginContext {
  /** 向用户显示通知（右上角提示，≤500 字符） */
  notify: NotifyApi
  logger: LoggerApi
  notes: NotesApi
  storage: StorageApi
  status: StatusApi
  /** 订阅事件；事件名或 handler 非法时抛错 */
  on(event: PluginEventName, handler: (payload: unknown) => void): void
  off(event: PluginEventName, handler: (payload: unknown) => void): void
  /** 注册命令，返回完整命令 id；命令超时 10 秒 */
  registerCommand(spec: CommandSpec): string
}

export type DeactivateCallback = () => void

/** 插件入口：exports.activate(ctx) 返回停用回调（可选） */
export type PluginEntrypoint = {
  activate(ctx: PluginContext): void | DeactivateCallback
}

// ---------- manifest 类型（编写 manifest.json / 类型化工具用） ----------

export interface ManifestToolbarItem {
  /** 按钮显示文本（1-4 个字符的 emoji / 文本） */
  icon?: string
  title: string
  /** 触发的命令（插件内短 id 或完整 `<插件id>.<命令id>`） */
  command: string
}

export interface PluginContributions {
  /** 编辑器工具栏按钮（需声明 editor:toolbar 权限） */
  toolbar?: ManifestToolbarItem[]
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  /** 入口文件（CommonJS，相对插件目录） */
  main?: string
  permissions?: Array<
    'notifications' | 'notes:read' | 'notes:write' | 'events' | 'editor:toolbar' | 'ui:status' | 'settings:persist'
  >
  contributions?: PluginContributions
}

/** 可选辅助：类型化地定义插件入口 */
export declare function definePlugin(entrypoint: {
  activate(ctx: PluginContext): void | DeactivateCallback
  deactivate?(): void
}): PluginEntrypoint
