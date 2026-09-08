import { defineStore } from 'pinia'
import { checkNameFormat, type ItemKind } from '@shared/validate'

interface NameDialogOptions {
  title: string
  kind: ItemKind
  initialValue?: string
  placeholder?: string
  /** 显示可选的描述输入框（当前用于创建笔记库） */
  withDescription?: boolean
  /** 确认动作：返回 {ok:false, error} 时对话框保持打开并显示错误 */
  action: (name: string, description?: string) => Promise<{ ok: boolean; error?: string } | void>
}

/** 全局「输入名称」对话框（创建/重命名共用） */
export const useNameDialog = defineStore('nameDialog', {
  state: () => ({
    visible: false,
    title: '',
    kind: 'note' as ItemKind,
    placeholder: '',
    withDescription: false,
    inputValue: '',
    descValue: '',
    error: '',
    busy: false,
    action: null as NameDialogOptions['action'] | null
  }),
  actions: {
    open(opts: NameDialogOptions): void {
      this.title = opts.title
      this.kind = opts.kind
      this.placeholder = opts.placeholder ?? '请输入名称'
      this.withDescription = opts.withDescription ?? false
      this.inputValue = opts.initialValue ?? ''
      this.descValue = ''
      this.error = ''
      this.busy = false
      this.action = opts.action
      this.visible = true
    },
    async confirm(): Promise<void> {
      if (!this.action || this.busy) return
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
