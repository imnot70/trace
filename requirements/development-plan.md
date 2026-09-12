# Trace 开发计划

> 基于需求 `requirements/requirements.md` 与 2026-09-06 讨论结论制定。
> 讨论已确认的决策：**Electron + Vue 3**、**GitHub PAT 登录**、**源码编辑 + 实时预览**、**主题实做 / 插件预留**。

## 1. 技术选型

| 领域 | 选型 | 说明 |
| --- | --- | --- |
| 桌面框架 | Electron + electron-vite | 三端打包成熟，插件生态天然适配 JS |
| 前端 | Vue 3 + TypeScript + Pinia + Vite | |
| 组件库 | Element Plus | 树、下拉菜单、对话框、右键菜单齐全，中文文档好 |
| 编辑器 | CodeMirror 6（`@codemirror/lang-markdown`） | 源码模式编辑 |
| 预览渲染 | markdown-it + KaTeX + highlight.js | `$...$` 行内公式、`$$...$$` 块级公式 |
<<<<<<< Updated upstream
| Git | 系统 git + simple-git | 启动时检测 git 是否安装，缺失时引导安装 |
=======
| Git | 系统 git + simple-git；内置 Git（FR-2.8.13，见 [bundled-git-design.md](2026-09-10_bundled-git/bundled-git-design.md)） | 触发关联/同步时检测：优先系统 git，未安装时使用内置 git |
>>>>>>> Stashed changes
| GitHub API | octokit（REST） | 校验 Token、列出/创建远程仓库 |
| 凭据存储 | Electron `safeStorage` | Windows DPAPI / macOS Keychain / Linux libsecret |
| 文件监听 | chokidar | 感知 git pull / 用户在应用外的改动 |
| 打包 | electron-builder | Windows NSIS、macOS DMG、Linux deb（Ubuntu/Debian） |

## 2. 总体架构

### 2.1 进程划分

- **主进程**：一切文件系统 / git / 网络（GitHub API）/ 凭据操作的唯一入口；设置持久化；主题与插件加载。
- **preload**：`contextBridge` 暴露类型化 IPC API，`contextIsolation` 开启。
- **渲染进程**：纯 UI（侧栏、编辑器、预览、设置页），不直接触碰 fs/git。

IPC 通道按域划分：`workspace:*`、`vault:*`、`fsTree:*`（子目录/笔记）、`trash:*`、`favorite:*`、`git:*`、`account:*`、`settings:*`。主进程 → 渲染进程事件：`fs:changed`（外部改动）、`git:progress`、`git:conflict`。

### 2.2 磁盘布局

```
<工作区根目录>/              # 默认 ~/Trace，可在设置中修改
 ├─ 笔记库A/                # 每个笔记库 = 一个独立 git 仓库（未关联远端即纯本地库）
 │  ├─ 一级子目录/
 │  │  └─ 笔记.md
 │  ├─ attachments/         # 库级附件目录（v1 支持粘贴图片）
 │  └─ ...
 └─ .trash/                 # 应用级回收站（应用管理，不进任何 git 仓库）
```

应用自身元数据（工作区路径、库注册表、收藏、最近打开、设置、凭据引用）存放在 Electron `userData` 目录的 JSON 文件中，**不**写入笔记库（避免污染 git 仓库）。

### 2.3 代码结构

```
trace/
├─ electron.vite.config.ts
├─ src/
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ ipc/            # IPC handler 注册（按域拆分）
│  │  ├─ services/       # workspace / vaults / fsTree / trash / favorites
│  │  │                  # / gitService / github / settings / themes / pluginHost
│  │  └─ lib/            # 文件名校验、路径工具、日志
│  ├─ preload/index.ts
│  └─ renderer/src/
│     ├─ views/          # Sidebar / EditorView / TrashView / SettingsView
│     ├─ components/     # 树节点（含齿轮/加号悬浮按钮）、对话框等
│     ├─ stores/         # pinia：workspace / tree / editor / settings
│     └─ styles/themes/  # 主题 CSS 变量集
```

## 3. 关键技术方案

### 3.1 命名与重名校验（`main/lib` 统一实现）
- 非法字符：`/ \ : * ? " < > |`、控制字符；首尾空格与 `.`；Windows 保留名（CON、PRN、AUX、NUL、COM1-9、LPT1-9）。
- 重名规则：笔记库之间全局唯一（大小写不敏感）；子目录/笔记在同一父目录内唯一（大小写不敏感，兼容 Mac/Windows 大小写不敏感文件系统）。笔记名即文件名（自动加 `.md`）。
- 子目录深度上限 6 层（不含笔记库），UI 禁用入口 + 后端双重校验，超限提示「已达最大层数」。

### 3.2 回收站
- 删除 = 移动到 `<工作区根目录>/.trash/<时间戳>-<名称>/`，索引文件记录原路径、类型、删除时间。
- 支持「还原」（移回原路径，原路径冲突时自动加后缀）与「彻底删除」。库/目录/笔记删除统一走此通道；笔记删除前弹确认框，库/目录含内容时提示连带删除。

### 3.3 收藏与常用
- 收藏：按「库名 + 笔记路径」引用，重命名/移动/删除时同步维护（改名跟随、失效清理）。
- 常用：最近打开笔记列表（按时间倒序，上限 20 条）。

### 3.4 Git 同步
- **关联**：库设置 → 校验登录态（未登录提示先登录）→ octokit 拉取用户仓库列表选择，或新建仓库 → 本地已有内容则首次 push，远端有内容则首次 pull。
- **同步**（库上的「同步」按钮）：`fetch` → `pull --rebase` → `add -A` → `commit`（固定格式 message）→ `push`；任一步失败即停止并上报。
- **冲突**：rebase 冲突时中止并提示用户，标注冲突文件；v1 不做图形化冲突解决（二期）。
- **Token 安全**：Token 存 `safeStorage`，git 操作通过每次调用的 `http.extraheader` 注入 Authorization，**绝不**写入 `.git/config`；日志脱敏。库内设置 `core.quotepath false` 保证中文文件名显示正常。

### 3.5 编辑器与预览
- 左侧 CodeMirror 6 源码编辑，右侧 markdown-it 渲染预览；简易滚动同步。
- 自动保存：变更后 1s 防抖写盘 + 切换笔记时强制保存；外部修改时提示重载（文件未在应用内修改过则静默重载）。
- 图片：粘贴/拖入图片 → 存入 `库/attachments/`，插入相对路径引用。

### 3.6 主题
- 全部颜色/字号收敛为 CSS 变量；内置浅色/深色两套 + 跟随系统；设置页切换。为后续「自定义主题包」留接口（主题 = 一组 CSS 变量文件）。

### 3.7 插件（v1 仅骨架）
- 定义清单格式（manifest.json：id/名称/版本/入口/权限声明）与加载器流程；API 骨架（命令注册、事件订阅接口的类型定义）。
- 设置页提供插件管理界面雏形（列表/启停开关）；不开放第三方插件加载，不建市场。

## 4. 里程碑

> 相对体量：S = 1~2 天，M = 3~5 天，L = 1~2 周（单人）

### M0 项目骨架（S）
- electron-vite + Vue3 + TS + Pinia + Element Plus 脚手架；主/preload/渲染三层 IPC 打通；eslint + prettier；electron-builder 三平台打包脚本可用（至少本机 Linux 验证）。
- **验收**：应用可启动，显示左右分栏空壳，`deb` 包可安装运行。

### M1 工作区与库/目录/笔记管理（L）
- 工作区根目录选择与校验；笔记库/子目录/笔记的创建、重命名、删除（含重名校验、非法字符校验、6 层深度限制）；左侧树 UI（悬浮齿轮/加号按钮、展开收起）；chokidar 监听外部变更并刷新树。
- **验收**：不用编辑器也能完整管理目录树；重名/非法名被拦截并有提示；应用外增删文件能实时反映。

### M2 编辑器与预览 + 收藏/常用（L）
- CodeMirror 编辑 + markdown-it/KaTeX/highlight 预览、自动保存、外部修改处理、图片粘贴到 attachments。
- 收藏/取消收藏 + 左侧收藏列表；常用（最近打开）列表。
- **验收**：Markdown 与 LaTeX 公式正确渲染；编辑自动保存；收藏与最近打开工作正常。

### M3 回收站（S）
- 删除流程全部接入回收站；回收站视图（列表、还原、彻底删除、清空）。
- **验收**：三类对象删除后可在回收站看到并可还原；原路径冲突时还原不丢数据。

### M4 Git 同步（L）
- 设置页 GitHub PAT 登录（safeStorage 存储、Token 校验）；库关联远程仓库（选已有/新建）；同步按钮（pull→commit→push）与状态展示；冲突检测与提示。
- **验收**：两个设备（或两个工作区）通过同一 GitHub 仓库完成双向同步；无 Token 时关联功能正确引导登录。

### M5 主题 + 系统设置 + 发布（M）
- 主题系统（浅/深/跟随系统）；系统设置页（工作区路径、主题、编辑器字号、自动保存开关）；应用图标、关于页；electron-builder 三端产物 + Ubuntu deb 实测。
- **验收**：Windows/macOS/Linux 均有可安装包，主题切换全局生效。

### M6 插件骨架（S）
- manifest 规范、加载器、API 类型骨架、设置页插件管理雏形；开发者文档一篇。
- **验收**：内置示例插件（demo）可被加载器识别并出现在管理列表（能力受限）。

### 二期 Backlog（不进 v1）
全局搜索、所见即所得模式、图形化冲突解决、定时/变更触发自动同步、自定义主题包导入、插件市场与完整插件 API、标签系统、多窗口、Markdown 导出（PDF/HTML）。

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 用户机器没有 git（尤其 Windows） | 启动检测；缺失时设置页给出安装指引并禁用同步功能（其余功能不受影响） |
| Linux 无 gnome-keyring 时 safeStorage 不可用 | 降级为加密文件存储并提示安全等级下降 |
| Token 泄露到仓库或日志 | 永不写入 .git/config；日志统一脱敏层 |
| 大小写不敏感文件系统导致重名漏洞 | 所有重名校验大小写不敏感 |
| git 操作与 chokidar 事件互相触发 | 同步期间挂起监听回调，操作完成后统一刷新一次 |
| 中文文件名在 git 输出中转义乱码 | 库内设置 `core.quotepath false` |

## 6. 待确认项

1. **应用显示名**：仓库名 trace，参考图上叫 NoteFlow——UI 与安装包名用哪个？（默认用 Trace，仅一处常量，随时可改）
2. 建议回填需求文档的补充项（已按默认方案纳入计划）：图片粘贴/附件、回收站还原与彻底删除、「常用」= 最近打开、v1 不做全局搜索。
