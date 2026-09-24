import { defineStore } from 'pinia'
import { promptDims, startPrompt, stepPrompt, type PromptKey, type TablePrompt } from '../lib/tablePrompt'

interface Anchor {
  x: number
  y: number
  /** true = 浮层显示在光标上方（光标贴近卡片底部时翻转） */
  above: boolean
}

/**
 * 表格尺寸输入提示态：跨组件共享（键位在 MarkdownEditor、浮层在 EditorView）。
 * 状态机是纯函数（lib/tablePrompt.ts），这里只负责「持有状态 + 把插入意图交给编辑器」。
 * 不做倒计时自动插入——浮层会一直等用户输入数字、按空格 / 回车确认或 Esc 取消
 * （2026-09-24 用户实测反馈：1 秒抢跑会让提示来不及看清）。
 */
export const useTablePromptStore = defineStore('tablePrompt', {
  state: () => ({
    active: false,
    prompt: startPrompt() as TablePrompt,
    anchor: { x: 0, y: 0, above: false } as Anchor,
    /** 最近一次输入的校验提示（浮层红字） */
    warning: null as string | null,
    /** 待插入意图（一次性，编辑器消费后清空）：行 × 列 */
    pendingInsert: null as { rows: number; cols: number } | null
  }),
  getters: {
    /** 当前将插入的尺寸（浮层实时回显） */
    dims(state): { rows: number; cols: number } {
      return promptDims(state.prompt)
    }
  },
  actions: {
    /** 进入提示态（Ctrl+T / 工具栏按钮）；anchor 为光标屏幕坐标 */
    begin(anchor: Anchor): void {
      this.prompt = startPrompt()
      this.anchor = anchor
      this.warning = null
      this.pendingInsert = null
      this.active = true
    },
    /** 消费一次按键；返回 true 表示该按键已被提示态吃掉（不应进入编辑器） */
    step(key: PromptKey, digit = ''): boolean {
      if (!this.active) return false
      const { next, action, warning } = stepPrompt(this.prompt, key, digit)
      this.prompt = next
      // 警告保留到下一次提交（空格 / 回车）或提示态结束：否则超限提示会被随后的数字输入立刻清掉，
      // 用户根本看不到「最多 50 行 / 20 列」的说明
      if (warning) this.warning = warning
      else if (key === 'space' || key === 'enter') this.warning = null
      if (action === 'insert') {
        this.finish()
      } else if (action === 'cancel') {
        this.cancel()
      }
      return true
    },
    /** 按当前尺寸生成插入意图（空格 / 回车 / 再按 Ctrl+T 都走这里） */
    finish(): void {
      const dims = this.dims
      this.active = false
      this.warning = null
      this.pendingInsert = dims
    },
    cancel(): void {
      this.active = false
      this.prompt = startPrompt()
      this.warning = null
      this.pendingInsert = null
    },
    /** 编辑器消费插入意图 */
    consumeInsert(): { rows: number; cols: number } | null {
      const next = this.pendingInsert
      this.pendingInsert = null
      return next
    }
  }
})
