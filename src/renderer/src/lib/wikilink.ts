/** 双链打开的共享逻辑：预览点击与编辑器 Ctrl+Click 同一套
 *  （无候选提示断链、单候选直接打开、多候选弹层消歧） */
import { h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

export function noteDisplayName(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base
}

export interface OpenNoteTarget {
  vault: string
  path: string
  name: string
}

/** 按双链名称解析并打开：open 回调由调用方提供（预览 emit / 编辑器直接开笔记） */
export async function openWikilinkByName(
  vault: string,
  name: string,
  open: (target: OpenNoteTarget) => void
): Promise<void> {
  const result = await window.trace.resolveByNameCandidates(vault, name)
  const paths = result.ok && result.paths ? result.paths : []
  if (paths.length === 0) {
    ElMessage.warning(`笔记不存在：${name}`)
    return
  }
  if (paths.length === 1) {
    open({ vault, path: paths[0], name: noteDisplayName(paths[0]) })
    return
  }
  ElMessageBox({
    title: `「${name}」有 ${paths.length} 篇同名笔记`,
    message: h(
      'div',
      { class: 'wikilink-ambig-list' },
      paths.map((p) =>
        h(
          'div',
          {
            class: 'wikilink-ambig-item',
            onClick: () => {
              ElMessageBox.close()
              open({ vault, path: p, name: noteDisplayName(p) })
            }
          },
          [h('span', { class: 'ambig-title' }, noteDisplayName(p)), h('span', { class: 'ambig-path' }, p)]
        )
      )
    ),
    showConfirmButton: false,
    showCancelButton: false
  }).catch(() => {
    /* 右上角关闭 / Esc */
  })
}
