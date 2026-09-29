import { isNewerVersion, parseLatestVersion, UPDATE_API_URL, UPDATE_REPO } from '../../shared/updateCheck'
import type { UpdateCheckResult } from '../../shared/updateCheck'
import { logger } from '../lib/logger'

/**
 * 新版本检测服务（FR-2.10.6）：
 * - 数据源 = GitHub Releases API latest（匿名请求，单机每日 1–2 次远低于限速）
 * - 网络经注入的 MarketHttpClient（生产 = createMarketHttpClient，跟随 proxyUrl；单测注入桩），
 *   与插件市场共用同一适配器
 * - 检查失败静默（返回 ok:false，渲染端不打扰用户——网络不可达是常态而非异常）
 * - 版本比较与 tag 解析在 shared/updateCheck.ts（纯函数，单测覆盖）
 */

interface TextClient {
  getText(url: string, etag?: string): Promise<{ status: number; body?: string }>
}

interface LatestReleasePayload {
  tag_name?: unknown
  html_url?: unknown
}

export async function checkForUpdate(
  client: TextClient,
  currentVersion: string
): Promise<UpdateCheckResult> {
  const base: UpdateCheckResult = { ok: false, available: false, currentVersion }
  try {
    const res = await client.getText(UPDATE_API_URL)
    if (res.status !== 200 || !res.body) {
      return { ...base, error: `GitHub API 响应异常（HTTP ${res.status}）` }
    }
    const payload = JSON.parse(res.body) as LatestReleasePayload
    if (typeof payload.tag_name !== 'string' || typeof payload.html_url !== 'string') {
      return { ...base, error: 'GitHub API 响应格式异常' }
    }
    const latestVersion = parseLatestVersion(payload.tag_name)
    if (!latestVersion) {
      return { ...base, error: `远端版本号无法解析：${String(payload.tag_name)}` }
    }
    return {
      ok: true,
      available: isNewerVersion(currentVersion, latestVersion),
      currentVersion,
      latestVersion,
      releaseUrl: payload.html_url
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.warn(`新版本检测失败：${message}`)
    return { ...base, error: message }
  }
}

/** 仓库常量转发（IPC 文案与测试引用单点） */
export { UPDATE_REPO }
