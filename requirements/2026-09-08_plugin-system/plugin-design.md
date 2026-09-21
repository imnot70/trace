# Trace 插件系统设计（v2 提案）

> 状态：**设计已确认（2026-09-08）；M1 已实施**（utilityProcess 进程隔离 + 能力网关 + Tier 1 API + 权限确认 + 崩溃守护，实施记录见第 10 节）——D1 独立插件进程 ｜ D2 仅 Tier 1 ｜ D3 全局授权 ｜ D4 GitHub 索引市场 ｜ D5 版本节奏顺延（M1 随 0.5.0 发布）。
> 起草：2026-09-08 ｜ 基于现有 v1 骨架（`src/main/services/pluginHost.ts`）
> 目标读者：项目所有者 + 后续开发代理。关键决策见第 8 节，威胁模型详解见第 2 节。

## 1. 现状（v1 骨架的能力与局限）

现有实现：插件 = `userData/plugins/<id>/` 目录（manifest.json + CommonJS 入口），主进程 `require()` 加载，`activate(ctx)` 返回停用函数；`ctx` 仅 `notify(message)` 与 `logger`；权限声明（manifest.permissions）**只展示不执行**；设置页有总开关与单插件启停。

主要局限：

1. **无进程隔离**：插件代码跑在主进程，一个插件抛未捕获异常或死循环可以拖垮整个应用；
2. **能力全开**：主进程 = 全量 Node API，插件能读写任意文件、读系统钥匙串（包括 GitHub 令牌）——`permissions` 字段形同虚设；
3. **无真实 API**：除通知外插件做不了任何与笔记相关的事，写了也没有生态价值；
4. **无分发**：手动拷目录，无打包/导入/市场。

## 2. 威胁模型（先讲清楚「防什么」，没经验的先读这节）

### 2.1 总防线

| 威胁 | 防线 |
| --- | --- |
| 插件 bug（死循环/抛异常）拖垮主进程 | **进程隔离**：插件跑在独立 utilityProcess，崩了只重启插件 |
| 插件「无意越权」（比如误删用户文件） | **能力声明 + 宿主强制**：ctx 只暴露 manifest 声明过的能力，调用未声明能力直接抛错 |
| 恶意插件（主观作恶） | 技术缓解（require 白名单，见 2.2）+ 市场人工审阅 + 安装时权限知情同意 |
| 插件市场被投毒（渠道攻击） | 自包含政策 + 版本校验和锁定 + 索引 PR 审阅 + 可追溯可下架（见 2.3） |

### 2.2 恶意插件：防到什么程度，诚实地说清楚

**攻击场景**：某人写了个「字数统计」插件上架，里面藏了额外逻辑——直接 `require('node:fs')` 扫描你的磁盘、`require('node:https')` 把笔记内容 POST 到外部服务器、或读取 safeStorage 里的 GitHub 令牌。

**关键事实**：能力网关只能拦截「走 `ctx` API 的调用」。插件进程里运行的是真 Node.js，直接用原生模块不走网关。所以有三级防线，逐级加码：

1. **require 白名单（技术防线，M1 实施）**：插件进程的模块加载器被宿主 hook——插件只能 `require` 自己目录内的文件，`node:fs` / `node:child_process` / `node:https` 等内置敏感模块一律拒绝。这挡住 90% 的顺手作恶与抄来的恶意代码（大多数恶意脚本就是直接 require fs）。**残余绕过**：`process.binding`、编译原生扩展等高门槛手段仍可行——我们不宣称防住国家级攻击者，而是抬高门槛、过滤廉价恶意件；
2. **人工审阅（生态防线，M4 起）**：市场收录走 PR，审阅者看代码 + 核对权限声明是否与功能匹配；
3. **知情同意（用户防线）**：安装时展示权限清单（「此插件可读写你的笔记」），用户是最后一道闸。

**资产损失评估**（为什么这个风险可接受）：最值钱的东西是 GitHub PAT——但它是同步专用令牌，权限有限、可随时撤销；笔记数据本地明文 .md，本来就能被任何用户手动外传。配合「最小权限令牌」的登录引导（创建 PAT 只勾 repo 权限），实际损失可控。Obsidian/Chrome 扩展生态都是同款取舍。

### 2.3 市场投毒：攻击的是渠道，不是单个插件

**攻击场景细分与对应防线**：

| 攻击 | 场景 | 防线 |
| --- | --- | --- |
| 提交恶意插件 | 混淆代码赌审阅看不出来 | PR 审阅 + 权限声明审查 + require 白名单兜底 |
| 依赖投毒 | 插件依赖某 npm 包，包后来被劫持 | **自包含政策（硬性）**：插件 zip 必须打包全部代码，运行期禁止 require 插件目录外的任何 npm 包（与 require 白名单是同一机制的两侧）——插件生态没有 `node_modules`，npm 传递依赖攻击面直接归零 |
| 更新通道攻击 | 作者账号被盗，推恶意「新版本」 | **版本锁定 + 校验和**：索引仓库记录每个版本的 sha256；应用只认索引里登记的版本与哈希；索引中「新增/更新版本」本身就要走 PR（每次更新过一次人工关） |
| 索引仓库被攻破 | 维护者账号被盗改索引 | 分支保护 + 强制 review +（后期可选）维护者对索引 commit 签名，应用端验签 |
| 仿冒热门插件 | 改名蹭知名度 | 插件 id 与仓库归属绑定，审阅时拒绝仿冒 |

**出事后的止损**（假设防线全被穿透）：索引删除条目 = 全网下架（已安装用户不再收到更新 + 应用内不再推荐）；版本历史在 git 里天然可回滚可追溯；令牌撤销与数据备份是用户侧最后兜底。人工审阅在真实世界从不是 100%（Chrome/Obsidian 都出过事），所以体系的现实目标是：**抬高作恶成本 + 缩小攻击窗口 + 出事能快速止损**，而不是绝对安全。

### 2.4 结论

**进程隔离解决稳定性，能力系统解决误用，require 白名单过滤廉价恶意件，审阅+校验和+知情同意构成分发信任链**——四层各自独立。不追求绝对安全，追求让「作恶比正当开发更贵」。

## 3. 架构：独立插件进程 + 能力注入（核心决策）

```
┌─ 主进程 ─────────────────────────┐
│ PluginHost（改造现有类）           │
│  ├─ 发现/清单校验/启停状态         │
│  ├─ 为每个启用的插件 fork         │      ┌─ 插件进程（utilityProcess）─┐
│  │   一个 utilityProcess          │◄─RPC─┤  插件代码（CommonJS）        │
│  ├─ 能力网关：按 manifest 过滤     │      │  ctx 由预加载的宿主脚本注入   │
│  └─ 崩溃守护：重启 + 状态标记      │      └────────────────────────────┘
└──────────────────────────────────┘
        │ IPC（现有 window.trace 通道不变）
┌─ 渲染进程 ───────────────────────┐
│ 纯 UI：设置页增强、命令面板、       │
│ 贡献点渲染（工具栏按钮等声明式）     │
└──────────────────────────────────┘
```

- RPC：主进程 ↔ 插件进程用 Electron `MessagePort`（utilityProcess 标准做法）；
- 插件进程里预加载一个宿主脚本，把 `ctx` 的每个方法代理成 RPC 调用 → 主进程「能力网关」→ 校验 `manifest.permissions` → 转发真实服务；
- **对插件作者保持简单**：作者看到的还是 `exports.activate(ctx)`，感觉不到 RPC。

## 4. 能力 API（分阶段开放）

权限标识即 API 域。v2.0 只做 Tier 1，宁可少而稳：

### Tier 1（v2.0，M1）

| 能力 | permission | API |
| --- | --- | --- |
| 通知 | `notifications` | `ctx.notify(msg)`（现有） |
| 日志 | 内置 | `ctx.logger`（现有） |
| 笔记读 | `notes:read` | `ctx.notes.list(vault)` / `ctx.notes.read(vault, path)` / `ctx.notes.tree(vault)` |
| 笔记写 | `notes:write` | `ctx.notes.write(vault, path, content, {expectedHash})`（复用防覆盖机制）/ `ctx.notes.create(vault, parentPath, name, content?)` |
| 事件订阅 | `events` | `ctx.on('note:saved' \| 'note:opened' \| 'vault:changed' \| 'sync:done', handler)` |
| 命令注册 | 内置 | `ctx.registerCommand({id, title, handler})` → 供设置页/（将来的）命令面板触发 |

### Tier 2（v2.x，M3）

- `editor:toolbar`：在编辑工具栏贡献按钮（manifest 声明 icon/title/command，渲染进程渲染，点击发命令——**声明式，插件不碰 DOM**）（✅ 已实施）；
- `ui:status`：侧栏底部状态区一行文字（如字数统计插件）（✅ 已实施）；
- `settings:persist`：插件私有 KV 存储（宿主托管 JSON，避免插件自己写文件）（✅ 已于 M2 提前实施）。

### Tier 3（远期，设计预留）

- 代码块自定义渲染器（mermaid/图表，需在预览 Worker 里跑插件提供的渲染函数）；
- 自定义面板/视图、主题包、右键菜单扩展。

**明确不做**（与产品原则冲突）：直接读写工作区外的文件系统（`fs:` 永不开放）、执行任意 shell、跨库批量操作免确认。

## 5. 生命周期与稳定性

```
安装(拷目录/导入包) → 确认权限 → 启用 → activate → 运行(可崩溃→守护重启,指数退避,连续5次转「已禁用+错误」)
                                   ↘ 停用 → deactivate(5s 超时强杀) → 可再启用
升级 = 覆盖目录 + 全新 activate；卸载 = 停用 + 删目录 + 清权限记录与私有存储
```

- 插件进程崩溃不影响主进程与已保存数据；
- 所有 RPC 调用带超时（默认 5s）与大小限制（笔记内容上限、事件频率节流），防止单插件拖垮 IPC；
- 启用插件的设置改回「启动时激活」，运行期启停是即时生效的（现骨架已如此，保持）。

## 6. 打包与分发

`.trace-plugin` = zip 改后缀（manifest + 入口 + 全部资源，**自包含，无 npm 依赖**）。两条来源走**同一条安装管线**：

```
来源A：本地导入（设置页按钮，M2 先行）
来源B：市场安装（M4，多一步「校验和与索引比对」）
      ↓
解压 → 清单校验 → sha256 校验（市场件）→ 展示权限清单 → 用户确认 → 落盘 plugins/<id>/
```

1. **本地导入（M2，先于市场）**：服务三类场景——作者自测、朋友间/内网传 zip、市场上线前的过渡期生态。因**绕过了市场审阅与校验和**，安装确认对话框必须显著提示「此插件未经 Trace 市场审阅」，权限展示不可跳过；同样支持从已装插件导出 `.trace-plugin` 分享；
2. **市场（M4）**：不做自有后端。约定一个 GitHub 索引仓库（`trace-plugins.json`：id/仓库/版本/sha256/权限），应用内浏览 → 点安装 → 从对应 GitHub Release 下载 zip → 与索引登记的 sha256 比对 → 权限确认 → 安装。收录与更新均走 PR 审阅（Obsidian 社区模式）；
3. 更新：设置页显示可更新列表（索引中版本 > 本地版本），更新=重新走安装管线（含校验与权限确认；权限新增时必须再次确认）；
4. 下架：索引删条目即全网停止更新与推荐，已安装实例保留但标记「已下架」；
5. 签名：等市场运行后评估（索引维护者对索引 commit 签名，应用端验签）。

## 7. 开发者体验

- `@trace/plugin-api` 类型包（只发 d.ts + JSDoc），npm 安装即有补全；
- 示例插件升级：覆盖 Tier 1 全部能力的演示（读写笔记 + 订阅保存事件 + 注册命令）；
- 设置页插件详情：权限清单、运行状态、崩溃历史、日志查看（复用 logger）；
- 文档一篇：`docs/plugin-development.md`（或仓库 wiki）。（✅ 已于 M1 提前落地为 `guides/plugin-development.md`：API 参考、错误约定、白名单、调试方法与完整示例）

## 8. 决策记录（项目所有者已确认，2026-09-08）

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | 进程模型 | **B：独立插件进程（utilityProcess）+ 能力网关**。主进程直载不解决崩溃且权限全开；渲染沙箱对「要读写笔记文件」的插件生态过严 |
| D2 | v2.0 能力范围 | **仅 Tier 1**（notes 读写 + 事件 + 命令）。事件+读写+命令已能做出真实插件（字数统计、每日笔记模板、同步后 webhook），编辑器扩展等有生态再做 |
| D3 | 权限粒度 | **全局授权**（简单）；`notes:*` 本就限工作区内 |
| D4 | 市场形态 | **GitHub 索引仓库**，零运维成本；本地 `.trace-plugin` 导入先行（M2）并存 |
| D5 | 版本节奏 | **0.4.0**（M1 进程隔离+Tier1 API+权限确认，M2 打包导入+设置页增强），编辑器扩展与市场进 0.5.x |

## 9. 实施里程碑（按 D1–D5 推荐方案）

- **M1（0.4.0）**：utilityProcess 插件进程 + 能力网关 + Tier 1 API + 权限确认对话框 + 崩溃守护；示例插件改写为 Tier 1 演示
- **M2（0.4.x）**：`.trace-plugin` 导入导出；设置页详情（权限/日志/崩溃记录）；插件私有存储（✅ 已实施，实施记录见第 11 节）
- **M3（0.5.0）**：声明式工具栏按钮 + 状态区；类型包发 npm（✅ 已实施，类型包发布动作待办，实施记录见第 12 节）
- **M4（0.5.x）**：GitHub 索引市场（浏览/安装/更新检查）——方案已确认待实施，决策与开发方案见第 13 节
- 测试基线：能力网关单元测试（权限过滤矩阵）+ 插件进程生命周期集成测试 + RPC 超时/节流测试

---

## 10. M1 实施记录（2026-09-20）

### 10.1 交付物

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 插件进程桥接脚本 | `src/main/plugin-runtime/bridge.ts`（构建为 `out/main/bridge.js`） | utilityProcess 入口；受限 require + ctx 代理为 RPC |
| require 白名单 | `src/main/plugin-runtime/requireGuard.ts` | 纯函数，可单测；允许插件目录内文件 + path/util/events，其余拒绝 |
| RPC 协议 | `src/main/plugin-runtime/protocol.ts` | MessagePort 消息类型与超时/大小常量 |
| 能力网关 | `src/main/services/pluginGateway.ts` | 纯函数 dispatch；按 manifest.permissions 过滤 |
| 插件宿主 v2 | `src/main/services/pluginHost.ts` | 进程管理 + 崩溃守护（指数退避，连续 5 次自动停用）+ 事件广播 |
| 运行时适配 | `src/main/services/pluginRuntime.ts` | electron utilityProcess 适配（PluginHost 不依赖 electron，测试注入桩） |
| 权限确认 | 设置页对话框 + `pluginPermissionsConfirmed` 设置字段 | 启用前权限集合必须与已确认一致；manifest 权限变化需重新确认 |
| 示例插件 | `resources/sample-plugin/`（v2.0.0） | Tier 1 全能力演示（vaults/list/read/create/write + note:saved + 命令） |

### 10.2 Tier 1 API 最终签名（作者视角）

```ts
// 全部 notes.* 调用 resolve 为 { ok: true, ...数据 } 或 { ok: false, error }，用 .ok 判断
ctx.notes.vaults(): Promise<{ ok: true; vaults: string[] } | { ok: false; error: string }>
ctx.notes.list(vault): Promise<{ ok: true; tree: TreeNode[] } | { ok: false; error: string }>
ctx.notes.tree(vault): Promise<{ ok: true; tree: TreeNode[] } | { ok: false; error: string }>  // list 的别名
ctx.notes.read(vault, path): Promise<{ ok: true; content: string; hash: string } | { ok: false; error: string }>
ctx.notes.write(vault, path, content, opts?: { expectedHash?: string | null }): Promise<{ ok: true; hash: string } | { ok: false; error: string }>
ctx.notes.create(vault, parentPath, name, content?): Promise<{ ok: true; path: string } | { ok: false; error: string }>
ctx.notify(message): Promise<{ ok: true } | { ok: false; error: string }>          // notifications 权限
ctx.logger.info/warn/error(...args): void                                          // 内置
ctx.on(event, handler) / ctx.off(event, handler)                                    // events 权限；event ∈ note:saved / note:opened / vault:changed / sync:done
ctx.registerCommand({ id, title, handler }): string                                // 内置；完整 id = <插件id>.<命令id>
```

**对设计第 4 节的修订**：

1. **新增 `ctx.notes.vaults()`**（归入 `notes:read` 权限）：设计原表缺少库名枚举能力，插件无从得知 `list(vault)` 的 vault 参数取值，M1 实施时补齐；
2. **`notes.write` 的防覆盖参数**为可选 `opts.expectedHash`（设计表中 `{expectedHash}` 语义不变）；
3. **错误语义分层**（测试基线补充）：权限违规 / 未知能力域 / 未知方法一律 **reject**（设计 2.1「调用未声明能力直接抛错」）；业务失败（未知库、重名、外部修改冲突、内容超限）**resolve 为 `{ ok: false, error }`** 由插件判断——两种失败混在一起会让插件无法区分「没权限」和「没写进去」；
4. **`list` 与 `tree` 同义**（均返回完整树），保留两个名字仅为贴合设计表措辞。

### 10.3 事件来源与节流

| 事件 | 来源 | 节流 |
| --- | --- | --- |
| `note:saved` | `note:write` IPC handler 成功后（覆盖编辑器保存；插件写入不经此路径，避免事件回环） | 直传 |
| `note:opened` | 渲染端 editor store 打开笔记后经 `plugin:reportNoteOpened` 上报 | 直传 |
| `vault:changed` | chokidar watcher 变更回调 | 每插件 300ms 尾沿合并（保留最新 payload） |
| `sync:done` | 手动同步（`git:sync` handler）与自动同步（AutoSyncService `onVaultSynced` 回调）成功后 | 直传 |

所有事件只广播给声明了 `events` 权限的运行中插件。

### 10.4 超时与限制（默认值）

| 项 | 值 |
| --- | --- |
| ctx RPC 调用超时 | 5s（`RPC_TIMEOUT_MS`） |
| 命令执行超时 | 10s（宿主与 bridge 双侧兜底） |
| activate 等待 | 10s，超时终止进程并记错误 |
| deactivate 宽限 | 5s，超时强杀 |
| 单次调用内容上限 | 4,000,000 字符（bridge 与网关双侧校验） |
| 通知长度 | 500 字符 |
| 崩溃守护 | 退避 1s/2s/4s/8s，连续 5 次自动停用（`pluginEnabled=false` + 错误标记），手动停用计数归零 |

### 10.5 测试基线落地

- `tests/pluginGateway.test.ts`（12 项）：权限过滤矩阵 + 分层语义 + 大小上限；
- `tests/requireGuard.test.ts`（8 项）：内置白名单、目录逃逸、npm 包拒绝、自包含政策；
- `tests/pluginHost.test.ts`（20 项）：进程内桩运行时走真实宿主协议——权限确认流程、能力调用、激活失败、停用、命令、崩溃守护退避与上限、事件广播与合并、清单校验。
- 生产冒烟（Windows 实测）：utilityProcess fork + 桥接激活 + 网关读写真实笔记库 + 命令触发 + 通知送达全链路通过。

### 10.6 M1 未含（按里程碑顺延）

`.trace-plugin` 打包导入导出、设置页权限/日志/崩溃详情页、插件私有存储（M2）；声明式工具栏/状态区、类型包（M3）；市场（M4）。

---

## 11. M2 实施记录（2026-09-20）

### 11.1 交付物

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| `.trace-plugin` 打包管线 | `src/main/services/pluginPackage.ts` | 导入（暂存解压 → 清单校验 → 入口检查）/ 导出 / 安装覆盖 |
| 插件私有存储 | `src/main/services/pluginStorage.ts` | 每插件一个 JSON（userData/plugin-data/<id>.json），宿主托管 |
| 网关 storage 域 | `pluginGateway.ts` | 权限 `settings:persist`；get/set/delete/keys |
| 设置页详情 | `SettingsView.vue` 详情弹层 | 状态 / 权限 / 崩溃历史 / 日志行 / 存储占用 / 导出 / 卸载 |
| 导入确认弹窗 | 同上 | 权限清单 + 显著提示「未经 Trace 市场审阅」（设计第 6 节要求，不可跳过） |

### 11.2 安装管线（本地导入）

```
选择 .trace-plugin → stagePluginZip（防 zip-slip / 条目数 / 总大小，manifest 位置兼容
根目录或唯一顶层文件夹）→ 暂存 userData/plugin-staging → 渲染端确认弹窗
（权限 + 未经审阅警告）→ confirmImport：停用旧进程（升级时）→ 整体替换 plugins/<id>/
→ 原启用中的插件按权限确认状态重新激活（权限变化则关闭开关待重确认）
```

取消导入即清理暂存；导入会话内存态（Map），应用重启自然失效。

### 11.3 私有存储约定

- 权限域 `storage` ↔ manifest 声明 `settings:persist`；未声明调用为致命拒绝（与其他域一致）
- 插件视角：`ctx.storage.get(key)` → `{ ok: true, value }`（未设置为 null）；`set/delete/keys` 同 `{ ok }` 风格
- 限制：键 ≤200 字符、单值 ≤256KB、单插件总量 ≤1MB、值必须 JSON 可序列化
- 卸载（`plugin:uninstall`）= 停用 + 删目录 + 清权限记录与启用开关 + 清私有存储（设计第 5 节）

### 11.4 安全防护

- **zip-slip**：逐条目规范化路径并校验不逃逸暂存目录（绝对路径 / 盘符 / `..` 逃逸拒绝）；守卫函数 `safeEntryTarget` 直接单测覆盖
- **炸弹防护**：解压总大小 ≤20MB、条目数 ≤2000（默认值）
- 清单要求 manifest.json 位于包根或唯一顶层文件夹；入口文件存在性校验

### 11.5 崩溃历史

宿主每插件保留最近 10 条崩溃记录（ISO 时间 + 退出码），随 `PluginInfo.crashHistory` 暴露；手动停用清零（与 crashCount 同语义）。

### 11.6 测试

- `tests/pluginPackage.test.ts`（7 项）：导出导入往返、顶层文件夹清单定位、无效清单 / 缺入口拒绝、路径守卫（含手工构造的 `../` 恶意条目包）、上限、升级覆盖
- `tests/pluginStorage.test.ts`（8 项）：往返持久化、插件隔离、键长 / 单值 / 总量上限、undefined 拒绝、id 路径防御、clear/usage
- `tests/pluginHost.test.ts` 新增 6 项：崩溃历史、卸载清理（目录 / 权限记录 / 存储）、导入安装、升级重激活、权限变化重确认、取消导入

---

## 12. M3 实施记录（2026-09-20）

### 12.1 交付物

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 工具栏贡献点 | manifest `contributions.toolbar` + `PluginHost.toolbarItems()` | 声明式：权限 `editor:toolbar` + 命令已注册才生效；命令短 id 自动补全为 `<插件id>.<命令id>` |
| 编辑器工具栏渲染 | `EditorView.vue` 工具栏尾部 | 主进程 `plugin:toolbar` 事件广播全量按钮，点击经 `invokePluginCommand` 执行 |
| 状态区 | 网关 `ui:status` 域 + `ctx.status.set/clear` | 权限 `ui:status`；每插件一条，≤120 字符自动截断；`plugin:status` 事件全量广播渲染端，侧栏底部渲染，插件停止自动清除 |
| `@trace/plugin-api` | `packages/plugin-api/`（index.d.ts + README） | 只含类型与 JSDoc；npm 发布为发布动作（构建产物已就绪，待 npm 账号执行 publish） |

### 12.2 行为约定

- **工具栏**：manifest `contributions.toolbar: [{icon, title, command}]`；icon 为 1-4 字符 emoji/文本（缺省 ▸）；仅当（a）声明 `editor:toolbar` 权限、（b）插件运行中、（c）command 已注册 三者同时满足才渲染；插件停止 / 崩溃 / 卸载自动消失
- **状态区**：`ctx.status.set(text)`（trim 后 ≤120 字符，超出截断）/ `ctx.status.clear()`；插件停止即清除；每插件一条、互不覆盖
- 渲染端订阅：`plugin:status` / `plugin:toolbar` 均为全量条目广播（无增量合并复杂度）

### 12.3 测试

网关 `ui:status`（2 项：权限拒绝 + set/clear/截断）+ 宿主贡献点（3 项：权限 + 命令注册的过滤组合、停止后消失与广播）。插件测试合计 72 项。

---

## 13. M4 方案（2026-09-20 确认，待实施）

### 13.1 已拍板决策

| # | 决策 | 结论 |
| --- | --- | --- |
| D-M4-1 | 索引仓库 | **`imnot70/trace-plugins`**（项目所有者已创建，public）；核心索引文件 `trace-plugins.json`（schemaVersion + plugins[]：id/repo/versions{name → releaseTag/asset/sha256/permissions/releasedAt}/latest） |
| D-M4-2 | 网络代理 | **市场全部网络请求无条件跟随 `proxyUrl`**（索引拉取 + Release 资产下载，与 git 同步行为一致；不提供独立开关） |
| D-M4-3 | 首个收录件 | 示例插件（顺带验证作者发布全流程） |

### 13.2 开发方案概要

- **marketService.ts**：fetchIndex（raw.githubusercontent.com 匿名拉取 + ETag 条件请求 + 本地缓存 24h TTL，userData/market-cache.json）/ checkUpdates（已装市场插件 vs 索引 latest）/ 资产下载（跟随 proxyUrl）
- **安装管线复用 M2**：下载 → **sha256 与索引比对（版本锁定）** → stagePluginZip → 权限确认（市场件显示「已通过市场审阅」）→ 落盘；权限新增由 M1 的确认机制自动处理
- **来源登记**：userData/market-installed.json 记录市场安装的 {id → repo/version/sha256}；只有市场件参与更新检查；索引中不存在的已装市场件标记「已下架」（保留可用）
- **渲染端**：设置 → 插件新增市场区块（平铺列表 + 名称过滤 + 刷新按钮 + 可更新标记）；不做分类/全文搜索
- **仓库治理**：trace-plugins.json 的增改走 PR + 人工审阅；main 分支保护；PR 模板要求附源码地址 / 构建方式 / sha256 计算命令 / 权限说明

### 13.3 工作拆分（2 批次）

1. ✅ **批次一已实施**：索引仓库脚手架（`market-index/` 种子目录）+ marketService（拉取/缓存/对比/sha256）+ 单测 11 项（实施明细见 13.4）
2. ✅ **批次二已实施**：市场 UI（安装/更新/已下架标记）接 M2 管线 + 作者发布指南（`guides/plugin-release.md`）+ PRD FR-2.11.14；实机 marketList 冒烟通过（安装全链路冒烟待首个 Release 资产上架后补测）

### 13.4 批次一实施记录（2026-09-20）

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 索引仓库种子 | `market-index/`（trace-plugins.json + PR 模板 + README/治理规则） | 内容复制推送到 imnot70/trace-plugins 即完成初始化；之后以该仓库为准 |
| 市场服务 | `src/main/services/marketService.ts` | fetchIndex（ETag 条件请求 + 24h TTL 缓存 + 失败回退旧缓存 stale 标记 + 非法条目过滤）/ checkUpdates（updates + unlisted 已下架）/ downloadAndVerify（sha256 校验不一致即拒绝并删除） |
| 网络适配器 | `src/main/services/marketHttp.ts` | 专用 session（trace-market）每次请求按 proxyUrl 设 fixed_servers 代理（无代理走系统），基于 net.request（net.fetch 类型不支持 session）；30s 超时 |
| 语义化版本比较 | `compareVersions` | 数字段比较，位数不足补 0（不支持预发布标签） |

- 索引校验：schemaVersion 必须为 1；插件条目 id 形如目录名、repo 形如 owner/name、latest 必须存在于 versions；非法条目静默过滤
- 下载校验：资产名白名单（防路径拼接）；sha256 大小写不敏感比对，不一致删除文件拒绝安装
- 测试：`tests/marketService.test.ts` 11 项（TTL/force/304/stale 回退/条目过滤/更新与下架判定/校验和一致与篡改拒绝/非法资产名）
- 待办：用户将 `market-index/repo/` 内容推送至 imnot70/trace-plugins（索引生效前提）
