import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { isValidManifest, type PluginManifest } from './pluginManifest'

/**
 * .trace-plugin 打包与安装管线（M2，设计第 6 节）：
 * - 格式 = zip 改后缀：manifest.json + 入口 + 全部资源，自包含、无 npm 依赖
 * - 导入：解压到暂存目录（防 zip-slip / 炸弹）→ 清单校验 → 权限确认（渲染端）→ 落盘 plugins/<id>/
 * - 导出：插件目录 → zip
 *
 * 本模块只做文件层操作；权限确认流程由 PluginHost / 渲染端编排。
 */

/** 导入防护默认上限：解压后总大小与条目数（可注入缩小便于测试） */
export interface PackageLimits {
  maxTotalBytes: number
  maxEntries: number
}

export const DEFAULT_PACKAGE_LIMITS: PackageLimits = {
  maxTotalBytes: 20 * 1024 * 1024,
  maxEntries: 2000
}

/** 暂存结果：已解压的插件目录 + 校验通过的清单 */
export interface StagedPlugin {
  stagingPath: string
  manifest: PluginManifest
}

function err(message: string): Error {
  return new Error(message)
}

/** 规范化 zip 条目名并校验目标路径不逃逸出解压根目录（zip-slip 防护）；导出供测试 */
export function safeEntryTarget(extractRoot: string, entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/')
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) return null
  const target = path.resolve(extractRoot, normalized)
  const rel = path.relative(extractRoot, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return target
}

/** 判断是否应忽略的无害杂项条目 */
function isJunkEntry(entryName: string): boolean {
  const normalized = entryName.replace(/\\/g, '/')
  const base = normalized.split('/').pop() ?? ''
  return base === '.DS_Store' || normalized.startsWith('__MACOSX/')
}

/**
 * 从 .trace-plugin（zip）导入：
 * 解压（带防护）→ 定位 manifest.json（根目录或唯一顶层文件夹）→ 清单校验 → 入口文件存在性检查。
 * 失败时抛错并清理暂存。
 */
export function stagePluginZip(zipPath: string, stagingRoot: string, limits: PackageLimits = DEFAULT_PACKAGE_LIMITS): StagedPlugin {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch {
    throw err('无法读取插件包（不是有效的 zip 文件）')
  }

  const entries = zip.getEntries().filter((e) => !isJunkEntry(e.entryName))
  if (entries.length === 0) throw err('插件包为空')
  if (entries.length > limits.maxEntries) throw err(`插件包条目数超出上限（${limits.maxEntries}）`)
  const total = entries.reduce((sum, e) => sum + (e.header.size ?? 0), 0)
  if (total > limits.maxTotalBytes) throw err(`插件包解压后超出大小上限（${Math.floor(limits.maxTotalBytes / 1024 / 1024)}MB）`)

  // manifest 位置：zip 根目录，或唯一顶层文件夹内
  const topLevels = new Set(entries.map((e) => e.entryName.replace(/\\/g, '/').split('/')[0]))
  let prefix = ''
  if (!entries.some((e) => e.entryName.replace(/\\/g, '/') === 'manifest.json')) {
    if (topLevels.size === 1) {
      const [top] = topLevels
      if (!entries.some((e) => e.entryName.replace(/\\/g, '/') === `${top}/manifest.json`)) {
        throw err('插件包中找不到 manifest.json')
      }
      prefix = `${top}/`
    } else {
      throw err('插件包中找不到 manifest.json')
    }
  }

  // 清单先行校验（解压前即可读）
  const manifestEntry = entries.find((e) => e.entryName.replace(/\\/g, '/') === `${prefix}manifest.json`)
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(manifestEntry?.getData().toString('utf-8') ?? '') as PluginManifest
  } catch {
    throw err('manifest.json 不是合法的 JSON')
  }
  if (!isValidManifest(manifest)) throw err('manifest.json 缺少 id / name / version 必填字段')

  // 逐条目解压（防 zip-slip）
  const stagingPath = path.join(stagingRoot, `${manifest.id}-${Date.now().toString(36)}`)
  fs.mkdirSync(stagingPath, { recursive: true })
  try {
    for (const entry of entries) {
      if (entry.isDirectory) continue
      const name = entry.entryName.replace(/\\/g, '/')
      const relInside = name.slice(prefix.length)
      if (relInside.length === 0) continue
      const safeTarget = safeEntryTarget(stagingPath, relInside)
      if (!safeTarget) throw err(`插件包含不安全的路径条目：${name}`)
      fs.mkdirSync(path.dirname(safeTarget), { recursive: true })
      fs.writeFileSync(safeTarget, entry.getData())
    }

    // 入口文件存在性
    if (manifest.main) {
      const entryAbs = path.resolve(stagingPath, manifest.main)
      if (!isWithin(stagingPath, entryAbs) || !fs.existsSync(entryAbs)) {
        throw err(`入口文件不存在：${manifest.main}`)
      }
    }
    return { stagingPath, manifest }
  } catch (e) {
    fs.rmSync(stagingPath, { recursive: true, force: true })
    throw e
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * 安装：暂存目录 → plugins/<manifest.id>。目标已存在时整体替换（升级语义，
 * 调用方需已停用对应插件）。返回安装目录。
 */
export function installStaged(stagingPath: string, pluginsDir: string, manifestId: string): string {
  const target = path.join(pluginsDir, manifestId)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(pluginsDir, { recursive: true })
  fs.cpSync(stagingPath, target, { recursive: true })
  return target
}

/** 导出插件目录为 .trace-plugin（zip） */
export function exportPluginZip(pluginDir: string, outZipPath: string): void {
  const zip = new AdmZip()
  zip.addLocalFolder(pluginDir)
  zip.writeZip(outZipPath)
}
