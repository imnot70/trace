import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonStore } from '../src/main/lib/jsonStore'
import { createPermissionsStore } from '../src/main/services/pluginPermissions'
import type { AppSettings } from '../src/shared/types'

/**
 * 插件权限确认记录独立持久化（技术债 2026-09-25 收口）：
 * 旧版记录随 settings.json 存放，现拆独立 plugin-permissions.json，
 * createPermissionsStore 首次构造时一次性迁出（先写新文件后删旧键，幂等）。
 */

let tmp: string

const SETTINGS_DEFAULTS = {
  workspaceRoot: '',
  theme: 'system',
  themePreset: 'default',
  editorFontSize: 16,
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
  sidebarMenus: { recents: true, favorites: true, shared: true, tags: true, unresolved: true, trash: true },
  showBacklinks: true,
  defaultEditMode: 'source',
  serifHeadings: true,
  editPosition: 'start',
  tableDefaultRows: 2,
  tableDefaultCols: 2,
  typewriterMode: 'off',
  flowLineWidth: 'medium',
  flowPaperEnabled: false,
  flowPaperColor: 'cream',
  flowPaperFade: false,
  flowPaperTexture: 'none',
  flowSoundEnabled: false,
  flowSoundVolume: 60,
  flowSoundVariant: 'retro',
  flowSoundSkipRepeat: true,
  skipCrossVaultCopyConfirm: false,
  crossVaultCopyDir: '跨库引用',
  vimEnabled: false
} as unknown as AppSettings

function settingsPath(): string {
  return path.join(tmp, 'settings.json')
}

function permissionsPath(): string {
  return path.join(tmp, 'plugin-permissions.json')
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-plugin-perms-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('插件权限记录独立持久化（迁移自 settings.json）', () => {
  it('旧键迁移：确认记录搬入新文件，settings.json 落盘后不再含旧键', () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ ...SETTINGS_DEFAULTS, pluginPermissionsConfirmed: { sample: ['notes.read', 'notify'] } })
    )
    const settings = new JsonStore<AppSettings>(settingsPath(), SETTINGS_DEFAULTS)
    const store = createPermissionsStore(settings, permissionsPath())

    expect(store.get()['sample']).toEqual(['notes.read', 'notify'])
    // 迁移后设置文件已持久化删除旧键（读回磁盘验证，非仅内存对象）
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) as Record<string, unknown>
    expect(raw.pluginPermissionsConfirmed).toBeUndefined()
    expect(raw.pluginEnabled).toEqual({})
  })

  it('迁移幂等：二次构造不丢记录、不再改写设置', () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ ...SETTINGS_DEFAULTS, pluginPermissionsConfirmed: { sample: ['notes.read'] } })
    )
    const first = createPermissionsStore(new JsonStore<AppSettings>(settingsPath(), SETTINGS_DEFAULTS), permissionsPath())
    expect(first.get()['sample']).toEqual(['notes.read'])

    // 第二次启动：settings.json 已无旧键 → 迁移跳过，记录原样保留、设置文件保持无旧键
    const second = createPermissionsStore(new JsonStore<AppSettings>(settingsPath(), SETTINGS_DEFAULTS), permissionsPath())
    expect(second.get()['sample']).toEqual(['notes.read'])
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) as Record<string, unknown>
    expect(raw.pluginPermissionsConfirmed).toBeUndefined()
  })

  it('无旧键（新装）：不写新文件，记录为空', () => {
    fs.writeFileSync(settingsPath(), JSON.stringify(SETTINGS_DEFAULTS))
    const store = createPermissionsStore(new JsonStore<AppSettings>(settingsPath(), SETTINGS_DEFAULTS), permissionsPath())
    expect(store.get()).toEqual({})
    expect(fs.existsSync(permissionsPath())).toBe(false)
  })
})
