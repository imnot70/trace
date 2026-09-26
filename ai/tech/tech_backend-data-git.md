# tech_backend-data-git — 主进程 / 数据 / Git 踩坑

> 来源：由 `requirements/lessons.md` 与 [tech-debt-2026-09-25 评审](../requirements/index.md)（2026-09-26 拆分归档）合并。红线约定（文件是唯一事实来源、不悄悄丢数据、令牌安全、校验规则前后端一致）见 [AGENTS.md](../../AGENTS.md)。

## 安全与边界

1. **渲染端传参不可信，路径必须过 `resolveWithin`**：冲突解决接口曾因直接 `path.join` 渲染端传来的 filePath 存在**路径穿越安全洞**（可 `../` 越权写库外文件，v0.8.5 修复）。任何「vault + 相对路径」的 IPC 入口都要有库内守卫。
2. **设置写入要按 schema 键集合白名单过滤**：`Object.assign` 直合会让渲染端任意 patch 落盘，升级换名后幽灵键永远留在 settings.json（v0.8.5 修复）。
3. **日志统一脱敏，任何新日志不得输出令牌**；PAT 仅经 `http.extraheader` 每次调用注入，绝不写 `.git/config`。（[AGENTS.md](../../AGENTS.md)）

## 数据持久化

4. **JsonStore 是所有应用元数据的底座，必须版本化**：`schemaVersion` + `migrate()` 钩子 + 深合并（浅合并 `{...defaults, ...parsed}` 会在升级时丢嵌套默认键，`sidebarMenus` 已踩此雷区）+ 损坏时留 `.bak` + fsync。散落的 ad-hoc 迁移要收进去——趁数据文件还少赶紧做，越晚越难写（v0.8.5 已落地地基）。
5. **枚举类设置删除旧值时要「迁移三件套」**：启动时持久化迁移（旧音色 `wood/metal/ratchet` → `retro` 的案例）+ 运行时播放兜底（`default` 分支承接过期值）+ 类型联合收窄——否则出现选择器空白 + 静默无声。（[flow-mode 设计 10.8](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）

## 索引与监听

6. **索引必须有完整生命周期**：只在启动时构建一次的索引，运行期不更新会把「显示有 bug」逼成面板被隐藏（双链索引首版教训）；watcher 挂起期（git 同步中）丢弃的变更要在 resume 后补偿重建**双链 + 搜索**索引并重发 `fs:changed`；防抖要有 max-wait 兜底（持续写入会无限推迟通知）。
7. **工作区外的文件（如草稿 scratch）watcher 看不到**：落盘后要手动调增量索引（`search.updateFileIndex`），转正 / 删除时对应 remove。（[draft-notes 设计 §3.5](../requirements/2026-09-26_draft-notes/draft-notes_design.md)）
8. **双链索引语义**：反向链接限同库、detailKey 按行内序号存取（按行号会让同行多引用互相覆盖）、索引按叶子名归属（路径形式双链不误报断链）；双链只在库内解析——跨库搜索预览后插入引用会产出永远断链的 `[[引用]]`，插入前必须校验目标库与当前库一致（已随 v0.8.8 发布）。（[wiki-link-anchor 设计 §7.2](../requirements/2026-09-12_wiki-link-anchor/wiki-link-anchor_design.md)、[draft-notes 设计 §3.5](../requirements/2026-09-26_draft-notes/draft-notes_design.md)）

## Git 同步

9. **git 语义陷阱——ours / theirs 随操作类型反转**：merge 冲突里 ours=HEAD=本地，而 `pull --rebase` 的冲突中 HEAD 是被变基到的**远端上游**、本地提交在被重放侧（REBASE_HEAD）——「接受本地版本」要按变基状态对调取值（v0.8.5 修复，端到端单测锁定）。
10. **simple-git 的安全拦截要显式放行**：`-c core.editor=true` 跳过变基编辑器提示会被默认拦截（需 `allowUnsafeEditor`，配置值由应用自身提供非外部输入）。
11. **同步要按库互斥**：手动同步与 autoSync 定时器可并发对同一仓库执行，撞 `.git/index.lock` 时把内部错误直接暴露给用户——按库串行排队（v0.8.5 修复）。
12. **变基是逐提交重放的，冲突可能连环出现**：「继续同步」遇到后续提交的新冲突要刷新冲突列表并重置解决状态；冲突未处理完时再点同步应带出列表重新打开解决对话框（v0.8.5 修复的自愈路径）。

## 已核实缺陷案例库（2026-09-25 评审，全部已随 v0.8.5–v0.8.7 修复）

> 原始证据与行号基准（commit `eae9abf`）随代码演进会漂移，定位以文字描述为准。保留作为「同类问题怎么找」的案例。

| # | 缺陷 | 教训要点 |
| --- | --- | --- |
| 1 | 冲突解决接口路径穿越（安全 P0） | `resolveWithin` 就在 lib/paths，唯独一处漏用——新 IPC 入口要过守卫清单 |
| 2 | 搜索打开笔记污染常用列表 | 绕过 actions 统一入口裸调 `openNote` 并把整篇内容当显示名传入 |
| 3 | 搜索索引不随文件变更更新 | watcher 增量链只接了双链，search 不在链上；渲染端死 IPC 链路无人调用 |
| 4 | `settings:set` 无白名单 | 见上文第 2 条 |
| 5 | git 同步无按库互斥 | 见上文第 11 条 |
| 6 | watcher 通知链两处缺口（补偿只重建双链、防抖无上限） | 见上文第 6 条 |
| 7 | JSON 持久化地基薄（无版本迁移 / 浅合并 / 损坏静默回退 / 无 fsync） | 见上文第 4 条 |
| 8 | 小项：双链正则不避代码块、死通道 `export:resetDir`、`continueRebase` 错误串绕过中文映射、PAT 经 argv 残余可见（接受现状） | 错误文案必须走 errMessage 中文映射，不能拼原始 `${e}` |
