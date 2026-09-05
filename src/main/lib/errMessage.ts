/** 把任意异常转成给用户看的中文信息 */
export function errMessage(e: unknown): string {
  if (e instanceof Error) {
    const anyErr = e as Error & { code?: string; status?: number }
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
