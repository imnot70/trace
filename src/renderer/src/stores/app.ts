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
    version: ''
  }),
  getters: {
    isDark(state): boolean {
      return state.settings.theme === 'dark' || (state.settings.theme === 'system' && prefersDark())
    }
  },
  actions: {
    async init(): Promise<void> {
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
