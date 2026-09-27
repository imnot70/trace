import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

/** GistShareService（FR-2.3.10）：gist ↔ 笔记映射的存储与重命名 / 删除 / 库更名挂钩 */
import { JsonStore } from '../src/main/lib/jsonStore'
import { GistShareService } from '../src/main/services/gistShares'
import type { GistShare } from '../src/shared/types'

let tmp: string
let svc: GistShareService
let store: JsonStore<{ shares: GistShare[] }>

function shareOf(vault: string, p: string, gistId = `gist-${p}`): Parameters<GistShareService['upsert']>[0] {
  return { gistId, url: `https://gist.github.com/x/${gistId}`, vault, path: p, fileName: p.replace(/.*\//, ''), description: 'd' }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-gist-'))
  store = new JsonStore(path.join(tmp, 'gist-shares.json'), { shares: [] })
  svc = new GistShareService(store)
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('GistShareService', () => {
  it('upsert：无记录新建、有记录更新（同一 gistId 更新链接）', () => {
    const created = svc.upsert(shareOf('库', 'n.md', 'g1'))
    expect(created.gistId).toBe('g1')
    expect(svc.get('库', 'n.md')?.gistId).toBe('g1')

    // 同一笔记再次分享：更新而非追加
    const updated = svc.upsert(shareOf('库', 'n.md', 'g1'))
    expect(updated.gistId).toBe('g1')
    expect(store.get().shares).toHaveLength(1)

    expect(svc.get('库', 'other.md')).toBeNull()
  })

  it('removeRecord 只解除关联，不影响其它记录', () => {
    svc.upsert(shareOf('库', 'a.md'))
    svc.upsert(shareOf('库', 'b.md'))
    svc.removeRecord('库', 'a.md')
    expect(svc.get('库', 'a.md')).toBeNull()
    expect(svc.get('库', 'b.md')).not.toBeNull()
  })

  it('onRename：笔记重命名 / 移动跟随，目录重命名按前缀匹配子树', () => {
    svc.upsert(shareOf('库', 'a.md'))
    svc.upsert(shareOf('库', 'docs/b.md'))

    svc.onRename('库', 'a.md', 'a2.md', 'note')
    expect(svc.get('库', 'a2.md')).not.toBeNull()
    expect(svc.get('库', 'a.md')).toBeNull()

    svc.onRename('库', 'docs', 'notes', 'dir')
    expect(svc.get('库', 'notes/b.md')).not.toBeNull()
    // 其它库的同名路径不受影响
    svc.upsert(shareOf('库2', 'docs/c.md'))
    svc.onRename('库', 'docs', 'notes2', 'dir')
    expect(svc.get('库2', 'docs/c.md')).not.toBeNull()
  })

  it('onDelete：删除笔记 / 目录 / 整库时清理记录（远端 gist 不由本服务触碰）', () => {
    svc.upsert(shareOf('库', 'a.md'))
    svc.upsert(shareOf('库', 'docs/b.md'))
    svc.upsert(shareOf('库2', 'c.md'))

    svc.onDelete('库', 'a.md', 'note')
    expect(svc.get('库', 'a.md')).toBeNull()

    svc.onDelete('库', 'docs', 'dir')
    expect(svc.get('库', 'docs/b.md')).toBeNull()

    svc.onDelete('库2', '', 'vault')
    expect(svc.get('库2', 'c.md')).toBeNull()
    expect(store.get().shares).toHaveLength(0)
  })

  it('onVaultRename：整库更名跟随', () => {
    svc.upsert(shareOf('旧库', 'n.md'))
    svc.onVaultRename('旧库', '新库')
    expect(svc.get('新库', 'n.md')).not.toBeNull()
    expect(svc.get('旧库', 'n.md')).toBeNull()
  })

  it('记录持久化到磁盘（JsonStore），重载实例可读回', () => {
    svc.upsert(shareOf('库', 'n.md', 'g9'))
    const reloaded = new GistShareService(new JsonStore(path.join(tmp, 'gist-shares.json'), { shares: [] }))
    expect(reloaded.get('库', 'n.md')?.gistId).toBe('g9')
  })
})
