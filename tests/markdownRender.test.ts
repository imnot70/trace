// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { md, sanitizeHtml, slugify } from '../src/renderer/src/lib/markdown'

describe('markdown 渲染管道：源码行号注入（data-source-line）', () => {
  it('顶层块携带正确的 0 基行号', () => {
    const html = md.render('# 标题\n\n第一段\n\n```js\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n')
    expect(html).toContain('data-source-line="0"') // 标题
    expect(html).toContain('data-source-line="2"') // 第一段
    expect(html).toContain('data-source-line="4"') // 代码块
    expect(html).toContain('data-source-line="8"') // 表格
  })

  it('行内 token 与闭合 token 不注入', () => {
    const html = md.render('**加粗** 与 *斜体*\n')
    // 段落有；bold/inline 无
    const count = (html.match(/data-source-line=/g) ?? []).length
    expect(count).toBe(1)
  })

  it('列表块注入在顶层 li 容器', () => {
    const html = md.render('- 项目一\n- 项目二\n')
    expect(html).toContain('data-source-line="0"')
  })
})

describe('DOMPurify 净化：内嵌 HTML 安全子集', () => {
  it('安全标签保留', () => {
    const clean = sanitizeHtml('<div class="x"><details><summary>折叠</summary><p>内容</p></details></div><table><tr><td>1</td></tr></table>')
    expect(clean).toContain('<details')
    expect(clean).toContain('<table>')
    expect(clean).toContain('<td>1</td>')
  })

  it('脚本与事件属性剥除', () => {
    const clean = sanitizeHtml('<script>alert(1)</script><div onclick="evil()">t</div><img src="x" onerror="evil()">')
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('onerror')
  })

  it('视觉钓鱼 / 导航劫持向量剥除', () => {
    const clean = sanitizeHtml('<style>body{display:none}</style><base href="https://evil.invalid/"><form action="https://evil.invalid/p"><input name="pw"></form>')
    expect(clean).not.toContain('<style')
    expect(clean).not.toContain('<base')
    expect(clean).not.toContain('<form')
    expect(clean).not.toContain('<input')
  })

  it('KaTeX 输出兼容（span + class + style 属性保留）', () => {
    const html = md.render('$e^{i\\pi}+1=0$\n')
    const clean = sanitizeHtml(html)
    // 公式容器与样式类存活
    expect(clean).toContain('katex')
  })

  it('javascript: 链接剥除', () => {
    const clean = sanitizeHtml('<a href="javascript:evil()">点我</a>')
    expect(clean).not.toContain('javascript:')
  })
})

describe('GFM 任务列表', () => {
  it('- [x] / - [ ] 渲染为勾选/未勾选复选框', () => {
    const html = md.render('- [x] 第一节内容\n- [ ] 第二节内容\n')
    expect(html).toContain('data-checked="true"')
    expect(html).toContain('task-list-item-checked')
    expect(html).toContain('第一节内容')
    // 未勾选项：有复选框但无 data-checked
    expect(html).toMatch(/<span class="task-item-checkbox"><\/span>\s*第二节内容/)
    // 列表项去圆点
    expect(html).toContain('task-list-item')
  })

  it('有序列表与嵌套同样支持', () => {
    const html = md.render('1. [x] 已完成\n2. [ ] 待办\n')
    expect(html).toContain('data-checked="true"')
  })

  it('非列表上下文的 [x] 不受影响', () => {
    const html = md.render('正文中的 [x] 不是任务项\n')
    expect(html).not.toContain('task-item-checkbox')
  })
})

describe('标题 id 生成', () => {
  it('标题渲染带 id 属性', () => {
    const html = md.render('# 一级标题\n\n## 二级标题\n')
    expect(html).toContain('id="一级标题"')
    expect(html).toContain('id="二级标题"')
  })

  it('slugify 正确转换', () => {
    expect(slugify('Hello World')).toBe('hello-world')
    expect(slugify('中文标题')).toBe('中文标题')
    expect(slugify('带有 special!@# 字符')).toBe('带有-special-字符')
  })

  it('同名标题去重追加后缀', () => {
    const html = md.render('# 重复\n\n## 重复\n\n### 重复\n')
    expect(html).toContain('id="重复"')
    expect(html).toContain('id="重复-1"')
    expect(html).toContain('id="重复-2"')
  })
})

describe('[[双链]] 渲染', () => {
  it('[[笔记名]] 渲染为 data-wikilink 标签', () => {
    const html = md.render('[[我的笔记]]\n')
    expect(html).toContain('data-wikilink="我的笔记"')
    expect(html).toContain('href="我的笔记.md"')
    expect(html).toContain('我的笔记')
  })

  it('[[路径|显示名]] 渲染正确', () => {
    const html = md.render('[[path/to/note|显示名]]\n')
    expect(html).toContain('data-wikilink="path/to/note"')
    expect(html).toContain('href="path/to/note.md"')
    expect(html).toContain('显示名')
  })

  it('双链标签通过 DOMPurify 净化保留', () => {
    const html = md.render('[[测试笔记]]\n')
    const clean = sanitizeHtml(html)
    expect(clean).toContain('data-wikilink="测试笔记"')
  })
})

describe('列表项内公式（texmath 块规则守卫 + 行内降级）', () => {
  it('句中 $$…$$ 降级为行内公式，不破坏句子结构', () => {
    const html = md.render('- 结论：$$E=mc^2$$')
    expect(html).toContain('<eq>')
    expect(html).not.toContain('katex-display')
    expect(html).toContain('结论：')
  })

  it('同一行多个公式与尾随文字全部保留（不再被块规则吞掉）', () => {
    const html = md.render('- $$a$$ 和 $$b$$ 同行')
    expect(html).toContain('和')
    expect(html).toContain('同行')
    expect((html.match(/<eq>/g) ?? []).length).toBe(2)
  })

  it('行首公式带尾随文字同样降级为行内（原版会静默丢内容）', () => {
    const html = md.render('$$a$$ 和 $$b$$ 同行')
    expect(html).toContain('同行')
    expect(html).not.toContain('katex-display')
  })

  it('独占列表项 / 独占段落仍为块级展示公式', () => {
    expect(md.render('- $$x^2$$')).toContain('katex-display')
    expect(md.render('前文\n\n$$x^2$$\n\n后文')).toContain('katex-display')
  })

  it('多行块级（含列表项内缩进）不受守卫影响', () => {
    expect(md.render('$$\nx^2\n$$')).toContain('katex-display')
    const inList = md.render('- 第一项\n- $$\n  x^2\n  $$\n- 第三项')
    expect(inList).toContain('katex-display')
    expect(inList).toContain('第一项')
    expect(inList).toContain('第三项')
  })

  it('纯公式段落（多公式各占一行）保持块级展示', () => {
    const html = md.render('$$a$$\n$$b$$')
    expect((html.match(/katex-display/g) ?? []).length).toBe(2)
  })
})
