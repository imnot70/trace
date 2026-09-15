import { ElMessage, ElMessageBox } from 'element-plus'
import { reactive } from 'vue'
import { renderNoteHtml } from '../lib/noteExportHtml'
import type { TreeNode } from '@shared/types'

interface ExportItem {
  vault: string
  path: string
  name: string
}

/** 递归收集文件夹/库下的全部笔记（名称排序与侧栏一致），vault 随项携带 */
export function collectNotes(nodes: TreeNode[], vault: string, prefix = ''): ExportItem[] {
  const result: ExportItem[] = []
  for (const n of nodes) {
    const path = prefix ? `${prefix}/${n.name}` : n.name
    if (n.kind === 'note') {
      result.push({ vault, path: `${path}.md`, name: n.name })
    } else if (n.kind === 'dir' && n.children) {
      result.push(...collectNotes(n.children, vault, path))
    }
  }
  return result
}

/** 导出进行中的全局进度（App.vue 渲染为悬浮进度条；完成即移除，无残留提示） */
export const exportState = reactive({
  visible: false,
  done: 0,
  total: 0,
  current: ''
})

/**
 * 批量导出（PDF / HTML 共用管道）：
 * 1. flushSave 当前笔记（磁盘内容 = 最新）
 * 2. 逐篇生成导出 HTML（图片内联 base64，frontmatter 剥离）
 * 3. PDF 交主进程 printToPDF 写盘；HTML 直接写自包含单文件；进度经 export:progress 回推
 */
async function exportNotes(
  targets: { vault: string; path: string; name: string }[],
  treeStore: { trees: Record<string, TreeNode[]>; loadTree(v: string): Promise<void> },
  editorStore: { current: { vault: string; path: string } | null; flushSave(): Promise<void> },
  kind: 'pdf' | 'html'
): Promise<void> {
  const label = kind === 'pdf' ? 'PDF' : 'HTML'
  if (targets.length === 0) {
    ElMessage.warning('没有可导出的笔记')
    return
  }
  // 导出前保存当前笔记，保证磁盘内容为最新
  await editorStore.flushSave()

  // 首次确认 + 选择目录（在主进程弹）
  const confirm = await ElMessageBox.confirm(
    `将导出 ${targets.length} 篇笔记为 ${label}（每篇一个文件，不合并）。继续后请选择导出目录。`,
    `导出 ${label}`,
    { confirmButtonText: '继续', cancelButtonText: '取消', type: 'info' }
  ).catch(() => null)
  if (!confirm) return

  // 逐篇准备 HTML（主进程选完目录后再生成，避免取消白做；先收集数据源）
  const htmls: string[] = []
  for (const t of targets) {
    if (!treeStore.trees[t.vault]) await treeStore.loadTree(t.vault)
    const result = await window.trace.readNote(t.vault, t.path)
    const content = result.ok && result.content != null ? result.content : ''
    htmls.push(
      await renderNoteHtml(content, t.path, (rel) => window.trace.readImage(t.vault, rel))
    )
  }

  exportState.visible = true
  exportState.done = 0
  exportState.total = targets.length
  exportState.current = ''
  const offProgress = window.trace.onExportProgress(({ done, total, current }) => {
    exportState.done = done
    exportState.total = total
    exportState.current = current
  })

  const items = targets.map((t, i) => ({ ...t, html: htmls[i] }))
  const result = kind === 'pdf' ? await window.trace.exportPdf(items) : await window.trace.exportHtml(items)
  offProgress()
  exportState.visible = false

  if (!result.ok && result.error) {
    ElMessage.error(result.error)
    return
  }
  const failed = result.failed ?? []
  if (failed.length === 0) {
    ElMessage.success(`已导出 ${targets.length} 篇 ${label}`)
  } else {
    ElMessage({
      type: 'warning',
      duration: 0,
      showClose: true,
      message: `导出完成：成功 ${targets.length - failed.length} 篇，失败 ${failed.length} 篇：${failed
        .map((f) => `${f.name}（${f.error}）`)
        .join('；')}`
    })
  }
}

export async function exportNotesToPdf(
  targets: { vault: string; path: string; name: string }[],
  treeStore: Parameters<typeof exportNotes>[1],
  editorStore: Parameters<typeof exportNotes>[2]
): Promise<void> {
  await exportNotes(targets, treeStore, editorStore, 'pdf')
}

export async function exportNotesToHtml(
  targets: { vault: string; path: string; name: string }[],
  treeStore: Parameters<typeof exportNotes>[1],
  editorStore: Parameters<typeof exportNotes>[2]
): Promise<void> {
  await exportNotes(targets, treeStore, editorStore, 'html')
}

export async function confirmAndExportOne(
  vault: string,
  path: string,
  name: string,
  treeStore: Parameters<typeof exportNotesToPdf>[1],
  editorStore: Parameters<typeof exportNotesToPdf>[2]
): Promise<void> {
  await exportNotesToPdf([{ vault, path, name }], treeStore, editorStore)
}

export async function confirmAndExportOneHtml(
  vault: string,
  path: string,
  name: string,
  treeStore: Parameters<typeof exportNotesToHtml>[1],
  editorStore: Parameters<typeof exportNotesToHtml>[2]
): Promise<void> {
  await exportNotesToHtml([{ vault, path, name }], treeStore, editorStore)
}

export { ElMessageBox }
