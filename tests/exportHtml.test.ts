import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExportService } from '../src/main/services/exportPdf'

let tmp: string
let service: ExportService

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-export-html-'))
  service = new ExportService(() => null)
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('导出 HTML', () => {
  it('生成自包含单文件：屏幕样式 + article 正文 + 文件名「库-路径」', () => {
    const result = service.exportOneHtml(tmp, {
      vault: '库',
      path: '日记/2026.md',
      name: '2026',
      html: '<h1>标题</h1><p>正文</p>'
    })
    expect(result.ok).toBe(true)
    expect(result.path).toBe(path.join(tmp, '库-日记-2026.html'))
    const content = fs.readFileSync(result.path!, 'utf-8')
    expect(content).toContain('<article>')
    expect(content).toContain('<h1>标题</h1><p>正文</p>')
    expect(content).toContain('max-width: 860px')
    expect(content).toContain('<title>2026</title>')
  })

  it('正文含 katex 时内联 KaTeX CSS（字体转 data URI）', () => {
    const result = service.exportOneHtml(tmp, {
      vault: '库',
      path: 'math.md',
      name: 'math',
      html: '<span class="katex">E=mc²</span>'
    })
    expect(result.ok).toBe(true)
    const content = fs.readFileSync(result.path!, 'utf-8')
    expect(content).toContain('.katex')
    expect(content).toContain('data:font/woff2;base64,')
  })

  it('正文不含 katex 时不内联公式 CSS', () => {
    const result = service.exportOneHtml(tmp, {
      vault: '库',
      path: 'plain.md',
      name: 'plain',
      html: '<p>纯文本</p>'
    })
    const content = fs.readFileSync(result.path!, 'utf-8')
    expect(content).not.toContain('data:font/woff2')
  })

  it('同名文件自动追加序号', () => {
    const req = { vault: '库', path: 'n.md', name: 'n', html: '<p>x</p>' }
    const first = service.exportOneHtml(tmp, req)
    const second = service.exportOneHtml(tmp, req)
    expect(first.path).toBe(path.join(tmp, '库-n.html'))
    expect(second.path).toBe(path.join(tmp, '库-n (1).html'))
    expect(fs.existsSync(second.path!)).toBe(true)
  })
})
