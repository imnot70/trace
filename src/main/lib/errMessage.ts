/** git 网络类错误的友好文案（按匹配优先级排列） */
const GIT_ERROR_PATTERNS: [RegExp, string][] = [
  [/could not resolve host/i, '无法解析 GitHub 地址，请检查网络连接或 DNS 设置'],
  [/failed (?:to )?connect|couldn't connect/i, '无法连接到 GitHub，请检查网络或防火墙设置'],
  [/connection timed out|operation timed out|timed? ?out|aborted by.*timeout/i, '连接 GitHub 超时，请检查网络后重试'],
  [/ssl|connection was reset|connection aborted|early EOF|RPC failed/i, '与 GitHub 的网络连接中断，请稍后重试'],
  [/authentication failed|invalid credentials|403 \(?git/i, 'GitHub 认证失败：令牌可能已过期或权限不足，请到 设置 → 账号 重新登录'],
  [/repository .* not found|not found/i, '远程仓库不存在或没有访问权限'],
  [/no upstream configured|has no upstream/i, '该分支尚未关联远程分支，请尝试重新关联 Git 仓库'],
]

/** 把任意异常转成给用户看的中文信息 */
export function errMessage(e: unknown): string {
  if (e instanceof Error) {
    const anyErr = e as Error & { code?: string; status?: number }
    // git 子进程的网络类报错是英文原文，普通用户无法理解，映射为友好中文
    const msg = anyErr.message ?? ''
    if (/git|fetch|push|pull|remote|github/i.test(msg) || anyErr.message.includes('ConfigFetch')) {
      for (const [pattern, friendly] of GIT_ERROR_PATTERNS) {
        if (pattern.test(msg)) return friendly
      }
    }
    if (anyErr.status === 401 || anyErr.status === 403) return 'GitHub 令牌无效或权限不足'
    if (anyErr.status === 404) return '仓库不存在或没有访问权限'
    if (anyErr.status === 422) return 'GitHub 拒绝了该操作（仓库名可能不合法或已存在）'
    if (['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED'].includes(anyErr.code ?? '')) {
      return '网络连接失败，请检查网络后重试'
    }
    return anyErr.message || '操作失败'
  }
  return String(e)
}
