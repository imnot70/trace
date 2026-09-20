import fs from 'node:fs'
import { net, session } from 'electron'
import { logger } from '../lib/logger'
import type { MarketHttpClient } from './marketService'

/**
 * 市场网络适配器（生产实现）：
 * - 专用 session（trace-market），代理规则按设置 proxyUrl 每次请求前应用——
 *   市场请求无条件跟随 proxyUrl（D-M4-2，与 git 同步行为一致）
 * - getText 返回 ETag 供索引条件请求（304 缓存续期）
 * - downloadToFile 收集响应写入文件（插件包体积小，≤20MB 上限由管线保证）
 * - 基于 net.request：其 options 支持 session（net.fetch 的类型与运行时均不支持）
 * 不可单测（依赖 electron）；单测注入桩 Client。
 */

const REQUEST_TIMEOUT_MS = 30000

let marketSession: Electron.Session | null = null

async function getMarketSession(proxyUrl: string | null): Promise<Electron.Session> {
  marketSession = marketSession ?? session.fromPartition('trace-market')
  const s = marketSession
  try {
    if (proxyUrl) {
      await s.setProxy({ mode: 'fixed_servers', proxyRules: proxyUrl })
    } else {
      await s.setProxy({ mode: 'system' })
    }
  } catch (e) {
    logger.warn('市场代理设置失败，回退系统代理', e)
    await s.setProxy({ mode: 'system' }).catch(() => {})
  }
  return s
}

interface RawResponse {
  status: number
  getHeader: (name: string) => string | null
  data: Buffer
}

function requestRaw(
  url: string,
  s: Electron.Session,
  headers: Record<string, string>
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url, session: s, redirect: 'follow' })
    for (const [name, value] of Object.entries(headers)) req.setHeader(name, value)
    const timer = setTimeout(() => {
      req.abort()
      reject(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）`))
    }, REQUEST_TIMEOUT_MS)
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        clearTimeout(timer)
        resolve({
          status: res.statusCode ?? 0,
          getHeader: (name) => {
            const v = res.headers[name.toLowerCase()]
            return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
          },
          data: Buffer.concat(chunks)
        })
      })
    })
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.end()
  })
}

export function createMarketHttpClient(getProxyUrl: () => string | null): MarketHttpClient {
  return {
    async getText(url: string, etag?: string) {
      const s = await getMarketSession(getProxyUrl())
      const headers: Record<string, string> = { 'User-Agent': 'Trace-Notes-App' }
      if (etag) headers['If-None-Match'] = etag
      const res = await requestRaw(url, s, headers)
      const result: { status: number; etag?: string; body?: string } = { status: res.status }
      const resEtag = res.getHeader('etag')
      if (resEtag) result.etag = resEtag
      if (res.status === 200) result.body = res.data.toString('utf-8')
      return result
    },

    async downloadToFile(url: string, dest: string) {
      try {
        const s = await getMarketSession(getProxyUrl())
        const res = await requestRaw(url, s, { 'User-Agent': 'Trace-Notes-App' })
        if (res.status !== 200) {
          return { ok: false, error: `下载失败（HTTP ${res.status}）` }
        }
        fs.writeFileSync(dest, res.data)
        return { ok: true }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn(`市场资产下载失败：${message}`)
        return { ok: false, error: `下载失败：${message}` }
      }
    }
  }
}
