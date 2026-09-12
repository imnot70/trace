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

  moveNode(
    vault: string,
    srcPath: string,
    kind: 'dir' | 'note',
    destParentPath: string
  ): { ok: boolean; error?: string; newPath?: string } {
    try {
      const vaultPath = this.getVaultPath(vault)
      const srcAbs = resolveWithin(vaultPath, srcPath)
      if (!fs.existsSync(srcAbs)) return { ok: false, error: '源路径不存在' }
      const destAbs = resolveWithin(vaultPath, destParentPath || '')
      if (!fs.existsSync(destAbs)) return { ok: false, error: '目标文件夹不存在' }
      if (kind === 'dir') {
        const srcNorm = srcPath.endsWith('/') ? srcPath : srcPath + '/'
        if (destParentPath === srcPath || destParentPath.startsWith(srcNorm)) {
          return { ok: false, error: '不能移动到自身内部' }
        }
        const depthAfter = relDepth(destParentPath) + this.subtreeDepth(srcAbs)
        if (depthAfter > MAX_DIR_DEPTH) return { ok: false, error: '移动后将超过最大层数限制' }
      }
      const baseName = kind === 'note' ? noteFileName(path.basename(srcPath)) : path.basename(srcPath)
      const invalid =
        checkNameFormat(kind === 'note' ? noteDisplayName(baseName) : baseName, kind) ??
        checkDuplicate(
          kind === 'note' ? noteDisplayName(baseName) : baseName,
          kind === 'dir' ? this.dirNames(destAbs) : this.noteNames(destAbs),
          kind
        )
      if (invalid) return { ok: false, error: invalid }
      const newRel = destParentPath ? `${destParentPath}/${baseName}` : baseName
      if (newRel === srcPath) return { ok: true, newPath: newRel }
      fs.renameSync(srcAbs, path.join(destAbs, baseName))
      this.rewriteRefs(vault, vaultPath, srcPath, kind, newRel)
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

  private subtreeDepth(absDir: string): number {
    let maxChild = 0
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const d = this.subtreeDepth(path.join(absDir, e.name))
        if (d > maxChild) maxChild = d
      }
    }
    return maxChild + 1
  }

  /** 移动后改写笔记内的相对路径引用 */
  private rewriteRefs(vault: string, vaultPath: string, srcPath: string, kind: 'dir' | 'note', newPath: string): void {
    try {
      if (kind === 'note') {
        this.rewriteNoteRefs(vaultPath, srcPath, newPath, srcPath)
      } else {
        this.walkNotes(path.join(vaultPath, newPath), (noteAbs) => {
          const noteNewRel = toRelPath(vaultPath, noteAbs)
          const noteOldRel = srcPath + noteNewRel.slice(newPath.length)
          this.rewriteNoteRefs(vaultPath, noteOldRel, noteNewRel, srcPath)
        })
      }
    } catch { /* 不阻塞移动 */ }
  }

  /** 改写单个笔记内的相对路径引用 */
  private rewriteNoteRefs(vaultPath: string, oldNoteRel: string, newNoteRel: string, movedRoot: string): void {
    const newAbs = path.join(vaultPath, newNoteRel)
    let content: string
    try { content = fs.readFileSync(newAbs, 'utf-8') } catch { return }

    const oldDir = path.posix.dirname(oldNoteRel)
    const movedNorm = movedRoot.endsWith('/') ? movedRoot : movedRoot + '/'

    const rewritten = content.replace(
      /(!?\[[^\]]*\]\(([^)]+)\))|(<img[^>]*\ssrc="([^"]+)")/g,
      (full, _md, mdRef: string | undefined, _html, htmlRef: string | undefined) => {
        const ref = mdRef ?? htmlRef
        if (!ref) return full
        if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/') || ref.startsWith('#')) return full

        const oldTargetRel = this.resolvePosix(oldDir, ref)
        if (!oldTargetRel || (oldTargetRel.startsWith(movedNorm) || oldTargetRel === movedRoot)) return full

        const oldTargetAbs = path.join(vaultPath, oldTargetRel)
        if (!fs.existsSync(oldTargetAbs)) return full

        const newRef = relReference(newNoteRel, oldTargetRel)
        return full.replace(ref, newRef)
      }
    )

    if (rewritten !== content) {
      try { fs.writeFileSync(newAbs, rewritten, 'utf-8') } catch { /* skip */ }
    }
  }

  /** POSIX 风格路径解析（渲染进程无 node:path，主进程自己实现） */
  private resolvePosix(fromDir: string, ref: string): string | null {
    const parts = [...fromDir.split('/'), ...ref.split('/')]
    const stack: string[] = []
    for (const seg of parts) {
      if (!seg || seg === '.') continue
      if (seg === '..') { if (stack.length > 0) stack.pop() }
      else stack.push(seg)
    }
    return stack.length > 0 ? stack.join('/') : null
  }

  /** 递归遍历目录下所有 .md 文件 */
  private walkNotes(absDir: string, cb: (abs: string) => void): void {
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const child = path.join(absDir, e.name)
      if (e.isDirectory()) this.walkNotes(child, cb)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) cb(child)
    }
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
