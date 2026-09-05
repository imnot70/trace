import { describe, expect, it } from 'vitest'
import {
  MAX_DIR_DEPTH,
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
