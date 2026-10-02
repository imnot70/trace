# suggest/ — 建议存档目录

本目录保存用户咨询过的**方案与建议类内容**（「我该如何操作」「能不能这样做」这类讨论的结论存档），与其它目录的分工：

- `../`（requirements 根）：PRD、开发计划、技术债评审等**正式需求与状态文档**；
- `../<日期>_<功能>/`：已立项功能的**需求与设计文档**；
- `../../guides/`：面向使用者的**操作指引**；
- **本目录**：尚未立项 / 已讨论待定 / 纯咨询性质的**建议与思路**。立项时把相关内容迁入正式的需求文档，本目录条目保留作为思路存档。

## 条目

| 文件 | 主题 | 状态 |
| --- | --- | --- |
| [github-pages-site.md](github-pages-site.md) | GitHub Pages 静态网站架设指南与风格建议 | ✅ 已实施上线（https://imnot70.github.io/trace/） |
| [flow-keyboard-workflow.md](flow-keyboard-workflow.md) | 「手不离键盘」心流动线设计思路（P1/P2 已实施，P3 备忘） | P1/P2 已随 v0.8.6 实施；P3 暂缓 |
| [feature-proposals.md](feature-proposals.md) | 功能提案池 ×7：标签优化 / 内联新建 / 临时笔记缓冲区 / 斜杠命令 / Vim 模式 / 分享链接 / 快速引入图片（含难度与工时评估） | 设计阶段，待逐项立项 |
| [flow-quick-ref-picker.md](flow-quick-ref-picker.md) | 心流快速引用面板：树形浏览（含草稿）+ 键盘化一键引入引用——补「记不清名字、按结构翻」的第三条引用动线；含方案 A/B/C 对比与 5 项决策点、工时 1~1.5 天 | ✅ 2026-09-29 已立项（方案 A 拍板）→ [requirements/2026-09-29_flow-quick-ref-picker/](../requirements/2026-09-29_flow-quick-ref-picker/flow-quick-ref-picker.md)（FR-2.9.12） |
| [wikilink-preview.md](wikilink-preview.md) | 双链悬浮预览：分栏单击预览 / Ctrl 打开；所见即所得 Alt+点击与 Alt+Enter（单击保留编辑入口） | ✅ 2026-09-30 已立项实施 → [requirements/2026-09-30_preview-batch/](../requirements/2026-09-30_preview-batch/preview-batch.md)（FR-2.4.27） |
| [flow-window-title.md](flow-window-title.md) | 窗口标题跟随当前笔记（常规「笔记名 - Trace 笔迹」、心流「库名 / 笔记名」，全模式） | ✅ 2026-09-30 已立项实施 → [requirements/2026-09-30_preview-batch/](../requirements/2026-09-30_preview-batch/preview-batch.md)（FR-2.10.7） |
| [context-menu.md](context-menu.md) | 右键上下文菜单（编辑器原生菜单替换 + 选区转双链等动作 / 树与网格右键镜像 ⋮）与轮盘菜单可行性：轮盘技术可行但全局不推荐，选区格式轮盘可作实验特性；含管线注意点（右键粘贴须过 FR-2.4.25 归一化）与分批工时 P1 1~1.5 天 / P2 0.5~1 天 / P3 2 天 | 讨论结论存档，待拍板立项 |
