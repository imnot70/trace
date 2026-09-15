import fs from 'node:fs'
import path from 'node:path'
import type { GitService } from './gitService'
import type { WatcherService } from './watcher'
import { logger } from '../lib/logger'

export type AutoSyncMode = 'off' | 'interval' | 'change'

export interface AutoSyncDeps {
  /** 工作区根目录（空 = 未设置） */
  getRoot: () => string | null
  git: GitService
  watcher: WatcherService
  /** 读取当前设置（模式 / 间隔） */
  getConfig: () => { mode: AutoSyncMode; intervalMin: number }
  /** 变更触发防抖时长（毫秒，默认 5000；测试可缩短） */
  debounceMs?: number
}

/**
 * 定时自动同步：对工作区内所有已关联远程仓库的笔记库静默执行同步管道。
 * - 仅同步磁盘状态（未防抖的输入属下一轮）；不广播 git:event，避免周期性打扰
 * - 失败仅记日志（界面上的 ahead/behind 徽标自然反映状态），下轮重试
 * - 同步期间挂起文件监听（与手动同步同路径）
 */
export class AutoSyncService {
  private timer: NodeJS.Timeout | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private running = false
  private rerunAfterTick = false

  constructor(private deps: AutoSyncDeps) {}

  /** 按当前设置应用（设置变更 / 启动时调用）：定时器 + 变更监听随模式切换 */
  apply(): void {
    const { mode, intervalMin } = this.deps.getConfig()
    this.stop()
    if (mode === 'off') {
      logger.info('自动同步已关闭')
      return
    }
    if (mode === 'interval') {
      const ms = Math.max(1, Math.min(1440, intervalMin)) * 60 * 1000
      this.timer = setInterval(() => void this.tick(), ms)
      logger.info(`定时自动同步已启用，间隔 ${intervalMin} 分钟`)
      return
    }
    // change 模式：监听由 WatcherService 侧调 onChanged 驱动，无需定时器
    logger.info('自动同步已启用（变更触发模式）')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * 变更触发入口（change 模式下由 WatcherService 的 fs 事件调用）：
   * 防抖 5 秒——连续保存 / 粘贴多图合并为一轮同步；运行中则置重跑标记，
   * 本轮结束后再跑一次（避免丢变更，也避免并发）。
   */
  onChanged(): void {
    const { mode } = this.deps.getConfig()
    if (mode !== 'change') return
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      if (this.running) {
        this.rerunAfterTick = true
        return
      }
      void this.tick()
    }, this.deps.debounceMs ?? 5000)
  }

  /** 单轮同步：遍历工作区一级目录中的 git 仓库，有 origin 的才同步 */
  private async tick(): Promise<void> {
    if (this.running) return // 上一轮未结束（网络慢）则跳过本轮
    const root = this.deps.getRoot()
    if (!root || !fs.existsSync(root)) return
    this.running = true
    try {
      const vaults = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
      for (const vault of vaults) {
        const vaultPath = path.join(root, vault)
        if (!this.deps.git.isRepo(vaultPath)) continue
        const status = await this.deps.git.status(vaultPath)
        if (!status.associated) continue
        this.deps.watcher.suspend()
        try {
          const result = await this.deps.git.sync(vaultPath)
          if (!result.ok) logger.warn(`自动同步失败（${vault}）：${result.error ?? '未知错误'}`)
          else if (result.conflicts?.length) logger.warn(`自动同步存在冲突（${vault}）：${result.conflicts.join('、')}`)
        } catch (e) {
          logger.warn(`自动同步异常（${vault}）`, e)
        } finally {
          this.deps.watcher.resume()
        }
      }
    } finally {
      this.running = false
    }
    // 变更触发模式：本轮同步期间又有新变更，结束后再跑一轮收敛
    if (this.rerunAfterTick && this.deps.getConfig().mode === 'change') {
      this.rerunAfterTick = false
      void this.tick()
    }
  }
}
