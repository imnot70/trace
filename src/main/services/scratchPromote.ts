import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeAttachDir } from '@shared/validate'
import { relReference } from '../lib/paths'
import type { ScratchService } from './scratch'

export interface PromoteOptions {
  /** 草稿文件名（scratch 目录内） */
  name: string
  /** 目标库 */
  vault: string
  /** 目标目录（库内相对路径，'' = 根） */
  dir: string
  /** 转正后的笔记名 */
  newName: string
  /** 目标库内附件目录（settings.attachmentsDir） */
  attachmentsDir: string
  /** 目标库根路径（附件随迁的落盘基准） */
  vaultPath: string
  /** fsTree.createNote / writeNote 由调用方注入（复用命名校验与写入管线） */
  createNote: (vault: string, dir: string, newName: string) => { ok: boolean; error?: string; path?: string }
  writeNote: (vault: string, relPath: string, content: string) => { ok: boolean; error?: string; hash?: string }
  /** 目标库附件目录内已存在的文件名（重名规避） */
  existingAttachments: (attachAbs: string) => string[]
  /** true = 复制模式（FR-2.9.12 引用草稿）：原草稿与其 assets 保留不删；
   *  缺省 false = 转正语义（草稿被消费，Ctrl+S 转正流程） */
  keepDraft?: boolean
}

export interface PromoteResult {
  ok: boolean
  error?: string
  path?: string
  /** true = 目标已存在同内容正式笔记，直接复用（FR-2.9.12 复验反馈：重复引入同一草稿
   *  此前报「名称已存在」——对齐跨库复制的去重语义） */
  reused?: boolean
}

/** 从 content 中提取 assets/… 引用（去重，保持出现顺序） */
export function extractAssetRefs(content: string): string[] {
  const refs = new Set<string>()
  for (const m of content.matchAll(/assets\/[^)\s"']+/g)) refs.add(m[0])
  return [...refs]
}

const md5buf = (b: Buffer): string => crypto.createHash('md5').update(b).digest('hex')

/**
 * 草稿转正编排：在目标库建笔记 → scratch 图片资产随迁（复制 + 引用改写）→ 写入内容 → 删除草稿。
 * 为什么不用 fsTree.writeNote 的吸收逻辑：转正走一次性写入（content 已是最终态），
 * createNote 仅用于走命名校验与重名检查，内容随后被本函数覆写。
 */
export function promoteDraft(
  scratch: ScratchService,
  opts: PromoteOptions
): PromoteResult {
  const read = scratch.read(opts.name)
  if (!read.ok) return { ok: false, error: read.error }
  const sourceContent = read.content

  const attach = normalizeAttachDir(opts.attachmentsDir)
  if (!attach.ok) return { ok: false, error: attach.error }
  const attachAbs = path.resolve(opts.vaultPath, attach.dir)
  fs.mkdirSync(attachAbs, { recursive: true })

  /**
   * 附件随迁 + 引用改写，返回改写后内容。
   * copyAssets = false：只计算「将要写入的内容」（附件按磁盘现状命名，新名不落盘）——
   * 供 keepDraft 的复用比对；附件命名内容感知（同名同内容复用其名、同名异内容找可用
   * 后缀），与 copyNoteAcrossVaults 的 planAttachments 同口径。
   */
  const buildFor = (relPath: string, copyAssets: boolean): string => {
    const existing = new Set(opts.existingAttachments(attachAbs))
    let content = sourceContent
    for (const ref of extractAssetRefs(sourceContent)) {
      const base = path.posix.basename(ref)
      const base64 = scratch.assetBase64(ref)
      if (base64 === null) continue
      const srcMd5 = md5buf(Buffer.from(base64, 'base64'))
      const ext = path.extname(base)
      const stem = path.basename(base, ext)
      const baseAbs = path.join(attachAbs, base)

      let targetName: string
      if (!fs.existsSync(baseAbs)) {
        targetName = base // 目标没有同名附件：直接用本名
      } else if (md5buf(fs.readFileSync(baseAbs)) === srcMd5) {
        targetName = base // 同名同内容：复用现有文件
      } else {
        // 同名异内容：找第一个「不存在（新建）/ 内容恰与源相同（复用）」的后缀名
        targetName = ''
        for (let i = 2; ; i++) {
          const cand = `${stem}-${i}${ext}`
          const candAbs = path.join(attachAbs, cand)
          if (!fs.existsSync(candAbs)) {
            targetName = cand
            break
          }
          if (md5buf(fs.readFileSync(candAbs)) === srcMd5) {
            targetName = cand
            break
          }
        }
      }
      existing.add(targetName)
      if (copyAssets && !fs.existsSync(path.join(attachAbs, targetName))) {
        fs.writeFileSync(path.join(attachAbs, targetName), Buffer.from(base64, 'base64'))
      }
      content = content.replaceAll(ref, relReference(relPath, `${attach.dir}/${targetName}`))
      if (!opts.keepDraft && copyAssets) scratch.removeAsset(ref)
    }
    return content
  }

  // keepDraft（引用草稿复制，FR-2.9.12）的目标已存在处理（2026-09-30 用户反馈，对齐
  // 跨库复制去重语义）：① 草稿未改过（同内容）→ 直接复用已有正式笔记（不写盘、引用
  // 指向它）——重复引入同一草稿不再报「名称已存在」；② 草稿已改过（内容分叉）→ 加
  // -2/-3 后缀生成新快照（历史保留）。转正（Ctrl+S）为交互式选名，保持原报错。
  if (opts.keepDraft) {
    let newSlot: { rel: string; name: string } | null = null
    for (let i = 1; i <= 99 && !newSlot; i++) {
      const name = i === 1 ? opts.newName : `${opts.newName}-${i}`
      const candRel = opts.dir ? `${opts.dir}/${name}.md` : `${name}.md`
      let disk: string | null = null
      try {
        disk = fs.readFileSync(path.resolve(opts.vaultPath, candRel), 'utf-8')
      } catch {
        newSlot = { rel: candRel, name } // 首个不存在的名字 = 新快照位置
        break
      }
      if (buildFor(candRel, false) === disk) {
        return { ok: true, path: candRel, reused: true } // 同内容 → 复用，不写盘
      }
    }
    if (!newSlot) return { ok: false, error: '目标目录重名过多，请更换位置后重试' }
    const created = opts.createNote(opts.vault, opts.dir, newSlot.name)
    if (!created.ok || !created.path) return { ok: false, error: created.error ?? '创建笔记失败' }
    const content = buildFor(created.path, true)
    const written = opts.writeNote(opts.vault, created.path, content)
    if (!written.ok) return { ok: false, error: written.error }
    return { ok: true, path: created.path }
  }

  // 转正（消费草稿）：交互式选名，重名保持报错（用户可在对话框里改）
  const created = opts.createNote(opts.vault, opts.dir, opts.newName)
  if (!created.ok || !created.path) return { ok: false, error: created.error ?? '创建笔记失败' }
  const content = buildFor(created.path, true)
  const written = opts.writeNote(opts.vault, created.path, content)
  if (!written.ok) return { ok: false, error: written.error }
  scratch.remove(opts.name)
  return { ok: true, path: created.path }
}
