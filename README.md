# Trace 笔迹

轻量级 Markdown 笔记应用。数据以纯 Markdown 文件保存在本地，通过 Git 仓库在多台设备间同步，支持 LaTeX 公式、图片粘贴、浅色/深色主题与插件。

- 跨平台：Windows / macOS / Linux（Ubuntu、Debian 系为主）
- 数据完全本地：笔记就是 `.md` 文件，没有私有格式，随时可以用其他编辑器打开
- 开源协议：MIT ｜ 当前版本：[v0.2.0](CHANGELOG.md)

![技术栈](https://img.shields.io/badge/Electron-44-47848f) ![Vue](https://img.shields.io/badge/Vue-3-42b883) ![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6)

## 功能说明

### 笔记库 / 文件夹 / 笔记

- 按主题创建**笔记库**，库内可建多级**文件夹**（最多 6 层），最底层是**笔记**（Markdown 文件）。
- 库、文件夹、笔记均支持创建 / 重命名 / 删除；全程重名校验（大小写不敏感）与 Windows 非法字符过滤。
- 侧边栏从上至下：**常用**（最近打开）、**收藏**、**回收站**、**笔记库**，左下角齿轮打开设置。
- 悬浮在库 / 文件夹 / 笔记行上会出现操作按钮：齿轮或 `⋮`（设置菜单）、`+`（新建文件夹 / 创建笔记）。

### 编辑器与预览

- 左侧源码编辑（CodeMirror 6），右侧实时渲染预览，中间分隔条可拖拽调整比例，滚动联动。
- 界面为三栏圆角卡片布局（侧栏 / 编辑 / 预览）。编辑卡顶栏可**收起预览**；「四角方框」按钮进入**专注模式**（隐藏侧栏只留编辑区，此时仍可呼出预览，两栏各半），状态会被记住。
- **长按**预览按钮：呼出悬浮预览卡片（覆盖在编辑区上，不改变布局），Esc 或 × 关闭。
- 完整 Markdown 支持 + **LaTeX 公式**：行内 `$e^{i\pi}+1=0$`、块级 `$$...$$`，代码块语法高亮。
- 工具栏一键插入加粗、斜体、标题、引用、代码、链接、公式等。
- **自动保存**：编辑后 1 秒写盘（可在设置关闭），`Ctrl+S` / `Cmd+S` 手动保存。
- **外部修改保护**：git 拉取或其他编辑器改动文件后自动感知——无冲突静默重载，有未保存改动时给出选择，绝不悄悄覆盖。

### 图片

- 直接**粘贴或拖入**图片，自动保存到库的附件目录（默认 `attachments/`，可在设置中改为多级目录如 `media/image`），笔记中以相对路径引用。
- 预览通过应用内自定义协议加载，无需关心路径问题。

### Git 云同步（GitHub）

每个笔记库就是一个独立的 git 仓库：

1. **登录**：设置 → 账号 → 点开「查看获取令牌的步骤」按提示操作——一键打开 GitHub 令牌创建页（已自动填好备注并勾选权限），生成后把 `ghp_` 开头的令牌粘贴进来即可。令牌保存在系统级加密存储中，只在 git 调用时注入请求头，绝不写入 `.git/config`。
2. **关联**：笔记库的齿轮菜单 → 关联 Git 仓库 → 从你的仓库列表选择，或直接新建一个（可设私有）。远端有内容会自动拉取，本地有内容会自动推送。
3. **同步**：点击「同步」按钮即完成 提交本地变更 → 拉取远端 → 推送 三步。出现冲突时列出冲突文件并保持本地内容不变，解决后再次同步即可。

在多台设备上安装 Trace 并关联同一个远程仓库，即可实现笔记同步。

### 收藏 / 常用 / 回收站

- **收藏**：笔记 `⋮` 菜单中收藏，侧栏收藏区直达；重命名、移动后自动跟随。
- **常用**：自动记录最近打开的笔记（最多 20 条）。
- **回收站**：删除的库 / 文件夹 / 笔记全部进入回收站（不污染 git 仓库），支持还原、彻底删除、清空。

### 主题

浅色 / 深色 / 跟随系统三种模式，设置页一键切换，全界面统一配色。

### 插件（实验性）

设置 → 插件中开启。插件为带 `manifest.json` 清单的目录，应用首次运行会自带一个示例插件作为开发模板（见[插件开发](#插件开发)）。插件系统当前为骨架阶段，完整 API 与市场在规划中。

## 安装

### 安装包（推荐）

在 [Releases](../../releases) 下载对应平台的安装包：

| 平台 | 文件 | 安装方式 |
| --- | --- | --- |
| Ubuntu / Debian | `linux-v0.2.0-x64.deb` | `sudo dpkg -i linux-v*.deb` 或 `sudo apt install ./linux-v*.deb` |
| 其他 Linux | `linux-v0.2.0-x64.AppImage` | `chmod +x linux-v*.AppImage && ./linux-v*.AppImage`（需 FUSE，或 `--appimage-extract` 后运行） |
| Windows | `win-v0.2.0-x64.exe` | 双击安装，可选择安装目录 |
| macOS | 暂不提供安装包 | 请自行从源码构建（见下方说明） |

> macOS 需要自行构建：安装 Node.js ≥ 20 与 git 后，执行下面的「从源码构建」，在 macOS 机器上运行 `npm run dist` 即可得到 `Trace-x.y.z.dmg`（首次构建前建议先执行 `xcode-select --install` 安装命令行工具）。

> 同步功能依赖系统 git（`sudo apt install git` / [Windows 下载](https://git-scm.com/download/win) / `xcode-select --install`）。未安装 git 时其余功能不受影响。

### 从源码构建

环境要求：Node.js ≥ 20、npm ≥ 10、git。

```bash
git clone <本仓库地址> trace
cd trace
npm install          # 安装依赖
npm run dev          # 开发模式启动（渲染进程热更新）
```

构建与打包：

```bash
npm run build        # 构建到 out/（不打包安装程序）
npm run dist         # 按当前平台打包安装程序
npm run dist:deb     # 只打 Ubuntu/Debian deb 包
```

产物输出在 `dist/` 目录，命名规范为「平台-v版本-架构.扩展名」（如 `linux-v0.2.0-x64.deb`、`win-v0.2.0-x64.exe`）。

> Windows / macOS 安装包需在对应平台上执行 `npm run dist`。macOS 没有预构建安装包，Mac 用户请通过本节自行构建 DMG。

其他开发命令：

```bash
npm test             # 单元测试
npm run typecheck    # 类型检查（主进程 + 渲染进程）
npm run lint         # ESLint
npm run icon         # 重新生成应用图标
```

调试技巧：`TRACE_CDP=9222 npm run dev` 后访问 `http://127.0.0.1:9222`，可通过 DevTools 协议连接渲染进程。

## 使用指南

### 首次启动

应用会创建默认工作区 `~/Trace`（所有笔记库的父目录）。想换位置：设置 → 通用 → 工作区 → 选择目录 → 应用。

### 基本流程

1. 侧栏「笔记库」区右上角 `+` → 输入名称创建笔记库（例如「工作笔记」）；
2. 库行上的 `+` → 新建文件夹 / 创建笔记；
3. 点击笔记开始编辑，右侧实时预览；公式、代码块、表格、图片直接按 Markdown 语法书写；
4. 笔记的 `⋮` 菜单可重命名、删除、收藏；删除项以红色警示。

### 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + S` | 手动保存当前笔记 |
| `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` | 撤销 / 重做 |
| `Esc` | 关闭悬浮预览 |

> 提示：编辑卡右上角的 ≣ 按钮可收起预览，⟦ ⟧ 按钮进入专注模式；**长按**预览按钮可呼出悬浮预览。

### 数据保存在哪里

```
~/Trace/                      # 工作区（可更换）
 ├─ <笔记库>/                 # 每个库 = 一个独立 git 仓库
 │  ├─ 文件夹/笔记.md
 │  └─ attachments/           # 图片附件
 └─ .trash/                   # 应用级回收站

Linux    ~/.config/Trace/     # 应用数据（设置、收藏、插件等）
Windows  %APPDATA%\Trace\
macOS    ~/Library/Application Support/Trace/
```

备份整个工作区目录（或直接推送各库的 git 远程）即可备份全部笔记。

### 插件开发

在应用数据目录 `plugins/<你的插件id>/` 下放两个文件：

`manifest.json`：

```json
{
  "id": "hello",
  "name": "Hello 插件",
  "version": "1.0.0",
  "description": "示例",
  "main": "main.js",
  "permissions": []
}
```

`main.js`（CommonJS）：

```js
exports.activate = function (ctx) {
  ctx.notify('插件已激活！')
  ctx.logger.info('hello plugin loaded')
  return function deactivate() {
    // 清理资源（可选）
  }
}
```

设置 → 插件 → 打开「启用插件」并启用你的插件即可。当前可用能力：`ctx.notify(message)` 弹出通知、`ctx.logger` 写日志；完整 API 在后续版本开放。

## 更新日志

各版本变更明细见 [CHANGELOG.md](CHANGELOG.md)。

## 路线图

全局搜索 · 所见即所得模式 · 图形化冲突解决 · 自动同步 · 自定义主题包 · 插件完整 API 与市场 · 标签 · 多窗口 · 导出 PDF/HTML

## 许可证

[MIT](LICENSE)
