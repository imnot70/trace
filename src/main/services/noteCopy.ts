import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../lib/logger'
import { relReference, resolveWithin } from '../lib/paths'
import { normalizeAttachDir } from '@shared/validate'

/**
 * 跨库复制笔记（FR-2.9.11 跨库引用改进）：
 * 双链只在库内解析，跨库「强制引用」的语义是把笔记**复制**进当前库再落 [[引用]]——
 * 链接真实可跳转，但与原笔记不再同步（确认框向用户说明的正是这点）。
 *
 * 编排仿 scratchPromote（草稿转正）：建笔记（走命名校验与重名检查）→ 图片资产随迁
 * （复制 + 引用改写，重名追加序号，不覆盖）→ 写入内容。差异：源是正式库里的普通笔记
 * （含 frontmatter 原样保留），图片引用按「库内相对路径」解析，不局限于 assets/ 前缀。
 */

export interface CrossVaultCopyOptions {
  /** 源库名 / 源笔记库内相对路径（含 .md） */
  sourceVault: string
  sourcePath: string
  /** 目标库名 / 目标目录（库内相对路径，'' = 根） */
  targetVault: string
  targetDir: string
  /** 源库 / 目标库根路径（图片随迁的读写基准） */
  sourceVaultPath: string
  targetVaultPath: string
  /** 目标库附件目录（settings.attachmentsDir） */
  attachmentsDir: string
  /** fsTree 读写由调用方注入（复用命名校验与写入管线，单测可换内存实现） */
  readNote: (vault: string, relPath: string) => { ok: true; content: string } | { ok: false; error: string }
  createNote: (vault: string, dir: string, name: string) => { ok: boolean; error?: string; path?: string }
  writeNote: (vault: string, relPath: string, content: string) => { ok: boolean; error?: string }
}

export interface CrossVaultCopyResult {
  ok: boolean
  error?: string
  /** 新笔记的库内相对路径（含 .md） */
  path?: string
  /** 最终笔记名（与源同名；目标目录重名时自动加后缀 -2 / -3…） */
  name?: string
}

/** 从内容中提取库内相对路径引用（markdown 图片/链接的圆括号目标 + HTML img src），去重保序 */
export function extractRelRefs(content: string): string[] {
  const refs: string[] = []
  const seen = new Set<string>()
  const push = (raw: string): void => {
    const ref = raw.trim()
    if (!ref || seen.has(ref)) return
    // 只随迁库内相对路径；URL（http/协议）与页内锚点原样保留
    if (/^(https?:|trace-vault:|data:|#|\/\/)/i.test(ref)) return
    seen.add(ref)
    refs.push(ref)
  }
  for (const m of content.matchAll(/\]\(([^()\s]+)\)/g)) push(m[1])
  for (const m of content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1])
  return refs
}

export function copyNoteAcrossVaults(opts: CrossVaultCopyOptions): CrossVaultCopyResult {
  const read = opts.readNote(opts.sourceVault, opts.sourcePath)
  if (!read.ok) return { ok: false, error: read.error }
  let content = read.content

  // 建目标笔记：重名自动加后缀（对齐回收站还原「冲突自动加后缀、不覆盖」约定）
  const baseName = path.basename(opts.sourcePath).replace(/\.md$/i, '')
  let created: { ok: boolean; error?: string; path?: string } | null = null
  let finalName = baseName
  for (let i = 1; i <= 99; i++) {
    finalName = i === 1 ? baseName : `${baseName}-${i}`
    const attempt = opts.createNote(opts.targetVault, opts.targetDir, finalName)
    if (attempt.ok) {
      created = attempt
      break
    }
    if (!attempt.error?.includes('已存在')) return { ok: false, error: attempt.error ?? '创建笔记失败' }
  }
  if (!created?.ok || !created.path) return { ok: false, error: '目标目录重名过多，请更换位置后重试' }
  const newPath = created.path

  // 图片资产随迁：解析库内相对引用 → 复制文件到目标库附件目录（重名追加序号）→ 改写引用
  const attach = normalizeAttachDir(opts.attachmentsDir)
  if (!attach.ok) return { ok: false, error: attach.error }
  const attachAbs = resolveWithin(opts.targetVaultPath, attach.dir)
  fs.mkdirSync(attachAbs, { recursive: true })
  const existing = new Set(fs.existsSync(attachAbs) ? fs.readdirSync(attachAbs) : [])
  // 引用以「笔记所在目录」为基准（saveImage 的 relReference 口径）；归一到源库根再解析，
  // 笔记在子目录时的 ../attachments/… 才不会被误判为逃逸
  const sourceNoteDir = path.posix.dirname(opts.sourcePath.split(path.sep).join('/'))

  for (const ref of extractRelRefs(content)) {
    let sourceAbs: string
    try {
      sourceAbs = resolveWithin(opts.sourceVaultPath, path.posix.join(sourceNoteDir, ref))
    } catch {
      continue // 引用逃逸出源库（非法路径）：原样保留
    }
    if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) continue

    const ext = path.extname(sourceAbs)
    const stem = path.basename(sourceAbs, ext)
    let targetName = path.basename(sourceAbs)
    for (let i = 2; existing.has(targetName); i++) {
      targetName = `${stem}-${i}${ext}`
    }
    existing.add(targetName)
    try {
      fs.copyFileSync(sourceAbs, path.join(attachAbs, targetName))
    } catch (e) {
      logger.warn(`跨库复制：附件随迁失败 ${sourceAbs}`, e)
      continue // 单个附件失败不阻塞整体，引用原样保留
    }
    const newRef = relReference(newPath, `${attach.dir}/${targetName}`)
    content = content.replaceAll(ref, newRef)
  }

  const written = opts.writeNote(opts.targetVault, newPath, content)
  if (!written.ok) return { ok: false, error: written.error ?? '写入笔记失败' }

  return { ok: true, path: newPath, name: finalName }
}
