import { app, BrowserWindow, Menu, nativeTheme, protocol, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { initLogger, logger } from './lib/logger'
import { resolveWithin } from './lib/paths'
import { JsonStore } from './lib/jsonStore'
import {
  AccountService,
  FavoritesService,
  FsTreeService,
  GitService,
  GithubService,
  pickGitBinary,
  PluginHost,
  spawnUtilityRuntime,
  PluginStorageService,
  MarketService,
  createMarketHttpClient,
  AutoSyncService,
  ExportService,
  RecentsService,
  resolveBundledGitPath,
  SearchService,
  SettingsService,
  TagsService,
  ThemeService,
  TrashService,
  VaultMetaService,
  VaultService,
  WatcherService,
  WorkspaceService,
  WikilinkService,
  applyWindowGlassEffect,
  applyOverlayTheme,
  overlayThemeFor
} from './services'
import { registerIpc } from './ipc/registerIpc'
import type { AppSettings } from '@shared/types'

let mainWindow: BrowserWindow | null = null
let exportPdf: ExportService | null = null
let settingsService: SettingsService | null = null
let wikilink: WikilinkService | null = null

// 自定义协议：预览中的相对路径图片（trace-vault://<库名>/<库内路径>）
protocol.registerSchemesAsPrivileged([
  { scheme: 'trace-vault', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
}

// 测试隔离：TRACE_TEST_USERDATA=1 时使用临时 userData，可与正式实例并行运行
if (process.env['TRACE_TEST_USERDATA']) {
  app.setPath('userData', path.join(app.getPath('temp'), 'trace-test-userdata'))
}

// 单实例运行
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// 开发/调试用：TRACE_CDP=9222 npm run dev 可通过 CDP 连接渲染进程
if (process.env['TRACE_CDP']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['TRACE_CDP'])
}

function createWindow(): void {
  const settings = settingsService?.get()

  // 窗口形态（见 requirements/2026-09-22_custom-titlebar/custom-titlebar_design.md）：
  // - macOS / Linux：原生标题栏 + 透明玻璃路径，与 0.6.x 完全一致（平台矩阵约束，零改动）
  // - Windows（v0.6.x 起恢复毛玻璃）：WCO 方案——titleBarStyle: 'hidden' + titleBarOverlay
  //   保留系统绘制三键与 Win11 贴靠布局；⚠️ 仍不碰 transparent: true（AGENTS.md 已知局限：
  //   transparent 会剥离 WS_CAPTION / WS_THICKFRAME，v0.4.4 严重回归根源），玻璃材质改用
  //   backgroundMaterial（Win11 22H2+），Win10 / 失败环境自动降级为不透明 + 仅透明度
  const glassEnabled = settings?.windowGlassEffect !== 'none' && settings?.windowGlassEffect !== undefined
  const isWin = process.platform === 'win32'
  const isTransparent = glassEnabled && !isWin
  const winGlass = isWin && glassEnabled

  // WCO 按钮区配色随主题（浅/深），运行期由主题变化与 nativeTheme 'updated' 动态更新
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: 'Trace 笔迹',
    backgroundColor: isTransparent ? '#00000000' : winGlass ? '#00000000' : '#f5f6f8',
    transparent: isTransparent,
    // 透明窗口下系统阴影是方形的，会从内容圆角的透明缺口里透出来
    // （浅色壁纸上尤其明显，像直角残留）；窗口层次感由内容卡片阴影承担。
    // win32 走 hidden title bar（保留 WS_THICKFRAME），DWM 阴影正常，恒 true
    hasShadow: !isTransparent,
    ...(isWin
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: overlayThemeFor(settings, nativeTheme.shouldUseDarkColors)
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 应用窗口玻璃效果
  if (settings) {
    applyWindowGlassEffect(mainWindow, settings)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    // 关闭隐藏导出窗口，否则它阻止 window-all-closed → 应用无法退出
    exportPdf?.close()
  })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 移除原生菜单栏（编辑相关操作已内嵌到编辑器工具栏）。
  // 注意必须显式设为 null：不设置时 Electron 会装配默认菜单（File/Edit/View…），
  // 仅靠窗口 autoHideMenuBar 只是隐藏，按 Alt 仍会弹出。
  Menu.setApplicationMenu(null)
  // 跟随系统主题变化同步 WCO 标题栏按钮区配色（应用主题为「跟随系统」时）
  nativeTheme.on('updated', () => {
    const s = settingsService?.get()
    if (s && mainWindow && !mainWindow.isDestroyed()) applyOverlayTheme(mainWindow, s, nativeTheme.shouldUseDarkColors)
  })
  initLogger(path.join(app.getPath('userData'), 'logs'))
  logger.info(`Trace 启动，版本 ${app.getVersion()}`)

  const userData = app.getPath('userData')
  const settingsStore = new JsonStore<AppSettings>(path.join(userData, 'settings.json'), {
    workspaceRoot: '',
    theme: 'system',
    themePreset: 'default',
    editorFontSize: 15,
    autoSave: true,
    zenHideTopbar: false,
    attachmentsDir: 'attachments',
    proxyUrl: '',
    trashRetentionDays: 30,
    trashMaxEntries: 0,
    autoSyncMode: 'off',
    autoSyncIntervalMin: 5,
    enablePlugins: false,
    pluginEnabled: {},
    pluginPermissionsConfirmed: {},
    gitSource: null,
    windowGlassEffect: 'auto',
    windowOpacity: 100,
    sidebarMenus: { recents: true, favorites: true, tags: true, unresolved: true, trash: true },
    showBacklinks: true,
    defaultEditMode: 'source',
    typewriterMode: 'off',
    flowLineWidth: 'medium',
    flowSoundEnabled: false,
    flowSoundVolume: 60,
    flowSoundVariant: 'wood'
  })

  settingsService = new SettingsService(settingsStore)
  const workspace = new WorkspaceService(settingsStore, path.join(os.homedir(), 'Trace'))
  workspace.initDefault()

  // 图片等静态资源协议
  protocol.handle('trace-vault', async (request) => {
    try {
      const url = new URL(request.url)
      const vault = decodeURIComponent(url.hostname)
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '')
      const root = workspace.getRoot()
      if (!root) return new Response('no workspace', { status: 404 })
      const abs = resolveWithin(path.join(root, vault), rel)
      const data = await fs.promises.readFile(abs)
      return new Response(new Uint8Array(data), {
        headers: { 'content-type': MIME_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })

  const trash = new TrashService(() => workspace.getRoot())
  const vaults = new VaultService(() => workspace.getRoot(), trash)
  const vaultMeta = new VaultMetaService(
    new JsonStore(path.join(userData, 'vault-meta.json'), { descs: {} })
  )
  const fsTree = new FsTreeService((vault) => vaults.vaultPath(vault), trash)
  const favorites = new FavoritesService(
    new JsonStore(path.join(userData, 'favorites.json'), { items: [] })
  )
  const recents = new RecentsService(new JsonStore(path.join(userData, 'recents.json'), { items: [] }))
  const tags = new TagsService(
    new JsonStore(path.join(userData, 'tags.json'), { tags: [], noteTags: [] }),
    fsTree,
    () => vaults.list().map((v) => v.name)
  )
  // 旧版（元数据方案）标签关联迁移到各笔记 frontmatter（无旧数据时为空操作）
  void tags.migrateFromNoteTags().then((count) => {
    if (count > 0) logger.info(`标签关联已迁移到笔记 frontmatter：${count} 篇`)
  })
  const themes = new ThemeService(path.join(userData, 'themes'))
  const account = new AccountService(userData)
  const github = new GithubService()
  const git = new GitService({
    getCommitter: () => {
      const username = account.getUsername()
      return username
        ? { name: username, email: `${username}@users.noreply.github.com` }
        : { name: 'Trace', email: 'trace@localhost' }
    },
    getToken: () => account.getToken(),
    getProxyUrl: () => settingsStore.get().proxyUrl ?? '',
    // 内置 git（FR-2.8.13）：用户偏好为 system 时走 PATH；bundled/未选择时优先内置，
    // 内置缺失（开发模式或用户取消了安装组件）则回落系统 git
    getGitBinary: () =>
      pickGitBinary(
        settingsStore.get().gitSource ?? null,
        resolveBundledGitPath(process.resourcesPath)
      )
  })
  // 插件私有存储（settings:persist）：应用数据目录内按插件隔离，绝不写入笔记库
  const pluginStorage = new PluginStorageService(path.join(userData, 'plugin-data'))

  // 插件市场（M4）：索引拉取/缓存/更新对比/下载校验；网络跟随 proxyUrl（D-M4-2）
  const market = new MarketService({
    cachePath: path.join(userData, 'market-cache.json'),
    installedPath: path.join(userData, 'market-installed.json'),
    http: createMarketHttpClient(() => settingsStore.get().proxyUrl ?? null)
  })

  // 侧栏状态区文字（ui:status）：宿主维护，变更即全量广播渲染端
  const pluginStatusTexts = new Map<string, string>()
  const broadcastPluginStatus = (): void => {
    const entries = [...pluginStatusTexts.entries()].map(([id, text]) => ({ id, text }))
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('plugin:status', entries)
  }

  // 插件宿主 v2：每个插件一个 utilityProcess，能力调用经网关按 manifest 权限过滤。
  // 注意声明顺序：watcher 的变更回调要向插件广播 vault:changed，plugins 需先于 watcher 创建
  const plugins = new PluginHost({
    pluginsDir: path.join(userData, 'plugins'),
    sampleDir: app.isPackaged
      ? path.join(process.resourcesPath, 'sample-plugin')
      : path.join(app.getAppPath(), 'resources', 'sample-plugin'),
    settings: settingsStore,
    // bridge.js 与主进程同目录构建（out/main/bridge.js），dev 与打包后路径一致
    bridgePath: path.join(__dirname, 'bridge.js'),
    spawnRuntime: spawnUtilityRuntime,
    gateway: {
      listVaultNames: () => vaults.list().map((v) => v.name),
      vaultPath: (name) => {
        try {
          const p = vaults.vaultPath(name)
          return fs.existsSync(p) ? p : null
        } catch {
          return null
        }
      },
      listTree: (vault) => fsTree.listTree(vault),
      readNote: (vault, relPath) => fsTree.readNote(vault, relPath),
      writeNote: (vault, relPath, content, expectedHash) =>
        fsTree.writeNote(vault, relPath, content, expectedHash),
      createNote: (vault, parentPath, name, content) => {
        const created = fsTree.createNote(vault, parentPath, name)
        if (!created.ok) return created
        const notePath = created.path
        if (content && notePath) {
          const written = fsTree.writeNote(vault, notePath, content, null)
          if (!written.ok) return { ok: false, error: written.error ?? '写入笔记内容失败' }
        }
        return created
      },
      notifyUser: (message) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('plugin:notify', message)
      },
      log: (level, pluginId, args) => {
        logger[level](`[插件 ${pluginId}]`, ...args)
      },
      getStorage: (pluginId) => pluginStorage.backend(pluginId),
      setStatus: (pluginId, text) => {
        pluginStatusTexts.set(pluginId, text)
        broadcastPluginStatus()
      },
      clearStatus: (pluginId) => {
        if (pluginStatusTexts.delete(pluginId)) broadcastPluginStatus()
      }
    },
    storage: pluginStorage,
    stagingDir: path.join(userData, 'plugin-staging'),
    logPath: path.join(userData, 'logs', 'main.log'),
    broadcastToolbars: (items) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('plugin:toolbar', items)
    },
    onPluginStopped: (id) => {
      if (pluginStatusTexts.delete(id)) broadcastPluginStatus()
    },
    clearMarketRecord: (id) => market.removeInstalled(id)
  })
  plugins.init()
  plugins.activateAll()

  const watcher = new WatcherService(
    () => workspace.getRoot(),
    (payload) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('fs:changed', payload)
      // 双链索引增量更新：应用内保存 / 外部编辑 / 删除都会经 chokidar 到达（unlink 由
      // updateFileIndex 内部按文件不存在处理）。 wikilink 在下方才创建，判空防启动窗口期
      for (const p of payload.paths) {
        if (p.endsWith('.md')) void wikilink?.updateFileIndex(payload.vault, p)
      }
      plugins.emitEvent('vault:changed', { vault: payload.vault, paths: payload.paths })
      autoSync.onChanged()
    },
    // git 同步 / 自动同步挂起期间丢弃的事件不会重放，resume 后全量重建双链索引
    () => void wikilink?.buildIndex(true)
  )
  watcher.start()

  exportPdf = new ExportService(() => mainWindow)

  const autoSync = new AutoSyncService({
    getRoot: () => workspace.getRoot(),
    git,
    watcher,
    onVaultSynced: (vault) => plugins.emitEvent('sync:done', { vault }),
    getConfig: () => {
      const s = settingsStore.get()
      // 兼容旧设置：v0.4.2 的 autoSyncEnabled=true 迁移为 interval 模式
      const legacy = s as AppSettings & { autoSyncEnabled?: boolean }
      const mode = s.autoSyncMode ?? (legacy.autoSyncEnabled ? 'interval' : 'off')
      return { mode, intervalMin: s.autoSyncIntervalMin }
    }
  })
  autoSync.apply()
  // 启动时执行一轮回收站过期清理（保留天数 0 = 永不清理）
  try {
    const cleaned = trash.cleanup(settingsStore.get().trashRetentionDays)
    if (cleaned.removed > 0) logger.info(`启动清理：回收站移除 ${cleaned.removed} 条过期条目`)
    const capped = trash.enforceCap()
    if (capped.removed > 0) logger.info(`启动清理：回收站超出容量上限，移除 ${capped.removed} 条最旧条目`)
  } catch (e) {
    logger.warn('回收站启动清理失败', e)
  }

  const search = new SearchService(
    (vault) => vaults.vaultPath(vault),
    () => vaults.list().map((v) => v.name)
  )
  // 应用启动后构建搜索索引
  void search.buildIndex()

  wikilink = new WikilinkService(
    (vault) => vaults.vaultPath(vault),
    () => vaults.list().map((v) => v.name)
  )
  // 注入到 fsTree 供重命名时同步索引
  fsTree.setWikilinkService(wikilink)
  // 应用启动后构建双链索引
  void wikilink.buildIndex()

  registerIpc({
    settings: settingsService,
    workspace,
    vaults,
    vaultMeta,
    fsTree,
    trash,
    favorites,
    recents,
    tags,
    themes,
    account,
    github,
    git,
    watcher,
    plugins,
    autoSync,
    exportPdf,
    search,
    wikilink,
    market,
    getWindow: () => mainWindow
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
