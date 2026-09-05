import { defineStore } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTreeStore } from './tree'
import { useEditorStore } from './editor'

/** GitHub 账号 + git 关联对话框状态 */
export const useGitStore = defineStore('git', {
  state: () => ({
    account: { loggedIn: false, username: null as string | null },
    /** 正在关联远程仓库的笔记库（控制关联对话框显隐） */
    associateVault: null as string | null,
    syncing: {} as Record<string, boolean>
  }),
  actions: {
    async refreshAccount(): Promise<void> {
      const result = await window.trace.getAccount()
      this.account = { loggedIn: result.loggedIn, username: result.username ?? null }
    },
    async login(token: string): Promise<string | null> {
      const result = await window.trace.login(token)
      if (result.ok) {
        await this.refreshAccount()
        return null
      }
      return result.error ?? '登录失败'
    },
    async logout(): Promise<void> {
      await window.trace.logout()
      await this.refreshAccount()
      ElMessage.success('已退出登录')
    },
    openAssociate(vault: string): void {
      this.associateVault = vault
    },
    closeAssociate(): void {
      this.associateVault = null
    },
    async sync(vault: string): Promise<void> {
      const tree = useTreeStore()
      const editor = useEditorStore()
      if (this.syncing[vault]) return
      this.syncing[vault] = true
      try {
        const result = await window.trace.syncVault(vault)
        await tree.refreshGitStatus(vault)
        await tree.loadTree(vault)
        if (editor.current?.vault === vault) {
          if (editor.dirty) editor.externalChanged = true
          else await editor.reloadFromDisk()
        }
        if (result.ok) ElMessage.success('同步完成')
        else if (result.conflicts?.length) {
          ElMessageBox.alert(
            `以下文件存在冲突：${result.conflicts.join('、')}。可在库目录中手动解决冲突后再次同步。`,
            '同步冲突',
            { type: 'error' }
          )
        } else {
          ElMessage.error(result.error ?? '同步失败')
        }
      } finally {
        this.syncing[vault] = false
      }
    },
    async disconnect(vault: string): Promise<void> {
      try {
        await ElMessageBox.confirm(
          '解除关联后将停止与远程仓库同步，本地内容与提交记录保留。确定解除吗？',
          '解除 Git 关联',
          { type: 'warning', confirmButtonText: '解除', cancelButtonText: '取消' }
        )
      } catch {
        return
      }
      const tree = useTreeStore()
      const result = await window.trace.disconnectVault(vault)
      if (result.ok) {
        await tree.refreshGitStatus(vault)
        ElMessage.success('已解除关联')
      }
    }
  }
})
