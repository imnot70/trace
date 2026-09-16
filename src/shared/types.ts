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

/** git 可用性检测结果（FR-2.8.13，触发同步/关联时检测） */
export interface GitAvailability {
  /** 系统 PATH 中是否有可用的 git */
  systemGit: boolean
  /** 打包产物中是否内置了 git（开发模式恒为 false） */
  bundledGit: boolean
  /** 系统 git 版本号；不可用时为 null */
  systemVersion: string | null
  /** 内置 git 版本号；未内置或不可执行时为 null */
  bundledVersion: string | null
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

export interface NoteInfo {
  birthtime: string
  mtime: string
}

export interface TagItem {
  id: string
  name: string
  color: string
  createdAt: string
}

export interface NoteTagEntry {
  vault: string
  path: string
  tagId: string
}

export type ThemeOption = 'light' | 'dark' | 'system'

export interface AppSettings {
  workspaceRoot: string
  theme: ThemeOption
  themePreset: string
  editorFontSize: number
  autoSave: boolean
  /** 专注模式下隐藏顶部信息栏（面包屑 / Git 状态 / 视图开关，悬停编辑卡顶部可临时显示） */
  zenHideTopbar: boolean
  /** 图片附件保存目录（相对库根，支持多级，如 media/image） */
  attachmentsDir: string
  /** Git 同步的 HTTP/HTTPS 代理（如 http://127.0.0.1:7890 或含凭据 http://user:pass@host:port），空 = 不使用 */
  proxyUrl: string
  /** 回收站保留天数（超过自动清理；0 = 永不清理） */
  trashRetentionDays: number
  /** 回收站容量上限（条目数），0 = 不限 */
  trashMaxEntries: number
  /** 自动同步模式：off 关闭 / interval 定时 / change 变更触发（FR-2.8.14） */
  autoSyncMode: 'off' | 'interval' | 'change'
  /** 定时模式下的同步间隔（分钟） */
  autoSyncIntervalMin: number
  enablePlugins: boolean
  /** 插件 id -> 是否启用 */
  pluginEnabled: Record<string, boolean>
  /** Git 来源偏好：null = 未选择（首次触发时检测并弹窗），'system' = 使用系统 Git，'bundled' = 使用内置 Git */
  gitSource: 'system' | 'bundled' | null
  /** 窗口玻璃效果：auto 根据平台自动选择，none 关闭，mica Windows 11 Mica，acrylic Windows Acrylic，vibrancy macOS 毛玻璃 */
  windowGlassEffect: 'auto' | 'none' | 'mica' | 'acrylic' | 'vibrancy'
  /** 窗口透明度 50-100，50 半透明，100 完全不透明（下限 50 保证界面可读） */
  windowOpacity: number
}

/** 自定义主题包：一组 CSS 变量覆盖（light/dark 两套），存 userData/themes/<id>.json */
export interface ThemePackage {
  id: string
  name: string
  light: Record<string, string>
  dark: Record<string, string>
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

/** 冲突文件内容（三方对比） */
export interface ConflictContent {
  /** 本地版本（ours） */
  ours: string
  /** 远端版本（theirs） */
  theirs: string
  /** 共同祖先版本（base） */
  base: string
  /** 当前工作区内容（可能包含冲突标记） */
  current: string
}

/** 冲突解决方式 */
export type ConflictResolution =
  | { type: 'ours' } // 接受本地版本
  | { type: 'theirs' } // 接受远端版本
  | { type: 'manual'; content: string } // 手动编辑的内容

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

/** 主进程 -> 渲染进程：批量导出进度 */
export interface ExportProgress {
  done: number
  total: number
  current: string
  ok: boolean
}

/** 主进程 -> 渲染进程：git 同步过程事件 */
export interface GitEventPayload {
  vault: string
  phase: 'start' | 'pull' | 'commit' | 'push' | 'done' | 'error'
  message?: string
}

/** 搜索结果项 */
export interface SearchResultItem {
  /** 笔记库名称 */
  vault: string
  /** 笔记相对路径 */
  path: string
  /** 笔记标题（不含 .md） */
  title: string
  /** 匹配的文本片段 */
  snippet: string
  /** 匹配分数（越高越相关） */
  score: number
  /** 匹配位置（行号） */
  lineNumber: number
  /** 匹配的关键词 */
  keyword: string
}

/** 搜索结果 */
export interface SearchResult {
  /** 是否成功 */
  ok: boolean
  /** 错误信息 */
  error?: string
  /** 搜索结果列表 */
  results?: SearchResultItem[]
  /** 搜索耗时（毫秒） */
  durationMs?: number
  /** 总匹配数 */
  totalMatches?: number
}
