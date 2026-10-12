import { JsonStore } from '../lib/jsonStore'
import type { AppSettings } from '@shared/types'

/** 插件权限确认记录（插件 id → 已确认的 manifest 权限集合） */
export type PluginPermissionRecords = Record<string, string[]>

/**
 * 插件权限确认记录的独立持久化（技术债 2026-09-25 收口）：
 * 记录原先随 settings.json 存放（AppSettings.pluginPermissionsConfirmed），
 * 但它是「应用管理的授予状态」而非用户设置——混在设置里有三个问题：
 * settings:set 白名单纪律旁路（pluginHost 直改设置对象）、settings.json 的
 * schemaVersion 迁移背着插件数据走、设置重置会连带丢权限记录（全部插件
 * 重新弹确认）。现拆独立 plugin-permissions.json（自有 JsonStore 实例），
 * 首次构造时一次性迁移：settings.json 里发现旧键即搬入新文件并从设置中删除。
 * 幂等：先写新文件后删旧键，中断则下次启动重复搬迁同值，无副作用。
 */
export function createPermissionsStore(
  settingsStore: JsonStore<AppSettings>,
  filePath: string
): JsonStore<PluginPermissionRecords> {
  const store = new JsonStore<PluginPermissionRecords>(filePath, {})
  const legacy = (settingsStore.get() as unknown as Record<string, unknown>)
    .pluginPermissionsConfirmed
  if (legacy && typeof legacy === 'object') {
    store.update((records) => {
      Object.assign(records, legacy as PluginPermissionRecords)
    })
    settingsStore.update((s) => {
      delete (s as unknown as Record<string, unknown>).pluginPermissionsConfirmed
    })
  }
  return store
}
