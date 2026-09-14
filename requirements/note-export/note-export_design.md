# 笔记导出 PDF 设计（多篇不合并）

> 状态：✅ **已实施**（2026-09-09，note-export 分支，待合并发布）——实施中的补充决策：KaTeX 资源走临时目录复制方案（data: URL 下 CSS/字体相对路径不可达）；fence 高亮返回完整 `<pre>` 时会绕过 token attrs 渲染，行号需自定义 fence 渲染器补写｜ 起草：2026-09-09（Linux 机）
> 范围界定（项目所有者确认）：**多篇（支持跨库）、每篇一个 PDF、不合并、不做 HTML 导出**。
> 预评估结论：无实质性技术难点，约 1~1.5 人日（评估时已核实 Electron `printToPDF` 管线与 CSP/session 边界）。

## 1. 需求

- 选中多个笔记（可跨库）批量导出为 PDF：**每个笔记一个独立 PDF 文件**，输出到用户选择的目录
- 排版保真：公式（KaTeX）、代码高亮、表格、内嵌 HTML、图片照预览效果输出
- 批量导出需要进度反馈；个别笔记失败不中断整体，结束后汇总报告

## 2. 方案

### 2.1 核心管线

```
渲染进程                                主进程
────────                                ──────
① 选中笔记集合（库/文件夹/多选）
② 逐篇生成导出 HTML（现有 markdown
   管道 + 图片内联 base64 + 打印样式）
③ export:pdf IPC（html, 文件名）   →   ④ 隐藏 BrowserWindow.loadURL(data: 或 file:)
                                        ⑤ webContents.printToPDF(...)
                                        ⑥ showSaveDialog（首次选目录，后续同名写盘）
   ← 进度事件 export:progress ←───────   ⑦ 写盘 / 失败记录，下一篇
⑧ 完成汇总（成功 N / 失败列表）
```

- **打印/屏幕分离**：导出走独立 HTML 文档（非复用预览容器）——导出需要固定白底、无侧栏装饰、可控的分页样式；预览容器继续服务交互（滚动同步、链接点击）
- **复用点**：HTML 生成复用 `lib/markdown.ts` 管道（markdown-it + KaTeX + 行号注入）；图片改写在本方案下改为**内联 base64**（见 2.2）

### 2.2 图片资源：内联 base64（决策 D-NE1）

预览图片走 `trace-vault://` 自定义协议——该协议注册在默认 session；导出用隐藏窗口若挂独立 partition session 则协议不可达。**选定方案：导出 HTML 生成时把库内图片直接读出内联为 `data:` base64**（渲染进程经现有 IPC 读文件……渲染进程无读任意文件的 IPC——改为：主进程提供 `export:notes` 时**由主进程读取图片**并内联？图片改写发生在渲染进程 HTML 字符串上。折衷：新增 IPC `fs:readImage(vault, path)` 返回 base64（主进程校验路径在库内 + 扩展名白名单），渲染进程在生成导出 HTML 前逐图调用并替换 src）。收益：PDF 完全自包含、无 session 边界问题、无文件路径泄漏面。

### 2.3 打印样式（约 30 行 CSS）

- 白底黑字固定（忽略当前主题，PDF 是分发物）；`printBackground: true` 保留代码块/表格底色
- `page-break-inside: avoid`：pre / table / blockquote 防截断
- 字号 12pt 基准；A4、边距 15mm（printToPDF `margin` 参数）
- KaTeX 公式：正常排版，无特殊处理（字体由 Chromium 内嵌）

### 2.4 批量与进度

- **入口**（本期）：库 / 文件夹卡片的 ⋮ 菜单「导出 PDF…」（导出该层级下全部笔记，递归含子文件夹）；单篇笔记卡片 / 树节点菜单「导出 PDF」
- **选目录**：首批导出弹一次目录选择；同会话内记住该目录（后续批量直接写盘）
- **文件名**：`库名-相对路径(→'-')-笔记名.pdf`（去非法字符，冲突时追加序号）
- **进度**：主进程每完成一篇发 `export:progress { done, total, current }`，渲染端进度条展示；失败项记录（笔记路径 + 原因），结束统一 `ElMessage` + 可复制列表
- **取消**：本期不做（单篇秒级、总量可控）；失败不中断循环

### 2.5 主进程实现要点

- 隐藏窗口：`new BrowserWindow({ show: false })` 专用导出窗口，常驻复用（避免反复创建）；`loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))`——data URL 长度无硬限制（Chromium 支持 MB 级）；`did-finish-load` 后 printToPDF
- `printToPDF({ landscape: false, printBackground: true, pageSize: 'A4', margins: { top/bottom/left/right: 0.6 (inch) } })` → Buffer → 写盘
- 写盘路径校验：限定用户所选目录内（防笔记内容伪造 `../` 类文件名——文件名本身来自笔记标题，仍做字符过滤，与 validate 同规则）

## 3. 边界与不做

- 不做 PDF 合并（无 pdf-lib 依赖）；不做 HTML 导出（后续可复用管线，差异仅在落盘格式）
- 不改写/解析笔记内的双链与锚点（PDF 内 `[[]]` 渲染为链接样式但不可跳转——打印物无跳转目标）
- 导出以磁盘内容为准（未保存的编辑先自动保存由现有防抖覆盖；导出前渲染端调用 flushSave）
- 大量图片的笔记内存峰值：逐篇生成逐篇释放（不缓存全部 HTML）

## 4. 验收清单

- [ ] 单篇导出：含标题 / 段落 / 代码块 / 表格 / 引用 / KaTeX 行内与块级公式 / 图片的笔记，PDF 打开排版正确、公式清晰、图片可见
- [ ] 深色主题下导出：PDF 为白底黑字
- [ ] 跨库批量：选 2 个库各若干篇，逐篇生成对应数量 PDF，文件名规范无冲突
- [ ] 含未保存修改：导出前自动保存，PDF 为最新内容
- [ ] 失败隔离：一篇失败（如图片缺失）不影响其余，结束有汇总
- [ ] 进度展示与文件名规范（中文、空格、特殊字符）
