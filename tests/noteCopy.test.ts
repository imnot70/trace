import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

/**
 * 跨库复制（FR-2.9.11 跨库引用改进）：把笔记复制进当前库再落引用——
 * 图片随迁 + 引用改写、重名自动加后缀、frontmatter 原样保留。
 * 在临时目录构建双库 + 真实 fsTree 服务栈。
 */
import { JsonStore } from '../src/main/lib/jsonStore'
import { WorkspaceService } from '../src/main/services/workspace'
import { VaultService } from '../src/main/services/vaults'
import { FsTreeService } from '../src/main/services/fsTree'
import { TrashService } from '../src/main/services/trash'
import { copyNoteAcrossVaults, extractRelRefs } from '../src/main/services/noteCopy'
import type { AppSettings } from '../src/shared/types'

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
    vimEnabled: false
  })
  const workspace = new WorkspaceService(settings, path.join(tmp, 'ws'))
  workspace.initDefault()
  const trash = new TrashService(() => workspace.getRoot(), () => 0)
  const vaults = new VaultService(() => workspace.getRoot(), trash)
  const fsTree = new FsTreeService((v) => vaults.vaultPath(v), trash)
  return { workspace, vaults, fsTree }
}

function copy(stack: ReturnType<typeof buildStack>, opts: Partial<Parameters<typeof copyNoteAcrossVaults>[0]> = {}) {
  const { vaults, fsTree } = stack
  return copyNoteAcrossVaults({
    sourceVault: '源库',
    sourcePath: '笔记/原文.md',
    targetVault: '目标库',
    targetDir: '',
    sourceVaultPath: vaults.vaultPath('源库'),
    targetVaultPath: vaults.vaultPath('目标库'),
    attachmentsDir: 'attachments',
    readNote: (v, rel) => {
      const r = fsTree.readNote(v, rel)
      return r.ok ? { ok: true, content: r.content } : { ok: false, error: r.error }
    },
    createNote: (v, d, n) => fsTree.createNote(v, d, n),
    createDir: (v, parent, name) => fsTree.createDir(v, parent, name),
    writeNote: (v, rel, content) => fsTree.writeNote(v, rel, content, null),
    ...opts
  })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-copy-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('extractRelRefs：库内相对引用提取', () => {
  it('提取 markdown 图片 / 链接与 HTML img src，去重保序', () => {
    const content = [
      '![a](./attachments/x.png)',
      '[链接](../docs/other.md)',
      '<img src="./attachments/y.png">',
      '![外链](https://example.com/z.png)',
      '![a 再来一次](./attachments/x.png)'
    ].join('\n')
    expect(extractRelRefs(content)).toEqual([
      './attachments/x.png',
      '../docs/other.md',
      './attachments/y.png'
    ])
  })

  it('URL / 协议 / 锚点不视为随迁对象', () => {
    expect(extractRelRefs('[t](trace-vault://va/a.png) [d](data:image/png;base64,xx) [a](#sec)'))
      .toEqual([])
  })
})

describe('跨库复制', () => {
  it('基础复制：内容（含 frontmatter）原样落到目标库指定目录', () => {
    const stack = buildStack()
    stack.vaults.create('源库')
    stack.vaults.create('目标库')
    stack.fsTree.createDir('源库', '', '笔记')
    stack.fsTree.createDir('目标库', '', '归档')
    stack.fsTree.createNote('源库', '笔记', '原文')
    stack.fsTree.writeNote('源库', '笔记/原文.md', '---\ntags:\n  - 工作\n---\n# 原文\n正文内容\n', null)

    const r = copy(stack, { targetDir: '归档' })
    expect(r.ok).toBe(true)
    expect(r.path).toBe('归档/原文.md')
    const read = stack.fsTree.readNote('目标库', '归档/原文.md')
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.content).toContain('tags')
  })

  it('目标目录重名自动加后缀 -2，不覆盖已有笔记', () => {
    const stack = buildStack()
    stack.vaults.create('源库')
    stack.vaults.create('目标库')
    stack.fsTree.createNote('源库', '', '原文')
    stack.fsTree.writeNote('源库', '原文.md', '源库内容\n', null)
    stack.fsTree.createNote('目标库', '', '原文')
    stack.fsTree.writeNote('目标库', '原文.md', '已有内容\n', null)

    const r = copy(stack, { sourcePath: '原文.md' })
    expect(r.ok).toBe(true)
    expect(r.name).toBe('原文-2')
    expect(r.path).toBe('原文-2.md')
    const read = stack.fsTree.readNote('目标库', '原文-2.md')
    if (read.ok) expect(read.content).toContain('源库内容')
    const original = stack.fsTree.readNote('目标库', '原文.md')
    if (original.ok) expect(original.content).toContain('已有内容')
  })

  it('图片随迁：复制到目标库附件目录，引用按新位置改写（含子目录笔记的 ../ 引用）', () => {
    const stack = buildStack()
    stack.vaults.create('源库')
    stack.vaults.create('目标库')
    stack.fsTree.createDir('源库', '', '笔记')
    stack.fsTree.createDir('目标库', '', '归档')
    stack.fsTree.createNote('源库', '笔记', '原文')
    const sourceVaultPath = stack.vaults.vaultPath('源库')
    const attachDir = path.join(sourceVaultPath, 'attachments')
    fs.mkdirSync(attachDir, { recursive: true })
    fs.writeFileSync(path.join(attachDir, 'pic.png'), 'PNG', 'utf-8')
    // relReference 口径：子目录笔记引用库附件 → ../attachments/pic.png
    stack.fsTree.writeNote(
      '源库',
      '笔记/原文.md',
      '---\ntags: 工作\n---\n![图](../attachments/pic.png)\n',
      null
    )

    const r = copy(stack, { targetDir: '归档' })
    expect(r.ok).toBe(true)
    const targetVaultPath = stack.vaults.vaultPath('目标库')
    expect(fs.existsSync(path.join(targetVaultPath, 'attachments', 'pic.png'))).toBe(true)
    const read = stack.fsTree.readNote('目标库', '归档/原文.md')
    if (read.ok) {
      // 笔记在 归档/ 下，改写后应指回库附件目录
      expect(read.content).toContain('../attachments/pic.png')
      expect(read.content).not.toContain('pic.png) 的旧路径')
    }
  })

  it('目标附件重名时图片名加序号且引用同步', () => {
    const stack = buildStack()
    stack.vaults.create('源库')
    stack.vaults.create('目标库')
    stack.fsTree.createNote('源库', '', '原文')
    stack.fsTree.createNote('目标库', '', '已有')
    const sourceAttach = path.join(stack.vaults.vaultPath('源库'), 'attachments')
    const targetAttach = path.join(stack.vaults.vaultPath('目标库'), 'attachments')
    fs.mkdirSync(sourceAttach, { recursive: true })
    fs.mkdirSync(targetAttach, { recursive: true })
    fs.writeFileSync(path.join(sourceAttach, 'pic.png'), 'SRC', 'utf-8')
    fs.writeFileSync(path.join(targetAttach, 'pic.png'), 'DST', 'utf-8')
    stack.fsTree.writeNote('源库', '原文.md', '![图](./attachments/pic.png)\n', null)

    const r = copy(stack, { sourcePath: '原文.md' })
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(path.join(targetAttach, 'pic.png'), 'utf-8')).toBe('DST')
    expect(fs.existsSync(path.join(targetAttach, 'pic-2.png'))).toBe(true)
    const read = stack.fsTree.readNote('目标库', '原文.md')
    if (read.ok) expect(read.content).toContain('pic-2.png')
  })

  it('源笔记不存在时报错', () => {
    const stack = buildStack()
    stack.vaults.create('源库')
    stack.vaults.create('目标库')
    const r = copy(stack)
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('外部 URL 引用不随迁、原样保留', () => {
    const stack = buildStack()
    stack.vaults.create('源库')
    stack.vaults.create('目标库')
    stack.fsTree.createNote('源库', '', '原文')
    stack.fsTree.writeNote('源库', '原文.md', '[官网](https://example.com)\n', null)
    const r = copy(stack, { sourcePath: '原文.md' })
    expect(r.ok).toBe(true)
    const read = stack.fsTree.readNote('目标库', '原文.md')
    if (read.ok) expect(read.content).toContain('https://example.com')
  })
})

describe('专用目录与去重（2026-09-27 二轮，用户反馈）', () => {
  const SOURCE = '---\ntags: 素材\n---\n# 会议记录\n\n内容正文\n'

  function seedSource(stack: ReturnType<typeof buildStack>, content = SOURCE): void {
    stack.vaults.create('源库')
    stack.vaults.create('目标库')
    stack.fsTree.createNote('源库', '', '会议记录')
    stack.fsTree.writeNote('源库', '会议记录.md', content, null)
  }

  it('多级目标目录逐段自动创建', () => {
    const stack = buildStack()
    seedSource(stack)
    const r = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    expect(r.ok).toBe(true)
    expect(r.path).toBe('跨库引用/库B/会议记录.md')
    expect(stack.fsTree.readNote('目标库', '跨库引用/库B/会议记录.md').ok).toBe(true)
  })

  it('同一来源重复复制：内容一致 → 复用已有副本，不再产生 -2', () => {
    const stack = buildStack()
    seedSource(stack)
    const first = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    expect(first.reused).toBe(false)
    const second = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    expect(second.ok).toBe(true)
    expect(second.reused).toBe(true)
    expect(second.path).toBe(first.path)
    // 目录里只有一份
    expect(
      fs.readdirSync(path.join(stack.vaults.vaultPath('目标库'), '跨库引用', '库B')).filter((n) => n.endsWith('.md'))
    ).toEqual(['会议记录.md'])
  })

  it('副本被用户改动后不再复用：再次复制生成新副本（-2），改动保留', () => {
    const stack = buildStack()
    seedSource(stack)
    const first = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    // 用户改动副本
    stack.fsTree.writeNote('目标库', first.path!, '---\ntags: 素材\n---\n# 会议记录\n\n我自己补充的批注\n', null)
    const second = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    expect(second.reused).toBe(false)
    expect(second.name).toBe('会议记录-2')
    const oldNote = stack.fsTree.readNote('目标库', first.path!)
    if (oldNote.ok) expect(oldNote.content).toContain('我自己补充的批注')
  })

  it('源笔记修改后再引入：生成新快照副本，旧快照原样保留', () => {
    const stack = buildStack()
    seedSource(stack)
    const first = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    stack.fsTree.writeNote('源库', '会议记录.md', SOURCE + '\n新增的第二段内容\n', null)
    const second = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    expect(second.reused).toBe(false)
    expect(second.name).toBe('会议记录-2')
    const newNote = stack.fsTree.readNote('目标库', second.path!)
    if (newNote.ok) expect(newNote.content).toContain('新增的第二段内容')
    const oldNote = stack.fsTree.readNote('目标库', first.path!)
    if (oldNote.ok) expect(oldNote.content).not.toContain('新增的第二段内容')
  })

  it('附件随路径稳定复用：同一来源重复复制不产生 pic-2（笔记级复用顺带覆盖）', () => {
    const stack = buildStack()
    stack.vaults.create('源库')
    stack.vaults.create('目标库')
    stack.fsTree.createNote('源库', '', '会议记录')
    const attachDir = path.join(stack.vaults.vaultPath('源库'), 'attachments')
    fs.mkdirSync(attachDir, { recursive: true })
    fs.writeFileSync(path.join(attachDir, 'pic.png'), 'PNG', 'utf-8')
    stack.fsTree.writeNote('源库', '会议记录.md', '![图](./attachments/pic.png)\n', null)

    const first = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    expect(first.reused).toBe(false)
    const second = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    expect(second.reused).toBe(true)
    const copied = fs.readdirSync(path.join(stack.vaults.vaultPath('目标库'), 'attachments'))
    expect(copied).toEqual(['pic.png'])
  })

  it('同名异内容附件仍加序号，互不覆盖', () => {
    const stack = buildStack()
    stack.vaults.create('源库')
    stack.vaults.create('源库2')
    stack.vaults.create('目标库')
    stack.fsTree.createNote('源库', '', '会议记录')
    stack.fsTree.createNote('源库2', '', '会议记录')
    const a1 = path.join(stack.vaults.vaultPath('源库'), 'attachments')
    const a2 = path.join(stack.vaults.vaultPath('源库2'), 'attachments')
    fs.mkdirSync(a1, { recursive: true })
    fs.mkdirSync(a2, { recursive: true })
    fs.writeFileSync(path.join(a1, 'pic.png'), 'AAA', 'utf-8')
    fs.writeFileSync(path.join(a2, 'pic.png'), 'BBB', 'utf-8')
    stack.fsTree.writeNote('源库', '会议记录.md', '![a](./attachments/pic.png)\n', null)
    stack.fsTree.writeNote('源库2', '会议记录.md', '![b](./attachments/pic.png)\n', null)

    const r1 = copy(stack, { sourcePath: '会议记录.md', targetDir: '跨库引用/库B' })
    const r2 = copy(stack, {
      sourceVault: '源库2',
      sourceVaultPath: stack.vaults.vaultPath('源库2'),
      sourcePath: '会议记录.md',
      targetDir: '跨库引用/库C'
    })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    // 不同来源库的子目录互不干扰：两边都叫 会议记录.md，不产生 -2
    expect(r1.path).toBe('跨库引用/库B/会议记录.md')
    expect(r2.path).toBe('跨库引用/库C/会议记录.md')
    // 附件同名同内容复用 / 异内容加序号
    const copied = fs.readdirSync(path.join(stack.vaults.vaultPath('目标库'), 'attachments')).sort()
    expect(copied).toEqual(['pic-2.png', 'pic.png'])
  })
})
