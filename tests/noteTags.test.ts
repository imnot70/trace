import { describe, expect, it } from 'vitest'
import { getFrontmatterTags, maskFrontmatter, setFrontmatterTags, stripFrontmatter } from '../src/shared/noteTags'

describe('frontmatter 标签读写', () => {
  it('读取列表形式 tags', () => {
    const content = '---\ntags:\n  - 工作\n  - 学习\n---\n# 正文\n'
    expect(getFrontmatterTags(content)).toEqual(['工作', '学习'])
  })

  it('读取内联字符串形式 tags', () => {
    expect(getFrontmatterTags('---\ntags: 工作\n---\n正文')).toEqual(['工作'])
  })

  it('无 frontmatter / 缺 tags 键 / 非法 YAML 时返回空数组', () => {
    expect(getFrontmatterTags('# 无 frontmatter')).toEqual([])
    expect(getFrontmatterTags('---\ntitle: x\n---\n正文')).toEqual([])
    expect(getFrontmatterTags('---\n: : 非法\n---\n正文')).toEqual([])
  })

  it('无 frontmatter 时新建 frontmatter 块', () => {
    const updated = setFrontmatterTags('# 正文\n', ['工作', '学习'])
    expect(updated).toBe('---\ntags:\n  - 工作\n  - 学习\n---\n# 正文\n')
    expect(getFrontmatterTags(updated!)).toEqual(['工作', '学习'])
  })

  it('更新 tags 时保留其他 frontmatter 键与正文', () => {
    const content = '---\ntitle: 我的笔记\ntags:\n  - 旧标签\n---\n# 正文\n'
    const updated = setFrontmatterTags(content, ['新标签'])
    expect(updated).toContain('title: 我的笔记')
    expect(getFrontmatterTags(updated!)).toEqual(['新标签'])
    expect(updated).toContain('# 正文')
  })

  it('tags 置空时移除 tags 键，但保留其他键', () => {
    const content = '---\ntitle: 我的笔记\ntags:\n  - 旧标签\n---\n# 正文\n'
    const updated = setFrontmatterTags(content, [])
    expect(updated).toContain('title: 我的笔记')
    expect(getFrontmatterTags(updated!)).toEqual([])
    expect(updated).toContain('# 正文')
  })

  it('frontmatter 只有 tags 且被清空时整体移除 frontmatter', () => {
    const updated = setFrontmatterTags('---\ntags:\n  - 唯一\n---\n# 正文\n', [])
    expect(updated).toBe('# 正文\n')
  })

  it('已有 frontmatter 的 YAML 非法时写入返回 null（保护原文）', () => {
    const content = '---\nkey: [unclosed\n---\n# 正文\n'
    expect(getFrontmatterTags(content)).toEqual([])
    expect(setFrontmatterTags(content, ['工作'])).toBeNull()
  })

  it('CRLF 内容可正常读写', () => {
    const content = '---\r\ntags:\r\n  - 旧\r\n---\r\n# 正文\r\n'
    expect(getFrontmatterTags(content)).toEqual(['旧'])
    const updated = setFrontmatterTags(content, ['新'])
    expect(getFrontmatterTags(updated!)).toEqual(['新'])
    expect(updated).toContain('# 正文')
  })
})

describe('frontmatter 掩码与剥离', () => {
  it('maskFrontmatter：frontmatter 变空白但换行数与正文位置不变（行级同步映射不错位）', () => {
    const content = '---\ntags:\n  - tag_1\n  - tag_2\n---\n# 标题\n正文\n'
    const masked = maskFrontmatter(content)
    expect(masked.split('\n').length).toBe(content.split('\n').length)
    expect(masked).not.toContain('tag_1')
    expect(masked).toContain('# 标题')
    expect(masked.endsWith('\n正文\n')).toBe(true)
  })

  it('maskFrontmatter：无 frontmatter 时原样返回', () => {
    expect(maskFrontmatter('# 纯正文\n')).toBe('# 纯正文\n')
  })

  it('stripFrontmatter：仅返回正文', () => {
    const content = '---\ntags:\n  - tag_1\n---\n# 正文\n'
    expect(stripFrontmatter(content)).toBe('# 正文\n')
    expect(stripFrontmatter('# 无 frontmatter')).toBe('# 无 frontmatter')
  })
})
