import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { SCRATCH_VAULT, SCRATCH_VAULT_LABEL } from '@shared/types'
import { noteDisplayName } from '@shared/validate'
import { useAppStore } from './app'
import { useEditorStore } from './editor'

export interface DraftItem {
  name: string
  mtime: number
}

/** 草稿笔记（FR-2.3.9）：真实文件存于 userData/scratch（伪库 __scratch__），
 *  不进搜索 / 双链 / 同步体系；Ctrl+S 触发「转正」进入正式笔记库。 */
/** 草稿打开后自动聚焦（FR-2.3.9 验收 1）：编辑视图已挂载时直接聚焦内容层
 *  （onMounted 的消费点不会再跑）；未挂载（欢迎页 / 设置页进入）时置一次性
 *  聚焦标志，由 EditorView 挂载时消费（与「设置返回自动聚焦」同机制）。 */
function focusDraftEditor(app: ReturnType<typeof useAppStore>): void {
  const el = document.querySelector<HTMLElement>('.cm-content')
  if (el) {
    el.focus()
    app.focusEditorOnce = false
  } else {
    app.focusEditorOnce = true
  }
}

export const useDraftStore = defineStore('draft', {
  state: () => ({
    drafts: [] as DraftItem[],
    /** 转正对话框：正在转正的草稿名；null = 关闭 */
    promoteName: null as string | null,
  }),
  actions: {
    async refresh(): Promise<void> {
      const result = await window.trace.scratchList()
      this.drafts = result.ok && result.notes ? result.notes : []
    },
    /** Ctrl+N：新建草稿并打开；当前已是空草稿时直接复用 */
    async createDraft(): Promise<void> {
      const app = useAppStore()
      const editor = useEditorStore()
      if (editor.current?.vault === SCRATCH_VAULT && !editor.content.trim()) {
        app.view = { name: 'editor' }
        focusDraftEditor(app)
        return
      }
      const result = await window.trace.scratchCreate()
      if (!result.ok || !result.name) {
        ElMessage.error(result.error ?? '创建草稿失败')
        return
      }
      void this.refresh() // 侧栏草稿菜单不监听 scratch 目录（watcher 看不到），创建后主动刷新
      await this.openDraft(result.name)
    },
    async openDraft(name: string): Promise<void> {
      const app = useAppStore()
      const editor = useEditorStore()
      app.view = { name: 'editor' }
      focusDraftEditor(app)
      await editor.openNote(SCRATCH_VAULT, name, noteDisplayName(name))
    },
    async remove(name: string): Promise<void> {
      const app = useAppStore()
      const editor = useEditorStore()
      const result = await window.trace.scratchDelete(name)
      if (!result.ok) {
        ElMessage.error(result.error ?? '删除失败')
        return
      }
      // 删除的是当前打开的草稿 → 回欢迎页（草稿删除为永久删除，不进回收站）
      if (editor.current?.vault === SCRATCH_VAULT && editor.current.path === name) {
        editor.current = null
        editor.content = ''
        app.view = { name: 'welcome' }
      }
      await this.refresh()
    },
    /** 打开转正对话框（不传 name = 转正当前打开的草稿） */
    requestPromote(name?: string): void {
      const editor = useEditorStore()
      const target = name ?? editor.current?.path
      if (!target || editor.current?.vault !== SCRATCH_VAULT) return
      this.promoteName = target
    },
    /** 转正：写入目标库 → 移入正式体系 → 编辑器切到正式路径 */
    async promote(vault: string, dir: string, newName: string): Promise<void> {
      const app = useAppStore()
      const editor = useEditorStore()
      const name = this.promoteName
      if (!name) return
      editor.flushSave() // 落盘最新内容，转正以磁盘内容为准
      const result = await window.trace.scratchPromote(name, vault, dir, newName)
      if (!result.ok || !result.path) {
        ElMessage.error(result.error ?? '转正失败')
        return
      }
      this.promoteName = null
      app.view = { name: 'editor' }
      await editor.openNote(vault, result.path, noteDisplayName(newName))
      ElMessage.success('草稿已转正为笔记')
      await this.refresh()
    },
    cancelPromote(): void {
      this.promoteName = null
    }
  }
})

/** 草稿伪库的显示名（侧栏菜单 / 面包屑 / 搜索结果统一） */
export function scratchVaultLabel(vault: string): string {
  return vault === SCRATCH_VAULT ? SCRATCH_VAULT_LABEL : vault
}
