# 打开已有笔记库 设计（FR-2.1.4）

> 2026-10-09 实施（分支 `feat/open-vault`，基线 v0.19.0）。需求见 [open-vault.md](open-vault.md)。

## 1. 架构决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 外部目录如何成为笔记库 | **注册表**（userData/open-vaults.json：`[{name, dir}]`），不移动目录 | clone 目录属于用户的 git 工作副本，搬移会打断路径预期与跨盘风险；注册表与既有「应用元数据不入笔记库」原则一致 |
| 「自动关联」的实现 | **零新增**——GitService 的关联态本就直接读 `.git` 的 origin remote（`associated: !!remoteUrl`），无独立关联记录 | clone 下来的仓库天然已关联；打开后调用一次 `git.status` 返回关联信息供 toast；同步时 PAT 照常注入 |
| 库列表合并 | `VaultService.list()` = 工作区扫描 + 外部注册（`external: true`），统一按名排序 | 下游（fsTree / git / search / 双链 / 导出）全部按「名字 → vaultPath」取路径，list 合并后自动生效 |
| 路径解析 | `vaultPath(name)` 先查外部注册返回注册绝对路径，否则走 `resolveWithin`（工作区库逃逸校验不变） | 外部路径本身即绝对路径，下游对其再做相对解析安全 |
| 文件监听 | 每个外部库一个独立 chokidar 实例（`WatcherService.setExternalVaults` 增量增删），事件以注册名归入**同一**防抖 / 挂起管线 | 工作区单一 watcher 看不到外部目录；共用管线保证 git 同步挂起 / 补偿语义一致 |
| 回收站跨盘 | `movePath(from, to)`：`fs.rename` 失败且 `EXDEV` 时回退「`cpSync` 递归复制 + `rmSync` 删除」 | 外部库可能在另一磁盘，`renameSync` 跨盘抛 EXDEV；移入与还原两处统一走该函数 |

## 2. 数据流

打开：`NameDialog「打开」标签页` → `dialog:pickDirectory`（Electron `showOpenDialog` openDirectory）→ `vault:openExternal(dir)` → `VaultService.openExternal`（校验存在 / 目录 / basename 命名规则 / 重名拒绝 / 同目录幂等）→ 注册 → `watcher.setExternalVaults` 刷新附加监听 → `git.status(vaultPath)` → 返回 `{ok, name, git}` → 渲染端 toast（关联 / 未关联两种文案）+ `tree.loadVaults`。

移除：库 ⋮「删除笔记库」→ 确认弹窗（external 分流文案「仅解除登记」）→ `vault:delete` → 主进程 `delete()` 内部分流 `removeExternal` → favorites / recents / gistShares / vaultMeta 清理（照旧）→ watcher 刷新。

重命名：`vault:rename` → 主进程 external 分支改注册名（磁盘不动）→ 既有联动（favorites / recents / gistShares / vaultMeta / editor / tree）照旧 → watcher 刷新（监听归属键 = 注册名）。

## 3. 关键实现点

- **注册表**：`JsonStore`（schemaVersion 能力继承 JsonStore 通用地基），`VaultService` 第三构造参可选注入（单测省略即禁用外部能力）；
- **重名 / 非法名**：basename 过 `checkNameFormat(vault)`（Windows 保留名、非法字符全拦），重名大小写不敏感（含工作区库与外部库之间）；`pathsEqual` 做路径幂等比较（分隔符与大小写归一）；
- **外部库删除的安全顺序**：`VaultService.delete` 对 external 直接返回 `removeExternal`，**不会**进 `trash.put`——用户 clone 目录永不进回收站 / 被删；
- **NameDialog 复用**：`withOpenTab` 选项 + `openAction(dir)` 回调；tab 状态与选中目录在 store；「打开」分支跳过名称校验（目录名合法性由主进程校验），确认按钮文案动态「打开」；
- **watcher 生命周期**：`close()` 关外部监听但保留注册映射（restart 场景 `rebuildExternal` 按 last-known 注册重建）；`start()` 尾部自动重建——应用启动时 `watcher.setExternalVaults(vaults.externalVaults())` 一次挂齐。

## 4. 验证

- 单测 +4（`services.test.ts` 外部笔记库块）：注册与 list 合并 external 标记 / vaultPath 分流（fsTree 真读外部文件、外部库内建笔记）/ 幂等与三类拒绝（工作区重名 / 目录不存在 / 保留名 con）/ rename 只改注册名磁盘不动 / delete 仅解除注册文件保留且可重开、工作区库照旧回收站。全仓 582 项全绿（90s 口径）；typecheck / lint 通过。
- CDP 隔离实例冒烟 10/10：真实 `git init + remote origin` 造 clone 样目录 → `openVaultExternal`（注册名 = 目录名、`git.associated=true`、remoteUrl 精确）→ 侧栏 external 标记与文件树列笔记 → 打开编辑落盘（磁盘真值）→ `searchBuildIndex(true)` 后搜索命中外部库 → 删除解除注册库消失、磁盘保留、重开恢复。
- Windows 单测注意：外部库之间的大小写变体重名在大小写不敏感文件系统上物理不可构造（mkdir 落回原目录走幂等分支），逻辑由 `exists()` 的大小写不敏感比较覆盖。
- 真机验证待用户确认（焦点：真实 GitHub clone（https + PAT）的同步链路、跨盘目录的回收站回退、U 盘等可移动介质拔插后外部库的报错表现）。

## 5. 真机反馈修复（2026-10-09，commit 51cbb05）

用户真机验证反馈两项，当日修复：

1. **⋮ 菜单漂移到视口左上角**：根因 = `.side-row-actions` 自 v0.1.0 起默认 `display: none`（hover / active 才显示），而 EP dropdown 的菜单 teleport 到 body——菜单打开后鼠标移向菜单、行失去 hover → 按钮组 `display: none` 脱离布局 → popper 失去参考锚点整体跳 (0,0)。库行 / 树行模板上挂了多年的 `menu-hold` class（注释明言「菜单打开期间保持按钮组可见，防止 popper 失去锚点闪现」）**CSS 规则从未存在**——补 `.side-row.menu-hold / .tree-row.menu-hold .side-row-actions { display: inline-flex }`。标签行无此问题（tag-menu-btn 用 opacity 隐藏，元素保持在布局中）。
2. **外部库不显示已关联**（菜单仍是「关联 Git 仓库」、无 git 徽标）：主进程识别正常（openExternal 返回 `git.associated`），缺口在渲染端——openAction 成功后只 `loadVaults`，**没把 git 状态写入 `tree.gitStatuses`**（徽标与菜单分流的数据源），新注册的库从未入表恒为未关联态。修复：openAction 补 `tree.refreshGitStatus(result.name)`。

**验证方式（运行中实例不可扰）**：用户 dev 实例（CDP 9222）正在真机验证，不启动第二实例（`TRACE_TEST_USERDATA` 固定路径会共享 userData + 缓存锁冲突 crash，见 [tech_verification 教训 16](../../tech/tech_verification.md)）——对其做**纯只读 CDP 断言**证实两根因（`gitStatuses[note_repo]` MISSING / `.side-row-actions` 计算样式 display:none），修复后 `menuHoldCssExists=true` 佐证 vite HMR 已把 CSS 修复热更进运行中实例。**用户重启复验：两项确认解决（2026-10-09）**。
