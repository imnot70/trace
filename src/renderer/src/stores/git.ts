import { defineStore } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTreeStore } from './tree'
import { useEditorStore } from './editor'
import { useAppStore } from './app'

/** 模块级缓存：避免同一次会话中重复检测 git 可用性 */
let gitAvailabilityCache: { systemGit: boolean; bundledGit: boolean } | null = null

/** 获取 git 可用性（优先读缓存，无缓存时调用主进程检测） */
async function getGitAvailability(): Promise<{ systemGit: boolean; bundledGit: boolean }> {
  if (gitAvailabilityCache) return gitAvailabilityCache
  gitAvailabilityCache = await window.trace.checkGitAvailability()
  return gitAvailabilityCache
}

/** 重置缓存（设置页「重置选择」时调用，下次触发同步重新检测） */
export function resetGitAvailabilityCache(): void {
  gitAvailabilityCache = null
}

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
    /**
     * 检测 git 可用性，不可用时弹窗引导。
     * @returns true = git 可用（或用户确认使用内置 git），false = 用户取消
     */
    async ensureGitAvailable(): Promise<boolean> {
      const app = useAppStore()
      // 用户已做过选择且选择的是系统 git → 直接通过
      if (app.settings.gitSource === 'system') return true
      // 用户已选择内置 git → 直接通过（当前版本无内置 git，兜底检测）
      if (app.settings.gitSource === 'bundled') {
        const avail = await getGitAvailability()
        if (avail.bundledGit) return true
        // 内置 git 不可用（理论上不会发生），重置偏好重新检测
        await app.updateSettings({ gitSource: null })
      }
      // 未做过选择或需要重新检测
      const avail = await getGitAvailability()
      if (avail.systemGit) {
        // 系统 git 可用，记住选择
        await app.updateSettings({ gitSource: 'system' })
        return true
      }
      if (avail.bundledGit) {
        // 系统 git 不可用，内置 git 可用 → 弹窗询问
        try {
          await ElMessageBox.confirm(
            'Trace 需要 Git 来完成笔记库的云端同步。检测到应用已内置 Git，可直接使用。',
            '未检测到系统 Git',
            { confirmButtonText: '使用内置 Git', cancelButtonText: '取消', type: 'warning' }
          )
          await app.updateSettings({ gitSource: 'bundled' })
          return true
        } catch {
          return false
        }
      }
      // 两者均不可用 → 弹窗提示安装
      const platform = navigator.platform.toLowerCase()
      let hint = ''
      if (platform.includes('win')) hint = '前往 git-scm.com 下载安装包'
      else if (platform.includes('mac')) hint = '终端执行 brew install git'
      else hint = '终端执行 sudo apt install git'
      try {
        await ElMessageBox.confirm(
          `Trace 需要 Git 来完成笔记库的云端同步。\n\n请先安装 Git 后重试：${hint}`,
          '需要安装 Git',
          { confirmButtonText: '我知道了', cancelButtonText: '取消', type: 'warning', showCancelButton: false }
        )
      } catch {
        // 用户关闭了弹窗
      }
      return false
    },
    async openAssociate(vault: string): Promise<void> {
      // 前置检测 git 可用性
      if (!(await this.ensureGitAvailable())) {
        ElMessage.warning('未安装 Git，无法关联远程仓库')
        return
      }
      this.associateVault = vault
    },
    closeAssociate(): void {
      this.associateVault = null
    },
    async sync(vault: string): Promise<void> {
      const tree = useTreeStore()
      const editor = useEditorStore()
      if (this.syncing[vault]) return
      // 前置检测 git 可用性
      if (!(await this.ensureGitAvailable())) {
        ElMessage.warning('未安装 Git，无法同步')
        return
      }
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
