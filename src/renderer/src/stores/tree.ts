import { defineStore } from 'pinia'
import { nextTick } from 'vue'
import { useAppStore } from './app'
import type { GitStatus, TreeNode, VaultInfo } from '@shared/types'

/** 侧栏数据：笔记库列表、库内目录树、git 状态、收藏与常用 */
export const useTreeStore = defineStore('tree', {
  state: () => ({
    vaults: [] as VaultInfo[],
    trees: {} as Record<string, TreeNode[]>,
    /** key: `${vault}::${path}` */
    expanded: {} as Record<string, boolean>,
    vaultExpanded: {} as Record<string, boolean>,
    /** 侧栏「笔记库」区块整体展开（定位功能需要控制它） */
    vaultSectionOpen: true,
    gitStatuses: {} as Record<string, GitStatus | null>,
    favorites: [] as { id: string; vault: string; path: string; name: string; addedAt: string }[],
    recents: [] as { vault: string; path: string; name: string; openedAt: string }[],
    /** 定位目标行（`${vault}::${path}` 或库级 `${vault}`），短暂高亮后自动清除 */
    locateKey: '',
    locateTimer: null as ReturnType<typeof setTimeout> | null,
    /** 当前位置上下文：最近导航到的库与文件夹（Ctrl+N 新建笔记的目标） */
    lastLocation: null as { vault: string; dir: string } | null
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
    /**
     * 在侧栏树中定位节点：展开祖先链 → 滚动到行 → 高亮闪烁。
     * 侧栏不可见时自动恢复（专注模式以浮层侧栏展示，不打断沉浸）。
     */
    async revealNode(vault: string, path: string, kind: 'vault' | 'dir' | 'note'): Promise<void> {
      const app = useAppStore()
      // 确保侧栏可见：专注 → 浮层侧栏；手动收起 → 恢复
      if (app.zenMode) app.zenSidebarOverlay = true
      else if (!app.sidebarVisible) app.toggleSidebar()
      this.vaultSectionOpen = true

      if (!this.trees[vault]) await this.loadTree(vault)
      this.vaultExpanded[vault] = true
      // 展开目标的所有祖先文件夹
      const segs = path.split('/').filter(Boolean)
      for (let i = 1; i < segs.length; i++) {
        this.expanded[`${vault}::${segs.slice(0, i).join('/')}`] = true
      }

      const key = kind === 'vault' ? vault : `${vault}::${path}`
      if (this.locateTimer) clearTimeout(this.locateTimer)
      this.locateKey = key
      this.locateTimer = setTimeout(() => {
        this.locateKey = ''
        this.locateTimer = null
      }, 2200)

      await nextTick()
      document
        .querySelector(`[data-locate="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    /** 更新当前位置上下文（打开笔记 / 网格钻入 / 侧栏点击时调用） */
    setLocation(vault: string, dir: string): void {
      this.lastLocation = { vault, dir }
    },
    /** 库重命名时迁移位置上下文 */
    renameLocation(oldVault: string, newVault: string): void {
      if (this.lastLocation?.vault === oldVault) this.lastLocation = { vault: newVault, dir: this.lastLocation.dir }
    },
    /** 库删除时清除失效的位置上下文 */
    clearLocationIfVault(vault: string): void {
      if (this.lastLocation?.vault === vault) this.lastLocation = null
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
