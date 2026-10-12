import { describe, expect, it } from 'vitest'
import {
  getBodyTags,
  getFrontmatterTags,
  getNoteTags,
  maskFrontmatter,
  rewriteBodyTag,
  setFrontmatterTags,
  stripFrontmatter
} from '../src/shared/noteTags'

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

describe('正文内联 #标签（FR-2.6.18）', () => {
  it('基本识别：中英文 / 数字 / 下划线 / 连字符 / 截尾', () => {
    expect(getBodyTags('开始 #旅行 结束')).toEqual(['旅行'])
    expect(getBodyTags('mixed #Travel and #工作日志 here')).toEqual(['Travel', '工作日志'])
    expect(getBodyTags('#2024 年度回顾')).toEqual(['2024'])
    expect(getBodyTags('#tag-name 与 #tag_name')).toEqual(['tag-name', 'tag_name'])
    expect(getBodyTags('#标签-，后续')).toEqual(['标签']) // 尾部 - 截除
    expect(getBodyTags('#a')).toEqual(['a']) // 单字符
  })

  it('长度上限 64：超长不识别', () => {
    expect(getBodyTags(`#${'a'.repeat(64)}`)).toEqual(['a'.repeat(64)])
    expect(getBodyTags(`#${'a'.repeat(65)}`)).toEqual([])
  })

  it('前缀排除：C#5 / ##标题 / HTML 实体 / URL 片段 / 词中#', () => {
    expect(getBodyTags('学 C#5 编程')).toEqual([])
    expect(getBodyTags('##标题行')).toEqual([])
    expect(getBodyTags('实体 &#123 编码')).toEqual([])
    expect(getBodyTags('见 https://x.com/#anchor 说明')).toEqual([])
    expect(getBodyTags('路径 a/b#c 引用')).toEqual([])
    expect(getBodyTags('词中 abc#def 不算')).toEqual([])
  })

  it('行首无空格 #标题 按标签识别（非 ATX 标题）', () => {
    expect(getBodyTags('#标题在行首')).toEqual(['标题在行首'])
    expect(getBodyTags('# 这是标题')).toEqual([]) // ATX 标题（# 后空格）
  })

  it('排除：frontmatter / 围栏代码块 / 行内码', () => {
    expect(getBodyTags('---\ntags:\n  - 旅行\n---\n正文 #旅行')).toEqual(['旅行']) // fm 不重复计
    const fenced = '正文前\n```js\nconst a = "#不行"\n#也不行\n```\n正文后 #行'
    expect(getBodyTags(fenced)).toEqual(['行'])
    expect(getBodyTags('代码 `#不行` 与 #行')).toEqual(['行'])
    expect(getBodyTags('~~~\n#不行\n~~~\n#行')).toEqual(['行'])
  })

  it('篇内大小写不敏感去重，保留首现写法', () => {
    expect(getBodyTags('#Travel 与 #travel 与 #TRAVEL')).toEqual(['Travel'])
  })

  it('getNoteTags 并集：frontmatter 优先、篇内去重', () => {
    const content = '---\ntags:\n  - 工作\n---\n正文 #工作 #旅行'
    expect(getNoteTags(content)).toEqual(['工作', '旅行'])
    expect(getNoteTags('---\ntags: Travel\n---\n正文 #travel')).toEqual(['Travel']) // 大小写变体归并
  })

  it('rewriteBodyTag：改名 / 删除 / 多处 / 大小写变体', () => {
    expect(rewriteBodyTag('见 #旧名 与 #旧名。', '旧名', '新名')).toBe('见 #新名 与 #新名。')
    expect(rewriteBodyTag('见 #OldName 与 #oldname', 'oldname', '新')).toBe('见 #新 与 #新')
    expect(rewriteBodyTag('删除 #旧名 标签', '旧名', null)).toBe('删除  标签')
    expect(rewriteBodyTag('无关内容 #其他', '旧名', '新名')).toBe('无关内容 #其他')
  })

  it('rewriteBodyTag：frontmatter / 代码块 / 行内码不触碰', () => {
    const content = '---\ntags:\n  - 旧名\n---\n正文 #旧名\n```js\n#旧名\n```\n代码 `#旧名` 结束'
    const updated = rewriteBodyTag(content, '旧名', '新名')
    expect(updated).toContain('- 旧名') // frontmatter 未动
    expect(updated).toContain('正文 #新名')
    expect(updated).toContain('```js\n#旧名') // 围栏内未动
    expect(updated).toContain('`#旧名`') // 行内码未动
  })

  it('rewriteBodyTag：无匹配返回原文引用（跳过写入判定）', () => {
    const content = '正文无标签'
    expect(rewriteBodyTag(content, '旧名', '新名')).toBe(content)
  })
})
