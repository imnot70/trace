import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'

/**
 * 插件 require 白名单（plugin-design.md 2.2 节 M1 技术防线）：
 * - 允许：插件目录内的相对/绝对文件（自包含政策）
 * - 允许：少量无害 Node 内置模块（path / util / events）
 * - 拒绝：敏感内置模块（fs / child_process / https / os …）、外部 npm 包、目录逃逸
 *
 * 纯函数实现便于单元测试；bridge 中挂到 Module._load 上使用。
 */

/** 允许插件 require 的内置模块（含 node: 前缀两种写法） */
export const ALLOWED_BUILTINS = new Set(['path', 'util', 'events', 'node:path', 'node:util', 'node:events'])

export class RequireBlockedError extends Error {
  constructor(specifier: string, reason: string) {
    super(`插件 require 被拒绝：${specifier}（${reason}）`)
    this.name = 'RequireBlockedError'
  }
}

/** 判断目标路径是否位于插件目录内（resolve 后比较，防 ../ 逃逸与符号链接大小写差异不做） */
export function isWithinPluginDir(pluginDir: string, target: string): boolean {
  const rel = path.relative(pluginDir, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * 解析插件的一次 require 调用，返回应加载的模块，或抛 RequireBlockedError。
 * loader 由调用方注入（生产为 Module.prototype.require，测试可为桩）。
 */
export function guardedRequire(
  specifier: string,
  parentDir: string,
  pluginDir: string,
  load: (resolvedPath: string) => unknown
): unknown {
  // 内置模块白名单
  if (specifier.startsWith('node:') || isBuiltinName(specifier)) {
    if (ALLOWED_BUILTINS.has(specifier)) {
      return load(specifier)
    }
    throw new RequireBlockedError(specifier, '敏感内置模块不在白名单内')
  }

  // 相对 / 绝对路径：限定在插件目录内
  if (specifier.startsWith('./') || specifier.startsWith('../') || path.isAbsolute(specifier)) {
    const base = path.isAbsolute(specifier) ? path.dirname(specifier) : parentDir
    const resolved = path.resolve(base, specifier)
    if (!isWithinPluginDir(pluginDir, resolved)) {
      throw new RequireBlockedError(specifier, '自包含政策：只能加载插件目录内的文件')
    }
    if (!fileExists(resolved)) {
      throw new RequireBlockedError(specifier, '文件不存在')
    }
    return load(resolved)
  }

  // 裸包名（npm 依赖）：插件必须自包含，禁止外部依赖
  throw new RequireBlockedError(specifier, '自包含政策：禁止加载插件目录外的 npm 包')
}

/** 裸名内置模块判断（builtinModules 为 Node 官方内置名单，不含 node: 前缀） */
const BUILTIN_NAMES = new Set(builtinModules)

function isBuiltinName(specifier: string): boolean {
  return BUILTIN_NAMES.has(specifier)
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile() || fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
