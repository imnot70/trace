import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  exportPluginZip,
  installStaged,
  safeEntryTarget,
  stagePluginZip,
  type PackageLimits
} from '../src/main/services/pluginPackage'

/**
 * .trace-plugin 打包管线（M2）：
 * - 导入：zip-slip 防护、清单校验、入口存在性、炸弹上限
 * - 导出 → 导入往返一致
 * - 安装：同 id 覆盖（升级语义）
 */

let tmp: string
let pluginsDir: string
let stagingDir: string

const smallLimits: PackageLimits = { maxTotalBytes: 64 * 1024, maxEntries: 4 }

function makePluginDir(id: string, version = '1.0.0'): string {
  const dir = path.join(tmp, id)
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ id, name: '测试插件', version, description: 'd', main: 'main.js', permissions: ['notifications'] })
  )
  fs.writeFileSync(path.join(dir, 'main.js'), "exports.activate = () => {}")
  fs.writeFileSync(path.join(dir, 'lib', 'util.js'), "module.exports = 1")
  return dir
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-pluginpkg-'))
  pluginsDir = path.join(tmp, 'plugins')
  stagingDir = path.join(tmp, 'staging')
  fs.mkdirSync(stagingDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('stagePluginZip · 清单与结构', () => {
  it('导出 → 导入往返：文件与清单一致（manifest 在根目录）', () => {
    const dir = makePluginDir('roundtrip')
    const zipPath = path.join(tmp, 'roundtrip.trace-plugin')
    exportPluginZip(dir, zipPath)

    const staged = stagePluginZip(zipPath, stagingDir)
    expect(staged.manifest).toMatchObject({ id: 'roundtrip', version: '1.0.0', main: 'main.js' })
    expect(fs.readFileSync(path.join(staged.stagingPath, 'main.js'), 'utf-8')).toContain('exports.activate')
    expect(fs.existsSync(path.join(staged.stagingPath, 'lib', 'util.js'))).toBe(true)
  })

  it('manifest 位于唯一顶层文件夹内时也能定位', () => {
    const dir = makePluginDir('infolder')
    const zipPath = path.join(tmp, 'infolder.trace-plugin')
    const zip = new AdmZip()
    zip.addLocalFolder(dir, 'infolder')
    zip.writeZip(zipPath)

    const staged = stagePluginZip(zipPath, stagingDir)
    expect(staged.manifest.id).toBe('infolder')
    expect(fs.existsSync(path.join(staged.stagingPath, 'main.js'))).toBe(true)
  })

  it('无效清单（缺 id/name/version）拒绝', () => {
    const zipPath = path.join(tmp, 'bad.trace-plugin')
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ id: 'x' })))
    zip.addFile('main.js', Buffer.from(''))
    zip.writeZip(zipPath)
    expect(() => stagePluginZip(zipPath, stagingDir)).toThrow('必填字段')
  })

  it('不是 zip 的文件拒绝', () => {
    const fake = path.join(tmp, 'fake.trace-plugin')
    fs.writeFileSync(fake, 'not a zip')
    expect(() => stagePluginZip(fake, stagingDir)).toThrow('zip')
  })

  it('声明的入口文件缺失拒绝', () => {
    const zipPath = path.join(tmp, 'noentry.trace-plugin')
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ id: 'ne', name: 'n', version: '1.0.0', main: 'gone.js' })))
    zip.writeZip(zipPath)
    expect(() => stagePluginZip(zipPath, stagingDir)).toThrow('入口文件不存在')
  })
})

describe('stagePluginZip · 安全防护', () => {
  it('zip-slip 条目（../ 逃逸 / 绝对路径 / 盘符）被路径守卫拒绝', () => {
    // adm-zip.addFile 会规范化恶意条目名，无法用它构造真实攻击包；
    // 提取循环的守卫函数是安全边界，直接针对它测试
    expect(safeEntryTarget(stagingDir, '../evil.txt')).toBeNull()
    expect(safeEntryTarget(stagingDir, 'a/../../evil.txt')).toBeNull()
    expect(safeEntryTarget(stagingDir, '/abs.txt')).toBeNull()
    expect(safeEntryTarget(stagingDir, 'C:/abs.txt')).toBeNull()
    expect(safeEntryTarget(stagingDir, 'lib\\util.js')).toBe(path.join(stagingDir, 'lib', 'util.js'))
    expect(safeEntryTarget(stagingDir, 'lib/util.js')).toBe(path.join(stagingDir, 'lib', 'util.js'))
  })

  it('提取循环拒绝恶意条目（手工构造含 .. 条目的包）', () => {
    // 用二进制替换把合法条目名改成 ../evil.txt，模拟真实攻击包
    const zipPath = path.join(tmp, 'slip.trace-plugin')
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ id: 'slip', name: 'n', version: '1.0.0', main: 'main.js' })))
    zip.addFile('normal.txt', Buffer.from('ok'))
    zip.writeZip(zipPath)
    const raw = fs.readFileSync(zipPath)
    const patched = Buffer.from(raw.toString('binary').replaceAll('normal.txt', '..' + String.fromCharCode(92) + 'evil.tx'), 'binary')
    fs.writeFileSync(zipPath, patched)
    expect(() => stagePluginZip(zipPath, stagingDir)).toThrow('不安全')
    expect(fs.existsSync(path.join(tmp, 'evil.txt'))).toBe(false)
  })

  it('条目数与总大小超限拒绝（注入缩小上限）', () => {
    const zipPath = path.join(tmp, 'many.trace-plugin')
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ id: 'many', name: 'n', version: '1.0.0', main: 'main.js' })))
    for (let i = 0; i < 6; i++) zip.addFile(`f${i}.txt`, Buffer.alloc(10))
    zip.writeZip(zipPath)
    expect(() => stagePluginZip(zipPath, stagingDir, smallLimits)).toThrow('上限')

    const bigZip = path.join(tmp, 'big.trace-plugin')
    const big = new AdmZip()
    big.addFile('manifest.json', Buffer.from(JSON.stringify({ id: 'big', name: 'n', version: '1.0.0', main: 'main.js' })))
    big.addFile('blob.bin', Buffer.alloc(128 * 1024))
    big.writeZip(bigZip)
    expect(() => stagePluginZip(bigZip, stagingDir, smallLimits)).toThrow('上限')
  })
})

describe('installStaged · 安装与升级', () => {
  it('安装到 plugins/<id>，覆盖旧目录（升级语义）', () => {
    const dir = makePluginDir('upgrade', '1.0.0')
    const zipPath = path.join(tmp, 'upgrade.trace-plugin')
    exportPluginZip(dir, zipPath)

    // 旧版本已存在（含将被替换的旧文件）
    const oldTarget = path.join(pluginsDir, 'upgrade')
    fs.mkdirSync(oldTarget, { recursive: true })
    fs.writeFileSync(path.join(oldTarget, 'stale.js'), 'old file')

    const staged = stagePluginZip(zipPath, stagingDir)
    const target = installStaged(staged.stagingPath, pluginsDir, staged.manifest.id)
    expect(target).toBe(oldTarget)
    expect(fs.existsSync(path.join(oldTarget, 'main.js'))).toBe(true)
    expect(fs.existsSync(path.join(oldTarget, 'stale.js'))).toBe(false)
  })
})
