import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initLogger, logger } from './lib/logger'
import { resolveWithin } from './lib/paths'
import { JsonStore } from './lib/jsonStore'
import {
  AccountService,
  FavoritesService,
  FsTreeService,
  GitService,
  GithubService,
  PluginHost,
  RecentsService,
  SettingsService,
  TrashService,
  VaultMetaService,
  VaultService,
  WatcherService,
  WorkspaceService
} from './services'
import { registerIpc } from './ipc/registerIpc'
import type { AppSettings } from '@shared/types'

let mainWindow: BrowserWindow | null = null

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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: 'Trace 笔迹',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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
  initLogger(path.join(app.getPath('userData'), 'logs'))
  logger.info(`Trace 启动，版本 ${app.getVersion()}`)

  const userData = app.getPath('userData')
  const settingsStore = new JsonStore<AppSettings>(path.join(userData, 'settings.json'), {
    workspaceRoot: '',
    theme: 'system',
    editorFontSize: 15,
    autoSave: true,
    zenHideTopbar: false,
    attachmentsDir: 'attachments',
    proxyUrl: '',
    enablePlugins: false,
    pluginEnabled: {}
  })

  const settings = new SettingsService(settingsStore)
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
    getProxyUrl: () => settingsStore.get().proxyUrl ?? ''
  })
  const watcher = new WatcherService(() => workspace.getRoot(), (payload) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('fs:changed', payload)
  })
  watcher.start()

  const plugins = new PluginHost(
    path.join(userData, 'plugins'),
    app.isPackaged ? path.join(process.resourcesPath, 'sample-plugin') : path.join(app.getAppPath(), 'resources', 'sample-plugin'),
    settingsStore,
    () => ({
      notify: (message: string) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('plugin:notify', message)
      },
      logger
    }),
    createRequire(__filename)
  )
  plugins.init()
  plugins.activateAll()

  registerIpc({
    settings,
    workspace,
    vaults,
    vaultMeta,
    fsTree,
    trash,
    favorites,
    recents,
    account,
    github,
    git,
    watcher,
    plugins,
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
