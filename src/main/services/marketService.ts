import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { logger } from '../lib/logger'

/**
 * 插件市场服务（M4，设计第 13 节）：
 * - 从索引仓库（raw.githubusercontent.com）拉取 trace-plugins.json，ETag 条件请求 + 本地缓存（默认 24h TTL）
 * - checkUpdates：已装市场插件与索引 latest 对比，产出可更新列表与已下架（未收录）列表
 * - downloadAndVerify：下载 Release 资产并按索引登记的 sha256 校验（版本锁定：不一致即拒绝）
 *
 * 网络经注入的 MarketHttpClient（生产适配器跟随 proxyUrl；测试注入桩），本模块不依赖 electron。
 */

export const DEFAULT_INDEX_URL =
  'https://raw.githubusercontent.com/imnot70/trace-plugins/main/trace-plugins.json'
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

import type {
  MarketIndex,
  MarketInstalledRecord,
  MarketPlugin,
  MarketUpdateInfo,
  MarketVersion
} from '@shared/types'

export type { MarketIndex, MarketInstalledRecord, MarketPlugin, MarketUpdateInfo, MarketVersion }

export interface MarketHttpClient {
  /** 拉取文本；HTTP 304 时 body 为空 */
  getText(url: string, etag?: string): Promise<{ status: number; etag?: string; body?: string }>
  downloadToFile(url: string, dest: string): Promise<{ ok: boolean; error?: string }>
}

export interface MarketDeps {
  /** 本地缓存文件（userData/market-cache.json） */
  cachePath: string
  /** 市场安装来源登记文件（userData/market-installed.json） */
  installedPath: string
  http: MarketHttpClient
  indexUrl?: string
  ttlMs?: number
  now?: () => number
}

export interface FetchIndexResult {
  ok: boolean
  index?: MarketIndex
  /** 来自本地缓存（TTL 内 / 304 / 网络失败回退） */
  fromCache: boolean
  /** 网络失败时回退到旧缓存（内容可能过期） */
  stale?: boolean
  error?: string
}

const FETCH_FAIL = (error: string): FetchIndexResult => ({ ok: false, fromCache: false, error })

interface CacheFile {
  etag?: string
  fetchedAt: number
  index: MarketIndex
}

const PLUGIN_ID_RE = /^[a-zA-Z0-9_-]+$/
const REPO_RE = /^[^/\s]+\/[^/\s]+$/

/** 语义化版本比较（仅支持数字段；a<b → -1，a=b → 0，a>b → 1） */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.')
  const pb = String(b).split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i] ?? '0', 10) || 0
    const nb = parseInt(pb[i] ?? '0', 10) || 0
    if (na !== nb) return na < nb ? -1 : 1
  }
  return 0
}

/** 过滤非法条目：id 形如目录名、repo 形如 owner/name、latest 必须在 versions 中 */
function sanitizeIndex(raw: unknown): MarketIndex | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { schemaVersion?: unknown; plugins?: unknown }
  if (obj.schemaVersion !== 1 || !Array.isArray(obj.plugins)) return null
  const plugins: MarketPlugin[] = []
  for (const entry of obj.plugins) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Partial<MarketPlugin>
    if (typeof p.id !== 'string' || !PLUGIN_ID_RE.test(p.id)) continue
    if (typeof p.name !== 'string' || typeof p.repo !== 'string' || !REPO_RE.test(p.repo)) continue
    if (typeof p.latest !== 'string' || !p.versions || typeof p.versions !== 'object') continue
    const versions: Record<string, MarketVersion> = {}
    for (const [ver, v] of Object.entries(p.versions)) {
      if (!v || typeof v !== 'object') continue
      const mv = v as Partial<MarketVersion>
      if (
        typeof mv.releaseTag === 'string' &&
        typeof mv.asset === 'string' &&
        typeof mv.sha256 === 'string' &&
        Array.isArray(mv.permissions)
      ) {
        versions[ver] = {
          releaseTag: mv.releaseTag,
          asset: mv.asset,
          sha256: mv.sha256.toLowerCase(),
          permissions: mv.permissions.map(String),
          releasedAt: String(mv.releasedAt ?? '')
        }
      }
    }
    if (!versions[p.latest]) continue
    plugins.push({
      id: p.id,
      name: p.name,
      description: typeof p.description === 'string' ? p.description : '',
      author: typeof p.author === 'string' ? p.author : '',
      repo: p.repo,
      latest: p.latest,
      versions
    })
  }
  return { schemaVersion: 1, plugins }
}

export class MarketService {
  private deps: MarketDeps

  constructor(deps: MarketDeps) {
    // 用 ?? 而非展开覆盖：显式传入的 undefined 可选字段不应抹掉默认值
    this.deps = {
      ...deps,
      indexUrl: deps.indexUrl ?? DEFAULT_INDEX_URL,
      ttlMs: deps.ttlMs ?? DEFAULT_TTL_MS,
      now: deps.now ?? (() => Date.now())
    }
  }

  private readCache(): CacheFile | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.deps.cachePath, 'utf-8')) as CacheFile
      if (!raw || !raw.index || typeof raw.fetchedAt !== 'number') return null
      return raw
    } catch {
      return null
    }
  }

  private writeCache(cache: CacheFile): void {
    try {
      fs.mkdirSync(path.dirname(this.deps.cachePath), { recursive: true })
      const tmp = `${this.deps.cachePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8')
      fs.renameSync(tmp, this.deps.cachePath)
    } catch (e) {
      logger.warn('市场索引缓存写入失败', e)
    }
  }

  /**
   * 拉取索引：
   * - TTL 内且非强制 → 直接用缓存
   * - 网络正常（200）→ 解压校验后更新缓存；304 → 刷新缓存时间
   * - 网络失败但有缓存 → 回退旧缓存（stale: true），保证离线可浏览
   */
  async fetchIndex(force = false): Promise<FetchIndexResult> {
    const cache = this.readCache()
    if (!force && cache && this.deps.now!() - cache.fetchedAt < this.deps.ttlMs!) {
      return { ok: true, index: cache.index, fromCache: true }
    }
    try {
      const res = await this.deps.http.getText(this.deps.indexUrl!, cache?.etag)
      if (res.status === 304 && cache) {
        this.writeCache({ ...cache, fetchedAt: this.deps.now!() })
        return { ok: true, index: cache.index, fromCache: true }
      }
      if (res.status !== 200 || typeof res.body !== 'string') {
        throw new Error(`索引拉取失败（HTTP ${res.status}）`)
      }
      const index = sanitizeIndex(JSON.parse(res.body))
      if (!index) throw new Error('索引格式无效')
      this.writeCache({ etag: res.etag, fetchedAt: this.deps.now!(), index })
      return { ok: true, index, fromCache: false }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (cache) {
        logger.warn(`市场索引拉取失败，回退本地缓存：${message}`)
        return { ok: true, index: cache.index, fromCache: true, stale: true, error: message }
      }
      return FETCH_FAIL(message)
    }
  }

  /**
   * 更新检查：installed 为「来源登记」中的市场插件（id + 当前版本）。
   * - updates：索引中有更高版本
   * - unlisted：索引中不存在的市场插件 id（已被下架删除条目）
   */
  checkUpdates(
    index: MarketIndex,
    installed: Array<{ id: string; version: string }>
  ): { updates: MarketUpdateInfo[]; unlisted: string[] } {
    const updates: MarketUpdateInfo[] = []
    const unlisted: string[] = []
    for (const item of installed) {
      const plugin = index.plugins.find((p) => p.id === item.id)
      if (!plugin) {
        unlisted.push(item.id)
        continue
      }
      if (compareVersions(plugin.latest, item.version) > 0) {
        updates.push({
          id: plugin.id,
          name: plugin.name,
          repo: plugin.repo,
          currentVersion: item.version,
          latestVersion: plugin.latest
        })
      }
    }
    return { updates, unlisted }
  }

  /** 下载 Release 资产到 destDir 并按索引登记的 sha256 校验；不一致删除文件并返回失败 */
  async downloadAndVerify(
    repo: string,
    releaseTag: string,
    asset: string,
    expectedSha256: string,
    destDir: string
  ): Promise<{ ok: boolean; filePath?: string; error?: string }> {
    if (!/^[a-zA-Z0-9._-]+$/.test(asset)) return { ok: false, error: `非法资产名：${asset}` }
    const url = `https://github.com/${repo}/releases/download/${releaseTag}/${asset}`
    fs.mkdirSync(destDir, { recursive: true })
    const filePath = path.join(destDir, asset)
    const dl = await this.deps.http.downloadToFile(url, filePath)
    if (!dl.ok) {
      return { ok: false, error: dl.error ?? '下载失败' }
    }
    try {
      const actual = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
      if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
        fs.rmSync(filePath, { force: true })
        logger.warn(`市场插件校验和不匹配，已拒绝安装：${asset}`)
        return { ok: false, error: '校验和不匹配，安装包与索引登记不一致，已拒绝安装' }
      }
      return { ok: true, filePath }
    } catch (e) {
      return { ok: false, error: `读取下载文件失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  // ---------- 市场安装来源登记（D-M4 设计：只有市场件参与更新检查与下架标记） ----------

  private readInstalled(): Record<string, MarketInstalledRecord> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.deps.installedPath, 'utf-8')) as Record<string, MarketInstalledRecord>
      return raw && typeof raw === 'object' ? raw : {}
    } catch {
      return {}
    }
  }

  getInstalled(): Record<string, MarketInstalledRecord> {
    return this.readInstalled()
  }

  recordInstalled(id: string, record: MarketInstalledRecord): void {
    const data = this.readInstalled()
    data[id] = record
    try {
      fs.mkdirSync(path.dirname(this.deps.installedPath), { recursive: true })
      const tmp = `${this.deps.installedPath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.deps.installedPath)
    } catch (e) {
      logger.warn('市场安装记录写入失败', e)
    }
  }

  /** 卸载插件时清除来源登记 */
  removeInstalled(id: string): void {
    const data = this.readInstalled()
    if (!(id in data)) return
    delete data[id]
    try {
      fs.mkdirSync(path.dirname(this.deps.installedPath), { recursive: true })
      const tmp = `${this.deps.installedPath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.deps.installedPath)
    } catch (e) {
      logger.warn('市场安装记录清除失败', e)
    }
  }
}
