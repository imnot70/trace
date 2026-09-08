import { defineStore } from 'pinia'
import type { AppSettings } from '@shared/types'

/** 卡片网格视图的区块类型 */
export type GridSection = 'recents' | 'favorites' | 'vaults'

export type ActiveView =
  | { name: 'welcome' }
  | { name: 'editor' }
  | { name: 'trash' }
  /** 常用 / 收藏 / 笔记库 的卡片网格视图（在主区域展示，预览卡片自然收起） */
  | { name: 'grid'; section: GridSection }
  | { name: 'settings'; tab: 'account' | 'plugins' | 'general' }

const DEFAULT_SETTINGS: AppSettings = {
  workspaceRoot: '',
  theme: 'system',
  editorFontSize: 15,
  autoSave: true,
  attachmentsDir: 'attachments',
  enablePlugins: false,
  pluginEnabled: {}
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useAppStore = defineStore('app', {
  state: () => ({
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
    /** 悬浮预览卡片（长按预览按钮触发，会话级不持久化） */
    floatingPreview: false
  }),
  getters: {
    isDark(state): boolean {
      return state.settings.theme === 'dark' || (state.settings.theme === 'system' && prefersDark())
    }
  },
  actions: {
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
      this.previewVisible = !this.previewVisible
      try {
        localStorage.setItem('trace.previewVisible', this.previewVisible ? '1' : '0')
      } catch {
        /* ignore */
      }
    },
    toggleZen(): void {
      this.zenMode = !this.zenMode
      if (this.zenMode) {
        // 进入专注：隐藏预览（预览按钮仍可呼出），记住进入前状态
        this.previewBeforeZen = this.previewVisible
        this.previewVisible = false
      } else {
        this.previewVisible = this.previewBeforeZen
      }
      try {
        localStorage.setItem('trace.zenMode', this.zenMode ? '1' : '0')
      } catch {
        /* ignore */
      }
    },
    async init(): Promise<void> {
      this.loadUiPrefs()
      const [ws, settings, version] = await Promise.all([
        window.trace.getWorkspace(),
        window.trace.getSettings(),
        window.trace.getAppVersion()
      ])
      this.workspaceRoot = ws.root ?? ''
      this.defaultRoot = ws.defaultRoot ?? ''
      if (settings.ok && settings.settings) this.settings = settings.settings
      this.version = version.version ?? ''
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
    },
    async updateSettings(patch: Partial<AppSettings>): Promise<void> {
      this.settings = { ...this.settings, ...patch }
      this.applyTheme()
      await window.trace.setSettings(patch)
    },
    async changeWorkspace(root: string): Promise<string | null> {
      const result = await window.trace.setWorkspace(root)
      if (!result.ok) return result.error ?? '设置失败'
      this.workspaceRoot = root
      return null
    }
  }
})
