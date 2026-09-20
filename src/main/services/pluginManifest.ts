/** 插件清单（plugins/<id>/manifest.json），主进程与插件运行时共用 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  /** 入口文件（CommonJS，相对插件目录），可选 */
  main?: string
  /** 声明的能力权限：notifications / notes:read / notes:write / events */
  permissions?: string[]
}

/** 校验清单最小合法性（id/name/version 必填） */
export function isValidManifest(m: Partial<PluginManifest> | null | undefined): m is PluginManifest {
  return !!m && typeof m.id === 'string' && m.id.length > 0 && typeof m.name === 'string' && m.name.length > 0 && typeof m.version === 'string' && m.version.length > 0
}
