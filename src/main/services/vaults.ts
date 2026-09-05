import fs from 'node:fs'
import path from 'node:path'
import { checkNameFormat, checkDuplicate } from '@shared/validate'
import { resolveWithin } from '../lib/paths'
import type { TrashService } from './trash'
import type { VaultInfo } from '@shared/types'

/** 笔记库管理：库 = 工作区根目录下的一个一级子目录 */
export class VaultService {
  constructor(
    private getRoot: () => string | null,
    private trash: TrashService
  ) {}

  list(): VaultInfo[] {
    const root = this.getRoot()
    if (!root || !fs.existsSync(root)) return []
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh'))
      .map((name) => ({ name, path: path.join(root, name), git: null }))
  }

  exists(name: string): boolean {
    return this.list().some((v) => v.name.toLowerCase() === name.toLowerCase())
  }

  /** 库的绝对路径（带逃逸校验） */
  vaultPath(name: string): string {
    const root = this.getRoot()
    if (!root) throw new Error('尚未设置工作区')
    return resolveWithin(root, name)
  }

  create(name: string): { ok: boolean; error?: string } {
    const invalid = checkNameFormat(name, 'vault') ?? checkDuplicate(name, this.names(), 'vault')
    if (invalid) return { ok: false, error: invalid }
    try {
      fs.mkdirSync(path.join(this.vaultPath(name)), { recursive: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  rename(oldName: string, newName: string): { ok: boolean; error?: string } {
    const others = this.names().filter((n) => n.toLowerCase() !== oldName.toLowerCase())
    const invalid =
      checkNameFormat(newName, 'vault') ??
      checkDuplicate(newName, others, 'vault') ??
      (this.exists(oldName) ? null : '笔记库不存在')
    if (invalid) return { ok: false, error: invalid }
    try {
      fs.renameSync(this.vaultPath(oldName), this.vaultPath(newName))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 删除（移入回收站） */
  delete(name: string): { ok: boolean; error?: string } {
    if (!this.exists(name)) return { ok: false, error: '笔记库不存在' }
    return this.trash.put({ vault: name, path: '', kind: 'vault' })
  }

  private names(): string[] {
    return this.list().map((v) => v.name)
  }
}
