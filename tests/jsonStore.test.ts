import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonStore } from '../src/main/lib/jsonStore'
import { SettingsService } from '../src/main/services/settings'
import type { AppSettings } from '../src/shared/types'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-jsonstore-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('JsonStore（版本化 / 深合并 / 损坏备份）', () => {
  it('写入后可读回，且无 .tmp 残留', () => {
    const file = path.join(tmp, 'a.json')
    const store = new JsonStore(file, { a: 1, nested: { x: 1 } })
    store.update((d) => {
      d.a = 2
    })
    const reloaded = new JsonStore(file, { a: 1, nested: { x: 1 } })
    expect(reloaded.get().a).toBe(2)
    expect(fs.readdirSync(tmp).some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('深合并：旧数据缺新版本嵌套默认键时补上默认值（浅合并会整体顶掉）', () => {
    const file = path.join(tmp, 'b.json')
    // 模拟旧版本写入的数据：nested 没有 newKey
    fs.writeFileSync(file, JSON.stringify({ nested: { x: 9 } }), 'utf-8')
    const store = new JsonStore(file, { nested: { x: 1, newKey: '默认' } })
    expect(store.get().nested).toEqual({ x: 9, newKey: '默认' })
  })

  it('损坏时保留 .bak 现场并回退默认值', () => {
    const file = path.join(tmp, 'c.json')
    fs.writeFileSync(file, '{ 这不是 JSON', 'utf-8')
    const store = new JsonStore(file, { a: 1 })
    expect(store.get()).toEqual({ a: 1 })
    expect(fs.readFileSync(`${file}.bak`, 'utf-8')).toBe('{ 这不是 JSON')
  })

  it('schemaVersion 写入文件；migrate 钩子对无版本旧数据生效且清理旧键', () => {
    const file = path.join(tmp, 'd.json')
    fs.writeFileSync(file, JSON.stringify({ autoSyncEnabled: true, theme: 'dark' }), 'utf-8')
    const store = new JsonStore<{ theme: string; autoSyncMode: string }>(
      file,
      { theme: 'system', autoSyncMode: 'off' },
      {
        version: 1,
        migrate: (data) => {
          if (data.autoSyncEnabled !== undefined && data.autoSyncMode === undefined) {
            data.autoSyncMode = data.autoSyncEnabled ? 'interval' : 'off'
          }
          delete data.autoSyncEnabled
          return data
        }
      }
    )
    expect(store.get()).toEqual({ theme: 'dark', autoSyncMode: 'interval' })
    store.update(() => {})
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    expect(raw.schemaVersion).toBe(1)
    expect(raw.autoSyncEnabled).toBeUndefined()
  })
})

describe('SettingsService 白名单', () => {
  it('已知键正常更新，未知键不落盘', () => {
    const file = path.join(tmp, 'settings.json')
    const defaults = { theme: 'system', editorFontSize: 15 } as unknown as AppSettings
    const service = new SettingsService(new JsonStore<AppSettings>(file, defaults))
    service.update({ editorFontSize: 20 })
    // 渲染端伪造的未知键（绕过类型系统）必须被过滤
    service.update({ evilKey: 'x' } as unknown as Partial<AppSettings>)
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    expect(raw.editorFontSize).toBe(20)
    expect(raw.evilKey).toBeUndefined()
  })
})
