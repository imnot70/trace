import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { errMessage } from '../lib/errMessage'
import { logger } from '../lib/logger'
import { resolveWithin } from '../lib/paths'
import { nativeTheme } from 'electron'
import { readGitVersion, resolveBundledGitPath, applyWindowGlassEffect, applyOverlayTheme, prepareGistContent } from '../services'
import { promoteDraft } from '../services/scratchPromote'
import { copyNoteAcrossVaults } from '../services/noteCopy'
import { SCRATCH_VAULT } from '@shared/types'
import type { ScratchService } from '../services/scratch'
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
  scratch: ScratchService
  trash: TrashService
  favorites: FavoritesService
  recents: RecentsService
  tags: TagsService
  gistShares: import('../services/gistShares').GistShareService
  themes: ThemeService
  account: AccountService
  github: GithubService
  git: GitService
  watcher: WatcherService
  plugins: PluginHost
  autoSync: import('../services/autoSync').AutoSyncService
  exportPdf: import('../services/exportPdf').ExportService
  search: import('../services/search').SearchService
  wikilink: import('../services/wikilink').WikilinkService
  market: import('../services/marketService').MarketService
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
      deps.gistShares.onVaultRename(oldName, newName)
      deps.vaultMeta.rename(oldName, newName)
    }
    return result
  })
  handle('vault:delete', (name: string) => {
    const result = deps.vaults.delete(name)
    if (result.ok) {
      deps.favorites.onDelete(name, '', 'vault')
      deps.recents.onDelete(name, '', 'vault')
      deps.gistShares.onDelete(name, '', 'vault')
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
        deps.gistShares.onRename(vault, relPath, result.newPath, kind)
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
        deps.gistShares.onRename(vault, srcPath, result.newPath, kind)
      }
      return result
    }
  )
  handle('node:delete', (vault: string, relPath: string, kind: 'dir' | 'note') => {
    const result = deps.fsTree.deleteNode(vault, relPath, kind)
    if (result.ok) {
      deps.favorites.onDelete(vault, relPath, kind)
      deps.recents.onDelete(vault, relPath, kind)
      deps.gistShares.onDelete(vault, relPath, kind)
    }
    return result
  })
  handle('note:read', (vault: string, relPath: string) =>
    vault === SCRATCH_VAULT ? deps.scratch.read(relPath) : deps.fsTree.readNote(vault, relPath)
  )
  handle('note:getInfo', (vault: string, relPath: string) => deps.fsTree.noteGetInfo(vault, relPath))
  handle('note:resolveByName', (vault: string, name: string) => deps.fsTree.resolveByName(vault, name))
  handle('note:resolveByNameCandidates', (vault: string, name: string) =>
    deps.fsTree.resolveByNameAll(vault, name)
  )
  handle(
    'note:write',
    (vault: string, relPath: string, content: string, expectedHash: string | null) => {
      if (vault === SCRATCH_VAULT) {
        // 草稿：写入 scratch 目录并同步搜索索引（草稿不进双链索引 / 插件事件——独立空间语义）
        const result = deps.scratch.write(relPath, content)
        if (result.ok) deps.search.updateFileIndex(SCRATCH_VAULT, relPath)
        return result
      }
      const result = deps.fsTree.writeNote(vault, relPath, content, expectedHash)
      if (result.ok) deps.plugins.emitEvent('note:saved', { vault, path: relPath })
      return result
    }
  )
  handle('note:saveImage', (vault: string, notePath: string, fileName: string, base64: string) =>
    vault === SCRATCH_VAULT
      ? deps.scratch.saveImage(fileName, base64)
      : deps.fsTree.saveImage(vault, notePath, fileName, base64, deps.settings.get().attachmentsDir)
  )
  // 快速引入图片（FR-2.5.4）：主进程弹系统文件选择器（多选）→ 复制进附件目录 → 返回引用列表；
  // 取消选择返回空列表不落盘。草稿伪库走 scratch 自有附件目录（与粘贴一致）
  handle('image:import', async (vault: string, notePath: string) => {
    const win = deps.getWindow()
    const options = {
      title: '引入图片',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }]
    }
    const pick = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (pick.canceled || pick.filePaths.length === 0) return { ok: true, images: [] }
    if (vault === SCRATCH_VAULT) {
      const images: { reference: string; fileName: string }[] = []
      for (const filePath of pick.filePaths) {
        const data = fs.readFileSync(filePath)
        const fileName = path.basename(filePath)
        const saved = deps.scratch.saveImage(fileName, data.toString('base64'))
        if (!saved.ok || !saved.reference) return { ok: false, error: saved.error ?? `「${fileName}」引入失败` }
        images.push({ reference: saved.reference, fileName })
      }
      return { ok: true, images }
    }
    return deps.fsTree.importImages(vault, notePath, pick.filePaths, deps.settings.get().attachmentsDir)
  })

  // ---------- 草稿（FR-2.3.9） ----------
  handle('scratch:list', () => ({ ok: true, notes: deps.scratch.list() }))
  handle('scratch:status', () => ({ ok: true, count: deps.scratch.list().length }))
  handle('scratch:create', () => deps.scratch.create())
  handle('scratch:delete', (name: string) => {
    const result = deps.scratch.remove(name)
    if (result.ok) deps.search.removeFileIndex(SCRATCH_VAULT, name)
    return result
  })
  // 转正：草稿移入正式笔记库（图片资产随迁 + 引用改写），并移除草稿搜索索引
  handle('scratch:promote', (name: string, vault: string, dir: string, newName: string) => {
    const result = promoteDraft(deps.scratch, {
      name,
      vault,
      dir,
      newName,
      attachmentsDir: deps.settings.get().attachmentsDir,
      vaultPath: deps.vaults.vaultPath(vault),
      createNote: (v, d, n) => deps.fsTree.createNote(v, d, n),
      writeNote: (v, rel, content) => {
        const r = deps.fsTree.writeNote(v, rel, content, null)
        if (r.ok) deps.search.updateFileIndex(v, rel)
        return r
      },
      existingAttachments: (attachAbs) => {
        try {
          return fs.readdirSync(attachAbs)
        } catch {
          return []
        }
      }
    })
    return result
  })

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
  handle('tag:byTags', async (tagIds: string[], match: 'all' | 'any') => ({
    ok: true,
    entries: await deps.tags.notesByTags(tagIds, match)
  }))

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

  // ---------- 分享为 Gist（FR-2.3.10） ----------
  handle('gist:get', (vault: string, relPath: string) => ({ ok: true, share: deps.gistShares.get(vault, relPath) }))
  handle('gist:share', async (vault: string, relPath: string) => {
    const token = deps.account.getToken()
    if (!token) return { ok: false, error: '尚未登录 GitHub 账号，请先到 设置 → 账号 登录' }
    const read = deps.fsTree.readNote(vault, relPath)
    if (!read.ok) return { ok: false, error: read.error ?? '笔记读取失败' }
    // 发布适配（FR-2.3.10）：剥离 frontmatter、[[双链]] 转纯文本、相对路径图片替换为占位说明
    const content = prepareGistContent(read.content ?? '')
    // gist 文件扁平，仅取笔记名；描述带应用标识便于在 GitHub 侧辨认来源
    const fileName = relPath.replace(/.*\//, '').replace(/\.md$/i, '') + '.md'
    const description = `Trace 笔记分享：${fileName.replace(/\.md$/, '')}`
    const existing = deps.gistShares.get(vault, relPath)

    const create = async (): Promise<{ id: string; url: string }> =>
      deps.github.createGist(token, fileName, content, description)
    try {
      let gist: { id: string; url: string }
      if (existing) {
        try {
          gist = await deps.github.updateGist(token, existing.gistId, fileName, content, description)
        } catch (e) {
          // 记录里的 gist 已在 GitHub 侧被删（404）→ 落库新分享；权限缺失也是 404，
          // 但随后 create 同样 404 会被下方的 scope 分支拦住
          if ((e as { status?: number }).status !== 404) throw e
          gist = await create()
        }
      } else {
        gist = await create()
      }
      const share = deps.gistShares.upsert({
        gistId: gist.id,
        url: gist.url,
        vault,
        path: relPath,
        fileName,
        description
      })
      return { ok: true, share }
    } catch (e) {
      // GitHub 对缺少 gist scope 的令牌返回 404：转成引导标记，渲染端展示补 scope 分步引导
      if ((e as { status?: number }).status === 404) {
        return {
          ok: false,
          needScope: true,
          error: 'GitHub 令牌缺少 gist 权限（GitHub 对无权限的请求返回 404）'
        }
      }
      throw e
    }
  })
  handle('gist:remove', async (vault: string, relPath: string, deleteRemote: boolean) => {
    const record = deps.gistShares.get(vault, relPath)
    if (deleteRemote && record) {
      const token = deps.account.getToken()
      if (!token) return { ok: false, error: '尚未登录 GitHub 账号，无法删除远端分享' }
      try {
        await deps.github.deleteGist(token, record.gistId)
      } catch (e) {
        if ((e as { status?: number }).status !== 404) throw e // 已被外部删除视为成功
      }
    }
    deps.gistShares.removeRecord(vault, relPath)
    return { ok: true }
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
        if (result.ok) deps.plugins.emitEvent('sync:done', { vault })
        return result
      } catch (e) {
        const error = errMessage(e)
        send('git:event', { vault, phase: 'error', message: error })
        return { ok: false, error }
      }
    })
  )

  // ---------- 冲突解决 ----------
  handle('git:conflictFiles', async (vault: string) => {
    try {
      const files = await deps.git.getConflictFiles(deps.vaults.vaultPath(vault))
      return { ok: true, files }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })
  handle('git:conflictContent', async (vault: string, filePath: string) => {
    try {
      const content = await deps.git.getConflictContent(deps.vaults.vaultPath(vault), filePath)
      return { ok: true, content }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })
  handle('git:resolveConflict', async (vault: string, filePath: string, resolution: any) => {
    try {
      const ok = await deps.git.resolveConflict(deps.vaults.vaultPath(vault), filePath, resolution)
      return { ok }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })
  handle('git:continueRebase', async (vault: string) => {
    try {
      const result = await deps.git.continueRebase(deps.vaults.vaultPath(vault))
      return result
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })
  handle('git:abortRebase', async (vault: string) => {
    try {
      const ok = await deps.git.abortRebaseOperation(deps.vaults.vaultPath(vault))
      return { ok }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  // ---------- 设置 ----------
  handle('settings:get', () => ({ ok: true, settings: deps.settings.get() }))
  handle('settings:set', (patch: Partial<AppSettings>) => {
    const settings = deps.settings.update(patch)
    // 定时自动同步配置可能变化，重新应用定时器
    deps.autoSync.apply()

    // 窗口效果设置变化时应用
    if (patch.windowGlassEffect !== undefined || patch.windowOpacity !== undefined) {
      const win = deps.getWindow()
      if (win && !win.isDestroyed()) {
        try {
          applyWindowGlassEffect(win, settings)
        } catch (e) {
          logger.warn('应用窗口效果失败', e)
        }
      }
    }

    // 主题变化时同步 WCO 标题栏按钮区配色（仅 Windows 生效）
    if (patch.theme !== undefined) {
      const win = deps.getWindow()
      if (win && !win.isDestroyed()) applyOverlayTheme(win, settings, nativeTheme.shouldUseDarkColors)
    }

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
  // 合并 PDF：多篇 → 单个 PDF
  handle(
    'export:pdf-merge',
    async (args: { items: { vault: string; path: string; name: string; html: string }[]; fileName: string }) => {
      const items = args.items
      const fileName = args.fileName || '导出合并.pdf'
      if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, error: '没有可导出的笔记' }
      }
      if (!exportDir) {
        exportDir = await deps.exportPdf.chooseDirectory()
        if (!exportDir) return { ok: false, error: '已取消' }
      }
      send('export:progress', { done: 0, total: items.length, current: '正在合并…', ok: true })
      const result = await deps.exportPdf.mergePdfs(exportDir, items, fileName)
      return result
    }
  )
  handle(
    'export:html',
    async (items: { vault: string; path: string; name: string; html: string }[]) => {
      if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, error: '没有可导出的笔记', results: [], failed: [] }
      }
      if (!exportDir) {
        exportDir = await deps.exportPdf.chooseDirectory()
        if (!exportDir) return { ok: false, error: '已取消', results: [], failed: [] }
      }
      const results = []
      let done = 0
      for (const item of items) {
        const r = deps.exportPdf.exportOneHtml(exportDir, item)
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
  handle('plugin:setEnabled', (id: string, enabled: boolean) => deps.plugins.setEnabled(id, enabled))
  handle('plugin:confirmEnable', (id: string) => deps.plugins.confirmEnable(id))
  handle('plugin:invokeCommand', async (commandId: string) => deps.plugins.invokeCommand(commandId))
  handle('plugin:reportNoteOpened', (vault: string, notePath: string) => {
    deps.plugins.emitEvent('note:opened', { vault, path: notePath })
    return { ok: true }
  })

  // ---------- 插件包（M2：.trace-plugin 导入导出 / 卸载 / 详情） ----------
  handle('plugin:import', async () => {
    const win = deps.getWindow()
    const picked = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      title: '导入插件',
      filters: [
        { name: 'Trace 插件包', extensions: ['trace-plugin', 'zip'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, error: '已取消' }
    const r = deps.plugins.beginImport(picked.filePaths[0])
    if (!r.ok) return { ok: false, error: r.error }
    return {
      ok: true,
      preview: {
        importId: r.importId,
        id: r.manifest.id,
        name: r.manifest.name,
        version: r.manifest.version,
        description: r.manifest.description ?? '',
        permissions: r.manifest.permissions ?? [],
        isUpgrade: r.isUpgrade
      }
    }
  })
  handle('plugin:confirmImport', (importId: string) => deps.plugins.confirmImport(importId))
  handle('plugin:cancelImport', (importId: string) => {
    deps.plugins.cancelImport(importId)
    return { ok: true }
  })
  handle('plugin:export', async (id: string) => {
    const info = deps.plugins.discover().find((p) => p.id === id)
    const win = deps.getWindow()
    const saved = await dialog.showSaveDialog(win ?? new BrowserWindow({ show: false }), {
      title: '导出插件',
      defaultPath: `${id}-${info?.version ?? '1.0.0'}.trace-plugin`,
      filters: [{ name: 'Trace 插件包', extensions: ['trace-plugin'] }]
    })
    if (saved.canceled || !saved.filePath) return { ok: false, error: '已取消' }
    const r = deps.plugins.exportPlugin(id, saved.filePath)
    return r.ok ? { ok: true, path: saved.filePath } : r
  })
  handle('plugin:uninstall', (id: string) => deps.plugins.uninstall(id))
  handle('plugin:detail', (id: string) => deps.plugins.detail(id))

  // ---------- 插件市场（M4） ----------
  handle('plugin:marketList', async () => {
    const installed = deps.market.getInstalled()
    const r = await deps.market.fetchIndex()
    if (!r.ok || !r.index) return { ok: false, error: r.error ?? '市场索引不可用', installed }
    const { updates, unlisted } = deps.market.checkUpdates(
      r.index,
      Object.entries(installed).map(([id, v]) => ({ id, version: v.version }))
    )
    return {
      ok: true,
      plugins: r.index.plugins,
      installed,
      updates,
      unlisted,
      stale: r.stale ?? false
    }
  })

  handle('plugin:marketInstall', async (id: string, version?: string) => {
    // 强制拉新索引：安装时以最新登记为准（版本锁定 + sha256 校验）
    const r = await deps.market.fetchIndex(true)
    if (!r.ok || !r.index) return { ok: false, error: r.error ?? '市场索引不可用' }
    const plugin = r.index.plugins.find((p) => p.id === id)
    if (!plugin) return { ok: false, error: `市场中不存在该插件：${id}` }
    const ver = version ?? plugin.latest
    const entry = plugin.versions[ver]
    if (!entry) return { ok: false, error: `版本不存在：${ver}` }

    const dl = await deps.market.downloadAndVerify(
      plugin.repo,
      entry.releaseTag,
      entry.asset,
      entry.sha256,
      deps.plugins.getStagingDir()
    )
    if (!dl.ok || !dl.filePath) return { ok: false, error: dl.error ?? '下载失败' }

    // 复用本地导入管线：zip-slip/清单校验（beginImport）+ 安装与权限处理（confirmImport）
    const imp = deps.plugins.beginImport(dl.filePath)
    fs.rmSync(dl.filePath, { force: true })
    if (!imp.ok) return { ok: false, error: imp.error }
    const c = deps.plugins.confirmImport(imp.importId)
    if (!c.ok) return { ok: false, error: c.error }

    deps.market.recordInstalled(id, { repo: plugin.repo, version: ver, sha256: entry.sha256 })
    logger.info(`市场插件已安装：${id} v${ver}（${plugin.repo}）`)
    return { ok: true, id, needsConfirmation: c.needsConfirmation, permissions: c.permissions }
  })

  // ---------- 搜索 ----------
  handle('search:buildIndex', async (force?: boolean) => {
    try {
      await deps.search.buildIndex(force)
      const status = deps.search.getIndexStatus()
      return { ok: true, ...status }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  handle('search:search', (query: string, maxResults?: number, options?: { searchInTitle?: boolean; searchInContent?: boolean; vaults?: string[]; tags?: string[]; excludeDir?: string }) => {
    try {
      // 防御：确保数组是普通副本（Vue reactive Proxy 经 IPC 传输可能异常）
      const opts = options ? {
        searchInTitle: options.searchInTitle,
        searchInContent: options.searchInContent,
        vaults: Array.isArray(options.vaults) ? [...options.vaults] : options.vaults,
        tags: Array.isArray(options.tags) ? [...options.tags] : options.tags,
        excludeDir: options.excludeDir
      } : undefined
      const result = deps.search.search(query, maxResults, opts)
      return result
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  handle('search:getIndexStatus', () => {
    try {
      const status = deps.search.getIndexStatus()
      return { ok: true, ...status }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  // 标签筛选下拉选项（FR-2.9.11）：从搜索索引跨库聚合
  handle('search:listTags', () => {
    try {
      return { ok: true, tags: deps.search.listTags() }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  // 跨库复制笔记（FR-2.9.11 跨库引用改进）：图片附件随迁 + 引用改写，重名自动加后缀
  handle('note:crossVaultCopy', (sourceVault: string, sourcePath: string, targetVault: string, targetDir: string) => {
    try {
      return copyNoteAcrossVaults({
        sourceVault,
        sourcePath,
        targetVault,
        targetDir,
        sourceVaultPath: deps.vaults.vaultPath(sourceVault),
        targetVaultPath: deps.vaults.vaultPath(targetVault),
        attachmentsDir: deps.settings.get().attachmentsDir,
        readNote: (v, rel) => {
          const r = deps.fsTree.readNote(v, rel)
          return r.ok ? { ok: true, content: r.content } : { ok: false, error: r.error }
        },
        createNote: (v, d, n) => deps.fsTree.createNote(v, d, n),
        createDir: (v, parent, name) => deps.fsTree.createDir(v, parent, name),
        writeNote: (v, rel, content) => {
          const r = deps.fsTree.writeNote(v, rel, content, null)
          if (r.ok) void deps.search.updateFileIndex(v, rel)
          return r
        }
      })
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  // ---------- 双链 P3：反向链接 / 断链引用 ----------
  handle('wikilink:backlinks', (vault: string, notePath: string) => {
    try {
      return { ok: true, backlinks: deps.wikilink.getBacklinks(vault, notePath) }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  handle('wikilink:unresolved', (vault?: string) => {
    try {
      return { ok: true, refs: deps.wikilink.getUnresolvedRefs(vault) }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  handle('wikilink:rebuildIndex', async () => {
    try {
      const stats = await deps.wikilink.buildIndex(true)
      return { ok: true, ...stats }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })

  handle('wikilink:getIndexStatus', () => {
    try {
      return { ok: true, ...deps.wikilink.getIndexStatus() }
    } catch (e) {
      return { ok: false, error: errMessage(e) }
    }
  })
}
