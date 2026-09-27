import { JsonStore } from '../lib/jsonStore'
import type { GistShare } from '@shared/types'

/**
 * Gist 分享记录（FR-2.3.10）：gist id ↔ 笔记路径的映射。
 * 存应用元数据 gist-shares.json，绝不写入笔记库（不污染 git 仓库）。
 * 重命名 / 移动 / 删除 / 库更名时同步维护引用（与 favorites 同一套挂钩约定）；
 * 删除笔记只解除关联，远端 gist 保持存活（分享出去的链接不受应用内删除影响）。
 */
export class GistShareService {
  constructor(private store: JsonStore<{ shares: GistShare[] }>) {}

  get(vault: string, relPath: string): GistShare | null {
    return this.store.get().shares.find((s) => s.vault === vault && s.path === relPath) ?? null
  }

  /** 全部分享记录（侧栏「分享」管理入口，按更新时间倒序） */
  list(): GistShare[] {
    return [...this.store.get().shares].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  /** 新建或更新（按 vault+path 定位；远端 gist id / 链接以本次调用结果为准） */
  upsert(share: Omit<GistShare, 'createdAt' | 'updatedAt'> & { createdAt?: string }): GistShare {
    const now = new Date().toISOString()
    this.store.update((d) => {
      const existing = d.shares.find((s) => s.vault === share.vault && s.path === share.path)
      if (existing) {
        existing.gistId = share.gistId
        existing.url = share.url
        existing.fileName = share.fileName
        existing.description = share.description
        existing.updatedAt = now
      } else {
        d.shares.push({ ...share, createdAt: share.createdAt ?? now, updatedAt: now })
      }
    })
    // update 后记录必然存在（上面刚 push / 改写）；?? 兜底仅为满足类型
    return this.get(share.vault, share.path) ?? { ...share, createdAt: now, updatedAt: now }
  }

  removeRecord(vault: string, relPath: string): void {
    this.store.update((d) => {
      d.shares = d.shares.filter((s) => !(s.vault === vault && s.path === relPath))
    })
  }

  /** 库内对象重命名 / 移动时同步记录；kind=dir 时按前缀匹配子树 */
  onRename(vault: string, oldRel: string, newRel: string, kind: 'dir' | 'note'): void {
    const prefix = `${oldRel}/`
    this.store.update((d) => {
      for (const share of d.shares) {
        if (share.vault !== vault) continue
        if (kind === 'note' && share.path === oldRel) {
          share.path = newRel
        } else if (kind === 'dir' && share.path.startsWith(prefix)) {
          share.path = `${newRel}${share.path.slice(oldRel.length)}`
        }
      }
    })
  }

  /** 库内对象被删除（或整库删除）时清理记录（远端 gist 不动） */
  onDelete(vault: string, relPath: string, kind: 'dir' | 'note' | 'vault'): void {
    const prefix = `${relPath}/`
    this.store.update((d) => {
      d.shares = d.shares.filter((s) => {
        if (s.vault !== vault) return true
        if (kind === 'vault' || s.path === relPath) return false
        return !(kind === 'dir' && s.path.startsWith(prefix))
      })
    })
  }

  /** 整个库被重命名时更新记录 */
  onVaultRename(oldVault: string, newVault: string): void {
    this.store.update((d) => {
      for (const share of d.shares) {
        if (share.vault === oldVault) share.vault = newVault
      }
    })
  }
}
