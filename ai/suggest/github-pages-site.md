# GitHub Pages 静态网站架设指南（建议存档）

> 2026-09-25 用户询问「想用 GitHub Pages 给这个项目做一个静态网站该怎么做」的建议存档。状态：**已实施上线**（2026-09-26），站点地址：<https://imnot70.github.io/trace/>。

> **实施记录**：`site/` 纸感笔记风单页（浅色主题、单页滚动、截图由隔离实例自动生成）+ `.github/workflows/pages.yml` Actions 部署。**踩坑**：首跑失败于 `configure-pages`（HttpError: Not Found）——仓库 Pages 从未启用且 GITHUB_TOKEN 无管理员权限、`enablement: true` 也自愈不了；一次性解决 = Settings → Pages 把 Source 切换为「GitHub Actions」后 Re-run。
> 需要注意：Trace 是 Electron 桌面应用，没有可部署的 Web 版本——网站的定位是**项目门面**（介绍 + 截图 + 下载入口 + 指引链接），不是 Web 版应用。

## 一、操作步骤

### 1. 选托管方式（仓库 Settings → Pages）

| 方式 | 说明 | 建议 |
| --- | --- | --- |
| Deploy from a branch | 建一个 `gh-pages` 分支（或用 main 的 `/docs` 目录）放纯静态文件，推送即发布 | 最简单，适合纯手写 HTML |
| **GitHub Actions** | 仓库加 `.github/workflows/pages.yml`，用官方三件套部署 | **推荐**：与现有的发版 Actions 习惯一致，改网站 = 改文件推 main |

Actions 方式的 workflow 骨架（三件套）：

```yaml
- actions/configure-pages
- actions/upload-pages-artifact   # 上传 site/ 构建产物
- actions/deploy-pages
```

### 2. 站点内容放哪

- 纯手写：仓库根建 `site/`（一个 `index.html` + 一个 CSS + `assets/` 截图）；
- 用生成器：源码放 `site/` 或 `docs-src/`，构建产物指向部署目录。

### 3. 可选项

- Settings → Pages 里绑自定义域名 + 强制 HTTPS；
- 免费额度：1GB 站点体积 / 每月 100GB 流量（软限），截图注意压缩。

## 二、技术选型建议

| 方案 | 适合 | 说明 |
| --- | --- | --- |
| **纯手写 HTML/CSS**（推荐起步） | 单页官网 | 零依赖零构建，一个 index.html + 一个 CSS 足够；本项目内容量（首页 + 下载 + 指引链接）撑得起 |
| VitePress | 想要「官网 + 完整文档站」 | 复用 Vue 技能，Markdown 写文档，自带搜索 / 深色模式 |
| Astro | 内容多、要长期演进 | 岛式架构、产物极轻 |

## 三、页面内容结构建议

1. **Hero**：应用名 + 一句话定位 + 下载按钮 + 主截图；
2. **特性网格**：本地纯 Markdown / 双链引用 / 所见即所得 / 心流模式 / Git 同步 / 插件系统 / 主题；
3. **截图**：浅色 + 深色主界面、心流模式各一张；
4. **下载**：按系统分区（Windows / Linux），标注最低版本要求（Win10+ / Ubuntu 22.04+）；
5. **指引**：链回仓库 `guides/` 目录；
6. **页脚**：MIT 协议 + 仓库链接。

### 下载链接与徽章

- 下载按钮直连最新版：`https://github.com/imnot70/trace/releases/latest`；
- 直接产物链接按现有命名规则：`win-v0.8.x-x64.exe`、`linux-v0.8.x-x64.deb`、`linux-v0.8.x-x64.AppImage`（版本号每版变化，用 `releases/latest` 兜底或部署脚本生成）；
- 版本徽章：shields.io 的 release 徽章（`img.shields.io/github/v/release/imnot70/trace`）；
- 截图素材：`site/assets/` 存放，注意压缩。

## 四、风格建议

核心思路：**让网站继承应用自己的设计语言**——访客从网站点到应用会感到「就是这个味」。

- **气质**：「纸感笔记」——大量留白、浅灰底 + 白卡片、细边框、10px 圆角；可加极淡的横线纹理呼应「笔迹」；
- **配色**：直接沿用应用的主题变量（`--accent: #4078d3`、`--bg-*` 灰阶体系）；支持 `prefers-color-scheme` 深色自适应（应用有深色主题，网站也应有）；
- **字体**：正文与编辑器一致（PingFang SC / Microsoft YaHei 栈），标题可用衬线体加一点「书写感」；
- **点缀**：手写体或下划线笔触效果做标题装饰，呼应「Trace 笔迹」，但克制（Hero 一处足矣）。
