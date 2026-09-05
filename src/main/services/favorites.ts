import { JsonStore } from '../lib/jsonStore'
import type { FavoriteItem, RecentItem } from '@shared/types'

const MAX_RECENTS = 20

/** 收藏：按 库名+库内路径 引用，跟随重命名/删除维护 */
export class FavoritesService {
  constructor(private store: JsonStore<{ items: FavoriteItem[] }>) {}

  list(): FavoriteItem[] {
    return this.store.get().items
  }

  has(vault: string, relPath: string): boolean {
    return this.store.get().items.some((i) => i.vault === vault && i.path === relPath)
  }

  add(vault: string, relPath: string, name: string): { ok: boolean; error?: string } {
    if (this.has(vault, relPath)) return { ok: true }
    this.store.update((d) => {
      d.items.unshift({ id: `${vault}::${relPath}`, vault, path: relPath, name, addedAt: new Date().toISOString() })
    })
    return { ok: true }
  }

  remove(vault: string, relPath: string): { ok: boolean; error?: string } {
    this.store.update((d) => {
      d.items = d.items.filter((i) => !(i.vault === vault && i.path === relPath))
    })
    return { ok: true }
  }

  /** 库内对象重命名时同步收藏引用；kind=dir 时按前缀匹配子树 */
  onRename(vault: string, oldRel: string, newRel: string, kind: 'dir' | 'note', newName: string): void {
    const prefix = `${oldRel}/`
    this.store.update((d) => {
      for (const item of d.items) {
        if (item.vault !== vault) continue
        if (kind === 'note' && item.path === oldRel) {
          item.path = newRel
          item.name = newName
          item.id = `${vault}::${newRel}`
        } else if (kind === 'dir' && item.path.startsWith(prefix)) {
          item.path = `${newRel}${item.path.slice(oldRel.length)}`
          item.id = `${vault}::${item.path}`
        }
      }
    })
  }

  /** 库内对象被删除（或其父目录被删除）时清理收藏 */
  onDelete(vault: string, relPath: string, kind: 'dir' | 'note' | 'vault'): void {
    const prefix = `${relPath}/`
    this.store.update((d) => {
      d.items = d.items.filter((i) => {
        if (i.vault !== vault) return true
        if (kind === 'vault' || i.path === relPath) return false
        return !(kind === 'dir' && i.path.startsWith(prefix))
      })
    })
  }

  /** 整个库被重命名时更新引用 */
  onVaultRename(oldVault: string, newVault: string): void {
    this.store.update((d) => {
      for (const item of d.items) {
        if (item.vault === oldVault) {
          item.vault = newVault
          item.id = `${newVault}::${item.path}`
        }
      }
    })
  }
}

/** 常用：最近打开的笔记 */
export class RecentsService {
  constructor(private store: JsonStore<{ items: RecentItem[] }>) {}

  list(): RecentItem[] {
    return this.store.get().items
  }

  add(vault: string, relPath: string, name: string): void {
    this.store.update((d) => {
      d.items = d.items.filter((i) => !(i.vault === vault && i.path === relPath))
      d.items.unshift({ vault, path: relPath, name, openedAt: new Date().toISOString() })
      if (d.items.length > MAX_RECENTS) d.items.length = MAX_RECENTS
    })
  }

  remove(vault: string, relPath: string): void {
    this.store.update((d) => {
      d.items = d.items.filter((i) => !(i.vault === vault && i.path === relPath))
    })
  }

  onRename(vault: string, oldRel: string, newRel: string, kind: 'dir' | 'note', newName: string): void {
    if (kind !== 'note') return
    this.store.update((d) => {
      for (const item of d.items) {
        if (item.vault === vault && item.path === oldRel) {
          item.path = newRel
          item.name = newName
        }
      }
    })
  }

  onDelete(vault: string, relPath: string, kind: 'dir' | 'note' | 'vault'): void {
    const prefix = `${relPath}/`
    this.store.update((d) => {
      d.items = d.items.filter((i) => {
        if (i.vault !== vault) return true
        if (kind === 'vault' || i.path === relPath) return false
        return !(kind === 'dir' && i.path.startsWith(prefix))
      })
    })
  }

  onVaultRename(oldVault: string, newVault: string): void {
    this.store.update((d) => {
      for (const item of d.items) {
        if (item.vault === oldVault) item.vault = newVault
      }
    })
  }
}
