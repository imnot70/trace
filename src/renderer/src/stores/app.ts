import { defineStore } from 'pinia'
import type { AppSettings } from '@shared/types'

export type ActiveView =
  | { name: 'welcome' }
  | { name: 'editor' }
  | { name: 'trash' }
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
    /** 专注模式：隐藏侧栏与预览，只留编辑卡片（localStorage 持久化） */
    zenMode: false
  }),
  getters: {
    isDark(state): boolean {
      return state.settings.theme === 'dark' || (state.settings.theme === 'system' && prefersDark())
    },
    /** 预览卡片当前是否实际显示 */
    previewShown(state): boolean {
      return state.previewVisible && !state.zenMode
    }
  },
  actions: {
    loadUiPrefs(): void {
      try {
        this.previewVisible = localStorage.getItem('trace.previewVisible') !== '0'
        this.zenMode = localStorage.getItem('trace.zenMode') === '1'
      } catch {
        /* localStorage 不可用时保持默认 */
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
