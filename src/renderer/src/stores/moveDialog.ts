import { defineStore } from 'pinia'
import { useTreeStore } from './tree'
import type { TreeNode } from '@shared/types'

interface MoveDialogOptions {
  vault: string
  srcPath: string
  kind: 'dir' | 'note'
  name: string
  action: (destParentPath: string) => Promise<{ ok: boolean; error?: string } | void>
}

/** 全局「移动到…」对话框 */
export const useMoveDialog = defineStore('moveDialog', {
  state: () => ({
    visible: false,
    vault: '',
    srcPath: '',
    kind: 'note' as 'dir' | 'note',
    name: '',
    selectedPath: '',
    error: '',
    busy: false,
    action: null as MoveDialogOptions['action'] | null
  }),
  getters: {
    folderTree(state): TreeNode[] {
      const tree = useTreeStore()
      return tree.trees[state.vault] ?? []
    }
  },
  actions: {
    open(opts: MoveDialogOptions): void {
      this.vault = opts.vault
      this.srcPath = opts.srcPath
      this.kind = opts.kind
      this.name = opts.name
      this.selectedPath = ''
      this.error = ''
      this.busy = false
      this.action = opts.action
      this.visible = true
    },
    select(path: string): void {
      this.selectedPath = path
      this.error = ''
    },
    async confirm(): Promise<void> {
      if (!this.action || this.busy) return
      this.busy = true
      this.error = ''
      try {
        const result = await this.action(this.selectedPath)
        if (result && !result.ok) {
          this.error = result.error ?? '操作失败'
          return
        }
        this.visible = false
      } finally {
        this.busy = false
      }
    }
  }
})
