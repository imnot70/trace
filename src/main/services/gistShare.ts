import { stripFrontmatter } from '@shared/noteTags'

/**
 * 分享为 Gist（FR-2.3.10）的正文发布适配。
 *
 * 背景（2026-09-27 调研结论）：Gist REST API 的文件内容只接受 UTF-8 文本
 * （二进制图片经 API 上传会被编码破坏），而 GitHub 渲染 Markdown 时会剥掉
 * data: 协议的图片（github/markup#270）——因此「图片随行」在 secret gist +
 * API 发布的约束下无自包含方案，公开图床仓库留作二期评估。一期做发布适配：
 *
 * 1. 剥离 frontmatter（Trace 预览本就不渲染，避免 GitHub 把 tags 渲染成表格）；
 * 2. [[双链]] 转纯文本（分享页无库内跳转能力，[[ ]] 对读者是噪音）；
 * 3. 相对路径图片引用替换为占位说明（附件不随行，避免碎图图标）。
 */

export function prepareGistContent(content: string): string {
  let out = stripFrontmatter(content)
  out = out.replace(/\[\[([^\[\]]+)\]\]/g, '$1')
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, _alt: string, src: string) => {
    // http(s) 外链与 data: URI 保持原样；其余（相对/绝对本地路径）替换为占位说明
    if (/^(https?:\/\/|data:)/i.test(src)) return whole
    const base = src.split('/').pop() || src
    return `（图片未随分享：${base}）`
  })
  return out
}
