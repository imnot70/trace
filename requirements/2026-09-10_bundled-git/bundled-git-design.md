# 内置 Git 设计与实施方案

> 状态：**已实施（2026-09-11）**——Windows 平台已完整验证；Linux 待 CI 验证
> 关联：FR-2.8（Git 云同步）；FR-2.8.13（内置 Git）
> 涉及代码：`scripts/fetch-git.mjs`、`src/main/services/bundledGit.ts`、`src/main/services/gitService.ts`、`electron-builder.yml`、`.github/workflows/build.yml`
> 起草：2026-09-10 ｜ 最后更新：2026-09-11（实施完成 + 实测数据校正）

---

## 1. 背景与动机

### 1.1 现状

Trace 的 Git 同步功能原本依赖用户自行安装系统 Git（`simple-git` 包装系统 `git` 命令）。非技术用户常卡在「请先安装 Git」这一步，核心同步工作流在最后环节断裂。

**关键区分**：GitHub 账号登录（PAT 校验）通过 octokit REST API 完成，**不需要** git 二进制；只有笔记库的关联、同步与状态查询才需要 git 二进制。

### 1.2 问题

- **安装门槛高**：Windows 用户需下载 ~60 MB 安装包并走多步配置向导。
- **版本碎片化**：用户机器上的 Git 版本不可控，行尾处理、编码等行为差异增加排查成本。
- **首次体验断裂**：新建笔记库 → 关联远程仓库 → 点同步 → 弹出「请先安装 Git」。
- **同类产品参考**：Obsidian、VS Code、GitHub Desktop 均已内置或半内置 git。

### 1.3 目标

使 Trace 在无系统 Git 的环境下也能完成完整同步工作流，同时保留使用系统 Git 的能力（给有自定义需求的高级用户）。

---

## 2. 三条技术路线对比

### 2.1 路线 A：捆绑 Git 二进制（MinGit / dugite-native）✅ 采用

**原理**：随应用分发精简 Git，`simple-git` 调用时优先使用内置 git，fallback 到系统 git。

| 维度 | 评估 |
|---|---|
| **成熟度** | Windows 用 MinGit（Git for Windows 官方精简发行版）；Linux/macOS 用 dugite-native（GitHub Desktop 同源，运行数年） |
| **安装包增量** | **实测 +19.6 MB（+15.7%）**，见第 5 节 |
| **功能覆盖** | 完整 CLI 能力（clone/fetch/push/rebase），与系统 git 行为一致 |
| **侵入性** | **低**：仅改动 `gitService.ts` 的 binary 解析，业务逻辑零改动 |
| **维护成本** | 中：需跟踪 Git 安全补丁（约每季度），见 6.2 |

### 2.2 路线 B：纯 JavaScript（isomorphic-git）— 重新评估后仍不采用

初版分析以「不支持 SSH」为否决理由，但该理由对 Trace **不成立**（同步走 HTTPS + PAT）。故基于其余维度重新判断：

| 维度 | 评估 |
|---|---|
| **安装包增量** | ~0 MB（最大优势） |
| **功能覆盖** | ⚠️ **rebase 支持不完整**——而 Trace 同步语义正是「提交 → **rebase 拉取** → 推送」（FR-2.8.5） |
| **侵入性** | **高**：需完全重写 `gitService.ts`（当前依赖 CLI 输出解析：冲突文件列表、`ls-remote` 等），并重建错误文案映射（FR-2.8.10） |

**结论**：不采用。体积优势显著且 SSH 理由不成立，但 rebase 支持直接冲击核心同步语义。列为**远期候选**，待 isomorphic-git 补齐 rebase 后重评。

### 2.3 路线 C：原生绑定（nodegit / libgit2）

nodegit 活跃度低，需为每个 Electron 版本编译原生模块，Electron 升级频繁导致维护痛苦。**不推荐**。

---

## 3. 采用方案：捆绑二进制 + 触发时检测

### 3.1 核心策略：触发时检测 + 条件弹窗

不在启动时打扰用户；仅在用户触发需要 git 的操作时检测引导。

```
用户触发关联/同步 → 检测系统 git 是否可用？
├─ 是 → 直接使用系统 git（静默，无提示）
└─ 否 → 检测内置 git 是否存在？
    ├─ 是 → 弹窗询问：「未检测到系统 Git，是否使用内置 Git？」
    │       ├─ 选择「使用内置 Git」→ 记入偏好，继续操作
    │       └─ 选择「取消」→ 中止本次操作
    └─ 否 → 弹窗提示：「需要安装 Git」+ 平台安装指引（降级兜底）
```

| 通道 | 改动 |
|---|---|
| `git:associate` / `git:sync` | 调用前检测，不可用时弹窗 |
| `git:status` | 不可用时返回降级状态，不弹窗 |
| `account:login` | **无需改动**（octokit REST，不需要 git） |

登录与同步**完全解耦**：用户可先登录再补 git，或反之。

### 3.2 弹窗交互

**场景 1（无系统 git + 有内置）**：「未检测到系统 Git / 检测到应用已内置 Git，可直接使用」→ 选择「使用内置 Git」后记入偏好，后续不再弹窗；「取消」则不保存选择（下次重新弹）。

**场景 2（两者均无）**：提示安装 Git 并给出平台指引（Windows: git-scm.com；macOS: brew；Linux: apt）。此路径为**降级兜底**，正常安装包不会走到。

**场景 3（有系统 git）**：无弹窗，静默使用系统 git。

### 3.3 用户偏好持久化

`AppSettings` 新增 `gitSource: 'system' | 'bundled' | null`：

- `null`（默认）：按 3.1 逻辑检测；系统 git 可用则记 `system`，否则弹窗
- 已做出选择：直接使用对应来源，不再弹窗
- 设置页提供「重置选择」，回到 `null`

### 3.4 三平台运行时选型（实测）

| 平台 | 采用资产 | 归档大小 | 解压后 | 入口 |
|---|---|---|---|---|
| **Windows x64** | `MinGit-2.55.0.5-busybox-64-bit.zip` | **32.9 MB** | **82 MB** | `cmd/git.exe` |
| **Linux x64** | `dugite-native-v2.53.0-4-ubuntu-x64.tar.gz` | 62.2 MB | 待实测 | `bin/git` |
| macOS arm64/x64 | dugite-native | 59.5 / 63.1 MB | — | — |

**说明**：

- Windows 用 **busybox 版 MinGit**（不含 GUI / Bash / Perl，Trace 均不需要）。已实测 `cmd/git.exe` 可执行：`git version 2.55.0.windows.5`，`init` / `status` / `add` / `commit` / `push` 均正常。
- Linux 归档下载体积（62.2 MB）不决定安装包体积——**安装包会重新压缩载荷**，见 3.5。
- **macOS 不内置**：Trace 的 macOS 当前仅支持源码构建（见 README），`fetch-git.mjs` 对未配置平台将跳过并回落到系统 git。
- **待查**：`ubuntu-x64` 归档（62.2 MB）远大于 `ubuntu-arm64`（22.1 MB），疑似 x64 构建附带 Git LFS / Credential Manager。可探索更精简的 x64 构建以缩短 CI 下载时间。

### 3.5 交付方式：随包内置 + build 时解压（决策）

#### 为什么不是「捆绑压缩归档 + 首次运行解压」

初版设计（D-BG8 原始版）选择运行时解压，理由是「直接捆绑解压后目录会让安装包涨到 150–200 MB」。**该前提不成立**：

1. 「解压后 150–200 MB」的估计有误——Windows MinGit 实测解压后为 **82 MB**；
2. 更重要的是，**安装包本身就会压缩载荷**（NSIS 用 LZMA、deb 用 xz、AppImage 用 squashfs），因此捆绑解压后的目录，安装包增量仍约等于压缩后大小。

#### 两种方案对比（Windows 实测）

| | 运行时解压（原 D-BG8） | **build 时解压（采用）** |
|---|---|---|
| 安装包增量 | +32.9 MB（压缩归档不可再压） | **+19.6 MB（实测）** |
| 安装后磁盘 | **+115 MB**（归档 32.9 + 解压 82） | **+82 MB** |
| 运行时解压代码 | 需要（~80 行 + 解压依赖） | **零** |
| 首次同步延迟 | 有（解压 82 MB） | **无** |
| 打包复杂度 | 高 | **低** |

build 时解压**同时更小、更简单**：安装包增量反而比捆绑归档更小（+19.6 vs +32.9 MB），因为 NSIS 的 LZMA 整体压缩优于上游 zip 的逐文件 deflate。

**决策（D-BG8 修订版）**：采用 build 时解压——归档在构建机上解压到 `vendor/git/<platform>/`，electron-builder 以 `extraResources` 收进 `resources/git/`；运行期不写一行解压代码。

#### 代价

- **安装后磁盘 +82 MB**（不可压缩）。
- **macOS 需对 bundle 内二进制签名**才能公证——但 macOS 不内置，当前无影响；将来若内置需处理。
- 安装包体积 +15.7%（125.0 → 144.6 MB）。

---

## 4. 实现（已落地）

### 4.1 二进制获取：`scripts/fetch-git.mjs`

**二进制不入库**（避免 ~76 MB 二进制永久留在 git 历史）。脚本负责：

1. 按平台下载固定版本的归档（URL 与 SHA256 均 pin 在脚本中）
2. **校验 SHA256**，不匹配即中止（fail-closed）
3. 解压到 `vendor/git/<platform>/`
4. 若归档多套一层顶层目录，则上移一层
5. **实际执行一次 `git --version` 验证**（宿主平台一致时）——布局错误会在构建期暴露，而不是静默打包出不可用的 git
6. 删除归档（内容已落地，保留只会让 vendor/ 翻倍）

幂等：已存在可执行文件时跳过（`--force` 可强制重取）。未配置的平台（macOS）跳过并提示回落系统 git。

`vendor/` 已加入 `.gitignore`。

### 4.2 运行时定位：`src/main/services/bundledGit.ts`

纯函数，全部有单测覆盖：

- `bundledGitCandidates(platform)` — 候选入口列表。**不假定目录布局**：Windows `cmd/git.exe` → `mingw64/bin/git.exe`；Linux/macOS `bin/git` → 根目录 `git`。
- `resolveBundledGitPath(resourcesPath, platform)` — 按候选顺序探测，返回首个存在的绝对路径。
- `pickGitBinary(gitSource, bundledPath)` — `system` → `null`（走 PATH）；`bundled`/`null` → 优先内置，内置缺失则回落系统 git（避免彻底不可用）。
- `parseGitVersion(stdout)` / `readGitVersion(binary)` — 版本探测，供设置页展示。

### 4.3 接入 `gitService.ts`

`GitDeps` 新增可选 `getGitBinary?: () => string | null`（可选，避免破坏既有测试）。新增 `gitOptions()` 统一构造 `simpleGit` 参数，`git()` 与 `testProxy()` 共用。

业务逻辑（config 注入、超时、冲突处理）**零改动**。

### 4.4 ⚠️ 关键坑：simple-git 的 `binary` 字符白名单

simple-git 对 `binary` 做字符校验：

```js
/^([a-z]:)?([a-z0-9/.\\_~-]+)$/i
```

**不允许空格与非 ASCII 字符**。这意味着安装在 `C:\Program Files\…` 或中文用户名路径下，传入完整路径会抛：

```
Invalid value supplied for custom binary, restricted characters must be removed
or supply the unsafe.allowUnsafeCustomBinary option
```

**已实证**：不加该选项必抛，加了即通过。

**处置**：内置 git 时同时传 `unsafe: { allowUnsafeCustomBinary: true }`（失效时退化为 `console.warn`）。该路径来自 `process.resourcesPath`（应用自身、非用户输入），放行是安全的。代码中已就此写注释。

### 4.5 打包配置：`electron-builder.yml`

```yaml
win:
  extraResources:
    - from: resources/sample-plugin
      to: sample-plugin
    - from: vendor/git/win32
      to: git
```

⚠️ **平台段会覆盖顶层同名配置**：`extraResources` 必须在 `win` / `linux` / `mac` 各自声明，顶层声明在平台构建时会被整体丢弃（连示例插件一起丢）。已实测确认修正后 `resources/` 同时含 `git` 与 `sample-plugin`。

### 4.6 CI：`.github/workflows/build.yml`

在 electron-builder 之前插入两步：

- **缓存** `vendor/git`，key 关联 `scripts/fetch-git.mjs` 的哈希（改动 pin 自动失效重取）
- **`npm run fetch:git`** — 不传 `--platform`，脚本默认取宿主平台，与 matrix 构建目标一致

`package.json` 的 `dist` / `dist:dir` / `dist:deb` 均已前置 `npm run fetch:git`。

### 4.7 改动量

| 模块 | 实际改动 |
|---|---|
| `scripts/fetch-git.mjs` | 新增（~230 行） |
| `src/main/services/bundledGit.ts` | 新增（~75 行） |
| `gitService.ts` | +25 行（binary 注入 + unsafe 放行） |
| `index.ts` / `registerIpc.ts` | +20 行（装配 + 真实检测） |
| `electron-builder.yml` / CI / package.json | 配置调整 |
| 单测 | +16 项（纯函数 14 + 内置 git 真实同步 2） |

---

## 5. 实测结果与验证

### 5.1 安装包体积（Windows，实测）

|版本 | 安装包 |
|---|---|
| 内置前（v0.3.8） | **125.0 MB** |
| 内置后 | **144.6 MB** |
| **增量** | **+19.6 MB（+15.7%）** |

优于初版估算（+32.9 MB / +26%）。

其他体积：`vendor/git/win32` 解压后 82 MB；`dist/win-unpacked` 整体 539 MB。

### 5.2 已验证项（Windows 本机）

- ✅ 脚本下载 / SHA256 校验 / 解压 / 幂等跳过
- ✅ `git --version` 输出 `2.55.0.windows.5`
- ✅ `simple-git` + `binary` + `unsafe` 组合调用成功
- ✅ `unsafe` 缺失时确实抛错、添加后通过（坑已闭环）
- ✅ 打包产物 `resources/git/cmd/git.exe` 可执行
- ✅ 平台段 `extraResources` 未丢失 `sample-plugin`
- ✅ **内置 git 真实同步链路**：`associate` 空远端 → 提交 → push → 远端出现笔记（集成测试）
- ✅ 全部 78 项测试通过；typecheck 与 lint 通过

### 5.3 待验证项

- ⬜ **Linux 解压与 `bin/git` 入口**（需 CI 或 Linux 机器）——`fetch-git.mjs` 的 `--version` 验证会在失败时中断构建，属 fail-fast
- ⬜ **CI 流水线实际运行**（缓存命中、Windows runner 的 `fetch:git`）
- ⬜ **安装包端到端**：在无系统 Git 的干净机器上安装并完成一次真实同步
- ⬜ Linux 安装包体积实测（预期 deb 增量约 +20~40 MB）

---

## 6. 技术难点与风险

### 6.1 包体积

见 5.1。安装包 +15.7%（可接受），但**安装后磁盘 +82 MB**（不可压缩）。缓解：NSIS 可选组件（未实施，见 7.2）。

### 6.2 Git 版本管理与安全更新

- 每个安全发布（约每季度）需更新 `fetch-git.mjs` 中的 URL 与 SHA256，并重跑打包验证。
- 用户长期不更新应用会导致内置 Git 版本过旧。
- 对策：跟踪 git-security 邮件列表；可在设置页对已知高危版本标红警告（未实施）。

### 6.3 Linux 兼容性与布局

- dugite-native 已链接较低 glibc 基线；`bin/git` 布局**尚未在本机验证**，但候选探测 + 构建期 `--version` 校验可兜住布局差异。

### 6.4 低风险项

| 问题 | 结论 |
|---|---|
| `simple-git` 兼容性 | 支持 `binary`；字符校验坑见 4.4 |
| SSH 密钥 | 内置 git 使用系统 `~/.ssh/`，Trace 实际走 HTTPS + PAT |
| Credential Manager / LFS | Trace 未使用 |
| 行尾 / 编码 | `core.autocrlf=false` 在应用层强制，与来源无关 |
| 可执行位 | tar 解压保留权限；Windows 无此概念 |

---

## 7. 实施计划与状态

### 7.1 已完成

| 阶段 | 状态 |
|---|---|
| P0 二进制准备（下载 / 校验 / 体积核对） | ✅ Windows 完成；Linux 待 CI |
| P1 获取脚本 + 解压 + 路径解析 | ✅ |
| P2 检测与弹窗 + 偏好持久化 | ✅ |
| P3 打包集成（`extraResources` + 体积实测） | ✅ Windows |
| P4 设置页 Git 信息（来源 + 版本） | ✅ |
| P5 CI（缓存 + fetch 步骤） | ✅ 代码就绪，待实跑 |
| P6 三平台测试 | 🟡 Windows 完成；Linux/macOS 待办 |

### 7.2 后续可选

- **NSIS 可选组件**：默认勾选「内置 Git 同步支持」，允许用户取消以缩小体积（取消后走场景 2 降级引导）。需将 `extraResources` 改为 NSIS `File` 指令，改动量中等。
- **设置页高危版本告警**（见 6.2）。
- **Linux x64 归档瘦身**（见 3.4 待查项），可缩短 CI 下载时间。

---

## 8. 决策记录

| # | 问题 | 决策 |
|---|---|---|
| D-BG1 | 是否内置 Git？ | **是**：消除首次体验断裂 |
| D-BG2 | 交付方式？ | **随安装包内置**（非按需下载）：体积代价换取零运维、无供应链下载风险、离线/企业可用 |
| D-BG3 | 是否允许切换？ | **允许**：设置页可重置选择 |
| D-BG4 | 版本跟踪策略？ | **跟踪最新安全版** |
| D-BG5 | 检测时机？ | **触发关联/同步时**，不打扰不用同步的用户 |
| D-BG6 | 弹窗行为？ | **记住选择 + 可重置** |
| D-BG7 | 与 GitHub 登录的关系？ | **完全解耦**（登录走 REST，不需要 git） |
| D-BG8 | 打包形态？ | **build 时解压、捆绑目录**（修订原「运行时解压」）：实测更小（+19.6 vs +32.9 MB）、更简单（运行期零解压代码）、省 33 MB 磁盘 |
| D-BG9 | 是否改用 isomorphic-git？ | **否**（当前）：SSH 理由不成立，但 rebase 支持不完整，冲击 FR-2.8.5；列为远期候选 |
| D-BG10 | Windows 发行版？ | **MinGit busybox**（32.9 MB，已实测可执行） |
| D-BG11 | 二进制是否入库？ | **不入库**：`vendor/` gitignore，由 `npm run fetch:git` 获取，避免 ~76 MB 二进制进入 git 历史 |

---

## 9. 替代方案（不推荐，记录）

| 方案 | 不推荐理由 |
|---|---|
| isomorphic-git | rebase 支持不完整、需重写已验证的 `gitService` 与错误映射（SSH 缺失对 Trace 不构成理由） |
| nodegit（libgit2） | Electron 版本绑定、维护成本极高 |
| 仅优化安装引导 | 未解决根本问题 |
| 按需下载内置 Git | 引入动态执行未签名二进制的供应链风险 + 托管运维成本 + 弱网/企业不可用 |
| 运行时解压（原 D-BG8） | 安装包增量反而更大（+32.9 vs +19.6 MB），且多 33 MB 磁盘与一套解压代码 |
