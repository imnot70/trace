import { BrowserWindow, app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../lib/logger'

export interface ExportRequestItem {
  /** 库名 */
  vault: string
  /** 库内相对路径（.md） */
  path: string
  /** 笔记标题（文件名去 .md） */
  name: string
  /** 渲染进程生成的导出 HTML 正文（已含内联图片与净化） */
  html: string
}

export interface ExportFileResult {
  ok: boolean
  path?: string
  name: string
  error?: string
}

/** 打印样式：白底黑字、A4 友好、代码/表格/引用防截断（设计 2.3 节） */
const PRINT_CSS = `
  body { margin: 0; padding: 24px; background: #fff; color: #24292f; font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; font-size: 12pt; line-height: 1.7; }
  h1, h2, h3, h4 { line-height: 1.4; margin: 1.2em 0 0.5em; page-break-after: avoid; }
  h1 { font-size: 1.7em; border-bottom: 1px solid #ddd; padding-bottom: 0.25em; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
  p { margin: 0.6em 0; }
  a { color: #1a5fb4; text-decoration: none; }
  img { max-width: 100%; }
  pre, table, blockquote, .katex-display { page-break-inside: avoid; }
  pre { background: #f4f5f7; border: 1px solid #e0e2e6; border-radius: 6px; padding: 10px 14px; overflow-x: auto; font-size: 10pt; }
  code { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 0.88em; }
  :not(pre) > code { background: #f0f2f5; padding: 0.1em 0.35em; border-radius: 4px; }
  table { border-collapse: collapse; margin: 0.8em 0; }
  th, td { border: 1px solid #d5d8dd; padding: 5px 12px; }
  th { background: #f0f2f5; }
  blockquote { margin: 0.7em 0; padding: 0.1em 1em; border-left: 3px solid #d5d8dd; color: #57606a; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1em 0; }
  ul, ol { padding-left: 1.6em; }
  .katex { font-size: 1.05em; }
`

/** 屏幕阅读样式（HTML 导出）：居中限宽、舒适排版、随系统深浅色 */
const SCREEN_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f7f9; color: #24292f; font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif; font-size: 15px; line-height: 1.75; }
  article { max-width: 860px; margin: 32px auto; padding: 40px 48px 72px; background: #fff; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  @media (prefers-color-scheme: dark) {
    body { background: #17191e; color: #d7dae0; }
    article { background: #1e2127; box-shadow: 0 2px 12px rgba(0,0,0,0.4); }
    a { color: #7aa7e8; }
    pre { background: #26292f; border-color: #33373e; }
    :not(pre) > code { background: #26292f; }
    th { background: #26292f; }
    blockquote { color: #9aa0aa; border-left-color: #33373e; }
  }
  h1, h2, h3, h4 { line-height: 1.4; margin: 1.4em 0 0.6em; }
  h1 { font-size: 1.7em; border-bottom: 1px solid #e4e7ec; padding-bottom: 0.3em; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #eef0f3; padding-bottom: 0.2em; }
  p { margin: 0.7em 0; }
  a { color: #4078d3; }
  img { max-width: 100%; border-radius: 6px; }
  pre { background: #f4f5f7; border: 1px solid #e4e7ec; border-radius: 8px; padding: 12px 16px; overflow-x: auto; font-size: 13px; }
  code { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 0.9em; }
  :not(pre) > code { background: #f0f2f5; padding: 0.15em 0.4em; border-radius: 4px; }
  table { border-collapse: collapse; margin: 0.9em 0; }
  th, td { border: 1px solid #d5d8dd; padding: 6px 14px; }
  th { background: #f0f2f5; }
  blockquote { margin: 0.8em 0; padding: 0.2em 1.2em; border-left: 3px solid #d5d8dd; color: #57606a; }
  hr { border: none; border-top: 1px solid #e4e7ec; margin: 1.6em 0; }
  ul, ol { padding-left: 1.8em; }
  .katex { font-size: 1.05em; }
`

/**
 * 笔记导出 PDF：多篇不合并，每篇一个文件。
 * 隐藏窗口常驻复用；正文写临时 HTML（KaTeX CSS/字体从依赖目录复制到旁边，
 * 相对路径引用），loadFile 后 printToPDF——避免 data: URL 下 CSS/字体无法加载。
 */
export class ExportService {
  private win: BrowserWindow | null = null
  private exportTmpDir: string | null = null
  private katexInlineCss: string | null = null
  private seq = 0

  constructor(private getWindow: () => BrowserWindow | null) {}

  /** 让用户选择导出目录（返回 null = 用户取消）。
   *  TRACE_EXPORT_DIR 环境变量为自动化测试钩子：跳过对话框直接使用指定目录 */
  async chooseDirectory(): Promise<string | null> {
    if (process.env['TRACE_EXPORT_DIR']) {
      fs.mkdirSync(process.env['TRACE_EXPORT_DIR'], { recursive: true })
      return process.env['TRACE_EXPORT_DIR']
    }
    const parent = this.getWindow()
    if (!parent) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: '选择导出目录',
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled ? null : filePaths[0]
  }

  /** 导出单篇：写临时 HTML → loadFile → printToPDF → 写盘 */
  async exportOne(dir: string, req: ExportRequestItem): Promise<ExportFileResult> {
    const name = req.name
    try {
      this.prepareKaTeX()
      const htmlPath = this.writeTempHtml(req)
      const win = this.ensureWindow()
      await win.loadFile(htmlPath)
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => undefined)').catch(() => undefined)
      const pdf = await win.webContents.printToPDF({
        landscape: false,
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
      })
      // 路径末段即笔记名，无需再拼接（避免重复）
      const fileBase = sanitizeFileName(
        `${req.vault}-${req.path.replace(/\.md$/i, '').split('/').join('-')}`
      )
      let target = path.join(dir, `${fileBase}.pdf`)
      let n = 1
      while (fs.existsSync(target)) {
        target = path.join(dir, `${fileBase} (${n}).pdf`)
        n++
      }
      fs.writeFileSync(target, pdf)
      logger.info(`导出 PDF：${target}`)
      return { ok: true, path: target, name }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      logger.error(`导出 PDF 失败（${name}）`, e)
      return { ok: false, name, error }
    }
  }

  /** 导出单篇为自包含 HTML：模板 + 屏幕样式 + 按需内联 KaTeX CSS（字体转 data URI） */
  exportOneHtml(dir: string, req: ExportRequestItem): ExportFileResult {
    const name = req.name
    try {
      const title = req.name.replace(/[<>&]/g, '')
      const needsKatex = req.html.includes('katex')
      const katexStyle = needsKatex ? `<style>${this.inlineKatexCss()}</style>` : ''
      const fileBase = sanitizeFileName(
        `${req.vault}-${req.path.replace(/\.md$/i, '').split('/').join('-')}`
      )
      let target = path.join(dir, `${fileBase}.html`)
      let n = 1
      while (fs.existsSync(target)) {
        target = path.join(dir, `${fileBase} (${n}).html`)
        n++
      }
      const doc = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${SCREEN_CSS}</style>
${katexStyle}
</head>
<body>
<article>
${req.html}
</article>
</body>
</html>`
      fs.writeFileSync(target, doc, 'utf-8')
      logger.info(`导出 HTML：${target}`)
      return { ok: true, path: target, name }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      logger.error(`导出 HTML 失败（${name}）`, e)
      return { ok: false, name, error }
    }
  }

  /** KaTeX CSS 内联（字体 woff2 转 data URI，使导出 HTML 离线自包含）；结果缓存 */
  private inlineKatexCss(): string {
    if (this.katexInlineCss !== null) return this.katexInlineCss
    try {
      const dist = path.dirname(require.resolve('katex/dist/katex.min.css'))
      let css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf-8')
      css = css.replace(/url\((fonts\/[^)]+\.woff2)\)/g, (_m, rel: string) => {
        const file = path.join(dist, rel)
        if (!fs.existsSync(file)) return 'url(data:,)'
        const b64 = fs.readFileSync(file).toString('base64')
        return `url(data:font/woff2;base64,${b64})`
      })
      this.katexInlineCss = css
    } catch (e) {
      logger.warn('内联 KaTeX CSS 失败，导出 HTML 将不含公式样式', e)
      this.katexInlineCss = ''
    }
    return this.katexInlineCss
  }

  /** KaTeX CSS 与字体复制到导出临时目录（首次或缺失时） */
  private prepareKaTeX(): void {
    if (!this.exportTmpDir) {
      this.exportTmpDir = path.join(app.getPath('temp'), 'trace-export')
      this.seq = 0
    }
    fs.mkdirSync(this.exportTmpDir, { recursive: true })
    const katexDist = path.dirname(require.resolve('katex/dist/katex.min.css'))
    const cssTarget = path.join(this.exportTmpDir, 'katex.min.css')
    const fontsTarget = path.join(this.exportTmpDir, 'fonts')
    if (!fs.existsSync(cssTarget)) {
      fs.copyFileSync(path.join(katexDist, 'katex.min.css'), cssTarget)
    }
    if (!fs.existsSync(fontsTarget)) {
      fs.cpSync(path.join(katexDist, 'fonts'), fontsTarget, { recursive: true })
    }
  }

  private writeTempHtml(req: ExportRequestItem): string {
    if (!this.exportTmpDir) this.exportTmpDir = path.join(app.getPath('temp'), 'trace-export')
    fs.mkdirSync(this.exportTmpDir, { recursive: true })
    this.seq++
    const file = path.join(this.exportTmpDir, `note-${this.seq}.html`)
    const title = req.name.replace(/[<>&]/g, '')
    fs.writeFileSync(
      file,
      `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="stylesheet" href="katex.min.css">
<style>${PRINT_CSS}</style>
</head>
<body>
${req.html}
</body>
</html>`,
      'utf-8'
    )
    return file
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    this.win = new BrowserWindow({
      show: false,
      width: 794, // A4 @96dpi 宽度，让排版与打印接近
      height: 1123,
      webPreferences: { nodeIntegration: false }
    })
    this.win.on('closed', () => {
      this.win = null
    })
    return this.win
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close()
    this.win = null
  }
}

/** 导出文件名清洗：非法字符过滤 + 长度限制（防路径注入 / 跨平台非法字符） */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || '未命名'
  )
}
