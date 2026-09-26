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
}

export interface PromoteResult {
  ok: boolean
  error?: string
  path?: string
}

/** 从 content 中提取 assets/… 引用（去重，保持出现顺序） */
export function extractAssetRefs(content: string): string[] {
  const refs = new Set<string>()
  for (const m of content.matchAll(/assets\/[^)\s"']+/g)) refs.add(m[0])
  return [...refs]
}

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
  let content = read.content

  const created = opts.createNote(opts.vault, opts.dir, opts.newName)
  if (!created.ok || !created.path) return { ok: false, error: created.error ?? '创建笔记失败' }

  const attach = normalizeAttachDir(opts.attachmentsDir)
  if (!attach.ok) return { ok: false, error: attach.error }
  const vaultPath = opts.vaultPath
  const attachAbs = path.resolve(vaultPath, attach.dir)
  fs.mkdirSync(attachAbs, { recursive: true })
  const existing = new Set(opts.existingAttachments(attachAbs))

  // 图片资产随迁：scratch/assets/x → 目标库附件目录（重名追加序号），引用路径同步改写
  for (const ref of extractAssetRefs(content)) {
    const base = path.posix.basename(ref)
    const base64 = scratch.assetBase64(ref)
    if (base64 === null) continue
    const ext = path.extname(base)
    const stem = path.basename(base, ext)
    let targetName = base
    for (let i = 2; existing.has(targetName); i++) {
      targetName = `${stem}-${i}${ext}`
    }
    existing.add(targetName)
    fs.writeFileSync(path.join(attachAbs, targetName), Buffer.from(base64, 'base64'))
    const newRef = relReference(created.path, `${attach.dir}/${targetName}`)
    content = content.replaceAll(ref, newRef)
    scratch.removeAsset(ref)
  }

  const written = opts.writeNote(opts.vault, created.path, content)
  if (!written.ok) return { ok: false, error: written.error }

  scratch.remove(opts.name)
  return { ok: true, path: created.path }
}

