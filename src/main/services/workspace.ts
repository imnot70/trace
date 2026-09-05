import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '@shared/types'
import { JsonStore } from '../lib/jsonStore'

/**
 * 工作区服务：负责工作区根目录（所有笔记库的父目录）。
 * 根目录持久化在设置存储的 workspaceRoot 字段中，避免两份事实来源。
 */
export class WorkspaceService {
  constructor(
    private settings: JsonStore<AppSettings>,
    private defaultRoot: string
  ) {}

  getRoot(): string | null {
    return this.settings.get().workspaceRoot || null
  }

  getDefaultRoot(): string {
    return this.defaultRoot
  }

  /** 首次运行时创建并启用默认工作区 */
  initDefault(): { ok: boolean; error?: string } {
    const current = this.getRoot()
    if (current && fs.existsSync(current)) return { ok: true }
    return this.setRoot(current ?? this.defaultRoot)
  }

  setRoot(root: string): { ok: boolean; error?: string } {
    try {
      const abs = path.resolve(root)
      if (abs === path.parse(abs).root) return { ok: false, error: '不能使用磁盘根目录作为工作区' }
      fs.mkdirSync(abs, { recursive: true })
      const probe = path.join(abs, `.trace-write-test-${Date.now()}`)
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
      this.settings.update((s) => {
        s.workspaceRoot = abs
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: `无法使用该目录：${e instanceof Error ? e.message : String(e)}` }
    }
  }
}
