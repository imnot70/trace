import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeService } from '../src/main/services/themes'

const sakura = { id: 'sakura', name: '樱花', light: { '--accent': '#e07a9b' }, dark: {} }

let dir: string
let svc: ThemeService

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'trace-themes-'))
  svc = new ThemeService(dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ThemeService', () => {
  it('save → list 往返', () => {
    expect(svc.save(sakura).ok).toBe(true)
    expect(svc.list()).toEqual([sakura])
  })

  it('目录不存在时 list 返回空数组', () => {
    expect(new ThemeService(path.join(dir, 'nope')).list()).toEqual([])
  })

  it('list 跳过损坏文件', () => {
    writeFileSync(path.join(dir, 'bad.json'), '{ not json')
    expect(svc.list()).toEqual([])
  })

  it('remove 删除文件并拒绝非法 id', () => {
    svc.save(sakura)
    expect(svc.remove('sakura').ok).toBe(true)
    expect(svc.list()).toEqual([])
    expect(svc.remove('../../etc').ok).toBe(false)
  })

  it('save 拒绝非法主题', () => {
    const r = svc.save({ id: 'warm', name: 'x', light: {}, dark: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('保留')
  })

  it('importFile 读取合法文件、拒绝非法主题', () => {
    const p = path.join(dir, 'in.json')
    writeFileSync(p, JSON.stringify(sakura), 'utf-8')
    expect(svc.importFile(p)).toEqual({ ok: true, theme: sakura })
    writeFileSync(p, '{ broken', 'utf-8')
    expect(svc.importFile(p).ok).toBe(false)
  })
})
