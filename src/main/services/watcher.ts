import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { FsChangedPayload } from '@shared/types'
import { logger } from '../lib/logger'

/**
 * 文件监听：感知用户在应用外 / git 拉取造成的变更，聚合并通知渲染进程。
 * git 同步期间可挂起，避免自我触发。
 */
export class WatcherService {
  private watcher: FSWatcher | null = null
  private suspendDepth = 0
  private pending = new Map<string, Set<string>>()
  private timer: NodeJS.Timeout | null = null
  /** 挂起期间有事件被丢弃（git 同步/自动同步拉取的文件变更），resume 后需补偿刷新 */
  private droppedWhileSuspended = false

  constructor(
    private getRoot: () => string | null,
    private emit: (payload: FsChangedPayload) => void,
    /** 挂起期丢弃过事件时在 resume 后触发（用于刷新依赖文件事件的索引，如双链索引） */
    private onEventsDropped?: () => void
  ) {}

  start(): void {
    const root = this.getRoot()
    if (!root) return
    this.close()
    const trashDir = path.join(root, '.trash')
    this.watcher = watch(root, {
      ignoreInitial: true,
      depth: 10,
      ignored: (p: string) => {
        if (p === root) return false
        if (p === trashDir || p.startsWith(trashDir + path.sep)) return true
        return path.basename(p) === '.git'
      }
    })
    const onChange = (p: string): void => {
      if (this.suspendDepth > 0) {
        this.droppedWhileSuspended = true
        return
      }
      const r = this.getRoot()
      if (!r) return
      const rel = path.relative(r, p)
      if (!rel || rel === '.trash' || rel.startsWith(`.trash${path.sep}`)) return
      const vault = rel.split(path.sep)[0]
      const rest = rel.split(path.sep).slice(1).join('/')
      let set = this.pending.get(vault)
      if (!set) {
        set = new Set()
        this.pending.set(vault, set)
      }
      if (rest) set.add(rest)
      this.schedule()
    }
    this.watcher
      .on('add', onChange)
      .on('change', onChange)
      .on('unlink', onChange)
      .on('addDir', onChange)
      .on('unlinkDir', onChange)
      .on('error', (e: unknown) => logger.warn('文件监听错误', e))
    logger.info('文件监听已启动', root)
  }

  /** git 操作等批量变更期间挂起事件（挂起期间的事件直接丢弃） */
  suspend(): void {
    this.suspendDepth++
  }

  resume(): void {
    this.suspendDepth = Math.max(0, this.suspendDepth - 1)
    // 挂起结束且期间丢弃过事件：异步触发补偿刷新（rebase 拉取的文件不会再来事件）
    if (this.suspendDepth === 0 && this.droppedWhileSuspended) {
      this.droppedWhileSuspended = false
      this.onEventsDropped?.()
    }
  }

  /** 工作区目录切换后重建监听 */
  restart(): void {
    this.start()
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
    this.droppedWhileSuspended = false
    void this.watcher?.close()
    this.watcher = null
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const batch = new Map(this.pending)
      this.pending.clear()
      for (const [vault, paths] of batch) {
        this.emit({ vault, paths: [...paths] })
      }
    }, 400)
  }
}
