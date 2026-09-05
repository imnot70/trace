import { JsonStore } from '../lib/jsonStore'
import type { AppSettings } from '@shared/types'

/** 应用设置（含工作区根目录） */
export class SettingsService {
  constructor(private store: JsonStore<AppSettings>) {}

  get(): AppSettings {
    return this.store.get()
  }

  update(patch: Partial<AppSettings>): AppSettings {
    return this.store.update((s) => Object.assign(s, patch))
  }
}
