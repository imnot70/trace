import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundledGitCandidates,
  parseGitVersion,
  pickGitBinary,
  resolveBundledGitPath
} from '../src/main/services/bundledGit'

describe('parseGitVersion', () => {
  it('解析 Windows 版输出', () => {
    expect(parseGitVersion('git version 2.55.0.windows.5\n')).toBe('2.55.0.windows.5')
  })

  it('解析 Linux 版输出', () => {
    expect(parseGitVersion('git version 2.53.0\n')).toBe('2.53.0')
  })

  it('解析 Apple 版输出（含后缀）', () => {
    expect(parseGitVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5')
  })

  it('无法识别时返回 null', () => {
    expect(parseGitVersion('')).toBeNull()
    expect(parseGitVersion('command not found')).toBeNull()
  })
})

describe('bundledGitCandidates', () => {
  it('Windows 首选 cmd/git.exe，回落 mingw64/bin/git.exe（MinGit 两种布局）', () => {
    expect(bundledGitCandidates('win32')).toEqual([
      path.join('cmd', 'git.exe'),
      path.join('mingw64', 'bin', 'git.exe')
    ])
  })

  it('Linux / macOS 首选 bin/git，回落根目录 git（dugite 布局）', () => {
    expect(bundledGitCandidates('linux')).toEqual([path.join('bin', 'git'), 'git'])
    expect(bundledGitCandidates('darwin')).toEqual([path.join('bin', 'git'), 'git'])
  })
})

describe('resolveBundledGitPath', () => {
  let tmp: string | null = null

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    tmp = null
  })

  it('内置 git 存在时返回绝对路径', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-bundled-'))
    const bin = path.join(tmp, 'git', 'cmd', 'git.exe')
    fs.mkdirSync(path.dirname(bin), { recursive: true })
    fs.writeFileSync(bin, '')
    expect(resolveBundledGitPath(tmp, 'win32')).toBe(bin)
  })

  it('内置 git 不存在时返回 null', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-bundled-'))
    expect(resolveBundledGitPath(tmp, 'win32')).toBeNull()
  })

  it('首选路径缺失时回落到次选路径（布局兼容）', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-bundled-'))
    const bin = path.join(tmp, 'git', 'mingw64', 'bin', 'git.exe')
    fs.mkdirSync(path.dirname(bin), { recursive: true })
    fs.writeFileSync(bin, '')
    expect(resolveBundledGitPath(tmp, 'win32')).toBe(bin)
  })

  it('resourcesPath 为空时返回 null（开发模式 / 未打包）', () => {
    expect(resolveBundledGitPath('', 'win32')).toBeNull()
  })
})

describe('pickGitBinary', () => {
  const bundled = '/res/git/cmd/git.exe'

  it('偏好 system 时始终使用系统 git', () => {
    expect(pickGitBinary('system', bundled)).toBeNull()
    expect(pickGitBinary('system', null)).toBeNull()
  })

  it('偏好 bundled 且内置存在时使用内置', () => {
    expect(pickGitBinary('bundled', bundled)).toBe(bundled)
  })

  it('偏好 bundled 但内置缺失时回落系统 git（避免彻底不可用）', () => {
    expect(pickGitBinary('bundled', null)).toBeNull()
  })

  it('未选择（null）时优先内置，缺失则回落系统 git', () => {
    expect(pickGitBinary(null, bundled)).toBe(bundled)
    expect(pickGitBinary(null, null)).toBeNull()
  })
})
