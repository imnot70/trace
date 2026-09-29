/**
 * 新版本检测（FR-2.10.6）的共享纯逻辑：版本比较 / 节流判定 / 结果类型。
 * 主进程 service 与单测共用；网络请求在主进程（渲染进程不碰网络的架构约束），
 * 节流状态在渲染端 localStorage（上次检查时间），主进程保持无状态。
 */

/** 版本更新检测的 GitHub 仓库（releases/latest 为数据源） */
export const UPDATE_REPO = 'imnot70/trace'
/** 匿名 Releases API 端点 */
export const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
/** 静默检查的最小间隔：24 小时（设置 → 关于的「立即检查」绕过节流） */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 一次检查的结果（渲染端消费；ok=false 时其余字段无意义） */
export interface UpdateCheckResult {
  /** 网络请求与解析是否成功（不代表有新版本） */
  ok: boolean
  /** 是否发现更新（远端版本 > 当前版本） */
  available: boolean
  currentVersion: string
  /** 远端最新版本号（已剥 v 前缀；ok 且 tag 合法时存在） */
  latestVersion?: string
  /** Release 页链接（available 时用于跳转） */
  releaseUrl?: string
  error?: string
}

/** 剥离 tag 的 v 前缀并校验形态；非法返回 null（不抛错——远端数据不可信） */
export function parseLatestVersion(tag: string): string | null {
  const t = tag.trim().replace(/^v/i, '')
  return /^\d+\.\d+\.\d+$/.test(t) ? t : null
}

/** 语义化版本比较：latest 是否严格新于 current（逐段数字比较，缺段按 0） */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string): number[] =>
    v.trim().replace(/^v/i, '').split('.').map((s) => Number.parseInt(s, 10) || 0)
  const [c = [0, 0, 0], l = [0, 0, 0]] = [parse(current), parse(latest)]
  for (let i = 0; i < 3; i++) {
    const ci = c[i] ?? 0
    const li = l[i] ?? 0
    if (li !== ci) return li > ci
  }
  return false
}

/** 节流判定：无记录或距上次超过 24h 才需要检查 */
export function shouldCheckUpdate(lastCheckAt: number | null, now: number): boolean {
  if (lastCheckAt === null || !Number.isFinite(lastCheckAt)) return true
  return now - lastCheckAt >= UPDATE_CHECK_INTERVAL_MS
}
