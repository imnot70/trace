#!/usr/bin/env node
/**
 * 下载并解压内置 Git 到 vendor/git/<platform>/（FR-2.8.13）。
 *
 * 设计要点（详见 requirements/2026-09-10_bundled-git/bundled-git-design.md 第 3.5 节）：
 * - 二进制不入库：`vendor/` 已 gitignore，由本脚本在打包前获取，避免把 ~76 MB 二进制写进 git 历史
 * - 先校验 SHA256 再解压，防供应链篡改（校验失败即中止，fail-closed）
 * - 解压到 `vendor/git/<platform>/`，electron-builder 以 extraResources 原样收进 `resources/git/`；
 *   安装包（NSIS LZMA / deb xz / AppImage squashfs）会自行压缩载荷，故**无需运行时解压**——
 *   运行期零依赖，只需定位可执行文件（见 src/main/services/bundledGit.ts）
 * - 解压后实际执行一次 `git --version` 验证布局正确，避免静默打包出不可用的 git
 *
 * 用法：
 *   node scripts/fetch-git.mjs                    # 当前平台
 *   node scripts/fetch-git.mjs --platform linux   # 指定目标平台
 *   node scripts/fetch-git.mjs --force            # 忽略已有产物，重新下载
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = path.join(ROOT, 'vendor', 'git')

/**
 * 各平台的 Git 发行版（版本与校验和均为固定 pin）。
 * 升级 Git 时须同步更新 url 与 sha256，并在三平台重跑打包验证。
 */
const SOURCES = {
  win32: {
    // MinGit busybox：Git for Windows 的精简发行版，不含 GUI / Bash / Perl（Trace 均不需要）
    url: 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/MinGit-2.55.0.5-busybox-64-bit.zip',
    sha256: 'a0287b54d3ead0c5abd0d15094f5b4c909867aae6bf8b9f2aee7109d24fa0081',
    format: 'zip'
  },
  linux: {
    // dugite-native：GitHub Desktop 同源构建
    url: 'https://github.com/desktop/dugite-native/releases/download/v2.53.0-4/dugite-native-v2.53.0-4098283-ubuntu-x64.tar.gz',
    sha256: 'cca76aa31ad9e835e771ee7f55b73934777fbd8d16757a10d307ba06de860901',
    format: 'tar.gz',
    // 注意：该构建可能包含 Git LFS / Credential Manager（体积约为 arm64 版的 4 倍）。
    // 若后续需要瘦身，见设计文档 3.4 节「待查异常」。
  }
}

/** 内置 git 的候选入口，与 src/main/services/bundledGit.ts 的 bundledGitCandidates 保持一致 */
const CANDIDATES = {
  win32: [path.join('cmd', 'git.exe'), path.join('mingw64', 'bin', 'git.exe')],
  linux: [path.join('bin', 'git'), 'git'],
  darwin: [path.join('bin', 'git'), 'git']
}

function parseArgs(argv) {
  const args = { platform: process.platform, force: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--platform') args.platform = argv[++i]
    else if (argv[i] === '--force') args.force = true
  }
  return args
}

/** 在目标目录中按候选顺序找到可执行文件 */
function findBinary(dir, platform) {
  for (const rel of CANDIDATES[platform] ?? []) {
    const candidate = path.join(dir, rel)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status} ${res.statusText}`)

  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  let lastLogged = 0
  const progress = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length
      const pct = total ? Math.floor((received / total) * 100) : 0
      if (pct >= lastLogged + 25) {
        lastLogged = pct - (pct % 25)
        console.log(`  已下载 ${pct}%（${(received / 1048576).toFixed(1)} MB）`)
      }
      cb(null, chunk)
    }
  })

  await pipeline(Readable.fromWeb(res.body), progress, fs.createWriteStream(dest))
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

async function extract(archive, format, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  if (format === 'zip') {
    // 安全性：调用前已完成 SHA256 校验，归档内容来自官方固定版本，不存在路径穿越风险
    const AdmZip = (await import('adm-zip')).default
    new AdmZip(archive).extractAllTo(targetDir, true)
    return
  }
  const tar = await import('tar')
  await tar.x({ file: archive, cwd: targetDir })
}

/**
 * 若解压结果只有单一顶层目录（部分归档会多套一层），把内容上移一层，
 * 使 resources/git/ 下直接就是 bin/ 或 cmd/。
 */
function flattenSingleRoot(root) {
  const entries = fs.readdirSync(root)
  if (entries.length !== 1) return
  const only = path.join(root, entries[0])
  if (!fs.statSync(only).isDirectory()) return
  for (const item of fs.readdirSync(only)) {
    fs.renameSync(path.join(only, item), path.join(root, item))
  }
  fs.rmSync(only, { recursive: true, force: true })
}

/** 校验解压结果：宿主平台可执行时才真正跑一次 --version */
function verify(targetDir, platform) {
  const binary = findBinary(targetDir, platform)
  if (!binary) {
    throw new Error(
      `解压后未找到 git 可执行文件（候选：${(CANDIDATES[platform] ?? []).join('、')}）`
    )
  }
  // 交叉获取（如在本机为 Linux 拉 Windows 产物）无法执行，只能确认文件存在
  if (platform !== process.platform) {
    console.log(`  ⚠ 目标平台 ${platform} 与宿主 ${process.platform} 不同，跳过执行验证`)
    return null
  }
  const out = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 30_000 })
  if (!/git version/.test(out)) throw new Error(`内置 git 无法执行，输出异常：${out.trim()}`)
  return out.trim()
}

async function main() {
  const { platform, force } = parseArgs(process.argv.slice(2))
  const source = SOURCES[platform]

  if (!source) {
    // macOS 当前仅支持源码构建（见 README），不内置 git，运行时回落到系统 git
    console.log(
      `⏭  平台 ${platform} 未配置内置 Git，跳过（应用将使用系统 Git）。` +
        `当前支持：${Object.keys(SOURCES).join('、')}`
    )
    return
  }

  const targetDir = path.join(VENDOR, platform)

  if (!force && findBinary(targetDir, platform)) {
    console.log(`✅ 内置 Git 已就绪（${path.relative(ROOT, targetDir)}），跳过下载。--force 可强制重取`)
    return
  }

  if (force) fs.rmSync(targetDir, { recursive: true, force: true })

  const archive = path.join(VENDOR, `${platform}.${source.format === 'zip' ? 'zip' : 'tar.gz'}`)
  fs.mkdirSync(VENDOR, { recursive: true })

  console.log(`⬇  下载内置 Git（${platform}）…`)
  console.log(`   ${source.url}`)
  await download(source.url, archive)
  console.log(`   归档大小 ${(fs.statSync(archive).size / 1048576).toFixed(1)} MB`)

  const digest = sha256(archive)
  if (digest !== source.sha256) {
    fs.rmSync(archive, { force: true })
    fs.rmSync(targetDir, { recursive: true, force: true })
    throw new Error(`SHA256 校验失败，已中止。\n  期望 ${source.sha256}\n  实际 ${digest}`)
  }
  console.log('   SHA256 校验通过')

  console.log('📦 解压中…')
  fs.rmSync(targetDir, { recursive: true, force: true })
  await extract(archive, source.format, targetDir)
  flattenSingleRoot(targetDir)

  const version = verify(targetDir, platform)
  // 归档不再需要（内容已落地）；保留归档只会让 vendor/ 翻倍
  fs.rmSync(archive, { force: true })

  console.log(`✅ 内置 Git 就绪：${path.relative(ROOT, targetDir)}${version ? `（${version}）` : ''}`)
}

main().catch((err) => {
  console.error(`\n✖ 获取内置 Git 失败：${err.message}`)
  process.exit(1)
})
