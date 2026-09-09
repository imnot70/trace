import { defineStore } from 'pinia'
import { useTreeStore } from './tree'
import { useAppStore } from './app'

interface OpenNote {
  vault: string
  path: string
  name: string
}

/** 当前编辑的笔记：内容、保存状态、外部修改检测 */
export const useEditorStore = defineStore('editor', {
  state: () => ({
    current: null as OpenNote | null,
    content: '',
    /** 磁盘内容在最后一次读取/保存时的样子，用于 dirty 判断 */
    _diskContent: '',
    /** 磁盘内容对应的 hash（readNote / writeNote 返回） */
    _diskHash: '',
    saving: false,
    /** 磁盘文件被外部修改且本地有未保存改动 */
    externalChanged: false,
    saveTimer: null as ReturnType<typeof setTimeout> | null
  }),
  getters: {
    dirty(state): boolean {
      return state.current !== null && state.content !== state._diskContent
    },
    /** 侧栏高亮键：仅当正处于编辑视图时返回 `vault::path`，其余视图返回空串（不高亮任何行） */
    activeKey(state): string {
      if (state.current === null || useAppStore().view.name !== 'editor') return ''
      return `${state.current.vault}::${state.current.path}`
    }
  },
  actions: {
    async openNote(vault: string, path: string, name: string): Promise<void> {
      await this.flushSave()
      const result = await window.trace.readNote(vault, path)
      if (!result.ok) return
      this.current = { vault, path, name }
      this.content = result.content ?? ''
      this._diskContent = this.content
      this._diskHash = result.hash ?? ''
      this.externalChanged = false
      // 更新位置上下文（Ctrl+N 新建笔记的目标）
      const dirParts = path.split('/')
      dirParts.pop()
      useTreeStore().setLocation(vault, dirParts.join('/'))
      void window.trace.addRecent(vault, path, name).then(() => useTreeStore().loadRecents())
    },
    setContent(content: string): void {
      this.content = content
      if (useAppStore().settings.autoSave) this.scheduleSave()
    },
    scheduleSave(): void {
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => void this.flushSave(), 1000)
    },
    async flushSave(): Promise<void> {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer)
        this.saveTimer = null
      }
      await this.saveNow()
    },
    async saveNow(): Promise<boolean> {
      if (!this.current || this.saving) return true
      if (this.content === this._diskContent) return true
      this.saving = true
      try {
        const { vault, path } = this.current
        const result = await window.trace.writeNote(vault, path, this.content, this._diskHash)
        if (result.ok) {
          this._diskContent = this.content
          this._diskHash = result.hash ?? this._diskHash
          this.externalChanged = false
          return true
        }
        if (result.error?.includes('外部修改')) this.externalChanged = true
        return false
      } finally {
        this.saving = false
      }
    },
    /** 放弃本地未保存修改，重新读取磁盘内容 */
    async reloadFromDisk(): Promise<void> {
      if (!this.current) return
      const { vault, path } = this.current
      const result = await window.trace.readNote(vault, path)
      if (result.ok) {
        this.content = result.content ?? ''
        this._diskContent = this.content
        this._diskHash = result.hash ?? ''
        this.externalChanged = false
      }
    },
    async closeNote(): Promise<void> {
      await this.flushSave()
      this.current = null
      this.content = ''
      this._diskContent = ''
    },
    /** fs:changed 事件：打开的笔记被外部修改时处理。
     *  注意 chokidar 不区分写入来源——应用自己的自动保存也会触发本事件，
     *  因此先读磁盘与 _diskContent 比对：一致即为自身保存的回声，忽略 */
    async handleFsChanged(vault: string, paths: string[]): Promise<void> {
      if (!this.current || this.current.vault !== vault) return
      if (!paths.includes(this.current.path)) return
      const { path } = this.current
      const result = await window.trace.readNote(vault, path)
      // 读取期间可能已切换/关闭笔记
      if (!this.current || this.current.vault !== vault || this.current.path !== path) return
      if (!result.ok) return
      const disk = result.content ?? ''
      if (disk === this._diskContent) return // 自身保存的回声（或磁盘内容与所知一致），无需处理
      if (this.dirty) this.externalChanged = true
      else {
        this.content = disk
        this._diskContent = disk
        this._diskHash = result.hash ?? ''
      }
    },
    handleVaultRenamed(oldName: string, newName: string): void {
      if (this.current?.vault === oldName) this.current.vault = newName
    },
    handleNodeRenamed(
      vault: string,
      oldPath: string,
      newPath: string,
      kind: 'dir' | 'note',
      newName: string
    ): void {
      const cur = this.current
      if (!cur || cur.vault !== vault) return
      if (kind === 'note' && cur.path === oldPath) {
        cur.path = newPath
        cur.name = newName
      } else if (kind === 'dir' && cur.path.startsWith(`${oldPath}/`)) {
        cur.path = `${newPath}${cur.path.slice(oldPath.length)}`
      }
    },
    handleNodeDeleted(vault: string, path: string, kind: 'dir' | 'note'): void {
      const cur = this.current
      if (!cur || cur.vault !== vault) return
      if (cur.path === path || (kind === 'dir' && cur.path.startsWith(`${path}/`))) {
        this.current = null
        this.content = ''
        this._diskContent = ''
      }
    }
  }
})
