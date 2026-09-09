// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import DOMPurify from 'dompurify'
import { md } from '../src/renderer/src/lib/markdown'

// 与生产一致的净化配置（MarkdownPreview.vue）
const SANITIZE_CONFIG = {
  FORBID_TAGS: ['style', 'base', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'meta', 'link'],
  FORBID_ATTR: ['srcdoc', 'target']
}

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
    const clean = DOMPurify.sanitize(
      '<div class="x"><details><summary>折叠</summary><p>内容</p></details></div><table><tr><td>1</td></tr></table>'
      ,
      SANITIZE_CONFIG
    )
    expect(clean).toContain('<details')
    expect(clean).toContain('<table>')
    expect(clean).toContain('<td>1</td>')
  })

  it('脚本与事件属性剥除', () => {
    const clean = DOMPurify.sanitize(
      '<script>alert(1)</script><div onclick="evil()">t</div><img src="x" onerror="evil()">'
      ,
      SANITIZE_CONFIG
    )
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('onerror')
  })

  it('视觉钓鱼 / 导航劫持向量剥除', () => {
    const clean = DOMPurify.sanitize(
      '<style>body{display:none}</style><base href="https://evil.invalid/"><form action="https://evil.invalid/p"><input name="pw"></form>'
      ,
      SANITIZE_CONFIG
    )
    expect(clean).not.toContain('<style')
    expect(clean).not.toContain('<base')
    expect(clean).not.toContain('<form')
    expect(clean).not.toContain('<input')
  })

  it('KaTeX 输出兼容（span + class + style 属性保留）', () => {
    const html = md.render('$e^{i\\pi}+1=0$\n')
    const clean = DOMPurify.sanitize(html, SANITIZE_CONFIG)
    // 公式容器与样式类存活
    expect(clean).toContain('katex')
  })

  it('javascript: 链接剥除', () => {
    const clean = DOMPurify.sanitize('<a href="javascript:evil()">点我</a>', SANITIZE_CONFIG)
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
