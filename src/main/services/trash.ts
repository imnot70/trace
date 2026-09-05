import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { JsonStore } from '../lib/jsonStore'
import { noteDisplayName } from '@shared/validate'
import type { ItemKind, TrashEntry } from '@shared/types'

interface TrashIndex {
  entries: TrashEntry[]
}

const EMPTY_INDEX: TrashIndex = { entries: [] }

/**
 * 应用级回收站：<工作区根>/.trash/。
 * items/<id>/ 存放被删对象本体，index.json 记录元数据（原位置等）。
 */
export class TrashService {
  private store: JsonStore<TrashIndex> | null = null
  private storeRoot: string | null = null

  constructor(private getRoot: () => string | null) {}

  private ensureStore(): JsonStore<TrashIndex> | null {
    const root = this.getRoot()
    if (!root) return null
    if (!this.store || this.storeRoot !== root) {
      this.store = new JsonStore<TrashIndex>(path.join(root, '.trash', 'index.json'), EMPTY_INDEX)
      this.storeRoot = root
    }
    return this.store
  }

  trashDir(): string | null {
    const root = this.getRoot()
    return root ? path.join(root, '.trash') : null
  }

  list(): TrashEntry[] {
    const store = this.ensureStore()
    if (!store) return []
    return [...store.get().entries].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }

  put(opts: { vault: string; path: string; kind: ItemKind }): { ok: boolean; error?: string } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root) return { ok: false, error: '尚未设置工作区' }
    try {
      const sourceAbs =
        opts.kind === 'vault' ? path.join(root, opts.vault) : path.join(root, opts.vault, opts.path)
      if (!fs.existsSync(sourceAbs)) return { ok: false, error: '目标不存在' }
      const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
      const baseName = opts.kind === 'vault' ? opts.vault : path.basename(opts.path)
      // 回收站列表里笔记显示不带 .md 的名字
      const name = opts.kind === 'note' ? noteDisplayName(baseName) : baseName
      const itemDir = path.join(root, '.trash', 'items', id)
      fs.mkdirSync(itemDir, { recursive: true })
      fs.renameSync(sourceAbs, path.join(itemDir, baseName))
      const entry: TrashEntry = {
        id,
        name,
        item: baseName,
        kind: opts.kind,
        vault: opts.vault,
        path: opts.path,
        deletedAt: new Date().toISOString()
      }
      store.update((d) => d.entries.push(entry))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  restore(id: string): { ok: boolean; error?: string } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root) return { ok: false, error: '尚未设置工作区' }
    const entry = store.get().entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: '回收站中不存在该条目' }
    try {
      const itemAbs = path.join(root, '.trash', 'items', entry.id, entry.item)
      if (!fs.existsSync(itemAbs)) return { ok: false, error: '回收站数据已损坏或已被清理' }

      let targetAbs: string
      if (entry.kind === 'vault') {
        targetAbs = path.join(root, entry.name)
      } else {
        targetAbs = path.join(root, entry.vault, entry.path)
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true })
      }
      if (fs.existsSync(targetAbs)) {
        // 目标位置已存在同名对象，追加后缀避免覆盖
        const { dir, ext, name } = path.parse(targetAbs)
        targetAbs = path.join(dir, `${name}（已恢复）${ext}`)
      }
      fs.renameSync(itemAbs, targetAbs)
      if (entry.kind === 'vault') {
        // 恢复后的库如果改了名字，同步修正条目里的库名
        entry.vault = path.basename(targetAbs)
      }
      store.update((d) => {
        d.entries = d.entries.filter((e) => e.id !== id)
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  purge(id: string): { ok: boolean; error?: string } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root) return { ok: false, error: '尚未设置工作区' }
    const entry = store.get().entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: '回收站中不存在该条目' }
    try {
      fs.rmSync(path.join(root, '.trash', 'items', entry.id), { recursive: true, force: true })
      store.update((d) => {
        d.entries = d.entries.filter((e) => e.id !== id)
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  empty(): { ok: boolean; error?: string } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root) return { ok: false, error: '尚未设置工作区' }
    try {
      fs.rmSync(path.join(root, '.trash', 'items'), { recursive: true, force: true })
      store.update((d) => {
        d.entries = []
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
