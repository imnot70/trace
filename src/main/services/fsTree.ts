import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_ATTACH_DIR,
  MAX_DIR_DEPTH,
  checkNameFormat,
  checkDuplicate,
  normalizeAttachDir,
  noteFileName,
  noteDisplayName,
  relDepth
} from '@shared/validate'
import { resolveWithin, toRelPath, relReference } from '../lib/paths'
import type { TreeNode } from '@shared/types'
import type { TrashService } from './trash'

/** 内容 hash：用于外部修改检测 */
export function contentHash(content: string): string {
  return crypto.createHash('md5').update(content, 'utf-8').digest('hex')
}

/**
 * 库内目录 / 笔记管理。
 * 相对路径统一为 POSIX 风格（'a/b'），'' 表示库根。
 */
export class FsTreeService {
  constructor(
    private getVaultPath: (vault: string) => string,
    private trash: TrashService
  ) {}

  listTree(vault: string): TreeNode[] {
    return this.scan(this.getVaultPath(vault), '')
  }

  private scan(absDir: string, rel: string): TreeNode[] {
    const dirs: TreeNode[] = []
    const notes: TreeNode[] = []
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        dirs.push({ name: e.name, path: childRel, kind: 'dir', children: this.scan(path.join(absDir, e.name), childRel) })
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        notes.push({ name: noteDisplayName(e.name), path: childRel, kind: 'note' })
      }
    }
    const cmp = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, 'zh')
    dirs.sort(cmp)
    notes.sort(cmp)
    return [...dirs, ...notes]
  }

  createDir(vault: string, parentPath: string, name: string): { ok: boolean; error?: string } {
    try {
      const parentAbs = this.subdirAbs(vault, parentPath)
      const invalid =
        checkNameFormat(name, 'dir') ??
        checkDuplicate(name, this.dirNames(parentAbs), 'dir') ??
        (relDepth(parentPath) + 1 > MAX_DIR_DEPTH ? '已达最大层数' : null)
      if (invalid) return { ok: false, error: invalid }
      fs.mkdirSync(path.join(parentAbs, name))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  createNote(vault: string, parentPath: string, name: string): { ok: boolean; error?: string; path?: string } {
    try {
      const parentAbs = this.subdirAbs(vault, parentPath)
      const invalid = checkNameFormat(name, 'note') ?? checkDuplicate(name, this.noteNames(parentAbs), 'note')
      if (invalid) return { ok: false, error: invalid }
      const fileName = noteFileName(name)
      const fileRel = parentPath ? `${parentPath}/${fileName}` : fileName
      fs.writeFileSync(path.join(parentAbs, fileName), `# ${noteDisplayName(fileName)}\n\n`, 'utf-8')
      return { ok: true, path: fileRel }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  renameNode(
    vault: string,
    relPath: string,
    kind: 'dir' | 'note',
    newName: string
  ): { ok: boolean; error?: string; newPath?: string } {
    try {
      const vaultPath = this.getVaultPath(vault)
      const abs = resolveWithin(vaultPath, relPath)
      if (!fs.existsSync(abs)) return { ok: false, error: '目标不存在' }
      const parentAbs = path.dirname(abs)
      const invalid =
        checkNameFormat(newName, kind) ??
        checkDuplicate(
          newName,
          kind === 'dir' ? this.dirNames(parentAbs) : this.noteNames(parentAbs),
          kind
        )
      if (invalid) return { ok: false, error: invalid }
      const newBase = kind === 'note' ? noteFileName(newName) : newName
      const parentRel = path.posix.dirname(relPath.split(path.sep).join('/'))
      const newRel = parentRel === '.' ? newBase : `${parentRel}/${newBase}`
      if (newRel === relPath) return { ok: true, newPath: newRel }
      fs.renameSync(abs, path.join(parentAbs, newBase))
      return { ok: true, newPath: newRel }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  deleteNode(vault: string, relPath: string, kind: 'dir' | 'note'): { ok: boolean; error?: string } {
    return this.trash.put({ vault, path: toRelPath(this.getVaultPath(vault), resolveWithin(this.getVaultPath(vault), relPath)), kind })
  }

  readNote(vault: string, relPath: string): { ok: true; content: string; hash: string } | { ok: false; error: string } {
    try {
      const abs = resolveWithin(this.getVaultPath(vault), relPath)
      const content = fs.readFileSync(abs, 'utf-8')
      return { ok: true, content, hash: contentHash(content) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 写入笔记。expectedHash 为渲染进程最后读到的磁盘内容 hash，
   * 不一致说明文件已被外部修改，拒绝覆盖以防丢失数据。
   */
  writeNote(vault: string, relPath: string, content: string, expectedHash: string | null): { ok: boolean; error?: string; hash?: string } {
    try {
      const abs = resolveWithin(this.getVaultPath(vault), relPath)
      if (expectedHash !== null) {
        let current: string
        try {
          current = fs.readFileSync(abs, 'utf-8')
        } catch {
          return { ok: false, error: '笔记文件不存在，可能已被删除或移动' }
        }
        if (contentHash(current) !== expectedHash) {
          return { ok: false, error: '笔记已被外部修改，请先备份当前内容后重试' }
        }
      }
      fs.writeFileSync(abs, content, 'utf-8')
      return { ok: true, hash: contentHash(content) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 保存粘贴/拖入的图片到库内附件目录（可配置多级），返回相对笔记的引用路径 */
  saveImage(
    vault: string,
    notePath: string,
    fileName: string,
    base64: string,
    attachDir = DEFAULT_ATTACH_DIR
  ): { ok: boolean; error?: string; reference?: string } {
    try {
      const dir = normalizeAttachDir(attachDir)
      if (!dir.ok) return { ok: false, error: dir.error }
      const vaultPath = this.getVaultPath(vault)
      const attachAbs = resolveWithin(vaultPath, dir.dir)
      fs.mkdirSync(attachAbs, { recursive: true })
      const ext = path.extname(fileName) || '.png'
      const base = path.basename(fileName, ext).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 60) || 'image'
      const unique = `${Date.now()}-${base}${ext.toLowerCase()}`
      fs.writeFileSync(path.join(attachAbs, unique), Buffer.from(base64, 'base64'))
      return { ok: true, reference: relReference(notePath, `${dir.dir}/${unique}`) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private subdirAbs(vault: string, parentPath: string): string {
    const vaultPath = this.getVaultPath(vault)
    const abs = resolveWithin(vaultPath, parentPath || '')
    if (!fs.existsSync(abs)) throw new Error('父目录不存在')
    return abs
  }

  private dirNames(absDir: string): string[] {
    return fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
  }

  private noteNames(absDir: string): string[] {
    return fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && !e.name.startsWith('.'))
      .map((e) => noteDisplayName(e.name))
  }
}
