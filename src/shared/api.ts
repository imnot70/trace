import type {
  AccountInfo,
  AppSettings,
  FavoriteItem,
  FsChangedPayload,
  GitEventPayload,
  GitStatus,
  NoteContent,
  OpResult,
  PluginInfo,
  RecentItem,
  RemoteRepo,
  SaveImageResult,
  SyncResult,
  TreeNode,
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
  deleteNode(vault: string, path: string, kind: 'dir' | 'note'): Promise<OpResult>
  readNote(vault: string, path: string): Promise<NoteContent>
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
  checkGitAvailability(): Promise<{ systemGit: boolean; bundledGit: boolean }>
  testProxy(): Promise<OpResult>

  // ---- 设置 ----
  getSettings(): Promise<OpResult & { settings?: AppSettings }>
  setSettings(patch: Partial<AppSettings>): Promise<OpResult & { settings?: AppSettings }>

  // ---- 插件 ----
  listPlugins(): Promise<OpResult & { plugins?: PluginInfo[] }>
  setPluginEnabled(id: string, enabled: boolean): Promise<OpResult>

  // ---- 事件订阅（返回取消订阅函数） ----
  onFsChanged(cb: (payload: FsChangedPayload) => void): () => void
  onGitEvent(cb: (payload: GitEventPayload) => void): () => void
  onPluginNotify(cb: (message: string) => void): () => void
}
