import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../lib/logger'
import { relReference, resolveWithin } from '../lib/paths'
import { checkNameFormat, normalizeAttachDir } from '@shared/validate'

/**
 * 跨库复制笔记（FR-2.9.11 跨库引用改进）：
 * 双链只在库内解析，跨库「强制引用」的语义是把笔记**复制**进当前库的专用目录再落 [[引用]]——
 * 链接真实可跳转，但与原笔记不再同步（确认框向用户说明的正是这点）。
 *
 * 编排仿 scratchPromote（草稿转正）：建笔记（走命名校验与重名检查）→ 图片资产随迁
 * （复制 + 引用改写，同名同内容复用、同名异内容加序号，不覆盖）→ 写入内容。
 *
 * 去重口径（2026-09-27 二轮，用户反馈同一笔记重复引用同一跨库文件被复制多份）：
 * - 副本统一落在 `targetDir`（渲染端传入「设置目录/源库名」，逐段校验并自动创建）；
 * - 复制前对专用目录下每个现有副本 P 验证：**若当初把本源复制到 P，改写图片引用后的
 *   内容是否与 P 的磁盘内容一致**——一致即同源同版本的未被改动副本，直接复用（不写盘）；
 *   副本被用户改过 → 比对必然失配 → 生成新副本（快照已分叉，符合语义）；
 * - 源笔记修改后再引入 → 改写结果变化 → 生成新快照副本，旧引用仍指旧快照（历史保留）；
 * - 附件：同名同内容复用现有文件（引用指向它），同名异内容才加序号——同一源重复引用时
 *   附件稳定复用，保证改写结果一致、笔记级去重得以命中。
 */

export interface CrossVaultCopyOptions {
  /** 源库名 / 源笔记库内相对路径（含 .md） */
  sourceVault: string
  sourcePath: string
  /** 目标库名 / 目标目录（库内相对路径，可多级，如「跨库引用/库B」；逐段校验 + 自动创建） */
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
  /** 建目录（走 fsTree 的名称 / 层级校验管线）；「已存在」由本服务自行容错 */
  createDir: (vault: string, parentPath: string, name: string) => { ok: boolean; error?: string }
}

export interface CrossVaultCopyResult {
  ok: boolean
  error?: string
  /** 新（或复用）笔记的库内相对路径（含 .md） */
  path?: string
  /** 最终笔记名 */
  name?: string
  /** true = 专用目录里已有同源同版本副本，直接复用未复制 */
  reused?: boolean
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

const md5 = (data: string | Buffer): string => crypto.createHash('md5').update(data).digest('hex')

const stripMd = (fileName: string): string => fileName.replace(/\.md$/i, '')

/** 逐段校验并创建目标目录（防路径逃逸 / 非法名；「已存在」容错）。返回错误信息或 null */
function ensureTargetDir(opts: CrossVaultCopyOptions): string | null {
  const segs = opts.targetDir.split('/').filter(Boolean)
  let parent = ''
  for (const seg of segs) {
    const invalid = checkNameFormat(seg, 'dir')
    if (invalid) return `目标目录名「${seg}」${invalid}`
    const r = opts.createDir(opts.targetVault, parent, seg)
    if (!r.ok && !r.error?.includes('已存在')) return r.error ?? '创建目录失败'
    parent = parent ? `${parent}/${seg}` : seg
  }
  return null
}

interface AttachmentPlan {
  /** 源引用文本 → 目标附件文件名（复用现有或拟新建） */
  refToTarget: Map<string, string>
  /** 需要实际复制的新建附件（确定不复用时才落盘） */
  toCopy: { sourceAbs: string; targetName: string }[]
}

/** 附件计划（只读不写）：同名同内容复用现有文件；同名异内容找可用后缀名待新建 */
function planAttachments(opts: CrossVaultCopyOptions, content: string, attachDir: string): AttachmentPlan {
  const attachAbs = resolveWithin(opts.targetVaultPath, attachDir)
  const sourceNoteDir = path.posix.dirname(opts.sourcePath.split(path.sep).join('/'))
  const refToTarget = new Map<string, string>()
  const toCopy: { sourceAbs: string; targetName: string }[] = []

  const fileMd5 = (abs: string): string | null => {
    try {
      return md5(fs.readFileSync(abs))
    } catch {
      return null
    }
  }

  for (const ref of extractRelRefs(content)) {
    let sourceAbs: string
    try {
      sourceAbs = resolveWithin(opts.sourceVaultPath, path.posix.join(sourceNoteDir, ref))
    } catch {
      continue // 引用逃逸出源库（非法路径）：原样保留
    }
    if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) continue

    const sourceMd5 = fileMd5(sourceAbs)
    if (sourceMd5 === null) continue
    const ext = path.extname(sourceAbs)
    const stem = path.basename(sourceAbs, ext)
    const base = path.basename(sourceAbs)
    const baseAbs = path.join(attachAbs, base)

    let targetName: string
    if (!fs.existsSync(baseAbs)) {
      // 目标没有同名附件：直接用本名新建
      targetName = base
      toCopy.push({ sourceAbs, targetName: base })
    } else if (fileMd5(baseAbs) === sourceMd5) {
      // 同名同内容：复用现有文件（同一来源重复引用时附件稳定复用）
      targetName = base
    } else {
      // 同名异内容：找第一个「不存在（新建）/ 内容恰与源相同（复用）」的后缀名
      targetName = ''
      for (let i = 2; ; i++) {
        const cand = `${stem}-${i}${ext}`
        const candAbs = path.join(attachAbs, cand)
        if (!fs.existsSync(candAbs)) {
          targetName = cand
          toCopy.push({ sourceAbs, targetName: cand })
          break
        }
        if (fileMd5(candAbs) === sourceMd5) {
          targetName = cand
          break
        }
      }
    }
    refToTarget.set(ref, targetName)
  }
  return { refToTarget, toCopy }
}

/** 专用目录下的现有笔记文件名（仅一层，本功能的副本空间） */
function listNoteFiles(dirAbs: string): string[] {
  try {
    return fs
      .readdirSync(dirAbs, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
  } catch {
    return []
  }
}

export function copyNoteAcrossVaults(opts: CrossVaultCopyOptions): CrossVaultCopyResult {
  const read = opts.readNote(opts.sourceVault, opts.sourcePath)
  if (!read.ok) return { ok: false, error: read.error }
  const sourceContent = read.content

  const attach = normalizeAttachDir(opts.attachmentsDir)
  if (!attach.ok) return { ok: false, error: attach.error }
  const attachAbs = resolveWithin(opts.targetVaultPath, attach.dir)

  const dirErr = ensureTargetDir(opts)
  if (dirErr) return { ok: false, error: dirErr }

  // 附件计划先行（只读）：复用 / 拟新建的映射确定后，才可能对「改写后内容」做去重比对
  const plan = planAttachments(opts, sourceContent, attach.dir)
  const rewriteFor = (noteRel: string): string => {
    let content = sourceContent
    for (const [ref, targetName] of plan.refToTarget) {
      content = content.replaceAll(ref, relReference(noteRel, `${attach.dir}/${targetName}`))
    }
    return content
  }

  // 复用扫描：现有副本 P 的磁盘内容 == 按本次源内容 + 附件映射改写到 P 的结果
  // ⇒ P 是同源同版本且未被用户改动的副本，直接复用（不写任何文件）
  const targetDirAbs = path.join(opts.targetVaultPath, opts.targetDir)
  for (const cand of listNoteFiles(targetDirAbs)) {
    const candRel = opts.targetDir ? `${opts.targetDir}/${cand}` : cand
    let disk: string
    try {
      disk = fs.readFileSync(path.join(targetDirAbs, cand), 'utf-8')
    } catch {
      continue
    }
    if (rewriteFor(candRel) === disk) {
      return { ok: true, path: candRel, name: stripMd(cand), reused: true }
    }
  }

  // 新建：重名自动加后缀（对齐回收站还原「冲突自动加后缀、不覆盖」约定）
  const baseName = stripMd(path.basename(opts.sourcePath))
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

  // 附件落盘（只写「拟新建」项；引用改写按最终位置）
  fs.mkdirSync(attachAbs, { recursive: true })
  for (const { sourceAbs, targetName } of plan.toCopy) {
    try {
      fs.copyFileSync(sourceAbs, path.join(attachAbs, targetName))
    } catch (e) {
      logger.warn(`跨库复制：附件随迁失败 ${sourceAbs}`, e)
      continue // 单个附件失败不阻塞整体，引用按计划名保留（文件缺失时预览显示占位）
    }
  }

  const content = rewriteFor(newPath)
  const written = opts.writeNote(opts.targetVault, newPath, content)
  if (!written.ok) return { ok: false, error: written.error ?? '写入笔记失败' }

  return { ok: true, path: newPath, name: finalName, reused: false }
}
