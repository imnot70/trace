# 内置 Git 可行性分析与技术方案

> 状态：**设计已确认（2026-09-10）**——待实施
> 关联：FR-2.8（Git 云同步）；FR-2.8.13（内置 Git）；当前实现 `src/main/services/gitService.ts`（simple-git 包装系统 git）
> 起草：2026-09-10 ｜ 最后更新：2026-09-10

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

### 2.1 路线 A：捆绑 Git 二进制（Dugite / MinGit / 自编译）

**原理**：随应用分发一个精简的 Git 可执行文件，`simple-git` 在调用时优先使用内置 git，fallback 到系统 git。

| 维度 | 评估 |
|---|---|
| **成熟度** | GitHub Desktop 用 Dugite（基于 digilent/dugite-native）验证了这条路，已稳定运行数年 |
| **跨平台** | Windows（MinGit / Dugite-native 编译）、Linux（静态编译 musl / 预编译二进制）、macOS（arm64 + x64 双架构）均有现成构建方案 |
| **安装包增量** | 三平台合计约 **60–120 MB**（压缩后），其中 macOS arm64 ~37 MB、Windows MinGit ~10 MB、Linux ~15 MB |
| **功能覆盖** | 完整 Git CLI 能力（clone/fetch/push/rebase/lfs/credential helper），与系统 git 行为一致 |
| **侵入性** | **低**：仅需修改 `gitService.ts` 中的路径解析逻辑，`simple-git` 无需替换 |
| **维护成本** | 中：需跟踪 Git 安全补丁版本更新（约每季度一次）；三平台构建流水线维护 |

**风险**：

| 风险 | 严重度 | 对策 |
|---|---|---|
| 包体积膨胀 | 中 | 分平台按需打包；Linux AppImage 天然包含所有依赖；deb 可选 `Recommends: git` 引导系统安装 |
| 版本更新滞后 | 低 | 跟踪 Git 官方安全发布，纳入 CI 自动化更新流程 |
| Windows 下 PATH 冲突 | 低 | 内置 git 设置为最高优先级，通过 `GIT_EXEC_PATH` / 显式路径调用，不污染系统 PATH |
| Linux 下 glibc 版本绑定 | 中 | 静态编译（musl）或链接最低版本 glibc；Dugite-native 已验证可行性 |

### 2.2 路线 B：纯 JavaScript 实现（isomorphic-git）

**原理**：用 `isomorphic-git`（纯 JS/WASM）替代系统 git CLI，直接操作 `.git` 目录的底层对象。

| 维度 | 评估 |
|---|---|
| **成熟度** | 有活跃社区，但 v1.7.5 后有 `readTree` 性能回归报告；大仓库场景未广泛验证 |
| **跨平台** | 天然跨平台（纯 JS），无需分平台打包二进制 |
| **安装包增量** | **~0 MB**（isomorphic-git 本身 ~2 MB，已在 npm 依赖中） |
| **功能覆盖** | ⚠️ **严重不足**：仅支持 HTTP(S) 传输，**不支持 SSH**；无 LFS 支持；无 credential helper 体系；sparse checkout 支持有限 |
| **侵入性** | **高**：需完全重写 `gitService.ts`，所有 git 操作替换为 isomorphic-git API；IPC 层可能需要调整 |
| **维护成本** | 高：需自行实现 SSH 传输层（依赖 `ssh2` 库）或放弃 SSH 支持；LFS 需额外实现 |

**结论**：**不推荐作为主路线**。SSH 不支持直接排除了大量用户场景（企业内网、自建 Git 服务器）；重写成本高且功能覆盖不足。

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

### 3.4 三平台 Git 运行时选型

| 平台 | 推荐方案 | 预估大小（压缩） | 来源 |
|---|---|---|---|
| **Windows** | MinGit（Git for Windows 精简版） | ~10 MB | gitforwindows.org/mingit |
| **macOS** | Dugite-native 预编译（arm64 + x64） | ~37 MB（.lzma） | desktop/dugite-native |
| **Linux** | Dugite-native 预编译 或 musl 静态编译 | ~15 MB | desktop/dugite-native / 自编译 |

---

## 4. 代码层面改动评估

### 4.1 路径解析（`gitService.ts`）

```typescript
// 新增：内置 git 路径解析
function resolveGitBinary(): string | undefined {
  // 1. 应用内置路径（electron-builder 打包后位于 resources/）
  const bundled = path.join(process.resourcesPath, 'git', gitExecutableName())
  if (fs.existsSync(bundled)) return bundled

  // 2. 系统 PATH 中的 git（现有行为）
  return undefined // simple-git 默认行为
}
```

改动量：**~30 行**，影响范围极小。

### 4.2 git 检测与弹窗（主进程 + 渲染进程）

```typescript
// 主进程：新增 IPC 处理器
handle('git:checkAvailability', async () => {
  const systemGit = await checkSystemGit()   // simpleGit().version()
  const bundledGit = checkBundledGit()       // fs.existsSync 内置路径
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

改动量：**~80 行**（主进程检测 + 渲染进程弹窗逻辑）。

### 4.3 设置页 Git 来源信息

在设置 → 通用或账号标签页新增：

```
Git 信息
├── 来源：系统 Git v2.43.0 / 内置 Git v2.47.0
├── 路径：/usr/bin/git 或 /path/to/resources/git/git
└── [重置选择] 按钮（将 gitSource 重置为 null，下次触发时重新检测）
```

改动量：**~40 行** UI。

### 4.4 打包配置（electron-builder.yml）

```yaml
# 按平台条件打包 Git 二进制
extraResources:
  - from: vendor/git-${platform}/
    to: git/
```

改动量：**~20 行**配置。

### 4.5 CI/CD 流水线

- 新增 Git 二进制下载/缓存步骤（vendor/ 目录或 CI artifact）；
- 三平台构建矩阵需测试内置 git 可执行性。

改动量：**~40 行** workflow 配置。

### 4.6 总改动量估算

| 模块 | 改动量 | 复杂度 |
|---|---|---|
| `gitService.ts` 路径解析 | ~30 行 | 低 |
| git 检测与弹窗逻辑 | ~80 行 | 低 |
| 设置页 Git 来源信息 | ~40 行 | 低 |
| `electron-builder.yml` 打包配置 | ~20 行 | 低 |
| CI/CD Git 二进制集成 | ~40 行 | 中 |
| **测试（三平台验证）** | 手动测试为主 | **中** |
| **合计** | **~210 行代码 + 手动测试** | **中低** |

---

## 5. 技术难点与风险

### 5.1 ⚠️ 包体积（最大难点）

| 平台 | 内置 Git 大小 | 当前安装包大小 | 增量 |
|---|---|---|---|
| Windows | ~10 MB（MinGit） | ~120 MB | **+8%** |
| Linux deb | ~15 MB | ~130 MB | **+12%** |
| Linux AppImage | ~15 MB | ~160 MB | **+9%** |
| macOS | ~37 MB | ~180 MB | **+21%** |

**应对策略**：
- macOS 增量最大（arm64 37 MB），可考虑使用压缩率更高的 .lzma 格式（~24 MB），或仅在用户首次触发同步时下载（延迟加载）；
- Windows MinGit 仅 10 MB，增量可接受；
- 可在安装向导中提供「是否内置 Git」选项（Windows NSIS），减小默认安装体积。

### 5.2 ⚠️ Git 版本管理与安全更新

Git 安全漏洞（如 CVE-2024-32002 等）需要及时更新。内置 Git 意味着：
- **每次安全发布**（约每季度一次）需要更新 vendor/ 中的二进制并发布补丁版本；
- 用户可能长期不更新应用，导致内置 Git 版本过旧。

**应对策略**：
- 跟踪 Git 安全邮件列表（git-security@lists.sourceforge.net）；
- 应用启动时检查内置 Git 版本，若存在已知高危漏洞，在设置页标红警告；
- 长期方案：可考虑「Git 运行时独立更新」机制（类似 VS Code 的 extension host），但当前阶段不必要。

### 5.3 ⚠️ Linux 发行版兼容性

Linux 二进制受 glibc 版本约束。Ubuntu 22.04 编译的 git 二进制无法在 Ubuntu 20.04 上运行（反之通常可以）。

**应对策略**：
- 静态编译（musl libc）彻底消除 glibc 依赖，Dugite-native 已验证可行性；
- 或链接 glibc 2.17（CentOS 7 基线），覆盖绝大多数 Linux 桌面用户。

### 5.4 低风险项

| 问题 | 评估 |
|---|---|
| simple-git 兼容性 | `simple-git` 支持 `binary` 配置指定 git 路径，改动极小 |
| SSH 密钥 | 内置 git 默认使用系统 SSH 密钥（`~/.ssh/`），无需额外处理；MinGit 支持 OpenSSH |
| Credential Manager | Windows MinGit 可附带 Git Credential Manager，但 Trace 用自己的 PAT 注入机制，不需要 |
| Git LFS | 当前未使用；MinGit 不含 LFS，需额外引入时再评估 |
| 行尾/编码 | `core.autocrlf=false` 已在应用层强制，不受内置/系统 git 影响 |

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
simpleGit({ baseDir, config, binary: 内置路径 })
    ↓
内置/系统 git CLI 子进程
```

**差异点**：`simpleGit()` 构造时传入 `binary` 参数；其余逻辑（config 注入、超时控制、冲突处理）完全不变。

### 6.3 设置页新增信息

```
Git 信息
├── 来源：内置 Git v2.47.0（推荐）/ 系统 Git v2.43.0
├── 路径：/path/to/resources/git/git.exe
└── [重置选择] 按钮（下次触发同步时重新检测）
```

---

## 7. 实施计划（建议）

> 假设决策确认后实施，预计 **2~3 人日**。

| 阶段 | 内容 | 耗时 | 依赖 |
|---|---|---|---|
| **P0: Git 二进制准备** | 三平台 Git 精简版编译/下载，验证可执行性，放入 `vendor/` | 0.5 天 | 无 |
| **P1: 路径解析** | `gitService.ts` 增加内置路径优先逻辑 + fallback 到系统 | 0.5 天 | P0 |
| **P2: 检测与弹窗** | 主进程检测 IPC + 渲染进程弹窗逻辑 + 设置持久化 | 0.5 天 | P1 |
| **P3: 打包集成** | `electron-builder.yml` 配置 `extraResources`，三平台构建验证 | 0.5 天 | P1 |
| **P4: 设置页 UI** | Git 来源信息展示 + 重置选择按钮 | 0.5 天 | P2 |
| **P5: CI/CD** | 构建流水线新增 Git 二进制缓存与打包步骤 | 0.5 天 | P3 |
| **P6: 三平台测试** | Windows/Linux/macOS 全流程验证（克隆、同步、冲突、代理、SSH） | 0.5–1 天 | P5 |

---

## 8. 决策记录

| # | 问题 | 候选方案 | 决策 |
|---|---|---|---|
| D-BG1 | 是否内置 Git？ | A. 内置 + 保留系统 fallback / B. 仅提示安装 | **A**：消除首次体验断裂 |
| D-BG2 | 内置时机？ | A. 随安装包内置 / B. 首次同步时按需下载 | **A**（简单可靠）；若体积敏感可 B |
| D-BG3 | 是否允许切换？ | A. 设置页可切换 / B. 始终使用内置 | **A**（高级用户需要自定义 git 版本） |
| D-BG4 | Git 版本跟踪策略？ | A. 跟踪最新安全版 / B. 固定版本仅修复关键 CVE | **A**（与 Git for Windows 同步） |
| D-BG5 | 检测时机？ | A. 启动时检测 / B. 触发关联/同步时检测 | **B**：不打扰不需要同步的用户 |
| D-BG6 | 弹窗行为？ | A. 一次性选择后记住 / B. 每次都弹 | **A + 可重置**：记住选择避免重复弹窗，设置页提供重置入口 |
| D-BG7 | 与 GitHub 登录的关系？ | A. 登录时一并检测 / B. 登录与 git 检测完全独立 | **B**：登录走 REST API 不需要 git，解耦更清晰 |

---

## 9. 替代方案（不推荐，但记录）

| 方案 | 不推荐理由 |
|---|---|
| 完全切换到 isomorphic-git | SSH 不支持、LFS 不支持、重写成本高、大仓库性能未验证 |
| 使用 nodegit（libgit2） | Electron 版本绑定痛苦、维护成本极高 |
| 放弃内置，仅优化安装引导 | 未解决根本问题；非技术用户仍卡在「安装 Git」 |
| 通过 npm 打包 git（如 git-essential） | npm 生态中无成熟方案，二进制分发不受 npm 设计支持 |
