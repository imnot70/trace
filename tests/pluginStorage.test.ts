import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PluginStorageService } from '../src/main/services/pluginStorage'

/**
 * 插件私有 KV 存储（settings:persist）：
 * - 按插件隔离（一个插件一个 JSON 文件）
 * - 键长度 / 单值 / 总量上限
 * - 值必须 JSON 可序列化
 * - 卸载清除（clear）
 */

let tmp: string
let storage: PluginStorageService

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-pluginstorage-'))
  storage = new PluginStorageService(tmp, { maxValueBytes: 1024, maxTotalBytes: 4096, maxKeyLength: 50 })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('PluginStorageService · 基本读写', () => {
  it('set → get → delete → keys 往返', () => {
    const b = storage.backend('sample')
    expect(b.get('missing')).toEqual({ ok: true, value: null })

    expect(b.set('counter', { n: 3 })).toEqual({ ok: true })
    expect(b.get('counter')).toEqual({ ok: true, value: { n: 3 } })
    expect(b.keys()).toEqual({ ok: true, keys: ['counter'] })

    expect(b.delete('counter')).toEqual({ ok: true })
    expect(b.get('counter')).toEqual({ ok: true, value: null })
    expect(b.keys()).toEqual({ ok: true, keys: [] })
  })

  it('持久化到磁盘（服务重建后仍在）', () => {
    storage.backend('persist').set('k', 'v1')
    const reborn = new PluginStorageService(tmp)
    expect(reborn.backend('persist').get('k')).toEqual({ ok: true, value: 'v1' })
  })

  it('不同插件相互隔离', () => {
    storage.backend('a').set('k', 'from-a')
    storage.backend('b').set('k', 'from-b')
    expect(storage.backend('a').get('k')).toEqual({ ok: true, value: 'from-a' })
    expect(storage.backend('b').get('k')).toEqual({ ok: true, value: 'from-b' })
  })

  it('支持嵌套 JSON 值', () => {
    storage.backend('c').set('obj', { list: [1, 2], nested: { ok: true } })
    expect(storage.backend('c').get('obj')).toEqual({
      ok: true,
      value: { list: [1, 2], nested: { ok: true } }
    })
  })
})

describe('PluginStorageService · 上限与校验', () => {
  it('键为空或超长拒绝', () => {
    const b = storage.backend('sample')
    expect(b.get('')).toMatchObject({ ok: false })
    expect(b.set('', 1)).toMatchObject({ ok: false })
    expect(b.set('x'.repeat(51), 1)).toMatchObject({ ok: false, error: expect.stringContaining('过长') })
  })

  it('undefined 值拒绝', () => {
    expect(storage.backend('sample').set('k', undefined)).toMatchObject({ ok: false })
  })

  it('单个值超出上限拒绝', () => {
    const r = storage.backend('sample').set('big', 'x'.repeat(2048))
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('256KB'.slice(0, 0) || '单个') })
  })

  it('总量超出上限拒绝', () => {
    const b = storage.backend('sample')
    // 总量上限 4096 字节：4 个约 902 字节的键值对约 3608 字节，第 5 个应失败
    for (let i = 0; i < 4; i++) {
      expect(b.set(`k${i}`, 'x'.repeat(900)).ok).toBe(true)
    }
    const r = b.set('overflow', 'x'.repeat(900))
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('总量') })
  })

  it('非法插件 id 拒绝（路径防御）', () => {
    expect(() => storage.backend('../evil')).toThrow('非法插件 id')
  })
})

describe('PluginStorageService · 清理与占用', () => {
  it('clear 删除存储文件，usageBytes 归零', () => {
    const b = storage.backend('sample')
    b.set('k', 'value')
    expect(storage.usageBytes('sample')).toBeGreaterThan(0)
    storage.clear('sample')
    expect(storage.usageBytes('sample')).toBe(0)
    expect(b.get('k')).toEqual({ ok: true, value: null })
  })

  it('usageBytes 无文件时为 0', () => {
    expect(storage.usageBytes('ghost')).toBe(0)
  })
})
