# AGENTS.md

本文件面向在本仓库中工作的 AI 编码代理（及新加入的开发者），帮助快速理解项目并遵守其约定。

## 项目是什么

**Trace（笔迹）** 是一款本地优先的轻量级 Markdown 笔记桌面应用（当前版本 v0.2.0）：

- 笔记以纯 `.md` 文件存储，无私有格式；每个**笔记库**是一个独立 git 仓库，通过 GitHub PAT 实现多设备同步；
- 支持 LaTeX 公式、图片粘贴、回收站、收藏/常用、浅色/深色主题与插件骨架（实验性）；
- 跨平台：Windows / Linux（Ubuntu、Debian 为主），macOS 仅支持源码构建。

**权威文档**（修改行为时务必同步更新）：

- `requirements/requirements.md` — 产品需求文档，当前形态的权威描述；
- `requirements/development-plan.md` — 技术选型与架构决策（另一台机器上制定）；
- `CHANGELOG.md` — 版本变更明细（Keep a Changelog 格式，语义化版本）；
- `README.md` — 用户视角的功能说明与使用指南。

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 桌面框架 | Electron 44 + electron-vite |
| 前端 | Vue 3 + TypeScript + Pinia + Element Plus |
| 编辑器 / 预览 | CodeMirror 6；markdown-it + KaTeX + highlight.js |
| Git / GitHub | 系统 git + simple-git；octokit（REST） |
| 文件监听 | chokidar |
| 凭据存储 | Electron `safeStorage`（Windows DPAPI / macOS Keychain / Linux libsecret） |
| 打包 | electron-builder（NSIS / deb + AppImage） |
| 测试 / 质量 | Vitest；主/渲染双 typecheck（tsc + vue-tsc）；ESLint |

## 常用命令

```bash
npm run dev          # 开发模式启动（渲染进程热更新）
npm run build        # 构建到 out/（不打包安装程序）
npm test             # 单元测试（vitest run）
npm run typecheck    # 类型检查：主进程（tsconfig.node）+ 渲染进程（tsconfig.web）
npm run lint         # ESLint（src tests scripts）
npm run dist         # 按当前平台打包安装程序
npm run dist:deb     # 只打 deb 包
npm run icon         # 重新生成应用图标
```

调试：`TRACE_CDP=9222 npm run dev` 后访问 `http://127.0.0.1:9222` 连接渲染进程 DevTools；`TRACE_TEST_USERDATA=1` 以临时数据目录启动隔离实例。

CI（`.github/workflows/build.yml`）：**仅在推送 `v*.*.*` 标签时**构建 Windows/Linux 安装包并发布 Release（push main 不触发，需要临时测试包可手动 workflow_dispatch）；tag 触发时会校验标签与 package.json 版本一致，不一致构建失败。注意 CI 中 electron-builder 前必须先 `npm run build` 生成 `out/`；多行 bash run 步骤在 Windows runner 上必须显式 `shell: bash`（默认 pwsh 解析不了 bash 语法）。产物命名规范：**平台-v版本-架构.扩展名**（如 `win-v0.2.0-x64.exe`、`linux-v0.2.0-x64.deb`）。⚠️ electron-builder 的 `${arch}` 变量在不同 target 上渲染不一致（deb→`amd64`、AppImage→`x86_64`、exe→`x64`），为保证命名统一，`electron-builder.yml` 的 `artifactName` 模板中架构是写死的 `x64`；将来增加 arm64 构建时需改为按 target 分别配置或恢复 `${arch}`。

## 架构

三进程模型，**渲染进程不直接触碰文件系统 / git / 网络**，一切经 IPC：

```
src/
├─ main/                  # 主进程：一切 fs/git/GitHub API/凭据操作的唯一入口
│  ├─ index.ts            # 应用生命周期、单实例、窗口
│  ├─ ipc/registerIpc.ts  # IPC handler 注册（按域划分通道）
│  ├─ services/           # workspace / vaults / fsTree / trash / favorites
│  │                      # / gitService / github / account / settings
│  │                      # / watcher(chokidar) / pluginHost
│  └─ lib/                # errMessage / jsonStore / logger(脱敏) / paths
├─ preload/index.ts       # contextBridge 暴露类型化 IPC API（window.trace）
├─ renderer/src/          # 纯 UI
│  ├─ views/              # EditorView / SettingsView / TrashView / WelcomeView
│  ├─ components/         # SideBar / VaultNode / MarkdownEditor / MarkdownPreview 等
│  ├─ stores/             # pinia：app / tree / editor / git / trash / nameDialog
│  ├─ composables/        # actions.ts（菜单/操作逻辑）
│  └─ styles/             # main.css / markdown.css / themes.css（全部颜色走 CSS 变量）
└─ shared/                # 主/渲染进程共用
   ├─ api.ts              # TraceApi 接口定义（preload 实现它）
   ├─ types.ts            # 所有 IPC 数据类型
   └─ validate.ts         # 名称校验规则（前后端共用，保证一致）
```

- **IPC 通道按域划分**：`workspace:*`、`vault:*`、`fsTree:*`、`trash:*`、`favorite:*`、`git:*`、`account:*`、`settings:*`；主 → 渲染事件：`fs:changed`（外部改动）、`git:progress`、`git:conflict`。
- **磁盘布局**：工作区（默认 `~/Trace`）下每个笔记库 = 一个 git 仓库；回收站在 `<工作区>/.trash/`；应用元数据（设置、收藏、最近打开、凭据）存 Electron `userData` 目录的 JSON 文件，**绝不写入笔记库**。
- 新增 IPC 能力的路径：先在 `shared/types.ts` 定类型、`shared/api.ts` 加方法签名 → 主进程 `services/` 实现 → `ipc/registerIpc.ts` 注册 → `preload/index.ts` 暴露 → 渲染进程经 `window.trace` 调用。

## 必须遵守的设计原则

这些原则来自需求文档，改动任何相关代码前先理解：

1. **文件是唯一事实来源**。笔记和图片都是磁盘上普通文件；应用元数据与笔记数据严格分离，不得污染笔记库（避免污染 git 仓库）。
2. **不悄悄丢数据**。保存有外部修改保护（磁盘内容 hash 比对：无冲突静默重载，有未保存改动给用户选择，本地保存时 hash 不一致拒绝写入）；删除一律先进回收站 `.trash/`（还原冲突自动加后缀，不覆盖）；危险操作红色警示 + 确认弹窗。
3. **对普通用户友好**。用户无需理解 git 也能完成同步（一键：提交 → rebase 拉取 → 推送）；关键流程有分步引导。
4. **令牌安全**。GitHub PAT 存 `safeStorage`，仅通过每次调用注入 `http.extraheader`，**绝不写入 `.git/config`**；日志统一脱敏（`lib/logger.ts`），任何新日志不得输出令牌。
5. **校验规则前后端一致**。名称校验（非法字符、Windows 保留名、重名大小写不敏感、文件夹最多 6 层、附件目录最多 4 层）集中在 `src/shared/validate.ts`，主进程与渲染进程共用——不要在单侧另写一套规则。

## 代码约定

- 注释、文档、UI 文案、commit message 均使用**中文**（与现有代码保持一致）。
- UI 用语：一律用「文件夹」（不用「子目录」）、「笔记库」；删除类菜单项红色警示。
- `el-tooltip` **只允许包裹非交互元素**（图标、纯文本）。禁止：tooltip 嵌套 tooltip；tooltip 包裹按钮（点击被拦截）；tooltip 包裹 `el-dropdown` 触发器（下拉事件绑定失效，菜单弹不出）。需要给按钮/触发器加提示时用原生 `title`。任何「点击后移除下拉菜单锚点元素」的操作（删除行、收起容器等）需延迟 ≥300ms 或保持锚点可见（参考 `menu-hold` 模式），否则 popper 会在左上角闪现残影。
- 全界面颜色必须走 CSS 变量（`--bg-*` / `--text-*` / `--accent` / `--danger` 等），新增颜色先看 `styles/themes.css` 是否已有对应变量；Element Plus 变量映射到同一套变量。
- 代码风格由 ESLint + Prettier 约束（`.prettierrc.json`）；提交前至少跑 `npm run lint` 与 `npm run typecheck`。
- 核心服务（gitService、trash、favorites、validate、pluginHost 等）有单元测试（`tests/`，Vitest，39 项含 git 同步/冲突集成测试）；修改这些服务时同步补充/更新测试。
  ⚠️ Windows 上 `tests/gitService.test.ts` 的 6 项集成测试会因超出 Vitest 默认 5s 超时而失败：Windows 下每次 git 子进程调用约 1~1.7s（Linux 仅几十毫秒），完整关联+同步流程需 5~10s。功能本身正常（已手动复现验证），用 `npx vitest run --testTimeout=30000` 验证即可，勿误判为产品代码 bug。
  ⚠️ Linux（Ubuntu 24.04+，含本机 Ubuntu 26.04）重新 `npm install` 后 Electron 可能启动失败：`The SUID sandbox helper binary was found, but is not configured correctly`。原因是 AppArmor 限制非特权用户命名空间（`kernel.apparmor_restrict_unprivileged_userns=1`），npm 又总是以当前用户安装 `chrome-sandbox`（无法带 SUID 位）。修复：`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`（每次重装依赖后需重做）。
- 版本号在 `package.json`，是**唯一版本来源**：「关于 Trace」（`app.getVersion()`）、安装包文件名（electron-builder `artifactName`）、CI 工件命名全部自动读取它；git tag 必须与其一致（CI 在 tag 触发时会校验，不一致构建失败）。**发版流程**：更新 `CHANGELOG.md` → `npm version <patch|minor|major 或 x.y.z>`（自动改版本号 + commit + 打 `v` 标签，要求工作区干净；经 `postversion` 钩子自动 `git push --follow-tags` 触发 Release）。

## 已知局限（勿误判为新 bug）

- 列表项内的块级公式（`- $$...$$`）渲染不理想（markdown-it-texmath 局限）。
- 专注模式与悬浮预览在极窄窗口（<1080px）下编辑区最小宽度受限。
- 回收站无容量上限与过期自动清理。

## 二期规划（未实现，不要顺手实现）

全局搜索、所见即所得模式、图形化冲突解决、定时/变更自动同步、自定义主题包、插件完整 API 与市场、标签、多窗口、导出 PDF/HTML、窗口毛玻璃效果。
