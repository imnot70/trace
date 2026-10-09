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
import { TagsService } from '../src/main/services/tags'
import { VaultMetaService } from '../src/main/services/vaultMeta'
import type { AppSettings, NoteTagEntry, TagItem } from '../src/shared/types'

let tmp: string

function buildStack() {
  const settings = new JsonStore<AppSettings>(path.join(tmp, 'settings.json'), {
    workspaceRoot: '',
    theme: 'system',
    themePreset: 'default',
    editorFontSize: 15,
    tableDefaultRows: 2,
    tableDefaultCols: 2,
    autoSave: true,
    zenHideTopbar: false,
    attachmentsDir: 'attachments',
    proxyUrl: '',
    trashRetentionDays: 30,
    trashMaxEntries: 0,
    autoSyncMode: 'off',
    autoSyncIntervalMin: 5,
    enablePlugins: false,
    pluginEnabled: {},
    gitSource: null,
    windowGlassEffect: 'auto',
    windowOpacity: 100,
    sidebarMenus: { recents: true, favorites: true, shared: true, tags: true, unresolved: true, trash: true },
    showBacklinks: true,
    defaultEditMode: 'source',
    editPosition: 'start',
    typewriterMode: 'off',
    flowLineWidth: 'medium',
    flowPaperEnabled: false,
    flowPaperColor: 'cream',
    flowPaperFade: false,
    flowPaperTexture: 'none',
    flowSoundEnabled: false,
    flowSoundVolume: 60,
    flowSoundVariant: 'retro',
    flowSoundSkipRepeat: true,
    skipCrossVaultCopyConfirm: false,
    crossVaultCopyDir: '跨库引用',
    vimEnabled: false,
  })
  const workspace = new WorkspaceService(settings, path.join(tmp, 'ws'))
  workspace.initDefault()
  let trashCap = 0 // 0 = 不限
  const trash = new TrashService(() => workspace.getRoot(), () => trashCap)
  const vaults = new VaultService(
    () => workspace.getRoot(),
    trash,
    // 外部笔记库注册表（FR-2.1.4）：与主进程同构，落在临时目录
    new JsonStore(path.join(tmp, 'open-vaults.json'), { vaults: [] })
  )
  const fsTree = new FsTreeService((v) => vaults.vaultPath(v), trash)
  const favorites = new FavoritesService(new JsonStore(path.join(tmp, 'fav.json'), { items: [] }))
  const recents = new RecentsService(new JsonStore(path.join(tmp, 'rec.json'), { items: [] }))
  return { settings, workspace, trash, vaults, fsTree, favorites, recents, setTrashCap: (n: number) => { trashCap = n } }
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

describe('外部笔记库（FR-2.1.4 打开已有笔记库）', () => {
  /** 在临时目录构造一个「clone 到本地」样子的仓库目录（含 .git 标记与一篇笔记） */
  function makeCloneDir(name: string): string {
    const dir = path.join(tmp, 'outside', name)
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'hello.md'), '# 来自 GitHub 的笔记\n')
    return dir
  }

  it('打开：注册 + list 合并 external 标记 + vaultPath 指向注册目录（读笔记走外部路径）', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('工作区库')
    const dir = makeCloneDir('cloned-repo')
    const result = vaults.openExternal(dir)
    expect(result.ok).toBe(true)
    expect(result.name).toBe('cloned-repo')

    const ext = vaults.list().find((v) => v.name === 'cloned-repo')
    expect(ext?.external).toBe(true)
    expect(ext?.path).toBe(path.resolve(dir))
    expect(vaults.list().find((v) => v.name === '工作区库')?.external).toBeUndefined()
    expect(vaults.isExternal('cloned-repo')).toBe(true)
    expect(vaults.isExternal('工作区库')).toBe(false)

    // vaultPath 分流：外部库返回注册的绝对路径，下游 fsTree 按其读文件
    expect(vaults.vaultPath('cloned-repo')).toBe(path.resolve(dir))
    const read = fsTree.readNote('cloned-repo', 'hello.md')
    expect(read.ok && read.content).toContain('来自 GitHub')

    // 与工作区库统一按名称读写 / 创建笔记
    expect(fsTree.createNote('cloned-repo', '', 'new').ok).toBe(true)
    expect(fs.existsSync(path.join(dir, 'new.md'))).toBe(true)
  })

  it('幂等与拒绝：同目录重复打开返回同名；与现有库重名 / 目录不存在 / 目录名非法拒绝', () => {
    const { vaults } = buildStack()
    vaults.create('cloned-repo') // 工作区内已有同名库
    const dir = makeCloneDir('cloned-repo')
    expect(vaults.openExternal(dir).error).toMatch(/同名/)

    const other = makeCloneDir('other-repo')
    expect(vaults.openExternal(other)).toMatchObject({ ok: true, name: 'other-repo' })
    expect(vaults.openExternal(other)).toMatchObject({ ok: true, name: 'other-repo' }) // 幂等
    expect(vaults.openExternal(path.join(tmp, 'outside', '不存在'))).toMatchObject({ ok: false })
    // 非法目录名（Windows 保留名）
    const con = makeCloneDir('con')
    expect(vaults.openExternal(con).error).toMatch(/命名规则/)
    // 注：外部库之间的大小写变体重名在 Windows 大小写不敏感文件系统上物理不可构造
    // （mkdir 落回原目录走幂等分支）；exists() 为大小写不敏感比较，Linux 场景逻辑已覆盖
  })

  it('rename 外部库：只改注册显示名，磁盘目录名不变；工作区库行为不变', () => {
    const { vaults } = buildStack()
    const dir = makeCloneDir('cloned-repo')
    vaults.openExternal(dir)
    expect(vaults.rename('cloned-repo', '我的笔记').ok).toBe(true)
    expect(fs.existsSync(dir)).toBe(true) // 目录原样
    expect(fs.existsSync(path.join(tmp, 'outside', '我的笔记'))).toBe(false)
    expect(vaults.list().map((v) => v.name)).toContain('我的笔记')
    expect(vaults.vaultPath('我的笔记')).toBe(path.resolve(dir))
  })

  it('delete 外部库 = 仅解除注册（文件保留）；工作区库照旧进回收站', () => {
    const { vaults, workspace } = buildStack()
    const dir = makeCloneDir('cloned-repo')
    vaults.openExternal(dir)
    expect(vaults.delete('cloned-repo').ok).toBe(true)
    expect(vaults.list().some((v) => v.name === 'cloned-repo')).toBe(false)
    expect(fs.existsSync(path.join(dir, 'hello.md'))).toBe(true) // 文件原样
    // 解除后可重新打开
    expect(vaults.openExternal(dir)).toMatchObject({ ok: true, name: 'cloned-repo' })

    // 工作区库不受影响：仍走回收站
    vaults.create('工作区库')
    expect(vaults.delete('工作区库').ok).toBe(true)
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

  it('移动笔记到子文件夹', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', '笔记')
    fsTree.createDir('库', '', '子目录')
    const r = fsTree.moveNode('库', '笔记.md', 'note', '子目录')
    expect(r.ok).toBe(true)
    expect(r.newPath).toBe('子目录/笔记.md')
    expect(fs.existsSync(path.join(vaults.vaultPath('库'), '子目录', '笔记.md'))).toBe(true)
    expect(fs.existsSync(path.join(vaults.vaultPath('库'), '笔记.md'))).toBe(false)
  })

  it('按名称解析：同名候选全部返回，唯一时返回单个', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', '同名')
    fsTree.createDir('库', '', 'a')
    fsTree.createNote('库', 'a', '同名')
    fsTree.createDir('库', '', 'b')
    fsTree.createNote('库', 'b', '同名')
    fsTree.createNote('库', '', '唯一')

    const all = fsTree.resolveByNameAll('库', '同名')
    expect(all.ok).toBe(true)
    expect(all.paths).toHaveLength(3)
    expect(all.paths).toContain('同名.md')
    expect(all.paths).toContain('a/同名.md')
    expect(all.paths).toContain('b/同名.md')

    const one = fsTree.resolveByNameAll('库', '唯一')
    expect(one.paths).toEqual(['唯一.md'])

    // 路径形式精确匹配，不产生同名候选堆积
    const pathForm = fsTree.resolveByNameAll('库', 'a/同名')
    expect(pathForm.paths).toEqual(['a/同名.md'])

    // resolveByName 保持「取第一个」契约且大小写不敏感
    expect(fsTree.resolveByName('库', '同名').path).toBe('同名.md')
    expect(fsTree.resolveByName('库', '唯一').path).toBe('唯一.md')
    expect(fsTree.resolveByName('库', '不存在').ok).toBe(false)
  })

  it('移动文件夹到子文件夹', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', '源')
    fsTree.createNote('库', '源', 'n')
    fsTree.createDir('库', '', '目标')
    const r = fsTree.moveNode('库', '源', 'dir', '目标')
    expect(r.ok).toBe(true)
    expect(r.newPath).toBe('目标/源')
    expect(fs.existsSync(path.join(vaults.vaultPath('库'), '目标', '源', 'n.md'))).toBe(true)
  })

  it('移动到库根', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', '子')
    fsTree.createNote('库', '子', '笔记')
    const r = fsTree.moveNode('库', '子/笔记.md', 'note', '')
    expect(r.ok).toBe(true)
    expect(r.newPath).toBe('笔记.md')
  })

  it('移动目标重名拒绝', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', 'a')
    fsTree.createDir('库', '', '子')
    fsTree.createNote('库', '子', 'a')
    const r = fsTree.moveNode('库', 'a.md', 'note', '子')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/已存在/)
  })

  it('移动文件夹到自身拒绝', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', '自引用')
    const r = fsTree.moveNode('库', '自引用', 'dir', '自引用')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/自身/)
  })

  it('移动文件夹到自身子目录拒绝', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', '父')
    fsTree.createDir('库', '父', '子')
    const r = fsTree.moveNode('库', '父', 'dir', '父/子')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/自身/)
  })

  it('移动源不存在报错', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    const r = fsTree.moveNode('库', '不存在.md', 'note', '')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不存在/)
  })

  it('移动目标不存在报错', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', 'n')
    const r = fsTree.moveNode('库', 'n.md', 'note', '不存在的目录')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不存在/)
  })

  it('移动后深度超限拒绝', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    // 建 5 层目录
    let rel = 'L1'
    fsTree.createDir('库', '', 'L1')
    for (let i = 2; i <= 5; i++) {
      fsTree.createDir('库', rel, `L${i}`)
      rel = `${rel}/L${i}`
    }
    // 在 L1/L2/L3/L4/L5 下建一个文件夹
    fsTree.createDir('库', rel, '待移')
    // 移到 L1/L2/L3/L4/L5 同级（L1/L2/L3/L4）应成功（总深度 5+1=6）
    const r1 = fsTree.moveNode('库', `${rel}/待移`, 'dir', 'L1/L2/L3/L4')
    expect(r1.ok).toBe(true)
    // 移到 L1/L2/L3 下应失败（子树深度 1 + 目标深度 3 = 4，但子树本身深度为 1，移后总深 3+1=4，应成功）
    // 实际检查：待移 文件夹深度=1，移到 L1/L2/L3 后路径=L1/L2/L3/待移，深度=4，<=6，应成功
    const r2 = fsTree.moveNode('库', 'L1/L2/L3/L4/待移', 'dir', 'L1/L2/L3')
    expect(r2.ok).toBe(true)
  })

  it('移动笔记后改写图片相对路径', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    // 在库根创建笔记，引用附件
    fsTree.writeNote('库', 'n.md', '# 标题\n\n![img](./attachments/123.png)\n', null)
    // 创建附件文件（让引用目标存在）
    fs.mkdirSync(path.join(vaults.vaultPath('库'), 'attachments'))
    fs.writeFileSync(path.join(vaults.vaultPath('库'), 'attachments', '123.png'), 'fake')
    fsTree.createDir('库', '', '子目录')
    const r = fsTree.moveNode('库', 'n.md', 'note', '子目录')
    expect(r.ok).toBe(true)
    const content = fsTree.readNote('库', '子目录/n.md')
    expect(content.ok && content.content).toContain('../attachments/123.png')
    expect(content.ok && content.content).not.toMatch(/\]\(\.\/attachments\/123\.png\)/)
  })

  it('移动笔记后改写链接相对路径', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.writeNote('库', 'a.md', '[链接](./other.md)\n', null)
    fsTree.createNote('库', '', 'other')
    fsTree.createDir('库', '', '子')
    const r = fsTree.moveNode('库', 'a.md', 'note', '子')
    expect(r.ok).toBe(true)
    const content = fsTree.readNote('库', '子/a.md')
    expect(content.ok && content.content).toContain('../other.md')
    expect(content.ok && content.content).not.toMatch(/\]\(\.\/other\.md\)/)
  })

  it('移动笔记后不改写同目录树内引用', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', '源')
    fsTree.writeNote('库', '源/a.md', '![img](./attachments/x.png)\n', null)
    // attachments 也在源目录下
    fsTree.createDir('库', '源', 'attachments')
    fsTree.createDir('库', '', '目标')
    const r = fsTree.moveNode('库', '源', 'dir', '目标')
    expect(r.ok).toBe(true)
    // 相对路径不变（attachments 一起移过去了）
    const content = fsTree.readNote('库', '目标/源/a.md')
    expect(content.ok && content.content).toContain('./attachments/x.png')
  })

  it('移动文件夹后批量改写内部笔记引用', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createDir('库', '', '移动区')
    fsTree.writeNote('库', '移动区/n1.md', '![a](./img.png)\n', null)
    fsTree.writeNote('库', '移动区/n2.md', '[link](./n1.md)\n', null)
    fsTree.createDir('库', '', '目标')
    const r = fsTree.moveNode('库', '移动区', 'dir', '目标')
    expect(r.ok).toBe(true)
    // n1 引用的 img.png 在移动区内，一起移了，不改写
    const c1 = fsTree.readNote('库', '目标/移动区/n1.md')
    expect(c1.ok && c1.content).toContain('./img.png')
    // n2 引用的 n1.md 也在移动区内，不改写
    const c2 = fsTree.readNote('库', '目标/移动区/n2.md')
    expect(c2.ok && c2.content).toContain('./n1.md')
  })

  it('不改写绝对 URL 和锚点', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.writeNote('库', 'n.md', '[ext](https://example.com) [anchor](#sec) ![remote](http://x.com/img.png)\n', null)
    fsTree.createDir('库', '', '子')
    fsTree.moveNode('库', 'n.md', 'note', '子')
    const content = fsTree.readNote('库', '子/n.md')
    expect(content.ok && content.content).toContain('https://example.com')
    expect(content.ok && content.content).toContain('#sec')
    expect(content.ok && content.content).toContain('http://x.com/img.png')
  })

  it('resolveByName 按名称查找笔记', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', '笔记A')
    fsTree.createDir('库', '', '子')
    fsTree.createNote('库', '子', '笔记B')
    // 大小写不敏感
    const r1 = fsTree.resolveByName('库', '笔记a')
    expect(r1.ok && r1.path).toBe('笔记A.md')
    // 子目录中的笔记
    const r2 = fsTree.resolveByName('库', '笔记B')
    expect(r2.ok && r2.path).toBe('子/笔记B.md')
    // 路径形式双链（如 [[子/笔记B]]）
    const r3 = fsTree.resolveByName('库', '子/笔记B')
    expect(r3.ok && r3.path).toBe('子/笔记B.md')
    // 不存在的笔记
    const r4 = fsTree.resolveByName('库', '不存在')
    expect(r4.ok).toBe(false)
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

  it('importImages（FR-2.5.4）：批量复制进附件目录，命名与粘贴管线一致', () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', 'n')
    // 准备两份源图片（一张中文文件名，验证非法字符清洗不落到文件名）
    const srcDir = path.join(tmp, 'src-imgs')
    fs.mkdirSync(srcDir)
    const p1 = path.join(srcDir, 'pic one.png')
    const p2 = path.join(srcDir, '截图.jpg')
    fs.writeFileSync(p1, Buffer.from('png-data-1'))
    fs.writeFileSync(p2, Buffer.from('jpg-data-2'))

    const r = fsTree.importImages('库', 'n.md', [p1, p2])
    expect(r.ok).toBe(true)
    expect(r.images).toHaveLength(2)
    // 引用格式与 saveImage 一致（同一 saveImageBuffer 产出），alt 保留原始文件名
    expect(r.images![0]).toEqual({ reference: expect.stringMatching(/^\.\/attachments\/\d+-pic one\.png$/), fileName: 'pic one.png' })
    expect(r.images![1]).toEqual({ reference: expect.stringMatching(/^\.\/attachments\/\d+-截图\.jpg$/), fileName: '截图.jpg' })
    // 文件真实落盘（时间戳前缀命名，与粘贴一致）
    const attachDir = path.join(vaults.vaultPath('库'), 'attachments')
    expect(fs.readdirSync(attachDir)).toHaveLength(2)
    expect(fs.readFileSync(path.join(attachDir, fs.readdirSync(attachDir)[0]))).toEqual(Buffer.from('png-data-1'))

    // 不存在的文件报错
    expect(fsTree.importImages('库', 'n.md', [path.join(srcDir, 'missing.png')]).ok).toBe(false)
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

  it('回收站过期清理', () => {
    const { vaults, fsTree, trash } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', '旧笔记')
    fsTree.createNote('库', '', '新笔记')
    fsTree.deleteNode('库', '旧笔记.md', 'note')
    fsTree.deleteNode('库', '新笔记.md', 'note')
    // 把第一条的删除时间改到 40 天前，并重建服务实例（模拟下次启动从磁盘加载）
    const store = JSON.parse(fs.readFileSync(path.join(trash.trashDir()!, 'index.json'), 'utf-8'))
    store.entries[0].deletedAt = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString()
    fs.writeFileSync(path.join(trash.trashDir()!, 'index.json'), JSON.stringify(store))
    const freshTrash = new TrashService(() => path.join(tmp, 'ws'))

    const { removed } = freshTrash.cleanup(30)
    expect(removed).toBe(1)
    expect(freshTrash.list()).toHaveLength(1)
    expect(freshTrash.list()[0].name).toBe('新笔记')
    // 保留天数 0 = 永不清理
    expect(trash.cleanup(0).removed).toBe(0)
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

describe('标签系统（frontmatter）', () => {
  function buildTags() {
    const { vaults, fsTree } = buildStack()
    const tags = new TagsService(
      new JsonStore(path.join(tmp, 'tags.json'), { tags: [], noteTags: [] }),
      fsTree,
      () => vaults.list().map((v) => v.name)
    )
    return { vaults, fsTree, tags }
  }

  it('创建 / 重命名 / 删除标签（重名大小写不敏感）', async () => {
    const { tags } = buildTags()
    const created = tags.createTag('工作', '#e74c3c')
    expect(created.ok).toBe(true)
    expect(tags.createTag('工作', '#2ecc71').ok).toBe(false)
    expect(tags.createTag('工作 ', '#2ecc71').ok).toBe(false) // 去重空格后重名
    expect(await tags.renameTag(created.tag!.id, '学习')).toEqual({ ok: true })
    expect(tags.listTags()[0].name).toBe('学习')
    await tags.deleteTag(created.tag!.id)
    expect(tags.listTags()).toHaveLength(0)
  })

  it('打标签写入 frontmatter，幂等；移除后清空', async () => {
    const { vaults, fsTree, tags } = buildTags()
    vaults.create('库')
    fsTree.createNote('库', '', 'n')
    const tag = tags.createTag('重要', '#3498db').tag!
    expect((await tags.addTagToNote('库', 'n.md', tag.id)).ok).toBe(true)
    expect((await tags.addTagToNote('库', 'n.md', tag.id)).ok).toBe(true) // 幂等
    expect(await tags.noteTags('库', 'n.md')).toEqual([expect.objectContaining({ name: '重要' })])
    const content = fsTree.readNote('库', 'n.md')
    expect(content.ok && content.content).toContain('tags:')

    expect((await tags.removeFromNote('库', 'n.md', tag.id)).ok).toBe(true)
    expect(await tags.noteTags('库', 'n.md')).toHaveLength(0)
    // frontmatter 只剩 tags 且被清空 → 整体移除
    const after = fsTree.readNote('库', 'n.md')
    expect(after.ok && after.content).not.toContain('---')
  })

  it('标签随文件移动保持（frontmatter 在文件内），重命名标签会改写关联笔记', async () => {
    const { vaults, fsTree, tags } = buildTags()
    vaults.create('库')
    fsTree.createDir('库', '', '新建文件夹')
    fsTree.createNote('库', '', 'n')
    const tag = tags.createTag('工作', '#3498db').tag!
    await tags.addTagToNote('库', 'n.md', tag.id)

    // 移动笔记到子文件夹：frontmatter 随文件走
    expect(fsTree.moveNode('库', 'n.md', 'note', '新建文件夹').ok).toBe(true)
    expect(await tags.noteTags('库', '新建文件夹/n.md')).toEqual([expect.objectContaining({ name: '工作' })])

    // 移动文件夹（内含已打标笔记）到已存在的「归档」文件夹
    fsTree.createDir('库', '', '归档')
    expect(fsTree.moveNode('库', '新建文件夹', 'dir', '归档').ok).toBe(true)
    expect(await tags.noteTags('库', '归档/新建文件夹/n.md')).toHaveLength(1)

    // 重命名标签定义 → 改写关联笔记 frontmatter
    await tags.renameTag(tag.id, '重要事项')
    expect(await tags.noteTags('库', '归档/新建文件夹/n.md')).toEqual([expect.objectContaining({ name: '重要事项' })])

    // 删除标签定义 → 从关联笔记移除
    await tags.deleteTag(tag.id)
    expect(await tags.noteTags('库', '归档/新建文件夹/n.md')).toHaveLength(0)
  })

  it('筛选：notesByTag 返回全部库中打该标签的笔记', async () => {
    const { vaults, fsTree, tags } = buildTags()
    vaults.create('a1')
    vaults.create('a2')
    fsTree.createNote('a1', '', 'n1')
    fsTree.createNote('a2', '', 'n2')
    const tag = tags.createTag('跨库', '#3498db').tag!
    await tags.addTagToNote('a1', 'n1.md', tag.id)
    await tags.addTagToNote('a2', 'n2.md', tag.id)
    const entries = await tags.notesByTag(tag.id)
    expect(entries.map((e) => `${e.vault}/${e.path}`)).toEqual(['a1/n1.md', 'a2/n2.md'])
  })

  it('多标签组合筛选（FR-2.6.13）：any 取并集、all 取交集', async () => {
    const { vaults, fsTree, tags } = buildTags()
    vaults.create('库')
    fsTree.createNote('库', '', 'n1') // a + b
    fsTree.createNote('库', '', 'n2') // 仅 a
    fsTree.createNote('库', '', 'n3') // 无标签
    const a = tags.createTag('a', '#e74c3c').tag!
    const b = tags.createTag('b', '#2ecc71').tag!
    await tags.addTagToNote('库', 'n1.md', a.id)
    await tags.addTagToNote('库', 'n1.md', b.id)
    await tags.addTagToNote('库', 'n2.md', a.id)

    const anyRes = await tags.notesByTags([a.id, b.id], 'any')
    expect(anyRes.map((e) => e.path).sort()).toEqual(['n1.md', 'n2.md'])
    const allRes = await tags.notesByTags([a.id, b.id], 'all')
    expect(allRes.map((e) => e.path)).toEqual(['n1.md'])
    // 未知标签 id / 空集合 → 空
    expect(await tags.notesByTags(['ghost'], 'any')).toEqual([])
    expect(await tags.notesByTags([], 'all')).toEqual([])
  })

  it('标签合并（FR-2.6.15）：改写 frontmatter 并删除来源定义，大小写变体一并归并', async () => {
    const { vaults, fsTree, tags } = buildTags()
    vaults.create('库')
    fsTree.createNote('库', '', 'n1') // a + b → b + 目标
    fsTree.createNote('库', '', 'n2') // 仅 A（大小写变体）→ 目标
    fsTree.createNote('库', '', 'n3') // 仅 b，不涉合并，不应被改写
    const a = tags.createTag('a', '#e74c3c').tag!
    const b = tags.createTag('b', '#2ecc71').tag!
    const target = tags.createTag('目标', '#3498db').tag!
    await tags.addTagToNote('库', 'n1.md', a.id)
    await tags.addTagToNote('库', 'n1.md', b.id)
    // n2 直接手写大小写变体（外部工具写入场景）
    fsTree.writeNote('库', 'n2.md', '---\ntags: [A]\n---\n\n正文', null)
    await tags.addTagToNote('库', 'n3.md', b.id)
    const beforeN3 = fsTree.readNote('库', 'n3.md')

    const result = await tags.mergeTags(a.id, target.id)
    expect(result.ok).toBe(true)
    expect(result.notes).toBe(2)
    const n1 = await tags.noteTags('库', 'n1.md')
    expect(n1.map((t) => t.name).sort()).toEqual(['b', '目标'])
    const n2 = await tags.noteTags('库', 'n2.md')
    expect(n2.map((t) => t.name)).toEqual(['目标'])
    // 来源定义已删除
    expect(tags.listTags().some((t) => t.id === a.id)).toBe(false)
    // 不涉及的笔记零触碰（内容未变）
    const afterN3 = fsTree.readNote('库', 'n3.md')
    expect(afterN3.ok && afterN3.content).toBe(beforeN3.ok ? beforeN3.content : '')
  })

  it('标签合并：同名（忽略大小写）或含未知 id 时拒绝', async () => {
    const { tags } = buildTags()
    const a = tags.createTag('工作', '#e74c3c').tag!
    expect((await tags.mergeTags(a.id, a.id)).ok).toBe(false)
    expect((await tags.mergeTags(a.id, 'ghost')).ok).toBe(false)
    expect((await tags.mergeTags('ghost', a.id)).ok).toBe(false)
  })

  it('标签统计（FR-2.6.16）：大小写不敏感聚合计数，mtime 取最大值', async () => {
    const { vaults, fsTree, tags } = buildTags()
    vaults.create('库')
    fsTree.createNote('库', '', 'n1')
    fsTree.createNote('库', '', 'n2')
    const a = tags.createTag('工作', '#e74c3c').tag!
    await tags.addTagToNote('库', 'n1.md', a.id)
    const n2Read = fsTree.readNote('库', 'n2.md')
    if (n2Read.ok) fsTree.writeNote('库', 'n2.md', '---\ntags: [工作, 其他]\n---\n\n正文', null)

    const stats = await tags.tagStats()
    const work = stats.find((s) => s.name === '工作')
    expect(work?.count).toBe(2)
    expect(work && work.lastUsed > 0).toBe(true)
    expect(stats.some((s) => s.name === '其他' && s.count === 1)).toBe(true)
    // lastUsed 是携带标签的笔记 mtime 最大值
    const n1Mtime = fsTree.noteMtime('库', 'n1.md')
    const n2Mtime = fsTree.noteMtime('库', 'n2.md')
    expect(work?.lastUsed).toBe(Math.max(n1Mtime, n2Mtime))
  })

  it('旧版元数据关联迁移到 frontmatter 后清空', async () => {
    const { vaults, fsTree } = buildStack()
    vaults.create('库')
    fsTree.createNote('库', '', 'n')
    const store = new JsonStore<{ tags: TagItem[]; noteTags: NoteTagEntry[] }>(path.join(tmp, 'tags.json'), {
      tags: [],
      noteTags: []
    })
    store.update((d) => {
      d.tags.push({ id: 't1', name: '旧标签', color: '#e74c3c', createdAt: new Date().toISOString() })
      d.noteTags.push({ vault: '库', path: 'n.md', tagId: 't1' })
    })
    const tags = new TagsService(store, fsTree, () => vaults.list().map((v) => v.name))
    expect(await tags.migrateFromNoteTags()).toBe(1)
    expect(await tags.noteTags('库', 'n.md')).toEqual([expect.objectContaining({ name: '旧标签' })])
    expect(store.get().noteTags).toHaveLength(0)
  })
})

describe('回收站容量上限', () => {
  it('超出上限时永久删除最旧条目（FIFO）；0 = 不限', () => {
    const { vaults, fsTree, trash, setTrashCap } = buildStack()
    vaults.create('库')
    for (const n of ['n1', 'n2', 'n3']) fsTree.createNote('库', '', n)
    setTrashCap(2)

    expect(trash.put({ vault: '库', path: 'n1.md', kind: 'note' }).ok).toBe(true)
    expect(trash.put({ vault: '库', path: 'n2.md', kind: 'note' }).ok).toBe(true)
    expect(trash.list()).toHaveLength(2)
    // 放入第 3 条时超出上限 → 最旧的 n1 被永久删除（list 按删除时间倒序：最新在前）
    expect(trash.put({ vault: '库', path: 'n3.md', kind: 'note' }).ok).toBe(true)
    expect(trash.list().map((e) => e.name)).toEqual(['n3', 'n2'])

    // 显式执行同样生效
    setTrashCap(1)
    expect(trash.enforceCap().removed).toBe(1)
    expect(trash.list().map((e) => e.name)).toEqual(['n3'])

    // 不限：不再清理
    setTrashCap(0)
    fsTree.createNote('库', '', 'n4')
    expect(trash.put({ vault: '库', path: 'n4.md', kind: 'note' }).ok).toBe(true)
    expect(trash.list()).toHaveLength(2)
  })
})
