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
  /** 插件 id -> 已确认的权限集合（manifest 权限集合变化后需重新确认；确认记录按插件 id 存应用数据目录） */
  pluginPermissionsConfirmed?: Record<string, string[]>
  /** Git 来源偏好：null = 未选择（首次触发时检测并弹窗），'system' = 使用系统 Git，'bundled' = 使用内置 Git */
  gitSource: 'system' | 'bundled' | null
  /** 窗口玻璃效果：auto 根据平台自动选择，none 关闭，mica Windows 11 Mica，acrylic Windows Acrylic，vibrancy macOS 毛玻璃 */
  windowGlassEffect: 'auto' | 'none' | 'mica' | 'acrylic' | 'vibrancy'
  /** 窗口不透明度 50-100，50 半透明，100 完全不透明（下限 50 保证界面可读） */
  windowOpacity: number
  /** 侧栏菜单分区显示开关（「笔记库」分区始终显示，不在开关之列） */
  sidebarMenus: {
    /** 常用 */
    recents: boolean
    /** 收藏 */
    favorites: boolean
    /** 标签 */
    tags: boolean
    /** 断链引用 */
    unresolved: boolean
    /** 回收站 */
    trash: boolean
  }
  /** 编辑区右下角反向链接入口（「断链引用」的子开关） */
  showBacklinks: boolean
  /** 默认编辑模式：source 源码模式 / wysiwyg 所见即所得（Live Preview，FR-W1） */
  defaultEditMode: 'source' | 'wysiwyg'
  /** 打字机模式：off 关闭 / center 高位（光标垂直居中）/ bottom 低位（光标锚定在距底边 20% 处） */
  typewriterMode: 'off' | 'center' | 'bottom'
  /** 心流模式的写作栏宽：窄 32em / 中 42em / 宽 52em（仅心流模式内生效） */
  flowLineWidth: 'narrow' | 'medium' | 'wide'
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

/** 插件声明并经用户确认的能力域（权限标识见 plugin-design.md 第 4 节） */
export type PluginPermission = 'notifications' | 'notes:read' | 'notes:write' | 'events'

/** 插件已注册的命令（ctx.registerCommand；运行中才有内容） */
export interface PluginCommandInfo {
  /** 完整命令 id：`<插件id>.<命令id>` */
  id: string
  title: string
}

/** 编辑器工具栏按钮贡献（editor:toolbar 权限；声明式，插件不碰 DOM） */
export interface PluginToolbarContribution {
  /** 按钮显示文本（1-4 个字符的 emoji / 文本） */
  icon: string
  /** 悬停提示 */
  title: string
  /** 点击触发的完整命令 id：`<插件id>.<命令id>` */
  command: string
  /** 贡献该按钮的插件 id（渲染展示用） */
  pluginId: string
}

/** 侧栏底部状态区一条文字（ui:status 权限，每插件一条） */
export interface PluginStatusEntry {
  id: string
  text: string
}

/** 市场索引中的插件版本条目（trace-plugins.json） */
export interface MarketVersion {
  releaseTag: string
  asset: string
  sha256: string
  permissions: string[]
  releasedAt: string
}

/** 市场索引中的插件条目 */
export interface MarketPlugin {
  id: string
  name: string
  description: string
  author: string
  repo: string
  latest: string
  versions: Record<string, MarketVersion>
}

/** 市场索引 */
export interface MarketIndex {
  schemaVersion: number
  plugins: MarketPlugin[]
}

/** 可更新的市场插件 */
export interface MarketUpdateInfo {
  id: string
  name: string
  repo: string
  currentVersion: string
  latestVersion: string
}

/** 市场安装来源登记（userData/market-installed.json；随卸载清除） */
export interface MarketInstalledRecord {
  repo: string
  version: string
  sha256: string
}

/** 插件崩溃记录（本轮启用期内，最近在前，最多 10 条） */
export interface PluginCrashRecord {
  /** ISO 时间 */
  at: string
  /** 进程退出码 */
  code: number
}

/** .trace-plugin 导入预览（安装管线：解压校验后、用户确认前） */
export interface PluginImportPreview {
  importId: string
  id: string
  name: string
  version: string
  description: string
  permissions: string[]
  /** 目标位置已存在同 id 插件（本次导入为升级覆盖） */
  isUpgrade: boolean
}

/** 插件详情（设置页详情弹层） */
export interface PluginDetail {
  info: PluginInfo
  /** 崩溃历史（最近在前） */
  crashes: PluginCrashRecord[]
  /** 主进程日志中该插件最近的输出行 */
  logs: string[]
  /** 私有存储占用字节数 */
  storageBytes: number
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  /** manifest 声明的权限集合 */
  permissions: string[]
  /** 已确认的权限是否覆盖当前声明（false 时启用会要求重新确认） */
  permissionsConfirmed: boolean
  enabled: boolean
  /** 插件进程存活（utilityProcess 运行中） */
  running: boolean
  error: string | null
  /** 本轮启用期内连续崩溃次数（守护重启成功后保留计数供展示） */
  crashCount: number
  /** 崩溃历史（最近在前，最多 10 条） */
  crashHistory: PluginCrashRecord[]
  /** 已注册的命令 */
  commands: PluginCommandInfo[]
  /** 编辑器工具栏按钮（运行中且声明 editor:toolbar 权限时非空） */
  toolbar: PluginToolbarContribution[]
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

/** 反向链接引用条目 */
export interface BacklinkRef {
  /** 来源笔记所在库 */
  vault: string
  /** 来源笔记相对路径 */
  path: string
  /** 来源笔记标题 */
  title: string
  /** 引用所在行号 */
  line: number
  /** 引用所在行的文本片段 */
  snippet: string
  /** 引用的目标笔记名 */
  targetName: string
}
