import crypto from 'node:crypto'
import { JsonStore } from '../lib/jsonStore'
import type { TagItem, NoteTagEntry } from '@shared/types'

interface TagsData {
  tags: TagItem[]
  noteTags: NoteTagEntry[]
}

export class TagsService {
  constructor(private store: JsonStore<TagsData>) {}

  listTags(): TagItem[] {
    return this.store.get().tags
  }

  createTag(name: string, color: string): { ok: boolean; tag?: TagItem; error?: string } {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '标签名不能为空' }
    const existing = this.store.get().tags
    if (existing.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: '标签名已存在' }
    }
    const tag: TagItem = { id: crypto.randomUUID(), name: trimmed, color, createdAt: new Date().toISOString() }
    this.store.update((d) => { d.tags.push(tag) })
    return { ok: true, tag }
  }

  renameTag(id: string, name: string): { ok: boolean; error?: string } {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '标签名不能为空' }
    const d = this.store.get()
    if (d.tags.some((t) => t.id !== id && t.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: '标签名已存在' }
    }
    this.store.update((data) => {
      const tag = data.tags.find((t) => t.id === id)
      if (tag) tag.name = trimmed
    })
    return { ok: true }
  }

  deleteTag(id: string): { ok: boolean; error?: string } {
    this.store.update((d) => {
      d.tags = d.tags.filter((t) => t.id !== id)
      d.noteTags = d.noteTags.filter((nt) => nt.tagId !== id)
    })
    return { ok: true }
  }

  setTagColor(id: string, color: string): { ok: boolean; error?: string } {
    this.store.update((d) => {
      const tag = d.tags.find((t) => t.id === id)
      if (tag) tag.color = color
    })
    return { ok: true }
  }

  noteTags(vault: string, relPath: string): TagItem[] {
    const d = this.store.get()
    const tagIds = d.noteTags.filter((nt) => nt.vault === vault && nt.path === relPath).map((nt) => nt.tagId)
    return d.tags.filter((t) => tagIds.includes(t.id))
  }

  addToNote(vault: string, relPath: string, tagId: string): { ok: boolean; error?: string } {
    const d = this.store.get()
    if (!d.tags.some((t) => t.id === tagId)) return { ok: false, error: '标签不存在' }
    if (d.noteTags.some((nt) => nt.vault === vault && nt.path === relPath && nt.tagId === tagId)) return { ok: true }
    this.store.update((data) => { data.noteTags.push({ vault, path: relPath, tagId }) })
    return { ok: true }
  }

  removeFromNote(vault: string, relPath: string, tagId: string): { ok: boolean } {
    this.store.update((d) => {
      d.noteTags = d.noteTags.filter((nt) => !(nt.vault === vault && nt.path === relPath && nt.tagId === tagId))
    })
    return { ok: true }
  }

  notesByTag(tagId: string): NoteTagEntry[] {
    return this.store.get().noteTags.filter((nt) => nt.tagId === tagId)
  }

  onRename(vault: string, oldRel: string, newRel: string, kind: 'dir' | 'note'): void {
    const prefix = `${oldRel}/`
    this.store.update((d) => {
      for (const nt of d.noteTags) {
        if (nt.vault !== vault) continue
        if (kind === 'note' && nt.path === oldRel) {
          nt.path = newRel
        } else if (kind === 'dir' && nt.path.startsWith(prefix)) {
          nt.path = `${newRel}${nt.path.slice(oldRel.length)}`
        }
      }
    })
  }

  onDelete(vault: string, relPath: string, kind: 'dir' | 'note' | 'vault'): void {
    const prefix = `${relPath}/`
    this.store.update((d) => {
      d.noteTags = d.noteTags.filter((nt) => {
        if (nt.vault !== vault) return true
        if (kind === 'vault' || nt.path === relPath) return false
        return !(kind === 'dir' && nt.path.startsWith(prefix))
      })
    })
  }

  onVaultRename(oldVault: string, newVault: string): void {
    this.store.update((d) => {
      for (const nt of d.noteTags) {
        if (nt.vault === oldVault) nt.vault = newVault
      }
    })
  }

  /** 标签关联的笔记数 */
  tagNoteCount(tagId: string): number {
    return this.store.get().noteTags.filter((nt) => nt.tagId === tagId).length
  }
}
