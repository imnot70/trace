import { ElMessageBox, ElMessage } from 'element-plus'
import { useNameDialog } from '../stores/nameDialog'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import { useAppStore } from '../stores/app'

/** 侧栏与树节点的全部操作（创建/重命名/删除/收藏/git） */
export function useNoteActions() {
  const dialog = useNameDialog()
  const tree = useTreeStore()
  const editor = useEditorStore()
  const app = useAppStore()

  async function refreshVault(vault: string): Promise<void> {
    await tree.loadVaults()
    await tree.loadTree(vault)
    void tree.refreshGitStatus(vault)
  }

  // ---------- 笔记库 ----------
  function createVault(): void {
    dialog.open({
      title: '创建笔记库',
      kind: 'vault',
      placeholder: '按主题命名，例如：工作笔记',
      action: async (name) => {
        const result = await window.trace.createVault(name)
        if (result.ok) await tree.loadVaults()
        return result
      }
    })
  }

  function renameVault(oldName: string): void {
    dialog.open({
      title: '重命名笔记库',
      kind: 'vault',
      initialValue: oldName,
      action: async (name) => {
        const result = await window.trace.renameVault(oldName, name)
        if (result.ok) {
          editor.handleVaultRenamed(oldName, name)
          delete tree.trees[oldName]
          await tree.loadVaults()
          await tree.loadTree(name)
          await tree.loadFavorites()
          await tree.loadRecents()
        }
        return result
      }
    })
  }

  async function deleteVault(name: string): Promise<void> {
    try {
      await ElMessageBox.confirm(
        `确定删除笔记库「${name}」吗？库中的全部内容将一并移入回收站。`,
        '删除笔记库',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
      )
    } catch {
      return
    }
    const result = await window.trace.deleteVault(name)
    if (result.ok) {
      await editor.closeNote()
      app.view = { name: 'welcome' }
      delete tree.trees[name]
      await tree.loadVaults()
      await tree.loadFavorites()
      await tree.loadRecents()
      ElMessage.success('已移入回收站')
    } else {
      ElMessage.error(result.error ?? '删除失败')
    }
  }

  // ---------- 目录 ----------
  function createDir(vault: string, parentPath = ''): void {
    dialog.open({
      title: '创建子目录',
      kind: 'dir',
      placeholder: '目录名称',
      action: async (name) => {
        const result = await window.trace.createDir(vault, parentPath, name)
        if (result.ok) {
          tree.expanded[`${vault}::${parentPath}`] = true
          await refreshVault(vault)
        }
        return result
      }
    })
  }

  function renameDir(vault: string, path: string, oldName: string): void {
    dialog.open({
      title: '重命名子目录',
      kind: 'dir',
      initialValue: oldName,
      action: async (name) => {
        const result = await window.trace.renameNode(vault, path, 'dir', name)
        if (result.ok && result.newPath) {
          editor.handleNodeRenamed(vault, path, result.newPath, 'dir', name)
          await refreshVault(vault)
          await tree.loadFavorites()
          await tree.loadRecents()
        }
        return result
      }
    })
  }

  async function deleteDir(vault: string, path: string, name: string): Promise<void> {
    try {
      await ElMessageBox.confirm(
        `确定删除子目录「${name}」吗？其中的全部内容将一并移入回收站。`,
        '删除子目录',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    const result = await window.trace.deleteNode(vault, path, 'dir')
    if (result.ok) {
      editor.handleNodeDeleted(vault, path, 'dir')
      await refreshVault(vault)
      await tree.loadFavorites()
      await tree.loadRecents()
      ElMessage.success('已移入回收站')
    } else {
      ElMessage.error(result.error ?? '删除失败')
    }
  }

  // ---------- 笔记 ----------
  function createNote(vault: string, parentPath = ''): void {
    dialog.open({
      title: '创建笔记',
      kind: 'note',
      placeholder: '笔记名称',
      action: async (name) => {
        const result = await window.trace.createNote(vault, parentPath, name)
        if (result.ok && result.path) {
          tree.expanded[`${vault}::${parentPath}`] = true
          await refreshVault(vault)
          await editor.openNote(vault, result.path, name)
          app.view = { name: 'editor' }
        }
        return result
      }
    })
  }

  function renameNote(vault: string, path: string, oldName: string): void {
    dialog.open({
      title: '重命名笔记',
      kind: 'note',
      initialValue: oldName,
      action: async (name) => {
        const result = await window.trace.renameNode(vault, path, 'note', name)
        if (result.ok && result.newPath) {
          editor.handleNodeRenamed(vault, path, result.newPath, 'note', name)
          await refreshVault(vault)
          await tree.loadFavorites()
          await tree.loadRecents()
        }
        return result
      }
    })
  }

  async function deleteNote(vault: string, path: string, name: string): Promise<void> {
    try {
      await ElMessageBox.confirm(`确定删除笔记「${name}」吗？删除后将移入回收站。`, '删除笔记', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消'
      })
    } catch {
      return
    }
    const result = await window.trace.deleteNode(vault, path, 'note')
    if (result.ok) {
      editor.handleNodeDeleted(vault, path, 'note')
      await refreshVault(vault)
      await tree.loadFavorites()
      await tree.loadRecents()
      ElMessage.success('已移入回收站')
    } else {
      ElMessage.error(result.error ?? '删除失败')
    }
  }

  // ---------- 收藏 ----------
  async function toggleFavorite(vault: string, path: string, name: string, favorite: boolean): Promise<void> {
    const result = favorite
      ? await window.trace.removeFavorite(vault, path)
      : await window.trace.addFavorite(vault, path, name)
    if (result.ok) await tree.loadFavorites()
  }

  // ---------- 打开 ----------
  async function openNote(vault: string, path: string, name: string): Promise<void> {
    await editor.openNote(vault, path, name)
    app.view = { name: 'editor' }
  }

  return {
    createVault,
    renameVault,
    deleteVault,
    createDir,
    renameDir,
    deleteDir,
    createNote,
    renameNote,
    deleteNote,
    toggleFavorite,
    openNote,
    refreshVault
  }
}
