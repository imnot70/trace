import { defineStore } from 'pinia'
import { checkNameFormat, type ItemKind } from '@shared/validate'

interface NameDialogOptions {
  title: string
  kind: ItemKind
  initialValue?: string
  placeholder?: string
  /** 显示可选的描述输入框（当前用于创建笔记库） */
  withDescription?: boolean
  /** 显示「打开已有笔记库」标签页（FR-2.1.4，创建笔记库弹窗专用） */
  withOpenTab?: boolean
  /** 「打开」标签页的确认动作：传入所选目录 */
  openAction?: (dir: string) => Promise<{ ok: boolean; error?: string }>
  /** 确认动作：返回 {ok:false, error} 时对话框保持打开并显示错误 */
  action: (name: string, description?: string) => Promise<{ ok: boolean; error?: string } | void>
}

/** 全局「输入名称」对话框（创建/重命名共用；创建笔记库时含「打开已有笔记库」标签页） */
export const useNameDialog = defineStore('nameDialog', {
  state: () => ({
    visible: false,
    title: '',
    kind: 'note' as ItemKind,
    placeholder: '',
    withDescription: false,
    withOpenTab: false,
    /** 当前标签页（仅 withOpenTab 时有意义） */
    tab: 'create' as 'create' | 'open',
    /** 「打开」标签页选中的目录 */
    pickedDir: '',
    inputValue: '',
    descValue: '',
    error: '',
    busy: false,
    action: null as NameDialogOptions['action'] | null,
    openAction: null as NameDialogOptions['openAction'] | null
  }),
  actions: {
    open(opts: NameDialogOptions): void {
      this.title = opts.title
      this.kind = opts.kind
      this.placeholder = opts.placeholder ?? '请输入名称'
      this.withDescription = opts.withDescription ?? false
      this.withOpenTab = opts.withOpenTab ?? false
      this.tab = 'create'
      this.pickedDir = ''
      this.inputValue = opts.initialValue ?? ''
      this.descValue = ''
      this.error = ''
      this.busy = false
      this.action = opts.action
      this.openAction = opts.openAction ?? null
      this.visible = true
    },
    async confirm(): Promise<void> {
      if (!this.action || this.busy) return
      // 「打开已有笔记库」分支：校验目录非空即走 openAction（目录名合法性由主进程校验）
      if (this.withOpenTab && this.tab === 'open') {
        if (!this.openAction) return
        const dir = this.pickedDir.trim()
        if (!dir) {
          this.error = '请先选择要打开的笔记库目录'
          return
        }
        this.busy = true
        this.error = ''
        try {
          const result = await this.openAction(dir)
          if (result && !result.ok) {
            this.error = result.error ?? '打开失败'
            return
          }
          this.visible = false
        } finally {
          this.busy = false
        }
        return
      }
      const formatError = checkNameFormat(this.inputValue, this.kind)
      if (formatError) {
        this.error = formatError
        return
      }
      this.busy = true
      this.error = ''
      try {
        const desc = this.withDescription ? this.descValue.trim() || undefined : undefined
        const result = await this.action(this.inputValue.trim(), desc)
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
