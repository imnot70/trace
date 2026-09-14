import { describe, expect, it } from 'vitest'
import { isValidThemeId, validateThemePackage } from '../src/main/lib/themePackage'

const valid = { id: 'sakura', name: '樱花', light: { '--accent': '#e07a9b' }, dark: {} }

describe('isValidThemeId', () => {
  it('接受小写字母数字连字符', () => {
    expect(isValidThemeId('sakura')).toBe(true)
    expect(isValidThemeId('my-theme-2')).toBe(true)
  })
  it('拒绝大写、斜杠、空与超长', () => {
    expect(isValidThemeId('Sakura')).toBe(false)
    expect(isValidThemeId('../x')).toBe(false)
    expect(isValidThemeId('')).toBe(false)
    expect(isValidThemeId('a'.repeat(65))).toBe(false)
  })
})

describe('validateThemePackage', () => {
  it('接受合法主题（允许部分覆盖与空对象）并规范化', () => {
    const r = validateThemePackage(valid)
    expect(r.ok).toBe(true)
    expect(r.theme).toEqual({ id: 'sakura', name: '樱花', light: { '--accent': '#e07a9b' }, dark: {} })
  })

  it('拒绝非对象输入', () => {
    expect(validateThemePackage('x').ok).toBe(false)
    expect(validateThemePackage(null).ok).toBe(false)
    expect(validateThemePackage([]).ok).toBe(false)
  })

  it('拒绝非法 id 与内置保留 id', () => {
    expect(validateThemePackage({ ...valid, id: 'Bad Id' }).error).toContain('id')
    expect(validateThemePackage({ ...valid, id: 'warm' }).error).toContain('保留')
  })

  it('拒绝空或超长的 name', () => {
    expect(validateThemePackage({ ...valid, name: '  ' }).error).toContain('name')
    expect(validateThemePackage({ ...valid, name: 'x'.repeat(31) }).error).toContain('name')
  })

  it('拒绝缺少 light 或 dark', () => {
    expect(validateThemePackage({ id: 'a', name: 'A', dark: {} }).error).toContain('缺少')
    expect(validateThemePackage({ id: 'a', name: 'A', light: {} }).error).toContain('缺少')
  })

  it('拒绝未知顶层字段', () => {
    const r = validateThemePackage({ ...valid, evil: 1 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知字段 evil')
  })

  it('拒绝 url() 值', () => {
    const r = validateThemePackage({ ...valid, light: { '--accent': 'url(//evil.com/x)' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('值非法')
  })

  it('拒绝未知变量', () => {
    const r = validateThemePackage({ ...valid, light: { '--accent-hover': '#fff' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知变量 --accent-hover')
  })

  it('拒绝非法值（含声明逃逸字符）', () => {
    expect(validateThemePackage({ ...valid, light: { '--accent': '#fff; background: red' } }).error).toContain('值非法')
    expect(validateThemePackage({ ...valid, light: { '--accent': '' } }).error).toContain('值非法')
    expect(validateThemePackage({ ...valid, light: { '--accent': '#'.repeat(65) } }).error).toContain('值非法')
  })
})
