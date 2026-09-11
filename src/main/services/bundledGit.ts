import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 内置 Git 支持（FR-2.8.13）。
 *
 * 交付方式：打包时解压归档到 `resources/git/`（见 scripts/fetch-git.mjs 与 electron-builder.yml），
 * 运行时零解压逻辑，只需定位可执行文件并交给 simple-git。
 */

/** Git 来源偏好（与 shared/types 的 AppSettings.gitSource 一致） */
export type GitSourcePreference = 'system' | 'bundled' | null

/**
 * 内置 git 在 `resources/git/` 下的候选入口（按优先级）。
 * 不假定各发行版目录布局完全一致，逐个探测更稳：
 * - Windows MinGit：`cmd/git.exe`（包装入口，自动设 GIT_EXEC_PATH）→ `mingw64/bin/git.exe`
 * - Linux/macOS dugite-native：`bin/git` → 根目录 `git`
 */
export function bundledGitCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') {
    return [path.join('cmd', 'git.exe'), path.join('mingw64', 'bin', 'git.exe')]
  }
  return [path.join('bin', 'git'), 'git']
}

/**
 * 解析内置 git 可执行文件路径（按候选顺序探测）。
 *
 * @param resourcesPath Electron 的 `process.resourcesPath`；开发模式下该目录不含内置 git
 * @returns 存在则返回绝对路径，否则 `null`
 */
export function resolveBundledGitPath(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!resourcesPath) return null
  try {
    for (const rel of bundledGitCandidates(platform)) {
      const candidate = path.join(resourcesPath, 'git', rel)
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  } catch {
    return null
  }
}

/**
 * 决定本次调用使用的 git 二进制。
 *
 * @returns 二进制绝对路径；`null` 表示交给 simple-git 使用系统 PATH 中的 `git`
 */
export function pickGitBinary(
  gitSource: GitSourcePreference,
  bundledPath: string | null
): string | null {
  // 用户明确选择系统 git：始终走 PATH（即使内置存在）
  if (gitSource === 'system') return null
  // 'bundled' 或尚未选择：优先内置；内置缺失时回落系统 git，避免彻底不可用
  return bundledPath
}

/** 从 `git --version` 的输出中提取版本号（如 `2.55.0.windows.5`） */
export function parseGitVersion(stdout: string): string | null {
  const m = stdout.match(/git version (\S+)/)
  return m ? m[1] : null
}

/**
 * 执行 `<git> --version` 读取版本号。
 * 失败（未安装 / 不可执行 / 超时）返回 `null`，不抛异常。
 */
export function readGitVersion(binary: string, timeoutMs = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binary, ['--version'], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      resolve(parseGitVersion(String(stdout)))
    })
  })
}
