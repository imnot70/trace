import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ALLOWED_BUILTINS, RequireBlockedError, guardedRequire, isWithinPluginDir } from '../src/main/plugin-runtime/requireGuard'

/**
 * 插件 require 白名单（plugin-design.md 2.2 节 M1 技术防线）：
 * 插件只能 require 自己目录内的文件与无害内置模块，fs/child_process/npm 包一律拒绝。
 */

let tmp: string
let pluginDir: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-reqguard-'))
  pluginDir = path.join(tmp, 'plugins', 'sample')
  fs.mkdirSync(path.join(pluginDir, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(pluginDir, 'helper.js'), 'module.exports = 1')
  fs.writeFileSync(path.join(pluginDir, 'lib', 'deep.js'), 'module.exports = 2')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function run(specifier: string, parentDir = pluginDir): { loaded: string | null; error: string | null } {
  let loaded: string | null = null
  try {
    guardedRequire(specifier, parentDir, pluginDir, (p) => {
      loaded = String(p)
      return null
    })
    return { loaded, error: null }
  } catch (e) {
    return { loaded: null, error: e instanceof Error ? e.message : String(e) }
  }
}

describe('require 白名单 · 内置模块', () => {
  it('允许 path / util / events（含 node: 前缀）', () => {
    for (const spec of ['path', 'node:path', 'util', 'node:util', 'events', 'node:events']) {
      expect(ALLOWED_BUILTINS.has(spec)).toBe(true)
      expect(run(spec).error).toBeNull()
    }
  })

  it('拒绝敏感内置模块：fs / child_process / https / os / http / net', () => {
    for (const spec of ['fs', 'node:fs', 'child_process', 'node:child_process', 'https', 'node:https', 'os', 'http', 'net']) {
      const r = run(spec)
      expect(r.error).toContain('被拒绝')
      expect(r.error).toContain('白名单')
    }
  })

  it('拒绝外部 npm 包（自包含政策）', () => {
    const r = run('lodash')
    expect(r.error).toContain('自包含')
    const scoped = run('@scope/pkg')
    expect(scoped.error).toContain('自包含')
  })
})

describe('require 白名单 · 文件范围', () => {
  it('允许插件目录内的相对路径（含子目录）', () => {
    const a = run('./helper.js')
    expect(a.error).toBeNull()
    expect(a.loaded).toBe(path.resolve(pluginDir, 'helper.js'))

    const b = run('./lib/deep.js')
    expect(b.error).toBeNull()
    expect(b.loaded).toBe(path.resolve(pluginDir, 'lib/deep.js'))
  })

  it('拒绝目录逃逸（../ 跳出插件目录）', () => {
    const outside = path.join(tmp, 'plugins', 'other.js')
    fs.writeFileSync(outside, 'module.exports = 4')
    const r = run('../../other.js', path.join(pluginDir, 'lib'))
    expect(r.error).toContain('自包含')
    expect(r.loaded).toBeNull()
    // 子目录内 ../ 回到插件根目录是合法引用
    expect(run('../helper.js', path.join(pluginDir, 'lib')).error).toBeNull()
  })

  it('拒绝插件目录外的绝对路径', () => {
    const outside = path.join(tmp, 'outside.js')
    fs.writeFileSync(outside, 'module.exports = 3')
    const r = run(outside, path.join(pluginDir, 'lib'))
    expect(r.error).toContain('自包含')
  })

  it('插件目录内不存在的文件报「文件不存在」', () => {
    const r = run('./nope.js')
    expect(r.error).toContain('文件不存在')
  })
})

describe('require 白名单 · 路径判断', () => {
  it('isWithinPluginDir 对嵌套目录与同目录返回 true，对逃逸返回 false', () => {
    expect(isWithinPluginDir(pluginDir, path.join(pluginDir, 'a', 'b.js'))).toBe(true)
    expect(isWithinPluginDir(pluginDir, pluginDir)).toBe(true)
    expect(isWithinPluginDir(pluginDir, path.join(tmp, 'other.js'))).toBe(false)
  })

  it('被拒绝的 require 抛 RequireBlockedError 类型', () => {
    expect(() => guardedRequire('node:fs', pluginDir, pluginDir, () => null)).toThrow(RequireBlockedError)
  })
})
