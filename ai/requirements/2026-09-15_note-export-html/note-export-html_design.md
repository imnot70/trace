# 笔记导出 HTML 设计

> 状态：已实施（2026-09-15，export-html 分支） ｜ 关联：FR-2.4.12；依赖 FR-2.4.9 的导出架构
> 复用 [note-export 设计](../note-export/note-export_design.md) 的管线与交互，产物从 PDF 换为自包含 HTML。

## 需求

与导出 PDF 相同的范围与交互（单篇 / 文件夹递归 / 整库批量、同名追加序号、进度与失败汇总），产物为**单个自包含 HTML 文件**：双击即可在任意浏览器阅读，无需 Trace 或网络。

## 方案

复用导出 PDF 的两段式架构——渲染进程 `renderNoteHtml` 生成正文（markdown 渲染 + DOMPurify 净化 + 库内图片 base64 内联 + frontmatter 剥离），主进程 `ExportService.exportOneHtml` 仅做组装与写盘（无隐藏窗口 / 无 printToPDF）：

- 模板：`<article>` 正文 + 屏幕阅读样式（居中限宽 860px、卡片化、随系统深浅色 `prefers-color-scheme`）；
- 公式：正文含 katex 标记时内联 KaTeX CSS，字体 woff2 转 data URI（离线自包含；非 woff2 格式不再被引用），结果按服务生命周期缓存；正文无公式时不内联；
- 命名 / 去重 / 导出目录会话记忆与 PDF 一致（两通道共享同一目录缓存）。

## 不做的事

- 不合并多篇为一个 HTML（与 PDF 口径一致）；
- 不内联正文字体（PingFang 等系统字体直接回退）。
