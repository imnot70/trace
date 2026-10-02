/**
 * 右键 / ⋮ 菜单的**单一定义源**（FR-2.4.29，D4 / D7）：
 * - 各表面的 ⋮ dropdown 与右键菜单共用本模块的定义，动作永不分叉；
 * - 「表面 ⋮」工厂逐字复刻该表面既有菜单（含条目差异——树与卡片的入口本就不同）；
 * - 「context」工厂 = 同类型对象的**并集**（D7：右键是最全的那份），调用方 handler
 *   须覆盖并集中全部 command（sync / associate / disconnect 等均为 store / composable 薄调用）；
 * - defsToVM 把定义 + 命令处理器映射为右键菜单的视图模型。
 */
import type { MenuItemVM } from '../lib/contextMenu'

export interface MenuItemDef {
  command: string
  label: string
  /** 该项之前渲染分隔线（dropdown 与右键同语义） */
  divided?: boolean
  /** 危险动作（红色警示） */
  danger?: boolean
}

export type MenuCommandHandler = (cmd: string) => void

/** 定义 + handler → 右键菜单视图模型 */
export function defsToVM(defs: MenuItemDef[], handler: MenuCommandHandler): MenuItemVM[] {
  return defs.map((d) => ({
    label: d.label,
    divided: d.divided,
    danger: d.danger,
    action: () => handler(d.command)
  }))
}

// ================= 侧栏树（VaultNode ⋮，逐字复刻现状） =================

export const treePlusItems: MenuItemDef[] = [
  { command: 'dir', label: '新建文件夹' },
  { command: 'note', label: '创建笔记' }
]

export function treeDirItems(): MenuItemDef[] {
  return [
    { command: 'exportPdf', label: '导出 PDF…' },
    { command: 'exportPdfMerge', label: '导出合并 PDF…' },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'move', label: '移动到…' },
    { command: 'rename', label: '重命名' },
    { command: 'delete', label: '删除文件夹', divided: true, danger: true }
  ]
}

export function treeNoteItems(favorited: boolean): MenuItemDef[] {
  return [
    { command: 'exportPdf', label: '导出 PDF…' },
    { command: 'exportPdfMerge', label: '导出合并 PDF…' },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'share', label: '分享…' },
    { command: 'move', label: '移动到…' },
    { command: 'rename', label: '重命名' },
    favorited
      ? { command: 'unfavorite', label: '取消收藏', divided: true }
      : { command: 'favorite', label: '收藏笔记', divided: true },
    { command: 'info', label: '信息', divided: true },
    { command: 'tag', label: '标签…' },
    { command: 'delete', label: '删除笔记', danger: true }
  ]
}

// ================= 网格卡片（NoteGridView ⋮，逐字复刻现状） =================

export function cardVaultItems(): MenuItemDef[] {
  return [
    { command: 'locate', label: '在侧栏中定位' },
    { command: 'exportPdf', label: '导出 PDF…', divided: true },
    { command: 'exportPdfMerge', label: '导出合并 PDF…', divided: true },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'rename', label: '重命名' },
    { command: 'deleteVault', label: '删除笔记库', danger: true }
  ]
}

export function cardDirItems(): MenuItemDef[] {
  return [
    { command: 'newDir', label: '新建文件夹' },
    { command: 'newNote', label: '创建笔记' },
    { command: 'exportPdf', label: '导出 PDF…', divided: true },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'exportPdfMerge', label: '导出合并 PDF…', divided: true },
    { command: 'locate', label: '在侧栏中定位', divided: true },
    { command: 'move', label: '移动到…' },
    { command: 'rename', label: '重命名' },
    { command: 'delete', label: '删除文件夹', danger: true }
  ]
}

export function cardNoteItems(favorited: boolean): MenuItemDef[] {
  return [
    { command: 'exportPdf', label: '导出 PDF…' },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'share', label: '分享…' },
    { command: 'move', label: '移动到…' },
    { command: 'favorite', label: favorited ? '取消收藏' : '收藏笔记' },
    { command: 'locate', label: '在侧栏中定位' },
    { command: 'info', label: '信息', divided: true },
    { command: 'tag', label: '标签' },
    { command: 'delete', label: '删除笔记', divided: true, danger: true }
  ]
}

/** 常用 / 收藏 / 分享 网格的笔记卡片（section 决定差异项与分享文案） */
export function gridNoteItems(section: 'recents' | 'favorites' | 'shared', favorited: boolean): MenuItemDef[] {
  return [
    ...(section === 'shared'
      ? [
          { command: 'copyGistLink', label: '复制链接' },
          { command: 'openGistUrl', label: '打开分享页' }
        ]
      : []),
    { command: 'favorite', label: favorited ? '取消收藏' : '收藏笔记' },
    ...(section === 'recents' ? [{ command: 'removeRecent', label: '移出常用' }] : []),
    { command: 'locate', label: '在侧栏中定位' },
    { command: 'info', label: '信息', divided: true },
    { command: 'tag', label: '标签' },
    { command: 'exportPdf', label: '导出 PDF…', divided: true },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'share', label: section === 'shared' ? '分享管理…' : '分享…' },
    { command: 'delete', label: '删除笔记', danger: true }
  ]
}

export const cardDraftItems: MenuItemDef[] = [
  { command: 'promote', label: '保存为笔记…' },
  { command: 'deleteDraft', label: '删除草稿', divided: true, danger: true }
]

// ================= 侧栏库行（SideBar ⋮，逐字复刻现状） =================

/** 关联态决定 sync / disconnect 显隐与 associate 文案 */
export function sidebarVaultItems(associated: boolean): MenuItemDef[] {
  return [
    ...(associated ? [{ command: 'sync', label: '立即同步' }] : []),
    { command: 'associate', label: associated ? '重新关联 Git 仓库' : '关联 Git 仓库' },
    ...(associated ? [{ command: 'disconnect', label: '解除关联', divided: true }] : []),
    { command: 'rename', label: '重命名', divided: true },
    { command: 'delete', label: '删除笔记库', danger: true }
  ]
}

// ================= 标签行（SideBar ⋮） =================

export const tagRowItems: MenuItemDef[] = [
  { command: 'rename', label: '重命名' },
  { command: 'color', label: '更换颜色' },
  { command: 'delete', label: '删除标签', divided: true, danger: true }
]

// ================= 回收站（TrashView 条目） =================

export const trashEntryItems: MenuItemDef[] = [
  { command: 'restore', label: '还原' },
  { command: 'purge', label: '彻底删除', danger: true }
]

// ================= 右键并集（D7：同类型对象的最全动作集） =================

export function dirContextItems(): MenuItemDef[] {
  return [
    { command: 'newDir', label: '新建文件夹' },
    { command: 'newNote', label: '创建笔记' },
    { command: 'exportPdf', label: '导出 PDF…', divided: true },
    { command: 'exportPdfMerge', label: '导出合并 PDF…' },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'locate', label: '在侧栏中定位', divided: true },
    { command: 'move', label: '移动到…' },
    { command: 'rename', label: '重命名' },
    { command: 'delete', label: '删除文件夹', divided: true, danger: true }
  ]
}

export function noteContextItems(favorited: boolean): MenuItemDef[] {
  return [
    { command: 'exportPdf', label: '导出 PDF…' },
    { command: 'exportPdfMerge', label: '导出合并 PDF…' },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'share', label: '分享…' },
    { command: 'move', label: '移动到…' },
    { command: 'rename', label: '重命名' },
    favorited
      ? { command: 'unfavorite', label: '取消收藏', divided: true }
      : { command: 'favorite', label: '收藏笔记', divided: true },
    { command: 'locate', label: '在侧栏中定位' },
    { command: 'info', label: '信息', divided: true },
    { command: 'tag', label: '标签…' },
    { command: 'delete', label: '删除笔记', divided: true, danger: true }
  ]
}

export function vaultContextItems(associated: boolean): MenuItemDef[] {
  return [
    ...(associated ? [{ command: 'sync', label: '立即同步' }] : []),
    { command: 'associate', label: associated ? '重新关联 Git 仓库' : '关联 Git 仓库' },
    ...(associated ? [{ command: 'disconnect', label: '解除关联', divided: true }] : []),
    { command: 'locate', label: '在侧栏中定位', divided: true },
    { command: 'exportPdf', label: '导出 PDF…', divided: true },
    { command: 'exportPdfMerge', label: '导出合并 PDF…' },
    { command: 'exportHtml', label: '导出 HTML…' },
    { command: 'rename', label: '重命名', divided: true },
    { command: 'deleteVault', label: '删除笔记库', danger: true }
  ]
}
