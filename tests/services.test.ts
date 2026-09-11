import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

/**
 * 服务层集成测试：vaults / fsTree / trash / favorites / recents
 * 在临时目录中构建完整服务栈。
 */
import { JsonStore } from '../src/main/lib/jsonStore'
import { WorkspaceService } from '../src/main/services/workspace'
import { VaultService } from '../src/main/services/vaults'
import { FsTreeService } from '../src/main/services/fsTree'
import { TrashService } from '../src/main/services/trash'
import { FavoritesService, RecentsService } from '../src/main/services/favorites'
import { VaultMetaService } from '../src/main/services/vaultMeta'
import type { AppSettings } from '../src/shared/types'

let tmp: string

function buildStack() {
  const settings = new JsonStore<AppSettings>(path.join(tmp, 'settings.json'), {
    workspaceRoot: '',
    theme: 'system',
    editorFontSize: 15,
    autoSave: true,
    zenHideTopbar: false,
    attachmentsDir: 'attachments',
    proxyUrl: '',
    enablePlugins: false,
    pluginEnabled: {},
    gitSource: null
  })
  const workspace = new WorkspaceService(settings, path.join(tmp, 'ws'))
  workspace.initDefault()
  const trash = new TrashService(() => workspace.getRoot())
  const vaults = new VaultService(() => workspace.getRoot(), trash)
  const fsTree = new FsTreeService((v) => vaults.vaultPath(v), trash)
  const favorites = new FavoritesService(new JsonStore(path.join(tmp, 'fav.json'), { items: [] }))
  const recents = new RecentsService(new JsonStore(path.join(tmp, 'rec.json'), { items: [] }))
  return { settings, workspace, trash, vaults, fsTree, favorites, recents }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-test-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('工作区', () => {
  it('首次运行初始化默认工作区', () => {
    const { workspace } = buildStack()
    expect(workspace.getRoot()).toBe(path.join(tmp, 'ws'))
    expect(fs.existsSync(path.join(tmp, 'ws'))).toBe(true)
  })

  it('切换工作区', () => {
    const { workspace } = buildStack()
    const newRoot = path.join(tmp, 'other')
    expect(workspace.setRoot(newRoot).ok).toBe(true)
    expect(workspace.getRoot()).toBe(newRoot)
  })
})

describe('笔记库管理', () => {
  it('创建/重名/重命名/删除', () => {
    const { vaults, workspace } = buildStack()
    expect(vaults.create('工作笔记').ok).toBe(true)
    expect(vaults.create('工作笔记').error).toMatch(/已存在/)
    expect(vaults.create('工作笔记'.toUpperCase()).error).toMatch(/已存在/)
    expect(vaults.list().map((v) => v.name)).toEqual(['工作笔记'])

    expect(vaults.rename('工作笔记', '个人笔记').ok).toBe(true)
    expect(vaults.rename('个人笔记', '工作笔记').ok).toBe(true)
    expect(vaults.rename('不存在', 'x').error).toMatch(/不存在/)

    // 删除 → 回收站
    expect(vaults.delete('工作笔记').ok).toBe(true)
    expect(vaults.list()).toEqual([])
    expect(fs.existsSync(path.join(workspace.getRoot()!, '.trash', 'items'))).toBe(true)
  })
})

describe('目录与笔记', () => {
  it('创建目录与深度限制', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    expect(fsTree.createDir('库', '', '一级').ok).toBe(true)
    expect(fsTree.createDir('库', '', '一级').error).toMatch(/已存在/)
    // 建到第 6 层，第 7 层应失败
    let rel = '一级'
    for (let i = 2; i <= 6; i++) {
      expect(fsTree.createDir('库', rel, `L${i}`).ok, `第 ${i} 层`).toBe(true)
      rel = `${rel}/L${i}`
    }
    expect(fsTree.createDir('库', rel, 'L7').error).toMatch(/已达最大层数/)
  })

  it('创建笔记/重名/读写', async () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    const created = fsTree.createNote('库', '', '会议记录')
    expect(created.ok).toBe(true)
    expect(created.path).toBe('会议记录.md')
    expect(fsTree.createNote('库', '', '会议记录').error).toMatch(/已存在/)

    const read = fsTree.readNote('库', '会议记录.md')
    expect(read.ok && read.content.startsWith('# 会议记录')).toBe(true)

    const write = fsTree.writeNote('库', '会议记录.md', '# 新内容\n', read.ok ? read.hash : null)
    expect(write.ok).toBe(true)
    const reread = fsTree.readNote('库', '会议记录.md')
    expect(reread.ok && reread.content).toBe('# 新内容\n')
  })

  it('外部修改检测（内容 hash 不匹配拒绝写入）', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', 'a')
    const read = fsTree.readNote('库', 'a.md')
    if (!read.ok) throw new Error('read failed')
    // 模拟外部修改
    fs.writeFileSync(path.join(vaults.vaultPath('库'), 'a.md'), '外部修改')
    const result = fsTree.writeNote('库', 'a.md', '覆盖', read.hash)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/外部修改/)
    // hash 一致时可正常写入
    const read2 = fsTree.readNote('库', 'a.md')
    expect(read2.ok && fsTree.writeNote('库', 'a.md', '覆盖', read2.ok ? read2.hash : null).ok).toBe(true)
  })

  it('重命名与路径转义防护', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', '目录')
    fsTree.createNote('库', '目录', '笔记')
    const r = fsTree.renameNode('库', '目录/笔记.md', 'note', '改名')
    expect(r.ok && r.newPath).toBe('目录/改名.md')
    // 逃逸路径被拒绝且不会读到工作区里的其他文件
    const escape = fsTree.readNote('库', '../settings.json')
    expect(escape.ok).toBe(false)
  })

  it('listTree 返回排序后的嵌套树', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', 'b')
    fsTree.createDir('库', '', '子')
    fsTree.createNote('库', '子', 'a')
    const tree = fsTree.listTree('库')
    expect(tree[0].kind).toBe('dir')
    expect(tree[0].name).toBe('子')
    expect(tree[0].children?.[0]).toMatchObject({ name: 'a', kind: 'note' })
    expect(tree[1]).toMatchObject({ name: 'b', kind: 'note' })
  })

  it('图片保存到 attachments 并返回相对引用', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', 'docs')
    const r = fsTree.saveImage('库', 'docs/n.md', '屏幕截图.png', Buffer.from('fakepng').toString('base64'))
    expect(r.ok).toBe(true)
    // 子目录中的笔记引用库根 attachments 需要回溯一级
    expect(r.reference).toMatch(/^(\.\.\/)?\.\.\/attachments\/.+\.png$/)
    // 库根的笔记用 ./attachments/...
    const r2 = fsTree.saveImage('库', 'root.md', 'x.png', Buffer.from('x').toString('base64'))
    expect(r2.reference).toMatch(/^\.\/attachments\/.+\.png$/)
  })

  it('图片可保存到自定义多级附件目录', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    const r = fsTree.saveImage('库', 'n.md', 'a.png', Buffer.from('x').toString('base64'), 'media/image')
    expect(r.ok).toBe(true)
    expect(r.reference).toMatch(/^\.\/media\/image\/.+\.png$/)
    expect(fs.existsSync(path.join(vaults.vaultPath('库'), 'media', 'image'))).toBe(true)
    // 非法目录被拒绝
    expect(fsTree.saveImage('库', 'n.md', 'a.png', Buffer.from('x').toString('base64'), '../evil').ok).toBe(false)
    expect(fsTree.saveImage('库', 'n.md', 'a.png', Buffer.from('x').toString('base64'), 'a/b/c/d/e').ok).toBe(false)
  })
})

describe('回收站', () => {
  it('删除/还原笔记', () => {
    const { vaults, fsTree, trash } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', '待删')
    expect(fsTree.deleteNode('库', '待删.md', 'note').ok).toBe(true)
    expect(fs.existsSync(path.join(vaults.vaultPath('库'), '待删.md'))).toBe(false)

    const entries = trash.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'note', vault: '库', name: '待删' })

    expect(trash.restore(entries[0].id).ok).toBe(true)
    expect(fs.existsSync(path.join(vaults.vaultPath('库'), '待删.md'))).toBe(true)
    expect(trash.list()).toHaveLength(0)
  })

  it('还原时目标位置冲突自动改名', () => {
    const { vaults, fsTree, trash } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', '笔记')
    fsTree.deleteNode('库', '笔记.md', 'note')
    fsTree.createNote('库', '', '笔记') // 同名重建
    const [entry] = trash.list()
    expect(trash.restore(entry.id).ok).toBe(true)
    const names = fs.readdirSync(vaults.vaultPath('库')).filter((n) => n.endsWith('.md'))
    expect(names).toHaveLength(2)
    expect(names.some((n) => n.includes('已恢复'))).toBe(true)
  })

  it('删除目录连带内容、彻底删除', () => {
    const { vaults, fsTree, trash } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', '子')
    fsTree.createNote('库', '子', 'n')
    fsTree.deleteNode('库', '子', 'dir')
    expect(trash.list()).toHaveLength(1)
    const [entry] = trash.list()
    expect(trash.purge(entry.id).ok).toBe(true)
    expect(trash.list()).toHaveLength(0)
    expect(fs.existsSync(path.join(trash.trashDir()!, 'items', entry.id))).toBe(false)
  })

  it('清空回收站', () => {
    const { vaults, fsTree, trash } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', 'a')
    fsTree.createNote('库', '', 'b')
    fsTree.deleteNode('库', 'a.md', 'note')
    fsTree.deleteNode('库', 'b.md', 'note')
    expect(trash.empty().ok).toBe(true)
    expect(trash.list()).toHaveLength(0)
  })
})

describe('收藏与常用', () => {
  it('收藏增删查与重命名跟随', () => {
    const { vaults, fsTree, favorites } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', 'n')
    favorites.add('库', 'n.md', 'n')
    expect(favorites.has('库', 'n.md')).toBe(true)
    fsTree.renameNode('库', 'n.md', 'note', 'm')
    favorites.onRename('库', 'n.md', 'm.md', 'note', 'm')
    expect(favorites.has('库', 'n.md')).toBe(false)
    expect(favorites.list()[0]).toMatchObject({ path: 'm.md', name: 'm' })
    favorites.onDelete('库', 'm.md', 'note')
    expect(favorites.list()).toHaveLength(0)
  })

  it('删除目录清理其下收藏', () => {
    const { favorites } = buildStack()
    favorites.add('库', 'd/a.md', 'a')
    favorites.add('库', 'other.md', 'o')
    favorites.onDelete('库', 'd', 'dir')
    expect(favorites.list().map((i) => i.path)).toEqual(['other.md'])
  })

  it('常用列表去重置顶且上限 20', () => {
    const { recents } = buildStack()
    for (let i = 0; i < 25; i++) recents.add('库', `n${i}.md`, `n${i}`)
    recents.add('库', 'n0.md', 'n0')
    const items = recents.list()
    expect(items).toHaveLength(20)
    expect(items[0].path).toBe('n0.md')
  })
})

describe('笔记库元数据', () => {
  function buildMeta(): VaultMetaService {
    return new VaultMetaService(new JsonStore(path.join(tmp, 'vault-meta.json'), { descs: {} }))
  }

  it('描述增删改查与重命名跟随', () => {
    const meta = buildMeta()
    expect(meta.get('库')).toBeUndefined()
    meta.set('库', '工作相关')
    expect(meta.get('库')).toBe('工作相关')
    meta.set('库', '') // 空描述 = 移除
    expect(meta.get('库')).toBeUndefined()
    meta.set('库', '工作相关')
    meta.rename('库', '新库')
    expect(meta.get('库')).toBeUndefined()
    expect(meta.get('新库')).toBe('工作相关')
  })

  it('元数据持久化到 JSON 文件', () => {
    const file = path.join(tmp, 'vault-meta.json')
    const meta = new VaultMetaService(new JsonStore(file, { descs: {} }))
    meta.set('库', '描述')
    // 新实例从磁盘读回
    const reloaded = new VaultMetaService(new JsonStore(file, { descs: {} }))
    expect(reloaded.get('库')).toBe('描述')
  })
})
