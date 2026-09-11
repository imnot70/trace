/** 仓库树节点 */
export interface TreeNode {
  /** 显示名（笔记不含 .md 后缀） */
  name: string
  /** 相对笔记库根目录的路径，目录不含尾部斜杠；笔记库根为 '' */
  path: string
  kind: 'dir' | 'note'
  children?: TreeNode[]
}

export type ItemKind = 'vault' | 'dir' | 'note'

/** 笔记库的 git 状态（未关联时为 null） */
export interface GitStatus {
  associated: boolean
  /** 形如 owner/repo */
  repoFullName: string | null
  remoteUrl: string | null
  branch: string | null
  ahead: number
  behind: number
  dirty: boolean
}

export interface VaultInfo {
  name: string
  path: string
  git: GitStatus | null
  /** 库描述（可选，应用级元数据，存 userData 不进库目录） */
  description?: string
}

export interface TrashEntry {
  id: string
  /** 显示名（笔记不含 .md） */
  name: string
  /** 回收站内的实际文件/目录名 */
  item: string
  kind: ItemKind
  /** 来源笔记库（删除库时即库自身名字） */
  vault: string
  /** 库内相对路径；删除整个库时为 '' */
  path: string
  deletedAt: string
}

export interface FavoriteItem {
  id: string
  vault: string
  path: string
  name: string
  addedAt: string
}

export interface RecentItem {
  vault: string
  path: string
  name: string
  openedAt: string
}

export type ThemeOption = 'light' | 'dark' | 'system'

export interface AppSettings {
  workspaceRoot: string
  theme: ThemeOption
  editorFontSize: number
  autoSave: boolean
  /** 专注模式下隐藏顶部信息栏（面包屑 / Git 状态 / 视图开关，悬停编辑卡顶部可临时显示） */
  zenHideTopbar: boolean
  /** 图片附件保存目录（相对库根，支持多级，如 media/image） */
  attachmentsDir: string
  /** Git 同步的 HTTP/HTTPS 代理（如 http://127.0.0.1:7890 或含凭据 http://user:pass@host:port），空 = 不使用 */
  proxyUrl: string
  enablePlugins: boolean
  /** 插件 id -> 是否启用 */
  pluginEnabled: Record<string, boolean>
  /** Git 来源偏好：null = 未选择（首次触发时检测并弹窗），'system' = 使用系统 Git，'bundled' = 使用内置 Git */
  gitSource: 'system' | 'bundled' | null
}

export interface AccountInfo {
  loggedIn: boolean
  username: string | null
}

export interface RemoteRepo {
  fullName: string
  description: string | null
  private: boolean
  updatedAt: string
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  loaded: boolean
  error: string | null
}

export interface OpResult {
  ok: boolean
  error?: string
}

export interface SyncResult extends OpResult {
  conflicts?: string[]
}

export interface NoteContent {
  ok: boolean
  error?: string
  content?: string
  /** 磁盘内容 hash，保存时回传用于外部修改检测 */
  hash?: string
}

export interface SaveImageResult extends OpResult {
  /** 相对当前笔记所在目录的引用路径（POSIX 风格） */
  reference?: string
}

/** 主进程 -> 渲染进程：文件变更（聚合） */
export interface FsChangedPayload {
  vault: string
  /** 变更文件相对库根的路径列表 */
  paths: string[]
}

/** 主进程 -> 渲染进程：git 同步过程事件 */
export interface GitEventPayload {
  vault: string
  phase: 'start' | 'pull' | 'commit' | 'push' | 'done' | 'error'
  message?: string
}
