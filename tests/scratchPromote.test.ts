import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { promoteDraft, type PromoteOptions } from '../src/main/services/scratchPromote'
import type { ScratchService } from '../src/main/services/scratch'

/**
 * 草稿引用复用（FR-2.9.12 复验反馈，2026-09-30）：keepDraft 引入同一草稿两次——
 * 第一次创建正式笔记，第二次同内容直接复用（不再报「名称已存在」）；草稿改过后
 * 生成 -2 新快照。转正（非 keepDraft）撞名保持报错。
 */

let tmp: string
let vaultAbs: string

function makeScratch(notes: Record<string, string>, assets: Record<string, string> = {}): ScratchService {
  return {
    read: (name: string) =>
      name in notes ? { ok: true, content: notes[name] } : { ok: false, error: '草稿不存在' },
    assetBase64: (ref: string) => {
      const key = ref.replace(/^assets\//, '')
      return key in assets ? assets[key] : null
    },
    removeAsset: (ref: string) => {
      delete assets[ref.replace(/^assets\//, '')]
    },
    remove: (name: string) => {
      delete notes[name]
    }
  } as unknown as ScratchService
}

function makeOpts(scratch: ScratchService, calls: { createNote: string[] }): PromoteOptions {
  return {
    name: '速记 0927.md',
    vault: '库A',
    dir: '跨库引用/草稿',
    newName: '速记 0927',
    attachmentsDir: 'attachments',
    vaultPath: vaultAbs,
    createNote: (vault, dir, newName) => {
      const abs = path.join(vaultAbs, dir, `${newName}.md`)
      if (fs.existsSync(abs)) {
        calls.createNote.push(newName)
        return { ok: false, error: '名称已存在，请更换' }
      }
      calls.createNote.push(newName)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, '', 'utf-8')
      return { ok: true, path: `${dir ? `${dir}/` : ''}${newName}.md` }
    },
    writeNote: (vault, relPath, content) => {
      fs.mkdirSync(path.dirname(path.join(vaultAbs, relPath)), { recursive: true })
      fs.writeFileSync(path.join(vaultAbs, relPath), content, 'utf-8')
      return { ok: true }
    },
    existingAttachments: (attachAbs) => {
      try {
        return fs.readdirSync(attachAbs).filter((f) => !f.startsWith('.'))
      } catch {
        return []
      }
    },
    keepDraft: true
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-promote-'))
  vaultAbs = path.join(tmp, '库A')
  fs.mkdirSync(vaultAbs, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('草稿引用复用（FR-2.9.12 复验反馈）', () => {
  it('首次 keepDraft 引用：创建正式笔记，reused 为空', () => {
    const scratch = makeScratch({ '速记 0927.md': '# 速记\n\n内容\n' })
    const calls = { createNote: [] as string[] }
    const r = promoteDraft(scratch, makeOpts(scratch, calls))
    expect(r.ok).toBe(true)
    expect(r.path).toBe('跨库引用/草稿/速记 0927.md')
    expect(r.reused).toBeFalsy()
    expect(calls.createNote).toEqual(['速记 0927'])
  })

  it('再次引用同一草稿（未改）：复用已有正式笔记，不再新建、不报错', () => {
    const scratch = makeScratch({ '速记 0927.md': '# 速记\n\n内容\n' })
    const calls = { createNote: [] as string[] }
    const opts = makeOpts(scratch, calls)
    promoteDraft(scratch, opts)
    const r2 = promoteDraft(scratch, opts)
    expect(r2.ok).toBe(true)
    expect(r2.reused).toBe(true)
    expect(r2.path).toBe('跨库引用/草稿/速记 0927.md')
    expect(calls.createNote).toEqual(['速记 0927']) // 第二次未再调用 createNote
  })

  it('草稿改过后再引用：内容分叉 → -2 新快照，旧副本保留', () => {
    const scratch = makeScratch({ '速记 0927.md': '# 速记 v1\n' })
    const calls = { createNote: [] as string[] }
    const opts = makeOpts(scratch, calls)
    promoteDraft(scratch, opts)
    const notes = makeScratch({ '速记 0927.md': '# 速记 v2（改过）\n' })
    scratch.read = notes.read
    const r2 = promoteDraft(scratch, opts)
    expect(r2.ok).toBe(true)
    expect(r2.path).toBe('跨库引用/草稿/速记 0927-2.md')
    expect(r2.reused).toBeFalsy()
    expect(fs.readFileSync(path.join(vaultAbs, '跨库引用/草稿/速记 0927.md'), 'utf-8')).toContain('v1')
  })

  it('带图片资产的草稿：复用时不重复落盘附件、引用改写一致', () => {
    const png = Buffer.from('fake-png-bytes').toString('base64')
    const scratch = makeScratch({ '速记 0927.md': '# 速记\n\n![图](assets/x.png)\n' }, { 'x.png': png })
    const calls = { createNote: [] as string[] }
    const opts = makeOpts(scratch, calls)
    const r1 = promoteDraft(scratch, opts)
    expect(r1.ok).toBe(true)
    expect(fs.readFileSync(path.join(vaultAbs, 'attachments/x.png')).toString()).toBe('fake-png-bytes')
    const r2 = promoteDraft(scratch, opts)
    expect(r2.ok).toBe(true)
    expect(r2.reused).toBe(true)
    expect(fs.readFileSync(path.join(vaultAbs, 'attachments/x.png')).toString()).toBe('fake-png-bytes')
  })

  it('转正（非 keepDraft）撞名：保持「名称已存在」报错（交互式选名，行为不变）', () => {
    const scratch = makeScratch({ '速记 0927.md': '# 速记\n' })
    const calls = { createNote: [] as string[] }
    const opts = { ...makeOpts(scratch, calls), keepDraft: undefined }
    fs.mkdirSync(path.join(vaultAbs, '跨库引用/草稿'), { recursive: true })
    fs.writeFileSync(path.join(vaultAbs, '跨库引用/草稿/速记 0927.md'), '', 'utf-8')
    const r = promoteDraft(scratch, opts)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已存在')
  })
})
