import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ATTACH_DIR,
  MAX_DIR_DEPTH,
  normalizeAttachDir,
  normalizeProxyUrl,
  checkDuplicate,
  checkNameFormat,
  noteDisplayName,
  noteFileName,
  relDepth,
  validateName
} from '@shared/validate'

describe('名称校验', () => {
  it('空名称拒绝', () => {
    expect(checkNameFormat('', 'vault')).toBe('名称不能为空')
    expect(checkNameFormat('   ', 'dir')).toBe('名称不能为空')
  })

  it('非法字符拒绝', () => {
    for (const ch of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
      expect(checkNameFormat(`a${ch}b`, 'note')).toMatch(/不能包含/)
    }
  })

  it('点开头拒绝', () => {
    expect(checkNameFormat('.hidden', 'dir')).toMatch(/以点开头/)
  })

  it('点结尾拒绝', () => {
    expect(checkNameFormat('abc.', 'dir')).toMatch(/空格或点/)
  })

  it('Windows 保留名拒绝', () => {
    expect(checkNameFormat('CON', 'dir')).toMatch(/保留名称/)
    expect(checkNameFormat('com1', 'note')).toMatch(/保留名称/)
  })

  it('笔记名自动补 .md / 显示名去 .md', () => {
    expect(noteFileName('会议记录')).toBe('会议记录.md')
    expect(noteFileName('a.md')).toBe('a.md')
    expect(noteFileName('A.MD')).toBe('A.MD')
    expect(noteDisplayName('会议记录.md')).toBe('会议记录')
    expect(noteDisplayName('plain')).toBe('plain')
  })

  it('重名检查大小写不敏感', () => {
    expect(checkDuplicate('Hello', ['hello'], 'dir')).toMatch(/已存在/)
    expect(checkDuplicate('world', ['hello'], 'dir')).toBeNull()
    // 笔记比较的是显示名（不含 .md）
    expect(checkDuplicate('笔记', ['其他', '笔记'], 'note')).toMatch(/已存在/)
    expect(checkDuplicate('新笔记', ['其他'], 'note')).toBeNull()
  })

  it('validateName 组合格式优先', () => {
    expect(validateName('a/b', 'dir', [])).toMatch(/不能包含/)
    expect(validateName('ok', 'dir', ['ok'])).toMatch(/已存在/)
    expect(validateName('ok', 'dir', ['other'])).toBeNull()
  })

  it('深度限制常量与 relDepth', () => {
    expect(MAX_DIR_DEPTH).toBe(6)
    expect(relDepth('')).toBe(0)
    expect(relDepth('a/b/c')).toBe(3)
  })
})

describe('附件目录规范化', () => {
  it('空值回退默认目录', () => {
    expect(normalizeAttachDir('')).toEqual({ ok: true, dir: DEFAULT_ATTACH_DIR })
    expect(normalizeAttachDir('  ')).toEqual({ ok: true, dir: DEFAULT_ATTACH_DIR })
    expect(normalizeAttachDir('/')).toEqual({ ok: true, dir: DEFAULT_ATTACH_DIR })
  })

  it('多级路径规范化（去首尾斜杠、去空段）', () => {
    expect(normalizeAttachDir('media/image')).toEqual({ ok: true, dir: 'media/image' })
    expect(normalizeAttachDir('/media//image/')).toEqual({ ok: true, dir: 'media/image' })
    expect(normalizeAttachDir(' assets ')).toEqual({ ok: true, dir: 'assets' })
  })

  it('非法输入拒绝', () => {
    expect(normalizeAttachDir('../evil').ok).toBe(false)
    expect(normalizeAttachDir('a/./b').ok).toBe(false)
    expect(normalizeAttachDir('a/b/c/d/e').ok).toBe(false) // 超过 4 层
    expect(normalizeAttachDir('a/b?:c').ok).toBe(false)
  })
})

describe('代理地址规范化', () => {
  it('空值 = 不使用代理', () => {
    expect(normalizeProxyUrl('')).toEqual({ ok: true, url: '' })
    expect(normalizeProxyUrl('  ')).toEqual({ ok: true, url: '' })
  })

  it('标准与带凭据格式', () => {
    expect(normalizeProxyUrl('http://127.0.0.1:7890')).toEqual({ ok: true, url: 'http://127.0.0.1:7890' })
    expect(normalizeProxyUrl('HTTP://Proxy.Local:8080')).toEqual({ ok: true, url: 'HTTP://Proxy.Local:8080' })
    expect(normalizeProxyUrl('http://user:pass@proxy.lan:3128')).toEqual({
      ok: true,
      url: 'http://user:pass@proxy.lan:3128'
    })
  })

  it('非法格式拒绝', () => {
    expect(normalizeProxyUrl('127.0.0.1:7890').ok).toBe(false) // 缺协议
    expect(normalizeProxyUrl('ftp://x:1').ok).toBe(false) // 协议不支持
    expect(normalizeProxyUrl('http://host:0').ok).toBe(false) // 端口 0
    expect(normalizeProxyUrl('http://host:99999').ok).toBe(false) // 端口越界
    expect(normalizeProxyUrl('http://host').ok).toBe(false) // 缺端口
    expect(normalizeProxyUrl('http://host:7890/path').ok).toBe(false) // 不应有路径
  })
})
