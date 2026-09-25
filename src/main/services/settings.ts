import { JsonStore } from '../lib/jsonStore'
import type { AppSettings } from '@shared/types'

/** 应用设置（含工作区根目录） */
export class SettingsService {
  constructor(private store: JsonStore<AppSettings>) {}

  get(): AppSettings {
    return this.store.get()
  }

  update(patch: Partial<AppSettings>): AppSettings {
    return this.store.update((s) => {
      // 白名单过滤：只接受设置 schema 已知的键——渲染端传来的任意键不得落盘
      //（否则升级换名后幽灵键永远留在 settings.json 里）
      for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
        if (key in s) (s as unknown as Record<string, unknown>)[key] = patch[key]
      }
    })
  }
}
