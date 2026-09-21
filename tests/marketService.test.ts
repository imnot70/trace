import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketService, compareVersions, type MarketHttpClient, type MarketIndex } from '../src/main/services/marketService'

/**
 * 插件市场服务（M4 批次一）：
 * - 索引拉取：TTL 缓存 / ETag 304 / 网络失败回退旧缓存（stale）/ 非法条目过滤
 * - checkUpdates：更新判定 / 已下架（未收录）识别 / 语义化版本比较
 * - downloadAndVerify：sha256 一致通过、不一致拒绝并删除文件
 */

let tmp: string
let cachePath: string

const VALID_INDEX: MarketIndex = {
  schemaVersion: 1,
  plugins: [
    {
      id: 'word-count',
      name: '字数统计',
      description: '统计字数',
      author: 'alice',
      repo: 'alice/word-count',
      latest: '1.2.0',
      versions: {
        '1.2.0': {
          releaseTag: 'v1.2.0',
          asset: 'word-count-1.2.0.trace-plugin',
          sha256: 'a'.repeat(64),
          permissions: ['notes:read'],
          releasedAt: '2026-09-01'
        }
      }
    }
  ]
}

function fakeHttp(overrides: Partial<MarketHttpClient> = {}): MarketHttpClient & { calls: { url: string; etag?: string }[] } {
  const calls: { url: string; etag?: string }[] = []
  return {
    calls,
    async getText(url, etag) {
      calls.push({ url, etag })
      return { status: 200, etag: '"etag-1"', body: JSON.stringify(VALID_INDEX) }
    },
    async downloadToFile() {
      return { ok: true }
    },
    ...overrides
  }
}

function makeService(http: MarketHttpClient, opts: { ttlMs?: number; now?: () => number } = {}) {
  return new MarketService({
    cachePath,
    installedPath: path.join(tmp, 'market-installed.json'),
    http,
    ttlMs: opts.ttlMs,
    now: opts.now
  })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-market-'))
  cachePath = path.join(tmp, 'market-cache.json')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('MarketService · 索引拉取与缓存', () => {
  it('首次拉取：解析索引、写入缓存、返回 fromCache=false', async () => {
    const http = fakeHttp()
    const svc = makeService(http)
    const r = await svc.fetchIndex()
    expect(r.ok).toBe(true)
    expect(r.fromCache).toBe(false)
    expect(r.index?.plugins).toHaveLength(1)
    expect(r.index?.plugins[0]).toMatchObject({ id: 'word-count', latest: '1.2.0' })
    expect(fs.existsSync(cachePath)).toBe(true)
    expect(http.calls).toHaveLength(1)
  })

  it('TTL 内直接用缓存，不发网络请求；force 强制拉取', async () => {
    const http = fakeHttp()
    const now = { value: 1_000_000 }
    const svc = makeService(http, { ttlMs: 24 * 3600 * 1000, now: () => now.value })
    await svc.fetchIndex()
    expect(http.calls).toHaveLength(1)

    now.value += 3600 * 1000 // 1 小时后（TTL 内）
    const r = await svc.fetchIndex()
    expect(r.fromCache).toBe(true)
    expect(http.calls).toHaveLength(1) // 未发请求

    await svc.fetchIndex(true) // 强制
    expect(http.calls).toHaveLength(2)
  })

  it('ETag 304：刷新缓存时间且沿用旧索引', async () => {
    let callCount = 0
    const http = fakeHttp({
      async getText(url, etag) {
        callCount += 1
        if (callCount === 1) return { status: 200, etag: '"e1"', body: JSON.stringify(VALID_INDEX) }
        expect(etag).toBe('"e1"')
        return { status: 304 }
      }
    })
    const svc = makeService(http, { ttlMs: 0 }) // 永不过期缓存，每次都走网络
    const first = await svc.fetchIndex(true)
    expect(first.index).toBeDefined()
    const second = await svc.fetchIndex(true)
    expect(second.fromCache).toBe(true)
    expect(second.index).toEqual(first.index)
  })

  it('网络失败时有缓存 → 回退旧缓存（stale）；无缓存 → 失败', async () => {
    const failing = fakeHttp({
      async getText() {
        throw new Error('网络超时')
      }
    })
    const svc = makeService(failing)
    const noCache = await svc.fetchIndex(true)
    expect(noCache.ok).toBe(false)
    expect(noCache.error).toContain('网络超时')

    // 先写入一份合法缓存
    const okHttp = fakeHttp()
    await makeService(okHttp).fetchIndex()
    const withCache = makeService(failing)
    const stale = await withCache.fetchIndex(true)
    expect(stale.ok).toBe(true)
    expect(stale.stale).toBe(true)
    expect(stale.index?.plugins).toHaveLength(1)
  })

  it('非法条目被过滤（缺 id / repo 格式错 / latest 不在 versions）', async () => {
    const messy = {
      schemaVersion: 1,
      plugins: [
        VALID_INDEX.plugins[0],
        { id: 'bad repo', name: 'x', repo: 'a/b', latest: '1.0.0', versions: {} },
        { id: 'nolatest', name: 'x', repo: 'a/b', latest: '9.9.9', versions: {} },
        { name: 'no id', repo: 'a/b', latest: '1.0.0', versions: {} },
        'not-an-object'
      ]
    }
    const http = fakeHttp({ async getText() { return { status: 200, body: JSON.stringify(messy) } } })
    const r = await makeService(http).fetchIndex(true)
    expect(r.index?.plugins).toHaveLength(1)
    expect(r.index?.plugins[0].id).toBe('word-count')
  })
})

describe('MarketService · 更新检查', () => {
  // describe 体在收集期执行，tmp 尚未初始化——服务在各用例内构造
  const getSvc = () => makeService(fakeHttp())

  it('有更高版本 → updates；版本相同 → 不提示', () => {
    const svc = getSvc()
    const index = VALID_INDEX
    expect(svc.checkUpdates(index, [{ id: 'word-count', version: '1.1.0' }]).updates).toHaveLength(1)
    expect(svc.checkUpdates(index, [{ id: 'word-count', version: '1.2.0' }]).updates).toHaveLength(0)
  })

  it('索引中不存在的市场插件 → unlisted（已下架）', () => {
    const svc = getSvc()
    const r = svc.checkUpdates(VALID_INDEX, [
      { id: 'word-count', version: '1.0.0' },
      { id: 'ghost', version: '1.0.0' }
    ])
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0]).toMatchObject({ id: 'word-count', currentVersion: '1.0.0', latestVersion: '1.2.0' })
    expect(r.unlisted).toEqual(['ghost'])
  })
})

describe('compareVersions · 语义化版本比较', () => {
  it('按数字段比较，位数不足补 0', () => {
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2.0')).toBe(1)
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1)
    expect(compareVersions('1.0', '1.0.1')).toBe(-1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })
})

describe('MarketService · 来源登记', () => {
  it('record → getInstalled → removeInstalled 往返与清除', () => {
    const svc = makeService(fakeHttp())
    svc.recordInstalled('word-count', { repo: 'alice/word-count', version: '1.2.0', sha256: 'a'.repeat(64) })
    svc.recordInstalled('other', { repo: 'b/other', version: '0.1.0', sha256: 'b'.repeat(64) })
    expect(svc.getInstalled()['word-count']).toMatchObject({ version: '1.2.0' })

    svc.removeInstalled('word-count')
    expect(svc.getInstalled()['word-count']).toBeUndefined()
    expect(svc.getInstalled()['other']).toBeDefined()
  })

  it('覆盖同 id 记录（升级场景）；无记录 remove 为幂等', () => {
    const svc = makeService(fakeHttp())
    svc.recordInstalled('wc', { repo: 'a/wc', version: '1.0.0', sha256: 'x' })
    svc.recordInstalled('wc', { repo: 'a/wc', version: '2.0.0', sha256: 'y' })
    expect(svc.getInstalled()['wc']).toMatchObject({ version: '2.0.0' })
    svc.removeInstalled('never-existed')
    expect(Object.keys(svc.getInstalled())).toEqual(['wc'])
  })
})

describe('MarketService · 下载校验', () => {
  function httpDownloadTo(content: () => Buffer): MarketHttpClient {
    return fakeHttp({
      async downloadToFile(url, dest) {
        fs.writeFileSync(dest, content())
        return { ok: true }
      }
    })
  }

  function sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex')
  }

  it('sha256 一致 → 保留文件并返回路径', async () => {
    const content = Buffer.from('fake plugin zip')
    const svc = makeService(httpDownloadTo(() => content))
    const r = await svc.downloadAndVerify('a/b', 'v1.0.0', 'p.trace-plugin', sha256(content), path.join(tmp, 'dl'))
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(r.filePath!)).toEqual(content)
  })

  it('sha256 不一致 → 拒绝安装并删除文件（大小写不敏感比对）', async () => {
    const content = Buffer.from('fake plugin zip')
    const tampered = 'X'.repeat(64)
    const svc = makeService(httpDownloadTo(() => content))
    const r = await svc.downloadAndVerify('a/b', 'v1.0.0', 'p.trace-plugin', tampered, path.join(tmp, 'dl'))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('校验和不匹配')
    expect(fs.existsSync(path.join(tmp, 'dl', 'p.trace-plugin'))).toBe(false)
  })

  it('非法资产名拒绝（防路径拼接）', async () => {
    const svc = makeService(httpDownloadTo(() => Buffer.alloc(0)))
    const r = await svc.downloadAndVerify('a/b', 'v1', '../evil.trace-plugin', 'x'.repeat(64), path.join(tmp, 'dl'))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('非法资产名')
  })
})
