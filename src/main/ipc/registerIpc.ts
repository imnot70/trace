import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { errMessage } from '../lib/errMessage'
import { logger } from '../lib/logger'
import { resolveWithin } from '../lib/paths'
import { readGitVersion, resolveBundledGitPath } from '../services'
import type { AppSettings, ThemePackage } from '@shared/types'
import type {
  AccountService,
  FavoritesService,
  FsTreeService,
  GitService,
  GithubService,
  PluginHost,
  RecentsService,
  SettingsService,
  TagsService,
  ThemeService,
  TrashService,
  VaultMetaService,
  VaultService,
  WatcherService,
  WorkspaceService
} from '../services'

export interface IpcDeps {
  settings: SettingsService
  workspace: WorkspaceService
  vaults: VaultService
  vaultMeta: VaultMetaService
  fsTree: FsTreeService
  trash: TrashService
  favorites: FavoritesService
  recents: RecentsService
  tags: TagsService
  themes: ThemeService
  account: AccountService
  github: GithubService
  git: GitService
  watcher: WatcherService
  plugins: PluginHost
  autoSync: import('../services/autoSync').AutoSyncService
  exportPdf: import('../services/exportPdf').ExportService
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
  handle('vault:list', () => ({
    ok: true,
    vaults: deps.vaults.list().map((v) => ({ ...v, description: deps.vaultMeta.get(v.name) }))
  }))
  handle('vault:create', (name: string, description?: string) => {
    const result = deps.vaults.create(name)
    if (result.ok && description?.trim()) deps.vaultMeta.set(name, description.trim())
    return result
  })
  handle('vault:rename', (oldName: string, newName: string) => {
    const result = deps.vaults.rename(oldName, newName)
    if (result.ok) {
      deps.favorites.onVaultRename(oldName, newName)
      deps.recents.onVaultRename(oldName, newName)
      deps.vaultMeta.rename(oldName, newName)
    }
    return result
  })
  handle('vault:delete', (name: string) => {
    const result = deps.vaults.delete(name)
    if (result.ok) {
      deps.favorites.onDelete(name, '', 'vault')
      deps.recents.onDelete(name, '', 'vault')
      deps.vaultMeta.remove(name)
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
  handle(
    'node:move',
    (vault: string, srcPath: string, kind: 'dir' | 'note', destParentPath: string) => {
      const result = deps.fsTree.moveNode(vault, srcPath, kind, destParentPath)
      if (result.ok && result.newPath) {
        const name = kind === 'note' ? result.newPath.replace(/.*\//, '').replace(/\.md$/i, '') : result.newPath.replace(/.*\//, '')
        deps.favorites.onRename(vault, srcPath, result.newPath, kind, name)
        deps.recents.onRename(vault, srcPath, result.newPath, kind, name)
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
  handle('note:getInfo', (vault: string, relPath: string) => deps.fsTree.noteGetInfo(vault, relPath))
  handle('note:resolveByName', (vault: string, name: string) => deps.fsTree.resolveByName(vault, name))
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

  // ---------- 标签 ----------
  handle('tag:list', () => ({ ok: true, tags: deps.tags.listTags() }))
  handle('tag:create', (name: string, color: string) => deps.tags.createTag(name, color))
  handle('tag:rename', async (id: string, name: string) => deps.tags.renameTag(id, name))
  handle('tag:delete', async (id: string) => deps.tags.deleteTag(id))
  handle('tag:setColor', (id: string, color: string) => deps.tags.setTagColor(id, color))
  handle('tag:noteTags', async (vault: string, relPath: string) => ({ ok: true, tags: await deps.tags.noteTags(vault, relPath) }))
  handle('tag:addToNote', async (vault: string, relPath: string, tagId: string) => deps.tags.addTagToNote(vault, relPath, tagId))
  handle('tag:removeFromNote', async (vault: string, relPath: string, tagId: string) =>
    deps.tags.removeFromNote(vault, relPath, tagId)
  )
  handle('tag:byTag', async (tagId: string) => ({ ok: true, entries: await deps.tags.notesByTag(tagId) }))

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
  handle('git:checkAvailability', async () => {
    // 系统 git：执行 `git --version`（走系统 PATH）
    const systemVersion = await readGitVersion('git')
    // 内置 git：定位打包产物中的可执行文件并读版本（开发模式下不存在）
    const bundledPath = resolveBundledGitPath(process.resourcesPath)
    const bundledVersion = bundledPath ? await readGitVersion(bundledPath) : null
    return {
      systemGit: systemVersion !== null,
      bundledGit: bundledPath !== null,
      systemVersion,
      bundledVersion
    }
  })
  handle('git:testProxy', () => deps.git.testProxy())
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
  handle('settings:set', (patch: Partial<AppSettings>) => {
    const settings = deps.settings.update(patch)
    // 定时自动同步配置可能变化，重新应用定时器
    deps.autoSync.apply()
    return { ok: true, settings }
  })

  // ---------- 主题包 ----------
  handle('theme:list', () => ({ ok: true, themes: deps.themes.list() }))
  handle('theme:import', async () => {
    const win = deps.getWindow()
    if (!win) return { ok: false, canceled: true }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '导入主题包',
      filters: [{ name: '主题包', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return { ok: false, canceled: true }
    return deps.themes.importFile(filePaths[0])
  })
  handle('theme:save', (theme: ThemePackage) => deps.themes.save(theme))
  handle('theme:delete', (id: string) => deps.themes.remove(id))

  // ---------- 插件 ----------
  // ---------- 导出 PDF ----------
  let exportDir: string | null = null
  handle(
    'export:pdf',
    async (items: { vault: string; path: string; name: string; html: string }[]) => {
      if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, error: '没有可导出的笔记', results: [] }
      }
      if (!exportDir) {
        exportDir = await deps.exportPdf.chooseDirectory()
        if (!exportDir) return { ok: false, error: '已取消', results: [] }
      }
      const results = []
      let done = 0
      for (const item of items) {
        const r = await deps.exportPdf.exportOne(exportDir, item)
        results.push(r)
        done++
        send('export:progress', { done, total: items.length, current: item.name, ok: r.ok })
      }
      const failed = results.filter((r) => !r.ok)
      return {
        ok: failed.length === 0,
        results,
        failed: failed.map((f) => ({ name: f.name, error: f.error }))
      }
    }
  )
  handle('export:resetDir', () => {
    exportDir = null
    return { ok: true }
  })

  // 图片内联（导出 HTML 用）：读取库内图片并返回 base64
  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])
  handle(
    'fs:readImage',
    (vault: string, relPath: string) => {
      try {
        const vaultPath = deps.vaults.vaultPath(vault)
        const abs = resolveWithin(vaultPath, relPath)
        if (!IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
          return { ok: false, error: '不支持的图片格式' }
        }
        const data = fs.readFileSync(abs)
        const mime = (
          {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp'
          } as Record<string, string>
        )[path.extname(abs).toLowerCase()]
        return { ok: true, mime, base64: data.toString('base64') }
      } catch (e) {
        return { ok: false, error: errMessage(e) }
      }
    }
  )

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
