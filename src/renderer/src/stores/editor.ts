import { defineStore } from 'pinia'
import { useTreeStore } from './tree'
import { SCRATCH_VAULT } from '@shared/types'
import { useAppStore } from './app'

/** 打开过的笔记条目（导航栈 / MRU 面板共用；NoteSwitcher 组件也引用） */
export interface OpenNote {
  vault: string
  path: string
  name: string
}

/** 历史栈条目（FR-2.4.26 D7）：在 OpenNote 上带**该次到访离开时**的光标快照——
 *  同一笔记可出现多条（每次到访一条），后退恢复的是那一次的光标（按到访时间旅行），
 *  而非全笔记最新的（cursorMap 只有最新一份） */
export interface HistoryNote extends OpenNote {
  cursor?: { anchor: number; head: number; scrollTop: number }
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
    /** 最近一次保存成功的时刻（心流模式保存指示的一次性脉冲信号；0 = 尚未保存过） */
    lastSavedAt: 0,
    /** 最近一次保存失败（非「外部修改冲突」，如磁盘写入失败） */
    saveFailed: false,
    /**
     * 打开笔记后待应用的光标位置（一次性意图，由 MarkdownEditor 消费后清空，见 FR-2.4.18 / FR-2.4.26）。
     * 用「打开事件」而不是「笔记路径变化」驱动：重命名只是原地改 path、外部重载只改 content，
     * 都不应把光标挪走。
     * remembered（FR-2.4.26）：恢复光标——位置取 pendingCursor（D7 条目级快照优先），
     * 无则查 cursorMap（最新一次离开的位置）
     */
    pendingPlacement: null as 'start' | 'end' | 'remembered' | null,
    /** 随 pendingPlacement='remembered' 下发的具体光标（D7：历史导航用条目快照；
     *  普通打开 / MRU 提交查 cursorMap）。一次性，消费后清空 */
    pendingCursor: null as { anchor: number; head: number; scrollTop: number } | null,
    /** 会话内每笔记光标存档（FR-2.4.26 B）：key = `vault::path`。离开笔记时写入（组件
     *  经 captureCursor 上报实时选区），重新打开时恢复上次编辑位置——任何方式切走再
     *  回来（搜索误点、双链误跳、侧栏切换）光标都在原地；未记录过的笔记仍按编辑位置
     *  设置落位。设置页往返等重挂载场景也由本表覆盖（原单槽 savedCursor 并入） */
    cursorMap: {} as Record<string, { anchor: number; head: number; scrollTop: number }>,
    /** 实时选区上报槽：MarkdownEditor 挂载时注册（读 CM 视图当前选区 / 滚动），卸载时清除。
     *  store 在切换笔记前调用它存档离开笔记的光标——store 自身拿不到 CM 视图 */
    captureCursor: null as (() => { anchor: number; head: number; scrollTop: number } | null) | null,
    /** 后退栈（FR-2.4.26 D5）：被切走离开的笔记，最近的在末尾。Alt+← 逐步弹出；
     *  新开导航（非前进）清空前进栈（浏览器语义）。条目带该次到访的光标快照（D7） */
    backStack: [] as HistoryNote[],
    /** 前进栈（FR-2.4.26 D5）：后退后「再来」的方向。Alt+→ 逐步弹出；后退时当前笔记转入本栈 */
    forwardStack: [] as HistoryNote[],
    /** 会话内最近打开顺序（FR-2.4.26 D6 MRU 面板数据源，最新的在最前，上限 15 篇） */
    mruList: [] as OpenNote[],
    /** MRU 快切面板状态（VS Code Ctrl+Tab 模型）：按住期间 mruIndex 在 mruList 上移动，
     *  松开 Ctrl 提交跳转、Esc 取消 */
    mruActive: false,
    mruIndex: 0,
    /** Vim 当前模式（FR-2.4.23）：由 MarkdownEditor 经 vim-mode-change 事件写入；
     *  null = vim 未开启（工具栏据此显隐模式徽标） */
    vimMode: null as import('../lib/vimMode').VimMode | null,
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
      await this.openNoteTo(vault, path, name, 'new')
    },

    /** 打开笔记的统一内部管线（FR-2.4.26）：mode 决定导航记账——
     *  new = 普通打开（当前笔记压入后退栈、清空前进栈）；back / forward = 历史导航
     *  （当前笔记转入对侧栈，不清栈）。entryCursor = 历史条目自带的光标快照（D7：
     *  恢复「那一次到访」的位置而非全笔记最新）。光标存档 / 落位意图 / MRU 记序对所有 mode 一致 */
    async openNoteTo(
      vault: string,
      path: string,
      name: string,
      mode: 'new' | 'back' | 'forward',
      entryCursor?: { anchor: number; head: number; scrollTop: number }
    ): Promise<void> {
      await this.flushSave()
      const result = await window.trace.readNote(vault, path)
      if (!result.ok) return
      const isScratch = vault === SCRATCH_VAULT
      const cur = this.current
      const sameKey = !!cur && cur.vault === vault && cur.path === path
      if (cur && !sameKey) {
        // 离开旧笔记（FR-2.4.26）：存档离开时光标（重开恢复 / cursorMap 最新）+ 导航记账
        // （D5 双栈，条目带本次离开的光标快照 D7）。重开同一篇不算切换（栈不动）
        const captured = this.captureCursor?.() ?? null
        if (captured) this.cursorMap[`${cur.vault}::${cur.path}`] = captured
        const leaving: HistoryNote = { ...cur, cursor: captured ?? undefined }
        if (mode === 'new') {
          this.backStack.push(leaving)
          if (this.backStack.length > 50) this.backStack.shift()
          this.forwardStack = []
        } else if (mode === 'back') {
          this.forwardStack.push(leaving)
        } else {
          this.backStack.push(leaving)
        }
      }
      this.current = { vault, path, name }
      this.content = result.content ?? ''
      this._diskContent = this.content
      this._diskHash = result.hash ?? ''
      this.externalChanged = false
      this.saveFailed = false
      // 落位意图（FR-2.4.18 / FR-2.4.26）：历史条目快照（D7）∨ 会话存档（最新）→ 恢复；
      // 都没有则按编辑位置设置落到文首 / 文末。由 MarkdownEditor 在文档就位后消费
      const mapHit = this.cursorMap[`${vault}::${path}`]
      this.pendingCursor = entryCursor ?? mapHit ?? null
      this.pendingPlacement = entryCursor || mapHit
        ? 'remembered'
        : useAppStore().settings.editPosition === 'end'
          ? 'end'
          : 'start'
      // MRU 记序（D6）：目标移到最前（去重），上限 15 篇
      const key = `${vault}::${path}`
      this.mruList = [{ vault, path, name }, ...this.mruList.filter((m) => `${m.vault}::${m.path}` !== key)].slice(0, 15)
      // 草稿（FR-2.3.9）不进常用 / 位置上下文 / 插件事件——转正后才进入正式体系
      if (!isScratch) {
        const dirParts = path.split('/')
        dirParts.pop()
        useTreeStore().setLocation(vault, dirParts.join('/'))
        void window.trace.addRecent(vault, path, name).then(() => useTreeStore().loadRecents())
        window.trace.reportNoteOpened(vault, path)
      }
    },
    /** 历史导航（FR-2.4.26 D5，Alt+← / Alt+→）：从后退 / 前进栈弹出目标并以对应
     *  模式打开——当前笔记自动转入对侧栈，光标恢复由 cursorMap 承担 */
    async goBackNote(): Promise<void> {
      await this.navigate('back')
    },
    async goForwardNote(): Promise<void> {
      await this.navigate('forward')
    },
    async navigate(mode: 'back' | 'forward'): Promise<void> {
      const stack = mode === 'back' ? this.backStack : this.forwardStack
      const target = stack.pop()
      if (!target) return
      // D7：带条目级光标快照——退回到哪次到访就恢复那次的光标
      await this.openNoteTo(target.vault, target.path, target.name, mode, target.cursor)
    },
    /** MRU 快切面板（FR-2.4.26 D6，Ctrl+Tab 按住模型）：开面板默认选中「上一次的笔记」
     *  （index 1，零额外按键 = 跳回上一篇的肌肉记忆）；<2 篇不启用 */
    mruBegin(): void {
      if (this.mruList.length < 2) return
      this.mruActive = true
      this.mruIndex = 1
    },
    mruMove(delta: number): void {
      if (!this.mruActive || this.mruList.length === 0) return
      const len = this.mruList.length
      this.mruIndex = (((this.mruIndex + delta) % len) + len) % len
    },
    async mruCommit(): Promise<void> {
      const target = this.mruList[this.mruIndex]
      this.mruActive = false
      if (!target) return
      const cur = this.current
      if (cur && cur.vault === target.vault && cur.path === target.path) return
      await this.openNoteTo(target.vault, target.path, target.name, 'new')
    },
    mruCancel(): void {
      this.mruActive = false
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
          this.saveFailed = false
          this.lastSavedAt = Date.now()
          return true
        }
        if (result.error?.includes('外部修改')) this.externalChanged = true
        else this.saveFailed = true
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
      // 导航结构随库更名改写（FR-2.4.26）：栈 / MRU / 光标表 / 光标表键
      const fix = (n: OpenNote) => {
        if (n.vault === oldName) n.vault = newName
        return n
      }
      this.backStack = this.backStack.map(fix)
      this.forwardStack = this.forwardStack.map(fix)
      this.mruList = this.mruList.map(fix)
      for (const k of Object.keys(this.cursorMap)) {
        if (k.startsWith(`${oldName}::`)) {
          this.cursorMap[`${newName}::${k.slice(oldName.length + 2)}`] = this.cursorMap[k]
          delete this.cursorMap[k]
        }
      }
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
      // 导航结构随重命名改写（FR-2.4.26）：笔记更名改路径 / 名字，文件夹更名做前缀重写
      const fix = (n: OpenNote): OpenNote => {
        if (n.vault !== vault) return n
        if (kind === 'note' && n.path === oldPath) return { ...n, path: newPath, name: newName }
        if (kind === 'dir' && n.path.startsWith(`${oldPath}/`))
          return { ...n, path: `${newPath}${n.path.slice(oldPath.length)}` }
        return n
      }
      this.backStack = this.backStack.map(fix)
      this.forwardStack = this.forwardStack.map(fix)
      this.mruList = this.mruList.map(fix)
      if (kind === 'note') {
        const oldKey = `${vault}::${oldPath}`
        if (this.cursorMap[oldKey]) {
          this.cursorMap[`${vault}::${newPath}`] = this.cursorMap[oldKey]
          delete this.cursorMap[oldKey]
        }
      } else {
        for (const k of Object.keys(this.cursorMap)) {
          if (k.startsWith(`${vault}::${oldPath}/`)) {
            this.cursorMap[`${vault}::${newPath}${k.slice((`${vault}::${oldPath}`).length)}`] = this.cursorMap[k]
            delete this.cursorMap[k]
          }
        }
      }
    },
    handleNodeDeleted(vault: string, path: string, kind: 'dir' | 'note'): void {
      const cur = this.current
      if (cur && cur.vault === vault) {
        if (cur.path === path || (kind === 'dir' && cur.path.startsWith(`${path}/`))) {
          this.current = null
          this.content = ''
          this._diskContent = ''
        }
      }
      // 导航结构剪枝（FR-2.4.26）：被删笔记 / 被删目录下的条目出栈，防止历史导航跳到空目标
      const alive = (n: OpenNote): boolean =>
        n.vault !== vault || (kind === 'note' ? n.path !== path : !n.path.startsWith(`${path}/`))
      this.backStack = this.backStack.filter(alive)
      this.forwardStack = this.forwardStack.filter(alive)
      this.mruList = this.mruList.filter(alive)
      for (const k of Object.keys(this.cursorMap)) {
        if (kind === 'note' ? k === `${vault}::${path}` : k.startsWith(`${vault}::${path}/`)) {
          delete this.cursorMap[k]
        }
      }
    }
  }
})
