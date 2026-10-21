import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { JsonStore } from '../lib/jsonStore'
import { noteDisplayName } from '@shared/validate'
import { resolveWithin } from '../lib/paths'
import { logger } from '../lib/logger'
import type { ItemKind, TrashEntry } from '@shared/types'

interface TrashIndex {
  entries: TrashEntry[]
}

const EMPTY_INDEX: TrashIndex = { entries: [] }

/**
 * 应用级回收站：<工作区根>/.trash/。
 * items/<id>/ 存放被删对象本体，index.json 记录元数据（原位置等）。
 */
export class TrashService {
  private store: JsonStore<TrashIndex> | null = null
  private storeRoot: string | null = null

  constructor(
    private getRoot: () => string | null,
    /** 容量上限（条目数）读取器；<= 0 表示不限制 */
    private getMaxEntries: () => number = () => 0,
    /** 库名 → 绝对路径解析器。外部笔记库（FR-2.1.4）注册在工作区之外，必须由
     *  index.ts 注入 VaultService.vaultPath 才能正确定位；缺省按工作区库约定
     *  解析（根目录下同名子目录，单测场景用）。 */
    private resolveVault?: (name: string) => string
  ) {}

  /** 注入库路径解析器（index.ts 在 VaultService 构造完成后回调，规避构造顺序循环） */
  setVaultResolver(resolve: (name: string) => string): void {
    this.resolveVault = resolve
  }

  /** 库的绝对路径：优先注入的解析器（覆盖外部库），否则按工作区库约定 */
  private vaultAbs(name: string): string {
    if (this.resolveVault) return this.resolveVault(name)
    const root = this.getRoot()
    if (!root) throw new Error('尚未设置工作区')
    return resolveWithin(root, name)
  }

  private ensureStore(): JsonStore<TrashIndex> | null {
    const root = this.getRoot()
    if (!root) return null
    if (!this.store || this.storeRoot !== root) {
      this.store = new JsonStore<TrashIndex>(path.join(root, '.trash', 'index.json'), EMPTY_INDEX)
      this.storeRoot = root
    }
    return this.store
  }

  trashDir(): string | null {
    const root = this.getRoot()
    return root ? path.join(root, '.trash') : null
  }

  list(): TrashEntry[] {
    const store = this.ensureStore()
    if (!store) return []
        // 删除时间倒序；同毫秒条目按插入序倒序（后删的在前）——sort 需全序，否则同毫秒批次顺序不稳定
    return [...store.get().entries]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.deletedAt.localeCompare(a.e.deletedAt) || b.i - a.i)
      .map((x) => x.e)
  }

  put(opts: { vault: string; path: string; kind: ItemKind }): { ok: boolean; error?: string } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root) return { ok: false, error: '尚未设置工作区' }
    let itemDir: string | null = null
    let moved = false // 搬移一旦落成，后续失败绝不可清理暂存目录（源已不在，只能保数据）
    try {
      // 外部笔记库（FR-2.1.4）不在工作区根下，必须经解析器定位（此前误拼 root/库名 → 「目标不存在」）
      const vaultAbs = this.vaultAbs(opts.vault)
      const sourceAbs = opts.kind === 'vault' ? vaultAbs : path.join(vaultAbs, opts.path)
      if (!fs.existsSync(sourceAbs)) return { ok: false, error: '目标不存在' }
      const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
      const baseName = opts.kind === 'vault' ? opts.vault : path.basename(opts.path)
      // 回收站列表里笔记显示不带 .md 的名字
      const name = opts.kind === 'note' ? noteDisplayName(baseName) : baseName
      itemDir = path.join(root, '.trash', 'items', id)
      fs.mkdirSync(itemDir, { recursive: true })
      movePath(sourceAbs, path.join(itemDir, baseName))
      moved = true
      const entry: TrashEntry = {
        id,
        name,
        item: baseName,
        kind: opts.kind,
        vault: opts.vault,
        path: opts.path,
        deletedAt: new Date().toISOString()
      }
      store.update((d) => d.entries.push(entry))
      // 容量上限：超出时永久删除最旧的条目（FIFO）
      this.enforceCap()
      return { ok: true }
    } catch (e) {
      // 条目未建立且搬移未发生时才清暂存目录（复制回退中途失败可能留下部分内容）；
      // 已搬移的（源已不在）一律保留数据，宁可留下无索引条目也不丢用户文件
      if (itemDir && !moved) {
        try { fs.rmSync(itemDir, { recursive: true, force: true }) } catch { /* 清理失败不影响错误上报 */ }
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  restore(id: string): { ok: boolean; error?: string } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root) return { ok: false, error: '尚未设置工作区' }
    const entry = store.get().entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: '回收站中不存在该条目' }
    try {
      const itemAbs = path.join(root, '.trash', 'items', entry.id, entry.item)
      if (!fs.existsSync(itemAbs)) return { ok: false, error: '回收站数据已损坏或已被清理' }

      let targetAbs: string
      if (entry.kind === 'vault') {
        // 库条目只会来自工作区库（外部库删除=仅解除注册，不进回收站），始终还原回工作区根；
        // 不走 vaultAbs——若此后注册了同名外部库，会被错误解析到外部目录
        targetAbs = path.join(root, entry.name)
      } else {
        // 笔记 / 文件夹经解析器定位：外部库条目还原回外部目录（而非工作区根下误建同名目录）
        targetAbs = path.join(this.vaultAbs(entry.vault), entry.path)
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true })
      }
      if (fs.existsSync(targetAbs)) {
        // 目标位置已存在同名对象，追加后缀避免覆盖
        const { dir, ext, name } = path.parse(targetAbs)
        targetAbs = path.join(dir, `${name}（已恢复）${ext}`)
      }
      movePath(itemAbs, targetAbs)
      if (entry.kind === 'vault') {
        // 恢复后的库如果改了名字，同步修正条目里的库名
        entry.vault = path.basename(targetAbs)
      }
      store.update((d) => {
        d.entries = d.entries.filter((e) => e.id !== id)
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  purge(id: string): { ok: boolean; error?: string } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root) return { ok: false, error: '尚未设置工作区' }
    const entry = store.get().entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: '回收站中不存在该条目' }
    try {
      fs.rmSync(path.join(root, '.trash', 'items', entry.id), { recursive: true, force: true })
      store.update((d) => {
        d.entries = d.entries.filter((e) => e.id !== id)
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 过期清理：删除保留天数之前的条目（本体 + 索引）。retentionDays <= 0 表示永不清理。
   * 由应用启动时调用（用户重启应用即触发一轮清理）。
   */
  cleanup(retentionDays: number): { removed: number } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root || retentionDays <= 0) return { removed: 0 }
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const expired = store.get().entries.filter((e) => new Date(e.deletedAt).getTime() < cutoff)
    let removed = 0
    for (const entry of expired) {
      try {
        fs.rmSync(path.join(root, '.trash', 'items', entry.id), { recursive: true, force: true })
        store.update((d) => {
          d.entries = d.entries.filter((e) => e.id !== entry.id)
        })
        removed++
      } catch (e) {
        logger.warn(`回收站清理失败：${entry.id}`, e)
      }
    }
    if (removed > 0) logger.info(`回收站清理了 ${removed} 条过期条目（保留 ${retentionDays} 天）`)
    return { removed }
  }

  /**
   * 容量上限执行：条目数超过上限时按删除时间从旧到新永久删除（FIFO）。
   * maxEntries <= 0 表示不限制。由 put 时与启动清理时调用。
   */
  enforceCap(): { removed: number } {
    const store = this.ensureStore()
    const root = this.getRoot()
    const max = this.getMaxEntries()
    if (!store || !root || max <= 0) return { removed: 0 }
    const entries = [...store.get().entries].sort((a, b) => a.deletedAt.localeCompare(b.deletedAt))
    let removed = 0
    for (const entry of entries.slice(0, Math.max(0, entries.length - max))) {
      try {
        fs.rmSync(path.join(root, '.trash', 'items', entry.id), { recursive: true, force: true })
        store.update((d) => {
          d.entries = d.entries.filter((e) => e.id !== entry.id)
        })
        removed++
      } catch (e) {
        logger.warn(`回收站容量清理失败：${entry.id}`, e)
      }
    }
    if (removed > 0) logger.info(`回收站容量清理：移除 ${removed} 条最旧条目（上限 ${max} 条）`)
    return { removed }
  }

  empty(): { ok: boolean; error?: string } {
    const store = this.ensureStore()
    const root = this.getRoot()
    if (!store || !root) return { ok: false, error: '尚未设置工作区' }
    try {
      fs.rmSync(path.join(root, '.trash', 'items'), { recursive: true, force: true })
      store.update((d) => {
        d.entries = []
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

/** 跨盘 / 占用回退（回收站移入 / 还原统一走此函数）：
 *  1. EXDEV——外部笔记库（FR-2.1.4）在另一磁盘，fs.rename 跨盘必抛，回退「复制 + 删除」；
 *  2. EPERM / EACCES / EBUSY——Windows 实测（2026-10-21）：工作区监听（chokidar 5 每目录
 *     一个 fs.watch 句柄）会锁住被监听目录，rename 进未监听的 .trash 子树硬失败，重试与
 *     chokidar unwatch 均无效（杀软 / 索引器瞬时占用同类）；复制 + 删除只需读源 + 逐项删，
 *     不要求对目录本身的独占句柄，实测稳定可用。目录与文件统一处理。 */
export function movePath(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
    return
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw e
  }
  fs.cpSync(from, to, { recursive: true })
  fs.rmSync(from, { recursive: true, force: true })
}
