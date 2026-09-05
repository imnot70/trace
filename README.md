# Trace 笔迹

轻量级 Markdown 笔记应用。数据以纯 Markdown 文件保存在本地，通过 Git 仓库多端同步，支持 LaTeX 公式、主题与插件。

> 当前版本 v0.1.0（M0–M6 全部里程碑已完成），支持 Windows / macOS / Linux（Ubuntu、Debian 系为主）。

## 功能特性

- **笔记库 → 子目录 → 笔记** 三层结构管理，子目录最多 6 层；创建/重命名/删除全程重名校验（大小写不敏感，兼容 Windows 非法字符）
- **编辑器**：CodeMirror 6 源码编辑 + 实时分栏预览；`$...$` 行内公式、`$$...$$` 块级公式（KaTeX）；代码高亮；1 秒防抖自动保存，外部修改检测防覆盖
- **图片粘贴 / 拖入**：自动存入库内 `attachments/`，预览通过 `trace-vault://` 自定义协议加载相对路径图片
- **Git 同步**：每个笔记库 = 一个独立 git 仓库。GitHub PAT 登录（令牌存系统加密存储），从仓库列表选择或直接新建远程仓库；一键「同步」= 提交本地变更 → rebase 拉取 → 推送；冲突时列出冲突文件并保持本地内容不变
- **常用 / 收藏 / 回收站**：最近打开、收藏笔记快速访问；删除内容全部进入应用级回收站（工作区 `.trash/`），支持还原与彻底删除
- **主题**：浅色 / 深色 / 跟随系统，全部颜色基于 CSS 变量
- **插件（骨架）**：`manifest.json` 清单规范 + 加载器 + 设置页管理；示例插件位于 `resources/sample-plugin/`
- **本地菜单中文化**、单实例运行、`Ctrl+S` 手动保存

## 技术栈

Electron 44 · Vue 3 · TypeScript · Pinia · Element Plus · CodeMirror 6 · markdown-it + KaTeX · simple-git + 系统 git · octokit · electron-vite · electron-builder · Vitest

## 开发

```bash
npm install          # 安装依赖（需要 Node 20+ 与本机 git）
npm run dev          # 启动开发模式（渲染进程热更新）
npm run typecheck    # 主进程 + 渲染进程类型检查
npm test             # 单元测试（服务层 + git 同步集成测试）
npm run lint         # ESLint
npm run build        # 构建三端 bundle 到 out/
```

调试渲染进程：`TRACE_CDP=9222 npm run dev`，然后访问 `http://127.0.0.1:9222`。

## 打包

```bash
npm run dist         # 按当前平台打包（NSIS / DMG / deb + AppImage）
npm run dist:deb     # Ubuntu/Debian deb 包
npm run icon         # 重新生成应用图标 build/icon.png
```

## 数据存储

```
~/Trace/                    # 默认工作区（设置中可更换）
 ├─ <笔记库>/               # 每个库一个独立 git 仓库
 │  ├─ 子目录/笔记.md
 │  └─ attachments/         # 图片附件
 └─ .trash/                 # 应用级回收站（索引 + 条目本体）

~/.config/Trace/            # 应用数据（Linux）
 ├─ settings.json           # 设置（工作区路径、主题、插件开关等）
 ├─ favorites.json / recents.json
 ├─ account.bin             # GitHub PAT（系统加密存储，Linux 缺 keyring 时降级明文并警告）
 └─ plugins/                # 已安装插件
```

## Git 同步说明

1. 设置 → 账号 → 创建并粘贴 [Personal Access Token](https://github.com/settings/personal-access-tokens/new)（需要仓库读写权限）
2. 笔记库齿轮菜单 → 关联 Git 仓库 → 选择已有仓库或新建
3. 以后通过库上的「立即同步」或编辑页「同步」按钮完成 双向同步

令牌仅在每次 git 调用时以 HTTP 头注入，不写入 `.git/config`；日志统一脱敏。

## 路线图（二期）

全局搜索 · 所见即所得模式 · 图形化冲突解决 · 定时自动同步 · 自定义主题包 · 插件完整 API 与市场 · 标签 · 多窗口
