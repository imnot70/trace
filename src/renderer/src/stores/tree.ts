import { defineStore } from 'pinia'
import type { GitStatus, TreeNode, VaultInfo } from '@shared/types'

/** 侧栏数据：笔记库列表、库内目录树、git 状态、收藏与常用 */
export const useTreeStore = defineStore('tree', {
  state: () => ({
    vaults: [] as VaultInfo[],
    trees: {} as Record<string, TreeNode[]>,
    /** key: `${vault}::${path}` */
    expanded: {} as Record<string, boolean>,
    vaultExpanded: {} as Record<string, boolean>,
    gitStatuses: {} as Record<string, GitStatus | null>,
    favorites: [] as { id: string; vault: string; path: string; name: string; addedAt: string }[],
    recents: [] as { vault: string; path: string; name: string; openedAt: string }[]
  }),
  actions: {
    async loadVaults(): Promise<void> {
      const result = await window.trace.listVaults()
      if (result.ok && result.vaults) {
        this.vaults = result.vaults
        // 库可能被外部删除，清理失效的展开状态
        const names = new Set(this.vaults.map((v) => v.name))
        for (const key of Object.keys(this.trees)) {
          if (!names.has(key)) delete this.trees[key]
        }
      }
    },
    async loadTree(vault: string): Promise<void> {
      const result = await window.trace.listTree(vault)
      if (result.ok && result.nodes) this.trees[vault] = result.nodes
    },
    async refreshAll(): Promise<void> {
      await this.loadVaults()
      await Promise.all(Object.keys(this.trees).map((v) => this.loadTree(v)))
      await Promise.all([this.loadFavorites(), this.loadRecents()])
    },
    toggleExpand(vault: string, path: string): void {
      const key = `${vault}::${path}`
      this.expanded[key] = !this.expanded[key]
    },
    isExpanded(vault: string, path: string): boolean {
      return this.expanded[`${vault}::${path}`] ?? false
    },
    toggleVault(vault: string): void {
      this.vaultExpanded[vault] = !this.vaultExpanded[vault]
      if (this.vaultExpanded[vault] && !this.trees[vault]) void this.loadTree(vault)
    },
    isVaultExpanded(vault: string): boolean {
      return this.vaultExpanded[vault] ?? false
    },
    async refreshGitStatus(vault: string): Promise<void> {
      this.gitStatuses[vault] = await window.trace.getGitStatus(vault)
    },
    async loadFavorites(): Promise<void> {
      const result = await window.trace.listFavorites()
      if (result.ok && result.items) this.favorites = result.items
    },
    async loadRecents(): Promise<void> {
      const result = await window.trace.listRecents()
      if (result.ok && result.items) this.recents = result.items
    },
    /** 文件变更事件：刷新对应库的树与 git 状态 */
    async handleFsChanged(vault: string): Promise<void> {
      if (this.vaults.some((v) => v.name === vault)) {
        await this.loadTree(vault)
        void this.refreshGitStatus(vault)
      } else {
        await this.loadVaults()
      }
    }
  }
})
