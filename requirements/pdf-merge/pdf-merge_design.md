# PDF 合并导出设计

> 状态：**实施中**（pdf-merge 分支）
> 需求：FR-2.4.10 扩展——在单篇 PDF 基础上支持"多篇合并为一个 PDF"。

## 1. 范围

- 单篇 PDF 导出保持不变（现有功能不受影响）
- 新增"导出合并 PDF…"入口（单篇菜单改为"导出 PDF…" / "导出合并 PDF…"两级）
- 合并 = 多篇笔记逐篇 printToPDF → pdf-lib 拼接 → 一个 PDF → 保存

## 2. 技术方案

### 2.1 pdf-lib 引入

`npm install pdf-lib`（~80KB，无原生依赖），用于读取多个单篇 PDF 的 Buffer，按顺序拼页。

### 2.2 主进程管线

```
exportPdfMerge(items[])
  for item in items:
    writeTempHtml(item)
    ensureWindow().loadFile(htmlPath)
    printToPDF → pdfBuffer
    pdfBuffers.push(pdfBuffer)
  merged = PDFDocument → 逐篇 load(pdfBuffer) → copyPages → 逐页 appendPage
  merged.save() → writeFileSync(target.pdf)
```

- 隐藏窗口逐篇 printToPDF（串行，每篇 1-3 秒）
- 拼接在所有 PDF 就绪后执行（pdf-lib 拼接秒级）
- 进度：已有 `onExportProgress` 事件，拼接阶段可追加"正在合并…"提示

### 2.3 文件名与目录

- 合并 PDF 保存为单一文件，文件名提示用户输入（默认"导出合并.pdf"，同名追加序号）
- 复用现有 `chooseDirectory()` 选目录

### 3.1 菜单入口

| 位置 | 现有 | 新增 |
|------|------|------|
| VaultNode 文件夹 ⋮ | 导出 PDF… / 导出 HTML… | 导出合并 PDF… |
| NoteGridView 库卡片 ⋮ | 导出 PDF… / 导出 HTML… | — |
| NoteGridView 笔记 ⋮ | 导出 PDF… / 导出 HTML… | — |
| SideBar 库 + | 导出整库 PDF… / 导出整库 HTML… | 导出整库合并 PDF… |

> 笔记库卡片导出范围太大（可能几千篇），不做合并入口；单篇和文件夹级别可合并。

## 3. 验收清单

- [ ] 3 篇笔记 → 合并为 1 个 PDF（16 页），顺序与源文件一致
- [ ] 公式、代码、表格、图片在合并后 PDF 中正确显示
- [ ] 文件名提示可自定义，默认"导出合并.pdf"
- [ ] 空文件夹/单篇笔记时仍可执行（等同单篇导出）
- [ ] 单篇"导出 PDF…"行为不变
- [ ] 39+ 项测试通过，无回归
