/** 编辑器工具栏贡献声明（manifest.contributions.toolbar） */
export interface ManifestToolbarItem {
  /** 按钮显示文本（1-4 个字符的 emoji / 文本） */
  icon?: string
  title: string
  /** 触发的命令（插件内短 id 或完整 `<插件id>.<命令id>`） */
  command: string
}

/** 声明式 UI 贡献点（M3）：插件只声明，渲染进程渲染，插件代码不碰 DOM */
export interface PluginContributions {
  toolbar?: ManifestToolbarItem[]
}

/** 插件清单（plugins/<id>/manifest.json），主进程与插件运行时共用 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  /** 入口文件（CommonJS，相对插件目录），可选 */
  main?: string
  /** 声明的能力权限：notifications / notes:read / notes:write / events / editor:toolbar / ui:status / settings:persist */
  permissions?: string[]
  /** 声明式 UI 贡献点 */
  contributions?: PluginContributions
}

/** 校验清单最小合法性（id/name/version 必填） */
export function isValidManifest(m: Partial<PluginManifest> | null | undefined): m is PluginManifest {
  return !!m && typeof m.id === 'string' && m.id.length > 0 && typeof m.name === 'string' && m.name.length > 0 && typeof m.version === 'string' && m.version.length > 0
}
