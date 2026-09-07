import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { errMessage } from '../lib/errMessage'
import { logger } from '../lib/logger'
import type { AppSettings } from '@shared/types'
import type {
  AccountService,
  FavoritesService,
  FsTreeService,
  GitService,
  GithubService,
  PluginHost,
  RecentsService,
  SettingsService,
  TrashService,
  VaultService,
  WatcherService,
  WorkspaceService
} from '../services'

export interface IpcDeps {
  settings: SettingsService
  workspace: WorkspaceService
  vaults: VaultService
  fsTree: FsTreeService
  trash: TrashService
  favorites: FavoritesService
  recents: RecentsService
  account: AccountService
  github: GithubService
  git: GitService
  watcher: WatcherService
  plugins: PluginHost
  getWindow: () => BrowserWindow | null
}

/**
 * 注册全部 IPC 通道。所有 handler 统一捕获异常并转为 { ok:false, error }，
 * 保证渲染进程拿到可展示的错误信息。
 */
export function registerIpc(deps: IpcDeps): void {
  const send = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  /** git 同步前后挂起文件监听，避免同步引发的事件风暴 */
  const withWatcherSuspended = async <T>(fn: () => Promise<T>): Promise<T> => {
    deps.watcher.suspend()
    try {
      return await fn()
    } finally {
      deps.watcher.resume()
    }
  }

  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, async (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
      try {
        return await fn(...args)
      } catch (e) {
        logger.error(`IPC ${channel} 失败`, e)
        return { ok: false, error: errMessage(e) }
      }
    })
  }

  // ---------- 工作区 ----------
  handle('workspace:get', () => ({
    ok: true,
    root: deps.workspace.getRoot() ?? '',
    defaultRoot: deps.workspace.getDefaultRoot()
  }))
  handle('workspace:set', (root: string) => {
    const result = deps.workspace.setRoot(root)
    if (result.ok) deps.watcher.restart()
    return result
  })
  handle('workspace:choose', async (current: string) => {
    const win = deps.getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择工作区目录',
      defaultPath: current || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled ? null : filePaths[0]
  })
  handle('app:version', () => ({ ok: true, version: app.getVersion() }))

  // ---------- 笔记库 ----------
  handle('vault:list', () => ({ ok: true, vaults: deps.vaults.list() }))
  handle('vault:create', (name: string) => deps.vaults.create(name))
  handle('vault:rename', (oldName: string, newName: string) => {
    const result = deps.vaults.rename(oldName, newName)
    if (result.ok) {
      deps.favorites.onVaultRename(oldName, newName)
      deps.recents.onVaultRename(oldName, newName)
    }
    return result
  })
  handle('vault:delete', (name: string) => {
    const result = deps.vaults.delete(name)
    if (result.ok) {
      deps.favorites.onDelete(name, '', 'vault')
      deps.recents.onDelete(name, '', 'vault')
    }
    return result
  })

  // ---------- 目录 / 笔记 ----------
  handle('tree:list', (vault: string) => ({ ok: true, nodes: deps.fsTree.listTree(vault) }))
  handle('dir:create', (vault: string, parentPath: string, name: string) =>
    deps.fsTree.createDir(vault, parentPath, name)
  )
  handle('note:create', (vault: string, parentPath: string, name: string) =>
    deps.fsTree.createNote(vault, parentPath, name)
  )
  handle(
    'node:rename',
    (vault: string, relPath: string, kind: 'dir' | 'note', newName: string) => {
      const result = deps.fsTree.renameNode(vault, relPath, kind, newName)
      if (result.ok && result.newPath) {
        deps.favorites.onRename(vault, relPath, result.newPath, kind, newName)
        deps.recents.onRename(vault, relPath, result.newPath, kind, newName)
      }
      return result
    }
  )
  handle('node:delete', (vault: string, relPath: string, kind: 'dir' | 'note') => {
    const result = deps.fsTree.deleteNode(vault, relPath, kind)
    if (result.ok) {
      deps.favorites.onDelete(vault, relPath, kind)
      deps.recents.onDelete(vault, relPath, kind)
    }
    return result
  })
  handle('note:read', (vault: string, relPath: string) => deps.fsTree.readNote(vault, relPath))
  handle(
    'note:write',
    (vault: string, relPath: string, content: string, expectedHash: string | null) =>
      deps.fsTree.writeNote(vault, relPath, content, expectedHash)
  )
  handle('note:saveImage', (vault: string, notePath: string, fileName: string, base64: string) =>
    deps.fsTree.saveImage(vault, notePath, fileName, base64, deps.settings.get().attachmentsDir)
  )

  // ---------- 收藏 / 常用 ----------
  handle('favorite:list', () => ({ ok: true, items: deps.favorites.list() }))
  handle('favorite:add', (vault: string, relPath: string, name: string) =>
    deps.favorites.add(vault, relPath, name)
  )
  handle('favorite:remove', (vault: string, relPath: string) => deps.favorites.remove(vault, relPath))
  handle('recent:list', () => ({ ok: true, items: deps.recents.list() }))
  handle('recent:add', (vault: string, relPath: string, name: string) => {
    deps.recents.add(vault, relPath, name)
    return { ok: true }
  })
  handle('recent:remove', (vault: string, relPath: string) => {
    deps.recents.remove(vault, relPath)
    return { ok: true }
  })

  // ---------- 回收站 ----------
  handle('trash:list', () => ({ ok: true, entries: deps.trash.list() }))
  handle('trash:restore', (id: string) => deps.trash.restore(id))
  handle('trash:purge', (id: string) => deps.trash.purge(id))
  handle('trash:empty', () => deps.trash.empty())

  // ---------- GitHub 账号 ----------
  handle('account:get', () => ({
    ok: true,
    loggedIn: deps.account.isLoggedIn(),
    username: deps.account.getUsername()
  }))
  handle('account:login', async (token: string) => {
    const username = await deps.github.getAuthenticated(token)
    const saved = deps.account.save(token, username)
    if (!saved.ok) return saved
    return { ok: true, username }
  })
  handle('account:logout', () => {
    deps.account.clear()
    return { ok: true }
  })
  handle('account:listRepos', async () => {
    const token = deps.account.getToken()
    if (!token) return { ok: false, error: '尚未登录 GitHub 账号' }
    return { ok: true, repos: await deps.github.listRepos(token) }
  })
  handle('account:createRepo', async (name: string, isPrivate: boolean) => {
    const token = deps.account.getToken()
    if (!token) return { ok: false, error: '尚未登录 GitHub 账号' }
    return { ok: true, fullName: await deps.github.createRepo(token, name, isPrivate) }
  })

  // ---------- Git 同步 ----------
  handle('git:status', async (vault: string) => {
    try {
      return await deps.git.status(deps.vaults.vaultPath(vault))
    } catch (e) {
      logger.warn('git status 失败', e)
      return null
    }
  })
  handle('git:associate', (vault: string, repoFullName: string) =>
    withWatcherSuspended(() =>
      deps.git.associate(deps.vaults.vaultPath(vault), `https://github.com/${repoFullName}.git`)
    )
  )
  handle('git:disconnect', (vault: string) =>
    withWatcherSuspended(() => deps.git.disconnect(deps.vaults.vaultPath(vault)))
  )
  handle('git:sync', (vault: string) =>
    withWatcherSuspended(async () => {
      send('git:event', { vault, phase: 'start' })
      try {
        const result = await deps.git.sync(deps.vaults.vaultPath(vault))
        send('git:event', { vault, phase: result.ok ? 'done' : 'error', message: result.error })
        return result
      } catch (e) {
        const error = errMessage(e)
        send('git:event', { vault, phase: 'error', message: error })
        return { ok: false, error }
      }
    })
  )

  // ---------- 设置 ----------
  handle('settings:get', () => ({ ok: true, settings: deps.settings.get() }))
  handle('settings:set', (patch: Partial<AppSettings>) => ({
    ok: true,
    settings: deps.settings.update(patch)
  }))

  // ---------- 插件 ----------
  handle('plugin:list', () => ({ ok: true, plugins: deps.plugins.discover() }))
  handle('plugin:setEnabled', (id: string, enabled: boolean) => {
    deps.plugins.setEnabled(id, enabled)
    return { ok: true }
  })

  // ---------- 插件 -> 渲染进程通知 ----------
  ipcMain.on('plugin:notify', (_e, message: string) => {
    send('plugin:notify', message)
  })
}
