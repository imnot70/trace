import crypto from 'node:crypto'
import { JsonStore } from '../lib/jsonStore'
import type { TagItem, TagStatInfo, NoteTagEntry, TreeNode } from '@shared/types'
import { getFrontmatterTags, setFrontmatterTags } from '@shared/noteTags'
import { pickTagColor } from '@shared/tagPalette'
import type { FsTreeService } from './fsTree'

/**
 * 标签系统（frontmatter 方案）：
 * - 笔记 ↔ 标签关联存储在笔记 YAML frontmatter 的 `tags` 键（共享层 noteTags.ts 读写），
 *   随文件移动 / 重命名 / 外部编辑天然跟随；
 * - 标签定义（名称 → 颜色）仍存应用元数据 tags.json（配色是应用级呈现，不进笔记）；
 * - 重命名 / 删除标签定义时会扫描全库改写受影响笔记的 frontmatter。
 */

/** 标签组合筛选口径：all = 同时含全部标签（AND），any = 含任一标签（OR） */
export type TagMatchMode = 'all' | 'any'

interface TagsData {
  tags: TagItem[]
  /** 旧版（元数据方案）的关联记录，仅迁移时读取，迁移完成后清空 */
  noteTags: NoteTagEntry[]
}

interface NoteRef {
  vault: string
  path: string
}

export class TagsService {
  constructor(
    private store: JsonStore<TagsData>,
    private fsTree: FsTreeService,
    private listVaultNames: () => string[]
  ) {}

  // ---------- 标签定义 ----------

  listTags(): TagItem[] {
    return this.store.get().tags
  }

  createTag(name: string, color: string): { ok: boolean; tag?: TagItem; error?: string } {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '标签名不能为空' }
    if (this.findByName(trimmed)) return { ok: false, error: '标签名已存在' }
    const tag: TagItem = { id: crypto.randomUUID(), name: trimmed, color, createdAt: new Date().toISOString() }
    this.store.update((d) => { d.tags.push(tag) })
    return { ok: true, tag }
  }

  /** 重命名标签定义，并改写全部关联笔记的 frontmatter */
  async renameTag(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '标签名不能为空' }
    const tag = this.store.get().tags.find((t) => t.id === id)
    if (!tag) return { ok: false, error: '标签不存在' }
    if (tag.name.toLowerCase() !== trimmed.toLowerCase() && this.findByName(trimmed)) {
      return { ok: false, error: '标签名已存在' }
    }
    const oldName = tag.name
    this.store.update((data) => {
      const target = data.tags.find((t) => t.id === id)
      if (target) target.name = trimmed
    })
    await this.rewriteNotes(oldName, trimmed)
    return { ok: true }
  }

  /** 删除标签定义，并从全部关联笔记的 frontmatter 中移除 */
  async deleteTag(id: string): Promise<{ ok: boolean; error?: string }> {
    const tag = this.store.get().tags.find((t) => t.id === id)
    if (!tag) return { ok: false, error: '标签不存在' }
    this.store.update((d) => {
      d.tags = d.tags.filter((t) => t.id !== id)
    })
    await this.rewriteNotes(tag.name, null)
    return { ok: true }
  }

  setTagColor(id: string, color: string): { ok: boolean; error?: string } {
    this.store.update((d) => {
      const tag = d.tags.find((t) => t.id === id)
      if (tag) tag.color = color
    })
    return { ok: true }
  }

  // ---------- 笔记关联（frontmatter） ----------

  /** 笔记的标签（含定义）。未登记的 frontmatter 标签自动注册定义（外部工具写入的标签可见可用） */
  async noteTags(vault: string, relPath: string): Promise<TagItem[]> {
    const read = this.fsTree.readNote(vault, relPath)
    if (!read.ok) return []
    const names = getFrontmatterTags(read.content)
    return names.map((name) => this.ensureDefinition(name))
  }

  async addTagToNote(vault: string, relPath: string, tagId: string): Promise<{ ok: boolean; error?: string }> {
    const tag = this.store.get().tags.find((t) => t.id === tagId)
    if (!tag) return { ok: false, error: '标签不存在' }
    return this.writeNoteTags(vault, relPath, (names) => {
      const has = names.some((n) => n.toLowerCase() === tag.name.toLowerCase())
      return has ? [...names.filter((n) => n !== tag.name), tag.name] : [...names, tag.name]
    })
  }

  async removeFromNote(vault: string, relPath: string, tagId: string): Promise<{ ok: boolean; error?: string }> {
    const tag = this.store.get().tags.find((t) => t.id === tagId)
    if (!tag) return { ok: true }
    return this.writeNoteTags(vault, relPath, (names) =>
      names.filter((n) => n.toLowerCase() !== tag.name.toLowerCase())
    )
  }

  /** 某标签下的全部笔记（全库扫描 frontmatter） */
  async notesByTag(tagId: string): Promise<NoteRef[]> {
    const tag = this.store.get().tags.find((t) => t.id === tagId)
    if (!tag) return []
    const lower = tag.name.toLowerCase()
    const result: NoteRef[] = []
    for await (const { vault, path, content } of this.walkNotes()) {
      if (getFrontmatterTags(content).some((n) => n.toLowerCase() === lower)) {
        result.push({ vault, path })
      }
    }
    return result
  }

  /** 多标签组合筛选（FR-2.6.13）：match=all 取交集（同时含全部标签），any 取并集（含任一） */
  async notesByTags(tagIds: string[], match: TagMatchMode): Promise<NoteRef[]> {
    const lowers = tagIds
      .map((id) => this.store.get().tags.find((t) => t.id === id)?.name.toLowerCase())
      .filter((n): n is string => !!n)
    if (lowers.length === 0) return []
    const result: NoteRef[] = []
    for await (const { vault, path, content } of this.walkNotes()) {
      const names = getFrontmatterTags(content).map((n) => n.toLowerCase())
      const hits = lowers.filter((l) => names.includes(l)).length
      const ok = match === 'all' ? hits === lowers.length : hits > 0
      if (ok) result.push({ vault, path })
    }
    return result
  }

  /**
   * 标签使用统计（FR-2.6.15 / FR-2.6.16）：全库扫描一次，按标签名（大小写不敏感）聚合
   * 笔记数与最近使用时间（笔记 mtime 的最大值）。未登记定义的 frontmatter 标签同样计入
   * （与筛选口径一致：它们在网格中可见）；名称取首次出现的原始写法。
   */
  async tagStats(): Promise<TagStatInfo[]> {
    const agg = new Map<string, TagStatInfo>()
    for await (const { vault, path, content } of this.walkNotes()) {
      const mtime = this.fsTree.noteMtime(vault, path)
      for (const raw of getFrontmatterTags(content)) {
        const key = raw.toLowerCase()
        const cur = agg.get(key)
        if (!cur) agg.set(key, { name: raw, count: 1, lastUsed: mtime })
        else {
          cur.count++
          if (mtime > cur.lastUsed) {
            cur.lastUsed = mtime
            cur.name = raw
          }
        }
      }
    }
    return [...agg.values()]
  }

  /**
   * 标签合并（FR-2.6.15）：source 的全部笔记并入 target——逐篇把 frontmatter 里的
   * source 名（大小写不敏感）移除，没有 target 名时补上；随后删除 source 定义。
   * 与删除 / 重命名同一写回管线（hash 防覆盖，YAML 解析失败的保护在 writeNoteTags 内）。
   */
  async mergeTags(sourceId: string, targetId: string): Promise<{ ok: boolean; notes?: number; error?: string }> {
    const tags = this.store.get().tags
    const source = tags.find((t) => t.id === sourceId)
    const target = tags.find((t) => t.id === targetId)
    if (!source || !target) return { ok: false, error: '标签不存在' }
    if (source.id === target.id || source.name.toLowerCase() === target.name.toLowerCase()) {
      return { ok: false, error: '不能合并到自身' }
    }
    const srcLower = source.name.toLowerCase()
    const dstLower = target.name.toLowerCase()
    let notes = 0
    for await (const { vault, path, content } of this.walkNotes()) {
      const names = getFrontmatterTags(content)
      if (!names.some((n) => n.toLowerCase() === srcLower)) continue
      const removed = names.filter((n) => n.toLowerCase() !== srcLower)
      // 已含 target（任意大小写写法）则只移除 source；否则补上定义的规范写法
      const next = removed.some((n) => n.toLowerCase() === dstLower) ? removed : [...removed, target.name]
      const write = await this.writeNoteTags(vault, path, () => next)
      if (write.ok) notes++
    }
    this.store.update((d) => {
      d.tags = d.tags.filter((t) => t.id !== sourceId)
    })
    return { ok: true, notes }
  }

  // ---------- 旧版元数据迁移 ----------

  /** 把旧版 noteTags（库+路径+tagId）关联写入各笔记 frontmatter，完成后清空旧记录 */
  async migrateFromNoteTags(): Promise<number> {
    const legacy = this.store.get().noteTags
    if (legacy.length === 0) return 0
    const byNote = new Map<string, string[]>()
    for (const nt of legacy) {
      const key = `${nt.vault}::${nt.path}`
      const tag = this.store.get().tags.find((t) => t.id === nt.tagId)
      if (!tag) continue
      const names = byNote.get(key) ?? []
      if (!names.some((n) => n.toLowerCase() === tag.name.toLowerCase())) names.push(tag.name)
      byNote.set(key, names)
    }
    let migrated = 0
    for (const [key, names] of byNote) {
      const [vault, path] = [key.slice(0, key.indexOf('::')), key.slice(key.indexOf('::') + 2)]
      const write = await this.writeNoteTags(vault, path, (existing) => {
        for (const n of names) {
          if (!existing.some((e) => e.toLowerCase() === n.toLowerCase())) existing.push(n)
        }
        return existing
      })
      if (write !== null && write.ok !== false) migrated++
    }
    this.store.update((d) => { d.noteTags = [] })
    return migrated
  }

  // ---------- 内部 ----------

  private findByName(name: string): TagItem | undefined {
    const lower = name.toLowerCase()
    return this.store.get().tags.find((t) => t.name.toLowerCase() === lower)
  }

  /** 未登记的 frontmatter 标签自动注册定义（配色按名称取自共享色板，与手动新建同一逻辑） */
  private ensureDefinition(name: string): TagItem {
    const existing = this.findByName(name)
    if (existing) return existing
    const tag: TagItem = { id: crypto.randomUUID(), name, color: pickTagColor(name), createdAt: new Date().toISOString() }
    this.store.update((d) => { d.tags.push(tag) })
    return tag
  }

  /** 读取笔记并按映射改写 frontmatter tags 后写回（带 hash 防覆盖）。文件不存在时静默成功 */
  private async writeNoteTags(
    vault: string,
    relPath: string,
    map: (names: string[]) => string[]
  ): Promise<{ ok: boolean; error?: string }> {
    const read = this.fsTree.readNote(vault, relPath)
    if (!read.ok) return { ok: true } // 文件已被外部删除等：视为无需处理
    const updated = setFrontmatterTags(read.content, map(getFrontmatterTags(read.content)))
    if (updated === null) return { ok: false, error: 'frontmatter 格式无法解析，已放弃写入以保护原文' }
    if (updated === read.content) return { ok: true }
    const write = this.fsTree.writeNote(vault, relPath, updated, read.hash)
    return write.ok ? { ok: true } : { ok: false, error: write.error ?? '写入失败' }
  }

  private async rewriteNotes(oldName: string, newName: string | null): Promise<void> {
    const lower = oldName.toLowerCase()
    for await (const { vault, path, content } of this.walkNotes()) {
      if (!getFrontmatterTags(content).some((n) => n.toLowerCase() === lower)) continue
      const updated = setFrontmatterTags(
        content,
        getFrontmatterTags(content)
          .filter((n) => n.toLowerCase() !== lower)
          .concat(newName ? [newName] : [])
      )
      if (updated === null || updated === content) continue
      const read = this.fsTree.readNote(vault, path)
      if (read.ok) this.fsTree.writeNote(vault, path, updated, read.hash)
    }
  }

  /** 遍历全部笔记库的所有笔记 */
  private collectNoteRefs(): NoteRef[] {
    const result: NoteRef[] = []
    const walk = (vault: string, list: TreeNode[]): void => {
      for (const node of list) {
        if (node.kind === 'note') result.push({ vault, path: node.path })
        else if (node.children) walk(vault, node.children)
      }
    }
    for (const vault of this.listVaultNames()) walk(vault, this.fsTree.listTree(vault))
    return result
  }

  private async *walkNotes(): AsyncGenerator<NoteRef & { content: string }> {
    for (const { vault, path } of this.collectNoteRefs()) {
      const read = this.fsTree.readNote(vault, path)
      if (read.ok) yield { vault, path, content: read.content }
    }
  }
}
