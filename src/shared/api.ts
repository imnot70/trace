import type {
  AccountInfo,
  AppSettings,
  BacklinkRef,
  ConflictContent,
  ConflictResolution,
  FavoriteItem,
  FsChangedPayload,
  GitAvailability,
  GitEventPayload,
  GitStatus,
  NoteContent,
  NoteInfo,
  NoteTagEntry,
  OpResult,
  PluginInfo,
  RecentItem,
  RemoteRepo,
  SaveImageResult,
  SearchResult,
  SyncResult,
  TagItem,
  ThemePackage,
  TreeNode,
  ExportProgress,
  TrashEntry,
  VaultInfo
} from './types'

/** 渲染进程可用的完整 API（由 preload 通过 contextBridge 注入 window.trace） */
export interface TraceApi {
  // ---- 工作区 ----
  getWorkspace(): Promise<OpResult & { root?: string; defaultRoot?: string }>
  setWorkspace(root: string): Promise<OpResult>
  chooseDirectory(current: string): Promise<string | null>
  getAppVersion(): Promise<OpResult & { version?: string }>

  // ---- 笔记库 ----
  listVaults(): Promise<OpResult & { vaults?: VaultInfo[] }>
  createVault(name: string, description?: string): Promise<OpResult>
  renameVault(oldName: string, newName: string): Promise<OpResult>
  deleteVault(name: string): Promise<OpResult>

  // ---- 目录 / 笔记 ----
  listTree(vault: string): Promise<OpResult & { nodes?: TreeNode[] }>
  createDir(vault: string, parentPath: string, name: string): Promise<OpResult>
  createNote(vault: string, parentPath: string, name: string): Promise<OpResult & { path?: string }>
  renameNode(vault: string, path: string, kind: 'dir' | 'note', newName: string): Promise<OpResult & { newPath?: string }>
  moveNode(vault: string, srcPath: string, kind: 'dir' | 'note', destParentPath: string): Promise<OpResult & { newPath?: string }>
  deleteNode(vault: string, path: string, kind: 'dir' | 'note'): Promise<OpResult>
  readNote(vault: string, path: string): Promise<NoteContent>
  noteGetInfo(vault: string, path: string): Promise<OpResult & { info?: NoteInfo }>
  resolveByName(vault: string, name: string): Promise<OpResult & { path?: string }>
  /** 按名称解析所有同名候选（双链同名消歧用） */
  resolveByNameCandidates(vault: string, name: string): Promise<OpResult & { paths?: string[] }>
  writeNote(vault: string, path: string, content: string, expectedHash: string | null): Promise<OpResult & { hash?: string }>
  saveImage(vault: string, notePath: string, fileName: string, base64: string): Promise<SaveImageResult>

  // ---- 收藏 / 常用 ----
  listFavorites(): Promise<OpResult & { items?: FavoriteItem[] }>
  addFavorite(vault: string, path: string, name: string): Promise<OpResult>
  removeFavorite(vault: string, path: string): Promise<OpResult>
  listRecents(): Promise<OpResult & { items?: RecentItem[] }>
  addRecent(vault: string, path: string, name: string): Promise<OpResult>
  removeRecent(vault: string, path: string): Promise<OpResult>

  // ---- 回收站 ----
  listTrash(): Promise<OpResult & { entries?: TrashEntry[] }>
  restoreTrash(id: string): Promise<OpResult>
  purgeTrash(id: string): Promise<OpResult>
  emptyTrash(): Promise<OpResult>

  // ---- GitHub 账号 ----
  getAccount(): Promise<OpResult & AccountInfo>
  login(token: string): Promise<OpResult & { username?: string }>
  logout(): Promise<OpResult>
  listRemoteRepos(): Promise<OpResult & { repos?: RemoteRepo[] }>
  createRemoteRepo(name: string, isPrivate: boolean): Promise<OpResult & { fullName?: string }>

  // ---- Git 同步 ----
  getGitStatus(vault: string): Promise<GitStatus | null>
  associateVault(vault: string, repoFullName: string): Promise<SyncResult>
  disconnectVault(vault: string): Promise<OpResult>
  syncVault(vault: string): Promise<SyncResult>
  checkGitAvailability(): Promise<GitAvailability>
  testProxy(): Promise<OpResult>

  // ---- 冲突解决 ----
  /** 获取冲突文件列表（rebase进行中时调用） */
  getConflictFiles(vault: string): Promise<OpResult & { files?: string[] }>
  /** 获取冲突文件的三方内容（ours/theirs/base） */
  getConflictContent(vault: string, filePath: string): Promise<OpResult & { content?: ConflictContent }>
  /** 解决单个文件的冲突 */
  resolveConflict(vault: string, filePath: string, resolution: ConflictResolution): Promise<OpResult>
  /** 继续rebase（所有冲突解决后调用） */
  continueRebase(vault: string): Promise<SyncResult>
  /** 中止rebase */
  abortRebase(vault: string): Promise<OpResult>
  /** 批量导出 PDF：每项一个文件；返回逐篇结果与失败清单 */
  exportPdf(items: { vault: string; path: string; name: string; html: string }[]): Promise<
    OpResult & { results?: { ok: boolean; name: string; error?: string }[]; failed?: { name: string; error?: string }[] }
  >
  /** 合并 PDF：多篇 → 单个 PDF；fileName 为输出文件名 */
  exportPdfMerge(items: { vault: string; path: string; name: string; html: string }[], fileName: string): Promise<OpResult & { name?: string; path?: string; error?: string }>
  /** 批量导出 HTML：每项一个自包含 .html 文件；返回逐篇结果与失败清单 */
  exportHtml(items: { vault: string; path: string; name: string; html: string }[]): Promise<
    OpResult & { results?: { ok: boolean; name: string; error?: string }[]; failed?: { name: string; error?: string }[] }
  >
  /** 读取库内图片（导出 HTML 内联 base64 用），路径限定库内且扩展名白名单 */
  readImage(vault: string, relPath: string): Promise<OpResult & { mime?: string; base64?: string }>
  onExportProgress(cb: (payload: ExportProgress) => void): () => void

  // ---- 设置 ----
  getSettings(): Promise<OpResult & { settings?: AppSettings }>
  setSettings(patch: Partial<AppSettings>): Promise<OpResult & { settings?: AppSettings }>

  // ---- 插件 ----
  listPlugins(): Promise<OpResult & { plugins?: PluginInfo[] }>
  setPluginEnabled(id: string, enabled: boolean): Promise<OpResult>

  // ---- 标签 ----
  listTags(): Promise<OpResult & { tags?: TagItem[] }>
  createTag(name: string, color: string): Promise<OpResult & { tag?: TagItem }>
  renameTag(id: string, name: string): Promise<OpResult>
  deleteTag(id: string): Promise<OpResult>
  setTagColor(id: string, color: string): Promise<OpResult>
  noteTags(vault: string, path: string): Promise<OpResult & { tags?: TagItem[] }>
  addTagToNote(vault: string, path: string, tagId: string): Promise<OpResult>
  removeTagFromNote(vault: string, path: string, tagId: string): Promise<OpResult>
  notesByTag(tagId: string): Promise<OpResult & { entries?: NoteTagEntry[] }>

  // ---- 主题包 ----
  listThemes(): Promise<OpResult & { themes?: ThemePackage[] }>
  importTheme(): Promise<OpResult & { theme?: ThemePackage; canceled?: boolean }>
  saveTheme(theme: ThemePackage): Promise<OpResult>
  deleteTheme(id: string): Promise<OpResult>

  // ---- 事件订阅（返回取消订阅函数） ----
  onFsChanged(cb: (payload: FsChangedPayload) => void): () => void
  onGitEvent(cb: (payload: GitEventPayload) => void): () => void
  onPluginNotify(cb: (message: string) => void): () => void

  // ---- 搜索 ----
  /** 构建搜索索引（应用启动时调用） */
  searchBuildIndex(force?: boolean): Promise<OpResult & { totalFiles?: number; isIndexing?: boolean }>
  /** 执行搜索查询 */
  searchQuery(query: string, maxResults?: number, options?: { searchInTitle?: boolean; searchInContent?: boolean; vaults?: string[] }): Promise<SearchResult>
  /** 获取搜索索引状态 */
  getSearchIndexStatus(): Promise<OpResult & { totalFiles?: number; isIndexing?: boolean }>
  /** 更新单个文件的索引 */
  updateSearchIndex(vault: string, filePath: string): Promise<OpResult>
  /** 删除单个文件的索引 */
  removeSearchIndex(vault: string, filePath: string): Promise<OpResult>
  /** 清空搜索索引 */
  clearSearchIndex(): Promise<OpResult>

  // ---- 双链 P3：反向链接 / 断链引用 ----
  /** 获取引用指定笔记的反向链接列表 */
  wikilinkBacklinks(vault: string, notePath: string): Promise<OpResult & { backlinks?: BacklinkRef[] }>
  /** 获取所有未解析的 [[...]] 引用 */
  wikilinkUnresolved(vault?: string): Promise<OpResult & { refs?: BacklinkRef[] }>
  /** 重建双链索引 */
  wikilinkRebuildIndex(): Promise<OpResult & { totalFiles?: number; totalLinks?: number }>
  /** 获取双链索引状态 */
  wikilinkGetIndexStatus(): Promise<OpResult & { totalFiles?: number; totalLinks?: number; isIndexing?: boolean }>
}
