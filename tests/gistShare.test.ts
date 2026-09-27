import { describe, expect, it } from 'vitest'

/** 分享为 Gist 的正文发布适配（FR-2.3.10）：剥离 frontmatter、双链转纯文本、相对图片占位 */
import { prepareGistContent } from '../src/main/services/gistShare'

describe('prepareGistContent', () => {
  it('剥离 frontmatter（tags 不再被 GitHub 渲染成表格）', () => {
    const out = prepareGistContent('---\ntags: [测试]\ntitle: x\n---\n\n# 正文\n')
    expect(out).not.toContain('tags')
    expect(out).toContain('# 正文')
  })

  it('无 frontmatter 的内容原样进入后续处理', () => {
    expect(prepareGistContent('# 正文')).toContain('# 正文')
  })

  it('[[双链]] 转纯文本：行内、独立行与中文路径', () => {
    const out = prepareGistContent(
      '测试内容[[for_test_01]]\n\n[[跨库引用/工作笔记/会议记录-2]]\n'
    )
    expect(out).toBe('测试内容for_test_01\n\n跨库引用/工作笔记/会议记录-2\n')
  })

  it('相对路径图片替换为占位说明（./ 与 ../ 前缀）', () => {
    const out = prepareGistContent(
      '![aaa.png](./attachments/123-aaa.png)\n\n![](../attachments/456-b.jpg)\n'
    )
    expect(out).toBe('（图片未随分享：123-aaa.png）\n\n（图片未随分享：456-b.jpg）\n')
  })

  it('http(s) 与 data: 图片保持原样；普通链接与文字不受影响', () => {
    const md = '![外链](https://example.com/a.png)\n\n![占位](data:image/png;base64,AAAA)\n\n[文字](https://example.com)\n'
    expect(prepareGistContent(md)).toBe(md)
  })

  it('综合场景：frontmatter + 双链 + 混合图片一次适配', () => {
    const md = [
      '---',
      'tags: [水果]',
      '---',
      '',
      '# 标题',
      '',
      '见 [[笔记A]]，图片：',
      '',
      '![本地图](attachments/x.png)',
      '![外地图](https://example.com/y.png)'
    ].join('\n')
    const out = prepareGistContent(md)
    expect(out).not.toContain('tags:')
    expect(out).toContain('见 笔记A')
    expect(out).toContain('（图片未随分享：x.png）')
    expect(out).toContain('![外地图](https://example.com/y.png)')
  })
})
