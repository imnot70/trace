# 内置 Git 可行性分析与技术方案

> 状态：**设计已确认（2026-09-10）**——交付方式已定（方案 A：随包内置），待实施
> 关联：FR-2.8（Git 云同步）；FR-2.8.13（内置 Git）；当前实现 `src/main/services/gitService.ts`（simple-git 包装系统 git）
> 起草：2026-09-10 ｜ 最后更新：2026-09-10（体积数据实测修正 + 交付方式对比）

---

## 1. 背景与动机

### 1.1 现状

Trace 的 Git 同步功能依赖用户自行安装系统 Git。当前实现通过 `simple-git`（Node.js 的 git CLI 薄包装层）调用系统 `git` 命令。应用启动时检测 git 是否存在，缺失时在设置页给出安装指引并禁用同步功能。

**关键区分**：GitHub 账号登录（PAT 校验）通过 octokit REST API 完成，**不需要** git 二进制；只有笔记库的关联（`git:associate`）、同步（`git:sync`）和状态查询（`git:status`）才需要 git 二进制。

### 1.2 问题

- **安装门槛高**：非技术用户面对「请先安装 Git」的提示往往不知所措，尤其 Windows 用户需要下载 ~60MB 安装包并经历多步配置向导。
- **版本碎片化**：用户机器上的 Git 版本不可控，不同版本的行为差异（如行尾处理、编码、SSH 实现）增加排查成本。
- **首次体验断裂**：新建笔记库 → 关联远程仓库 → 点同步 → 弹出「请先安装 Git」，核心工作流在最关键的一步断裂。
- **现有同类产品参考**：Obsidian（内置简单 Git 集成）、VS Code（内置终端 Git）、GitHub Desktop（完全内置 Dugite）均已解决此问题。

### 1.3 目标

评估「应用内置 Git 运行时」的可行性，使 Trace 在无系统 Git 的环境下也能完成完整的同步工作流，同时保留使用系统 Git 的能力（给有自定义需求的高级用户）。

---

## 2. 三条技术路线对比

### 2.1 路线 A：捆绑 Git 二进制（Dugite / MinGit）✅ 采用

**原理**：随应用分发一个精简的 Git 可执行文件，`simple-git` 在调用时优先使用内置 git，fallback 到系统 git。

| 维度 | 评估 |
|---|---|
| **成熟度** | GitHub Desktop 用 Dugite（基于 desktop/dugite-native）验证了这条路，已稳定运行数年 |
| **跨平台** | Windows（MinGit / Dugite-native 编译）、Linux（静态编译 musl / 预编译二进制）、macOS（arm64 + x64 双架构）均有现成构建方案 |
| **安装包增量** | **实测每平台 +33~43 MB**（压缩归档），详见 [3.4](#34-三平台-git-运行时选型) 与 [3.5](#35-交付方式随包内置-vs-按需下载决策) |
| **功能覆盖** | 完整 Git CLI 能力（clone/fetch/push/rebase/lfs/credential helper），与系统 git 行为一致 |
| **侵入性** | **低**：仅需修改 `gitService.ts` 中的路径解析逻辑，`simple-git` 无需替换 |
| **维护成本** | 中：需跟踪 Git 安全补丁版本更新（约每季度一次）；三平台构建流水线维护 |

**风险**：

| 风险 | 严重度 | 对策 |
|---|---|---|
| 包体积膨胀 | 中 | 捆绑压缩归档 + 首次使用解压；Windows 用 busybox 版 MinGit；安装向导可选组件 |
| 版本更新滞后 | 低 | 跟踪 Git 官方安全发布，纳入 CI 自动化更新流程 |
| Windows 下 PATH 冲突 | 低 | 内置 git 设置为最高优先级，通过 `GIT_EXEC_PATH` / 显式路径调用，不污染系统 PATH |
| Linux 下 glibc 版本绑定 | 中 | Dugite-native 已链接较低 glibc 基线；必要时静态编译（musl） |

### 2.2 路线 B：纯 JavaScript 实现（isomorphic-git）— 重新评估后仍不采用

**原理**：用 `isomorphic-git`（纯 JS/WASM）替代系统 git CLI，直接操作 `.git` 目录的底层对象。

> ⚠️ **2026-09-10 重新评估**：初版分析以「不支持 SSH」为主要否决理由，但该理由对 Trace **不成立**——Trace 的同步使用 **HTTPS + GitHub PAT**（FR-2.8.2），全程不涉及 SSH。因此需基于其余维度重新判断。

| 维度 | 评估 |
|---|---|
| **成熟度** | 有活跃社区，但 v1.7.5 后有 `readTree` 性能回归报告；大仓库场景未广泛验证 |
| **跨平台** | 天然跨平台（纯 JS），无需分平台打包二进制 |
| **安装包增量** | **~0 MB**（isomorphic-git 本身 ~2 MB，已在 npm 依赖中）——最大优势 |
| **功能覆盖** | ⚠️ rebase 支持不完整（Trace 同步语义为「提交 → **rebase 拉取** → 推送」，FR-2.8.5）；LFS / credential helper 缺失（Trace 未使用，影响小） |
| **性能** | 大仓库 / 大批量文件场景未验证；notes 库通常不大，风险可控但不确定 |
| **侵入性** | **高**：需完全重写 `gitService.ts`（当前依赖 CLI 输出解析，如冲突文件列表、`ls-remote`）；错误文案映射（FR-2.8.10）需重建 |
| **维护成本** | 中高：需自行适配 rebase 语义；缺少 CLI 的成熟错误信息 |

**结论**：**不采用**（在当前版本）。虽然体积优势显著且 SSH 理由不成立，但 **rebase 支持不完整**直接影响 FR-2.8.5 的核心同步语义，且需重写已验证的 `gitService` 与其错误文案映射。建议作为**远期候选**：待同步语义简化（如改为 merge）或 isomorphic-git 补齐 rebase 后重新评估。

### 2.3 路线 C：原生绑定（nodegit / libgit2）

**原理**：通过 Node.js 原生绑定调用 libgit2 C 库。

| 维度 | 评估 |
|---|---|
| **成熟度** | nodegit 项目活跃度低，Electron 版本兼容性问题频发 |
| **跨平台** | 需为每个 Electron/Node 版本编译原生模块，Electron 升级频繁导致维护痛苦 |
| **功能覆盖** | 较完整（libgit2 覆盖大部分 Git 操作），但 LFS / credential helper 需自行集成 |
| **侵入性** | **高**：完全不同的 API 体系，需全面重写 |
| **维护成本** | **极高**：Electron 每次大版本升级都可能 break 原生模块编译 |

**结论**：**不推荐**。维护成本与 Electron 版本绑定，是长期负担。

---

## 3. 推荐路线：A（捆绑 Git 二进制）+ 系统 Git 保留

### 3.1 核心策略：触发时检测 + 条件弹窗

**设计原则**：不在应用启动时打扰用户；仅在用户主动触发需要 git 的操作时，才检测并按需引导。

#### 检测与优先级逻辑

```
用户触发关联/同步 → 检测系统 git 是否可用？
├─ 是 → 直接使用系统 git（静默，无任何提示）
└─ 否 → 检测内置 git 是否存在？
    ├─ 是 → 弹窗询问：「未检测到系统 Git，是否使用内置 Git？」
    │       ├─ 用户选择「使用内置 Git」→ 切换到内置 git，继续操作
    │       └─ 用户选择「取消」→ 中止操作
    └─ 否 → 弹窗提示：「需要安装 Git 才能使用同步功能」+ 安装引导
```

#### 涉及的 IPC 通道

| 通道 | 当前行为 | 改动 |
|---|---|---|
| `git:associate` | 直接调用 `git.associate()` | 调用前检测 git 可用性，不可用时弹窗 |
| `git:sync` | 直接调用 `git.sync()` | 调用前检测 git 可用性，不可用时弹窗 |
| `git:status` | 直接调用 `git.status()` | 不可用时返回降级状态（`{ associated: false }`），不弹窗 |
| `account:login` | 通过 octokit REST API 校验 PAT | **无需改动**（登录不需要 git） |

#### 与 GitHub 登录流程的关系

```
用户操作流程：
1. 设置 → 账号 → 登录 GitHub（PAT）     ← 不需要 git，正常进行
2. 侧栏 → 笔记库 ⋮ → 关联 Git 仓库     ← 首次触发 git 检测
3. 编辑卡 → 同步                        ← 触发 git 检测
```

- 登录和同步是**解耦**的：用户可以先登录再安装 git，也可以先有 git 再登录
- 弹窗只在步骤 2/3 出现，不会在步骤 1 打扰用户
- 登录失败的错误信息保持不变（与 git 可用性无关）

### 3.2 弹窗交互设计

#### 场景 1：系统无 git + 内置 git 可用

```
┌──────────────────────────────────────────────┐
│  ⚠️ 未检测到系统 Git                           │
│                                              │
│  Trace 需要 Git 来完成笔记库的云端同步。       │
│  检测到应用已内置 Git，可直接使用。             │
│                                              │
│         [使用内置 Git]      [取消]             │
└──────────────────────────────────────────────┘
```

- 点击「使用内置 Git」：记住用户选择（持久化到 settings），后续同步自动使用内置 git，不再弹窗
- 点击「取消」：中止本次关联/同步操作，不保存选择（下次触发时重新弹窗）

#### 场景 2：系统无 git + 无内置 git

```
┌──────────────────────────────────────────────┐
│  ⚠️ 需要安装 Git                              │
│                                              │
│  Trace 需要 Git 来完成笔记库的云端同步。       │
│  请先安装 Git 后重试。                         │
│                                              │
│  · Windows：前往 git-scm.com 下载安装包       │
│  · macOS：终端执行 brew install git           │
│  · Linux：终端执行 sudo apt install git       │
│                                              │
│                        [知道了]               │
└──────────────────────────────────────────────┘
```

- 仅提供信息引导，不阻断应用其他功能
- 安装 git 后，下次触发同步时自动检测到系统 git，不再弹窗

> 说明：本场景是**降级兜底**。内置 git 后正常安装包不会走到这里；仅在用户使用「不含内置 Git」的可选安装（见 3.5.4）或内置归档损坏时出现。

#### 场景 3：系统 git 已安装（默认情况）

- **无弹窗**，直接使用系统 git，用户无感知
- 设置页可查看当前 git 来源（系统/内置）及版本号

### 3.3 用户偏好持久化

在 `AppSettings` 中新增字段：

```typescript
// settings.json
{
  "gitSource": "system" | "bundled" | null
  // null = 未做过选择（首次触发时弹窗）
  // "system" = 用户选择了系统 git（不再弹窗）
  // "bundled" = 用户选择了内置 git（不再弹窗）
}
```

- `null`（默认）：每次触发关联/同步时检测，系统 git 可用则静默使用；不可用则弹窗
- `"system"` / `"bundled"`：用户已做过选择，直接使用对应 git，不再弹窗
- 设置页提供「重置 Git 来源选择」按钮，将 `gitSource` 重置为 `null`

> ✅ **已实施**（2026-09-10）：`gitSource` 字段、`git:checkAvailability` IPC、触发时检测与弹窗、设置页「Git 信息」区块与重置按钮均已落地（届时内置 git 尚未捆绑，场景 1 不可达）。

### 3.4 三平台 Git 运行时选型

**实测体积**（2026-09-10 查询官方 release 资产）：

| 平台 | 推荐资产 | 实际大小 | 来源 |
|---|---|---|---|
| **Windows x64** | `MinGit-2.55.0.5-busybox-64-bit.zip` | **32.9 MB** | git-for-windows/git |
| Windows x64（标准版） | `MinGit-2.55.0.5-64-bit.zip` | 37.2 MB | git-for-windows/git |
| **macOS arm64** | `dugite-native-…-macOS-arm64.lzma` | **39.1 MB** | desktop/dugite-native |
| **macOS x64** | `dugite-native-…-macOS-x64.lzma` | **43.5 MB** | desktop/dugite-native |
| **Linux x64** | `dugite-native-…-ubuntu-x64.lzma` | **40.8 MB** | desktop/dugite-native |
| Linux arm64 | `dugite-native-…-ubuntu-arm64.lzma` | 9.6 MB | desktop/dugite-native |

**选型结论**：

- **Windows**：优先 **busybox 版 MinGit**（32.9 MB，省 4.3 MB）。MinGit 不含 Git GUI / Bash / Perl（Trace 均不需要），已是最贴合的精简发行版。
- **macOS**：dugite-native（GitHub Desktop 同源）。Trace 的 macOS 当前仅支持源码构建，优先级最低。
- **Linux**：dugite-native ubuntu-x64。
- **⚠️ 待查异常**：`ubuntu-x64`（40.8 MB）比 `ubuntu-arm64`（9.6 MB）大 4 倍，疑似 x64 构建额外打包了 Git LFS / Credential Manager。实施 P0 阶段应确认能否产出更精简的 x64 构建（潜在节省 ~30 MB）。
- **当前仅打包 x64**：与 electron-builder 现有配置一致（`artifactName` 硬编码 x64，见 AGENTS.md）。arm64 待有构建需求时再加。

### 3.5 交付方式：随包内置 vs 按需下载（决策）

这是在「路线 A 已定」的前提下，关于**何时获得二进制**的决策。

#### 3.5.1 体积实测数据

Trace 当前安装包（Windows 实测）：`win-v0.3.8-x64.exe` = **125.0 MB**。

| 平台 | 当前安装包 | 内置 Git 归档 | 内置后 | 增量 |
|---|---|---|---|---|
| Windows x64 | 125.0 MB（实测） | +32.9 MB（busybox） | **~158 MB** | **+26%** |
| Linux deb | ~130 MB（估算） | +40.8 MB | ~171 MB | **+31%** |
| Linux AppImage | ~160 MB（估算） | +40.8 MB | ~201 MB | **+26%** |
| macOS arm64 | ~180 MB（估算） | +39.1 MB | ~219 MB | **+22%** |

> 除 Windows 外为估算，实施前应实测。**前提**：捆绑**压缩归档**并在首次使用时解压；若直接捆绑解压后的目录，dugite 解压后约 150–200 MB，增量将翻数倍（不可接受）。

#### 3.5.2 按需下载（首次触发时下载）的问题

| 类别 | 问题 | 严重度 |
|---|---|---|
| **安全** | 应用运行时下载可执行文件并执行 = 远程代码执行面。MinGit / dugite **无 Authenticode 签名 / 未 notarize**，无法建立签名验证链，只能依赖 HTTPS + SHA256。托管服务器或 CDN 一旦被攻破即可分发恶意二进制（同类风险参见 `electron-updater` CVE-2024-39698） | 🔴 高 |
| **安全** | 杀软 / EDR 常拦截「应用下载并执行二进制」行为，可能静默阻断且难以排查 | 🟠 中高 |
| **可达性** | 需自建托管（对象存储 + CDN 成本）。用户能访问 GitHub ≠ 能访问我方下载源；国内网络尤甚 | 🟠 中高 |
| **企业环境** | 防火墙普遍禁止从互联网下载可执行文件，需另备离线包，反而增加复杂度 | 🟠 中 |
| **体验** | 点「同步」后不是立即同步，而是先等 ~33 MB 下载（慢网数分钟），预期落差大；需进度 UI + 失败引导 | 🟠 中 |
| **可靠性** | 需实现断点续传、重试、超时、半成品清理、SHA256 校验失败处理、磁盘空间检查 | 🟡 中 |
| **离线** | 无法使用任何 git 功能（含本地提交 / 历史查看——若将来扩展这些能力） | 🟡 中 |
| **实现复杂度** | 下载器 + 进度 IPC + 校验 + 解压 + 跨平台变体选择（macOS arm64/x64、Linux arch/glibc）+ 版本管理 + 清理；**另需托管基础设施与 CI 发布流程** | 🔴 高 |
| **合规** | GPLv2 分发义务（两种方案均需面对；按需下载时我方仍是分发者） | 🟡 中 |

#### 3.5.3 对比与决策

| 维度 | 方案 A：随包内置 | 方案 B：按需下载 |
|---|---|---|
| 安装包体积 | +22% ~ +31% | 0 |
| 首次使用等待 | 无（开箱即用） | 30 秒 ~ 数分钟 |
| 供应链安全面 | 低（随应用签名/公证一同验证） | **高**（动态执行未签名二进制） |
| 离线可用 | ✅ | ❌ |
| 企业环境 | ✅ | ❌（常被防火墙拦截） |
| 弱网体验 | ✅ | ❌ |
| 实现复杂度 | 中 | **高**（+ 托管基础设施） |
| 托管 / 运维成本 | 无 | 对象存储 + CDN + CI 发布 |
| 不用同步的用户 | 承担体积 | 不承担 |

**决策：采用方案 A（随包内置）。**

理由：方案 B 的唯一优势是体积；而它引入供应链安全面、显著实现复杂度，并牺牲弱网 / 离线 / 企业环境可用性。+26% 的 Windows 体积代价，相比「开箱即用 + 安全可验证 + 零运维」是划算的。同类桌面应用（Obsidian、VS Code、GitHub Desktop）均采用内置或半内置方案。

#### 3.5.4 内置的落地方式

1. **捆绑压缩归档，首次使用时解压**（而非捆绑解压后目录）——把安装包增量控制在 ~33 MB。
   - 归档随应用一起签名 / 公证，**无需下载时校验**（来源可信），比方案 B 简单得多。
   - 解压目标：`userData/git/`（`resources/` 在 macOS .app 与 Linux 安装目录下可能只读）。
   - 解压一次后记录版本标记（如 `userData/git/.trace-git-version`），后续启动跳过。
   - 可选：解压成功后删除安装目录内的归档以省磁盘（需权衡重装 / 修复场景）。
2. **安装向导可选组件**（Windows NSIS `components`）：默认勾选「内置 Git 同步支持」，用户可取消以缩小体积。取消则退回场景 2 的安装引导。
3. **Linux deb 的 `Recommends: git`**：作为系统包管理场景的补充引导（不替代内置）。

---

## 4. 代码层面改动评估

### 4.1 路径解析（`gitService.ts`）

```typescript
// 新增：内置 git 路径解析（含首次解压）
function resolveGitBinary(): string | undefined {
  // 1. 用户偏好为 bundled，或系统 git 不可用时 → 内置路径
  const bundled = path.join(app.getPath('userData'), 'git', gitExecutableName())
  if (fs.existsSync(bundled)) return bundled
  // 2. 系统 PATH 中的 git（simple-git 默认行为）
  return undefined
}
```

改动量：**~40 行**（含内置路径判断），影响范围极小。

### 4.2 首次解压逻辑（新增）

```typescript
/** 首次使用内置 git 时，从 resources/git/ 解压归档到 userData/git/ */
async function ensureBundledGitExtracted(): Promise<string | null> {
  const target = path.join(app.getPath('userData'), 'git')
  if (fs.existsSync(path.join(target, gitExecutableName()))) return target
  const archive = path.join(process.resourcesPath, 'git', archiveName())
  if (!fs.existsSync(archive)) return null          // 用户取消了可选组件
  await extract(archive, target)                     // zip / tar.gz
  await fs.promises.chmod(path.join(target, gitExecutableName()), 0o755)  // *nix 需可执行位
  return target
}
```

- Windows：`zip` 解压；macOS / Linux：`tar.gz`（Node 无内置 tar，需引入 `tar` 依赖或调用系统 `tar`）。
- 改动量：**~80 行**（含跨平台解压分支与可执行权限处理）。

### 4.3 git 检测与弹窗（主进程 + 渲染进程）

```typescript
// 主进程：新增 IPC 处理器
handle('git:checkAvailability', async () => {
  const systemGit = await checkSystemGit()          // simpleGit().version()
  const bundledGit = await ensureBundledGitExtracted() !== null
  return { systemGit, bundledGit }
})

// 渲染进程：触发关联/同步前调用
const { systemGit, bundledGit } = await window.trace.checkGitAvailability()
if (!systemGit && !bundledGit) {
  // 弹窗：需要安装 Git
} else if (!systemGit && bundledGit) {
  // 弹窗：是否使用内置 Git？
} else {
  // 静默继续
}
```

改动量：**~80 行**（主进程检测 + 渲染进程弹窗逻辑）。✅ 已实施。

### 4.4 设置页 Git 来源信息

```
Git 信息
├── 来源：系统 Git v2.43.0 / 内置 Git v2.53.0
├── 路径：/usr/bin/git 或 <userData>/git/git
└── [重置选择] 按钮（将 gitSource 重置为 null，下次触发时重新检测）
```

改动量：**~40 行** UI。✅ 已实施（版本号展示待内置 git 落地后补齐）。

### 4.5 打包配置（electron-builder.yml）

```yaml
# 按平台条件打包 Git 压缩归档
extraResources:
  - from: vendor/git/${platform}/      # 归档文件，不解压
    to: git/
```

改动量：**~25 行**配置（含平台条件分支）。

### 4.6 CI/CD 流水线

- 新增 Git 二进制下载 + SHA256 校验 + 缓存步骤（`vendor/git/`）；
- 三平台构建矩阵需验证内置 git 解压后可执行（含 `chmod +x`）。

改动量：**~60 行** workflow 配置。

### 4.7 总改动量估算

| 模块 | 改动量 | 状态 |
|---|---|---|
| `gitService.ts` 路径解析 | ~40 行 | 待实施 |
| 首次解压逻辑 | ~80 行 | 待实施 |
| git 检测与弹窗逻辑 | ~80 行 | ✅ 已实施 |
| 设置页 Git 来源信息 | ~40 行 | ✅ 已实施 |
| `electron-builder.yml` 打包配置 | ~25 行 | 待实施 |
| CI/CD Git 二进制集成 | ~60 行 | 待实施 |
| **测试（三平台验证）** | 手动测试为主 | 待实施 |
| **合计** | **~325 行代码**（新增部分 ~205 行） | **中** |

---

## 5. 技术难点与风险

### 5.1 ⚠️ 包体积（最大难点）

**修正说明**：初版估算（Windows +10 MB / Linux +15 MB / 按 +8% 计）**严重偏低**，实际二进制为初版的 2.7~3.7 倍。以下为实测数据。

| 平台 | 内置 Git 归档 | 当前安装包 | 增量 |
|---|---|---|---|
| Windows x64 | 32.9 MB（busybox MinGit） | 125.0 MB（实测） | **+26%** |
| Linux deb | 40.8 MB | ~130 MB（估算） | **+31%** |
| Linux AppImage | 40.8 MB | ~160 MB（估算） | **+26%** |
| macOS arm64 | 39.1 MB | ~180 MB（估算） | **+22%** |

**应对策略**：
- **捆绑压缩归档 + 首次解压**（核心手段）：直接把增量压到归档大小量级；
- Windows 用 **busybox 版 MinGit** 再省 4.3 MB；
- 查证 Linux x64 能否精简（见 3.4 异常项，潜在节省 ~30 MB）；
- 安装向导可选组件：不用同步的用户可取消勾选。

### 5.2 ⚠️ Git 版本管理与安全更新

Git 安全漏洞（如 CVE-2024-32002 等）需要及时更新。内置 Git 意味着：
- **每次安全发布**（约每季度一次）需要更新 `vendor/git/` 中的归档并发布补丁版本；
- 用户可能长期不更新应用，导致内置 Git 版本过旧。

**应对策略**：
- 跟踪 Git 安全邮件列表（git-security@lists.sourceforge.net）；
- 应用启动时检查内置 Git 版本，若存在已知高危漏洞，在设置页标红警告；
- 长期方案：可考虑「Git 运行时独立更新」机制（类似 VS Code 的 extension host），但当前阶段不必要。

### 5.3 ⚠️ Linux 发行版兼容性

Linux 二进制受 glibc 版本约束。Ubuntu 22.04 编译的 git 二进制无法在 Ubuntu 20.04 上运行（反之通常可以）。

**应对策略**：
- dugite-native 已针对较低 glibc 基线构建，覆盖率较高；
- 必要时静态编译（musl libc）彻底消除 glibc 依赖；
- 或链接 glibc 2.17（CentOS 7 基线）。

### 5.4 低风险项

| 问题 | 评估 |
|---|---|
| simple-git 兼容性 | `simple-git` 支持 `binary` 配置指定 git 路径，改动极小 |
| SSH 密钥 | 内置 git 默认使用系统 SSH 密钥（`~/.ssh/`），无需额外处理；MinGit 支持 OpenSSH |
| Credential Manager | Windows MinGit 可附带 Git Credential Manager，但 Trace 用自己的 PAT 注入机制，不需要 |
| Git LFS | 当前未使用；MinGit 不含 LFS，需额外引入时再评估 |
| 行尾/编码 | `core.autocrlf=false` 已在应用层强制，不受内置/系统 git 影响 |
| 可执行位 | Windows 无此概念；macOS / Linux 解压后需 `chmod 0o755`（易漏，务必覆盖） |
| 解压失败 | 归档损坏或磁盘不足时，回退到「检测系统 git / 安装引导」（场景 2） |

---

## 6. 与现有架构的集成点

### 6.1 当前 Git 调用链

```
渲染进程 → IPC(git:sync) → 主进程 registerIpc → gitService.sync(vaultPath)
                                                    ↓
                                              simpleGit({ baseDir, config })
                                                    ↓
                                              系统 git CLI 子进程
```

### 6.2 内置 Git 后的调用链

```
渲染进程 → IPC(git:sync)
    ↓
主进程 registerIpc
    ↓
gitService.sync(vaultPath, { binary: resolvedGitPath })
    ↓
simpleGit({ baseDir, config, binary: 内置/系统路径 })
    ↓
内置/系统 git CLI 子进程
```

**差异点**：`simpleGit()` 构造时传入 `binary` 参数；其余逻辑（config 注入、超时控制、冲突处理）完全不变。

### 6.3 设置页新增信息

```
Git 信息
├── 来源：内置 Git v2.53.0（推荐）/ 系统 Git v2.43.0
├── 路径：<userData>/git/git 或 /usr/bin/git
└── [重置选择] 按钮（下次触发同步时重新检测）
```

---

## 7. 实施计划（建议）

> 假设决策确认后实施，预计 **2.5~3.5 人日**（较初版 2~3 天增加，含解压逻辑与体积核对）。

| 阶段 | 内容 | 耗时 | 依赖 | 状态 |
|---|---|---|---|---|
| **P0: 二进制准备** | 三平台归档下载 + SHA256 校验 + 体积核对（含 Linux x64 精简可行性）；放入 `vendor/git/` | 0.5 天 | 无 | 待办 |
| **P1: 解压与路径解析** | `ensureBundledGitExtracted()`（zip / tar.gz 分支、`chmod +x`）+ `resolveGitBinary()` | 0.5 天 | P0 | 待办 |
| **P2: 检测与弹窗** | 主进程检测 IPC + 渲染进程弹窗 + 设置持久化 | 0.5 天 | P1 | ✅ 已完成 |
| **P3: 打包集成** | `electron-builder.yml` 配置 `extraResources`（归档不解压）；NSIS 可选组件 | 0.5 天 | P1 | 待办 |
| **P4: 设置页 UI** | Git 来源与版本展示 + 重置按钮 | 0.5 天 | P2 | ✅ 已完成 |
| **P5: CI/CD** | 构建流水线新增归档下载 / 校验 / 缓存与打包步骤 | 0.5 天 | P3 | 待办 |
| **P6: 三平台测试** | Windows/Linux/macOS 全流程验证（解压、同步、冲突、代理）+ 体积实测 | 0.5–1 天 | P5 | 待办 |

---

## 8. 决策记录

| # | 问题 | 候选方案 | 决策 |
|---|---|---|---|
| D-BG1 | 是否内置 Git？ | A. 内置 + 保留系统 fallback / B. 仅提示安装 | **A**：消除首次体验断裂 |
| D-BG2 | 交付方式？ | A. 随安装包内置 / B. 首次同步时按需下载 | **A**（2026-09-10 基于实测体积确认）：体积代价 +22~31%，换取零运维、无供应链下载风险、离线/企业可用；详见 3.5 |
| D-BG3 | 是否允许切换？ | A. 设置页可切换 / B. 始终使用内置 | **A**（高级用户需要自定义 git 版本） |
| D-BG4 | Git 版本跟踪策略？ | A. 跟踪最新安全版 / B. 固定版本仅修复关键 CVE | **A**（与 Git for Windows 同步） |
| D-BG5 | 检测时机？ | A. 启动时检测 / B. 触发关联/同步时检测 | **B**：不打扰不需要同步的用户 |
| D-BG6 | 弹窗行为？ | A. 一次性选择后记住 / B. 每次都弹 | **A + 可重置**：记住选择避免重复弹窗，设置页提供重置入口 |
| D-BG7 | 与 GitHub 登录的关系？ | A. 登录时一并检测 / B. 登录与 git 检测完全独立 | **B**：登录走 REST API 不需要 git，解耦更清晰 |
| D-BG8 | 打包形态？ | A. 捆绑压缩归档 + 首次解压 / B. 捆绑解压后目录 | **A**：归档 ~33 MB vs 解压后 150–200 MB，差异巨大 |
| D-BG9 | 是否改用 isomorphic-git？ | A. 采用（体积 ~0）/ B. 继续用 CLI 内置 | **B**（当前）：SSH 理由不成立，但 rebase 支持不完整，直接影响 FR-2.8.5 同步语义；列为远期候选 |
| D-BG10 | Windows 发行版？ | A. 标准 MinGit（37.2 MB）/ B. busybox 版（32.9 MB） | **B**：功能足够且更小 |

---

## 9. 替代方案（不推荐，但记录）

| 方案 | 不推荐理由 |
|---|---|
| 完全切换到 isomorphic-git | rebase 支持不完整（与 FR-2.8.5 冲突）、需重写已验证的 `gitService` 与错误文案映射；**SSH 缺失对 Trace 不构成理由**。远期重新评估 |
| 使用 nodegit（libgit2） | Electron 版本绑定痛苦、维护成本极高 |
| 放弃内置，仅优化安装引导 | 未解决根本问题；非技术用户仍卡在「安装 Git」 |
| 按需下载内置 Git | 引入动态执行未签名二进制的供应链风险 + 托管运维成本 + 弱网/企业环境不可用；体积是唯一优势。见 3.5 |
| 通过 npm 打包 git（如 git-essential） | npm 生态中无成熟方案，二进制分发不受 npm 设计支持 |
