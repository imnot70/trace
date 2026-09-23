import { defineStore } from 'pinia'
import type { AppSettings, ThemePackage } from '@shared/types'
import { useTreeStore } from './tree'
import { THEME_PRESETS, buildThemeCss } from '../styles/presets'
import { effectiveTypewriterMode, flowMeasureEm } from '../lib/flow'
import type { TypewriterMode } from '../lib/typewriter'

/** 卡片网格视图的区块类型 */
export type GridSection = 'recents' | 'favorites' | 'vaults' | 'tags' | 'unresolved'
export type ViewMode = 'grid' | 'list'

export type ActiveView =
  | { name: 'welcome' }
  | { name: 'editor' }
  | { name: 'trash' }
  /** 常用 / 收藏 / 笔记库 / 标签 的卡片网格视图（在主区域展示，预览卡片自然收起）；
   *  笔记库区可携带钻入路径（POSIX 相对路径，首段为库名；缺省 = 库列表级）；
   *  标签区携带 tagId */
  | { name: 'grid'; section: GridSection; vaultPath?: string; tagId?: string }
  | { name: 'settings'; tab: 'account' | 'plugins' | 'general' }

const DEFAULT_SETTINGS: AppSettings = {
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
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useAppStore = defineStore('app', {
  state: () => ({
    // 插件状态区文字（ui:status）与编辑器工具栏按钮（editor:toolbar），由主进程广播
    pluginStatuses: [] as { id: string; text: string }[],
    pluginToolbars: [] as { icon: string; title: string; command: string; pluginId: string }[],
    workspaceRoot: '',
    defaultRoot: '',
    view: { name: 'welcome' } as ActiveView,
    settings: { ...DEFAULT_SETTINGS } as AppSettings,
    version: '',
    /** 编辑视图：是否显示预览卡片（localStorage 持久化） */
    previewVisible: true,
    /** 进入专注模式前的预览状态，退出专注时恢复（会话级不持久化） */
    previewBeforeZen: true,
    /** 专注模式：隐藏侧栏，只留编辑卡片（localStorage 持久化） */
    zenMode: false,
    /** 侧栏显示（手动收起/呼出，localStorage 持久化；专注模式强制隐藏与此独立） */
    sidebarVisible: true,
    /** 专注模式下临时浮出的侧栏（浮层，会话级） */
    zenSidebarOverlay: false,
    /** 从设置等视图返回编辑时置位，EditorView 挂载后聚焦编辑器并清除 */
    focusEditorOnce: false,
    /** 悬浮预览卡片（长按预览按钮触发，会话级不持久化） */
    floatingPreview: false,
    /** 所见即所得（Live Preview）编辑模式：运行态开关，初始值取设置 defaultEditMode（会话级） */
    editorWysiwyg: false,
    /** 心流模式（沉浸创作预设，会话级）：进入时快照外围界面状态，退出还原 */
    flowMode: false,
    /** 进入所见即所得前的预览分栏状态（会话级；由 setEditorWysiwyg 维护） */
    previewBeforeWysiwyg: null as boolean | null,
    /** 进入心流前的外围界面状态快照（侧栏 / 专注 / 预览 / 编辑形态；不持久化） */
    flowSnapshot: null as null | {
      sidebarVisible: boolean
      zenMode: boolean
      previewVisible: boolean
      editorWysiwyg: boolean
    },
    /** 网格/列表视图模式（localStorage 持久化） */
    viewMode: 'grid' as ViewMode,
    /** 已导入的自定义主题（userData/themes），与内置预设在 UI 中并列 */
    customThemes: [] as ThemePackage[]
  }),
  getters: {
    /** 心流模式内实际生效的打字机形态（关闭 → 默认低位；用户选过则沿用） */
    effectiveTypewriterMode(state): TypewriterMode {
      return effectiveTypewriterMode(state.flowMode, state.settings.typewriterMode)
    },
    /** 心流模式写作栏宽（em） */
    flowMeasure(state): number {
      return flowMeasureEm(state.settings.flowLineWidth)
    },
    isDark(state): boolean {
      return state.settings.theme === 'dark' || (state.settings.theme === 'system' && prefersDark())
    },
    allPresets(state): ThemePackage[] {
      return [...THEME_PRESETS, ...state.customThemes]
    }
  },
  actions: {
    /** 库网格：钻入库 / 文件夹（vaultPath = '库名' 或 '库名/文件夹/…'） */
    drillIn(vaultPath: string): void {
      if (this.view.name === 'grid' && this.view.section === 'vaults') {
        this.view = { name: 'grid', section: 'vaults', vaultPath }
        // 更新位置上下文（Ctrl+N 新建笔记的目标）
        const vault = vaultPath.split('/')[0]
        if (vault) useTreeStore().setLocation(vault, vaultPath)
      }
    },
    /** 库网格：回退上一级（已在库列表级时无操作） */
    drillOut(): void {
      if (this.view.name === 'grid' && this.view.section === 'vaults' && this.view.vaultPath) {
        const segs = this.view.vaultPath.split('/').filter(Boolean)
        segs.pop()
        this.view = segs.length
          ? { name: 'grid', section: 'vaults', vaultPath: segs.join('/') }
          : { name: 'grid', section: 'vaults' }
      }
    },
    /** 打开 / 关闭某区块的卡片网格（与侧栏标题点击行为一致） */
    toggleGridSection(section: GridSection): void {
      if (this.view.name === 'grid' && this.view.section === section) this.view = { name: 'welcome' }
      else this.view = { name: 'grid', section }
    },
    openFloatingPreview(): void {
      this.floatingPreview = true
    },
    closeFloatingPreview(): void {
      this.floatingPreview = false
    },
    loadUiPrefs(): void {
      try {
        this.previewVisible = localStorage.getItem('trace.previewVisible') !== '0'
        this.zenMode = localStorage.getItem('trace.zenMode') === '1'
        this.sidebarVisible = localStorage.getItem('trace.sidebarVisible') !== '0'
        const vm = localStorage.getItem('trace.viewMode')
        if (vm === 'grid' || vm === 'list') this.viewMode = vm
      } catch {
        /* localStorage 不可用时保持默认 */
      }
      // 上次退出时仍在专注模式：启动即隐藏预览（保持专注语义一致）
      if (this.zenMode) {
        this.previewBeforeZen = this.previewVisible
        this.previewVisible = false
      }
    },
    togglePreview(): void {
      this.setPreviewVisible(!this.previewVisible)
    },
    setPreviewVisible(v: boolean): void {
      // 所见即所得模式下预览分栏强制收起（需求 D2）：Alt+V / 预览按钮不得展开
      if (v && this.editorWysiwyg) return
      this.previewVisible = v
      try {
        localStorage.setItem('trace.previewVisible', v ? '1' : '0')
      } catch {
        /* ignore */
      }
    },
    /**
     * 切换所见即所得编辑模式。预览分栏的收起 / 恢复由这里统一维护
     * （原先在 EditorView 的 watcher 里：组件重挂载会丢失「进入前分栏状态」的记忆，
     *  且心流模式的进入 / 退出会与它互相覆盖，实测退出心流后预览未能还原）。
     */
    setEditorWysiwyg(on: boolean): void {
      if (on === this.editorWysiwyg) return
      if (on) {
        if (this.previewBeforeWysiwyg === null) this.previewBeforeWysiwyg = this.previewVisible
        this.previewVisible = false
      } else if (this.previewBeforeWysiwyg !== null) {
        this.previewVisible = this.previewBeforeWysiwyg
        this.previewBeforeWysiwyg = null
      }
      this.editorWysiwyg = on
    },
    toggleEditorMode(): void {
      this.setEditorWysiwyg(!this.editorWysiwyg)
    },
    /**
     * 进入心流模式：快照外围界面状态 → 拨动各轴（沉浸）。
     * 只改会话状态，不改设置项（打字机形态由 effectiveTypewriterMode 推导）。
     */
    enterFlow(): void {
      if (this.flowMode) return
      this.flowSnapshot = {
        sidebarVisible: this.sidebarVisible,
        zenMode: this.zenMode,
        previewVisible: this.previewVisible,
        editorWysiwyg: this.editorWysiwyg
      }
      this.zenSidebarOverlay = false
      this.floatingPreview = false
      this.editorWysiwyg = true
      this.zenMode = true
      this.sidebarVisible = false
      this.previewVisible = false
      this.flowMode = true
    },
    /** 退出心流模式：还原进入前的外围界面状态 */
    exitFlow(): void {
      if (!this.flowMode) return
      const snap = this.flowSnapshot
      this.flowMode = false
      this.zenSidebarOverlay = false
      if (snap) {
        this.sidebarVisible = snap.sidebarVisible
        this.zenMode = snap.zenMode
        this.previewVisible = snap.previewVisible
        this.editorWysiwyg = snap.editorWysiwyg
      }
      this.flowSnapshot = null
      try {
        localStorage.setItem('trace.zenMode', this.zenMode ? '1' : '0')
        localStorage.setItem('trace.sidebarVisible', this.sidebarVisible ? '1' : '0')
        localStorage.setItem('trace.previewVisible', this.previewVisible ? '1' : '0')
      } catch {
        /* ignore */
      }
    },
    toggleFlow(): void {
      if (this.flowMode) this.exitFlow()
      else this.enterFlow()
    },
    toggleZen(): void {
      this.zenMode = !this.zenMode
      if (this.zenMode) {
        // 进入专注：隐藏预览（预览按钮仍可呼出），记住进入前状态
        this.previewBeforeZen = this.previewVisible
        this.previewVisible = false
      } else {
        // 退出专注：所见即所得模式下预览保持收起
        this.previewVisible = this.previewBeforeZen && !this.editorWysiwyg
      }
      try {
        localStorage.setItem('trace.zenMode', this.zenMode ? '1' : '0')
      } catch {
        /* ignore */
      }
    },
    toggleSidebar(): void {
      this.sidebarVisible = !this.sidebarVisible
      try {
        localStorage.setItem('trace.sidebarVisible', this.sidebarVisible ? '1' : '0')
      } catch {
        /* ignore */
      }
    },
    toggleZenSidebar(): void {
      this.zenSidebarOverlay = !this.zenSidebarOverlay
    },
    setViewMode(mode: ViewMode): void {
      this.viewMode = mode
      try {
        localStorage.setItem('trace.viewMode', mode)
      } catch {
        /* ignore */
      }
    },
    closeZenSidebar(): void {
      this.zenSidebarOverlay = false
    },
    async init(): Promise<void> {
      this.loadUiPrefs()
      const [ws, settings, version, themes] = await Promise.all([
        window.trace.getWorkspace(),
        window.trace.getSettings(),
        window.trace.getAppVersion(),
        window.trace.listThemes()
      ])
      this.workspaceRoot = ws.root ?? ''
      this.defaultRoot = ws.defaultRoot ?? ''
      if (settings.ok && settings.settings) this.settings = settings.settings
      if (themes.ok && themes.themes) this.customThemes = themes.themes
      this.version = version.version ?? ''
      // 所见即所得模式的会话初始值来自设置默认编辑模式（FR-W1）；
      // 为所见即所得时同步收起预览分栏（保持「内容已所见即所得」的一致语义）
      if (this.settings.defaultEditMode === 'wysiwyg') {
        this.previewBeforeWysiwyg = this.previewVisible
        this.previewVisible = false
        this.editorWysiwyg = true
      }
      this.applyTheme()
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.settings.theme === 'system') this.applyTheme()
      })
    },
    applyTheme(): void {
      const dark =
        this.settings.theme === 'dark' ||
        (this.settings.theme === 'system' && prefersDark())
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      // 注入预设主题包 CSS 变量覆盖
      const presetId = this.settings.themePreset ?? 'default'
      let el = document.getElementById('trace-theme-preset')
      if (presetId === 'default') {
        if (el) el.textContent = ''
        return
      }
      const preset = this.allPresets.find((p) => p.id === presetId)
      if (!preset) {
        if (el) el.textContent = ''
        return
      }
      if (!el) {
        el = document.createElement('style')
        el.id = 'trace-theme-preset'
        document.head.appendChild(el)
      }
      el.textContent = buildThemeCss(preset)
    },
    async updateSettings(patch: Partial<AppSettings>): Promise<void> {
      this.settings = { ...this.settings, ...patch }
      this.applyTheme()
      await window.trace.setSettings(patch)
    },
    async reloadCustomThemes(): Promise<void> {
      const result = await window.trace.listThemes()
      if (result.ok && result.themes) this.customThemes = result.themes
    },
    /** 选择文件并校验；不写盘（覆盖确认由视图层完成后调用 saveTheme） */
    async importThemeFile(): Promise<{ theme?: ThemePackage; canceled?: boolean; error?: string }> {
      const result = await window.trace.importTheme()
      return { theme: result.theme, canceled: result.canceled, error: result.error }
    },
    /** 落盘并立即应用新主题；失败返回错误信息 */
    async saveTheme(theme: ThemePackage): Promise<string | null> {
      const result = await window.trace.saveTheme(theme)
      if (!result.ok) return result.error ?? '保存失败'
      await this.reloadCustomThemes()
      await this.updateSettings({ themePreset: theme.id })
      return null
    },
    /** 删除主题；若删除的是当前主题则回退默认 */
    async deleteTheme(id: string): Promise<string | null> {
      const result = await window.trace.deleteTheme(id)
      if (!result.ok) return result.error ?? '删除失败'
      await this.reloadCustomThemes()
      if (this.settings.themePreset === id) await this.updateSettings({ themePreset: 'default' })
      return null
    },
    async changeWorkspace(root: string): Promise<string | null> {
      const result = await window.trace.setWorkspace(root)
      if (!result.ok) return result.error ?? '设置失败'
      this.workspaceRoot = root
      return null
    }
  }
})
