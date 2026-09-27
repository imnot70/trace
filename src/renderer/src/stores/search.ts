import { defineStore } from 'pinia'

/**
 * 搜索对话框的开关状态（FR-2.9.11 精简后）。
 * 查询 / 结果 / 索引状态等数据自 v0.4.4 起就由 SearchDialog 组件自行持有（直接调
 * window.trace.*），store 里曾并存一套从未被消费的副本与增量方法（渲染端死链路，
 * 2026-09-26 随搜索体系重设计清理——主进程写入链已覆盖索引维护，渲染端无需参与）。
 */
export const useSearchStore = defineStore('search', {
  state: () => ({
    /** 是否显示搜索对话框 */
    visible: false,
    /** Double-Shift 预置的搜索范围（当前库名；FR-2.9.11）。SearchDialog 打开时消费并清空 */
    presetVault: null as string | null
  }),

  actions: {
    /** 打开搜索对话框；传库名则预置范围为该库（当前库搜索） */
    openSearch(presetVault?: string): void {
      this.presetVault = presetVault ?? null
      this.visible = true
    },

    /** 关闭搜索对话框 */
    closeSearch(): void {
      this.visible = false
      this.presetVault = null
    }
  }
})
