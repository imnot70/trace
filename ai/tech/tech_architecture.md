# tech_architecture — 架构评估与工程约定

> 来源：由技术债评审《tech-debt-2026-09-25》（2026-09-25 全仓架构与技术选型快照）与 `requirements/lessons.md` §六（2026-09-26 拆分归档）合并。评审方法：人工精读核心模块 + 两路并行探查渲染端（12.5k 行 / 49 文件）与主进程（6.8k 行）交叉验证；行号基准 commit `eae9abf`（已漂移，定位以文字描述为准）。缺陷证据已移 [tech_backend-data-git](tech_backend-data-git.md)。

## 〇、总体结论

**架构骨架是健康的，没有结构性腐烂**：三进程隔离、类型化 IPC（88 个方法编译期锚定）、「文件是唯一事实来源」贯彻彻底；TypeScript 质量优秀（`@ts-ignore` = 0、`: any` 仅 6 处）；`lib/livePreview/` 是深模块范本（纯函数计算核心 + 渲染 widget + 装配三层分离，可单测）；插件系统是主进程设计最好的部分（判别联合 RPC、超时/背压/崩溃守护完整、权限检查收口在纯函数）。

问题集中在三类：① 评审核实的缺陷（已全部修复，见 [tech_backend-data-git](tech_backend-data-git.md) 案例库）；② 视图层随功能堆积开始失控（见 §三）；③ 地基薄点——持久化无版本迁移、索引生命周期不完整、UI 层零测试（均已修复 / 见 [tech_verification](tech_verification.md)）。

## 一、技术选型评估（避免反复重议的快照）

| 领域 | 选型 | 结论 | 一句话理由 |
| --- | --- | --- | --- |
| 桌面框架 | Electron 44 | **保留** | safeStorage / WCO / utilityProcess / printToPDF 均被深度使用；换 Tauri 是全量重写，收益撑不起成本 |
| 编辑器 | CodeMirror 6 | **保留（全项目最正确的选型）** | 「文件即纯 Markdown」只有 CM6「源码为底、装饰为表」的模型能优雅支撑；P0 回归集中在集成层是 wysiwyg 的固有成本，教训沉淀见 [tech_cm6-editor](tech_cm6-editor.md) |
| UI 组件 | Element Plus | **保留，但停止加深依赖** | tooltip 禁令 / popper 闪影等集成摩擦在持续产生隐性成本；新 UI 优先自有样式 + CSS 变量，EP 只留对话框/下拉/消息类 |
| git 同步 | simple-git + 内置 Git | **保留，收口而非替换** | PAT 不落盘、extraheader 注入、rebase 管线规避 autostash 都对；包体 +15.7% 等代价已知可控 |
| 搜索 | 自研内存索引 | **最薄弱，待重构** | 索引生命周期缺陷已修（v0.8.5），结构化标签检索与「搜索支持标签维度」立项合并解决 |
| 渲染管道 | markdown-it + KaTeX + highlight.js | 保留 | 够用；Shiki 输出更好但同步 API 重，不值得换 |
| 文件监听 | chokidar | 保留 | 用法缺口已补（v0.8.5），非选型问题 |
| 测试 | Vitest + 双 typecheck | 保留，**补 UI 层** | 服务层单测是强项；CM6 集成层零测试是最大空洞（[tech_verification](tech_verification.md)） |

## 二、架构改进项（随功能顺路做，不专门立项）

**渲染端**：
1. SettingsView 拆分（1455 行承载 8 个功能域，第一刀拆出 PluginSettings 子组件 + stores/plugin.ts）；
2. **IPC 访问纪律**：视图/组件只走 store 或 composables，store 是唯一 IPC 门面（`stores/editor.ts` 是范本）——搜索打开笔记污染常用列表的 bug 就是绕过纪律的直接代价；
3. store 依赖理顺（app↔tree 模块级循环 import；useRemoteRepos 藏在 trash.ts；git store 里的对话框状态应下沉 actions 层）；
4. 重复代码收敛（文件夹导出级联两份、slugify 两份、refresh 级联重复 6 次）；
5. lib 层越界（`lib/wikilink.ts` import Vue 的 h + ElMessage 并直调 window.trace——对话框流程混进 lib 层，应降级为 composable）。

**主进程**：
1. **rename/delete 的跨服务级联（双链改写、收藏、最近打开）下沉领域服务**——写在 IPC 层的话，未来任何新入口（插件 API、导入向导）都要复刻整套级联，漏一处就是静默数据不一致；
2. registerIpc（695 行单函数）按域拆文件、try/catch 收敛到统一 `handle()` 包装器；
3. 主进程 handler 签名无类型锚（preload 侧有 `const api: TraceApi`，IPC 链条上唯一未闭合的一环）；
4. fsTree / vaults / favorites 日志覆盖补齐；
5. 保存回声抑制依赖读盘时序比对（可用可文档化，出问题再考虑写入方打标）。

## 三、工程流程教训

1. **「文件是唯一事实来源」与「应用元数据不进笔记库」是红线**；新增 IPC 能力走固定路径：shared 定类型 → 主进程 services 实现 → registerIpc 注册 → preload 暴露 → 渲染端经 window.trace 调用。（[AGENTS.md](../../AGENTS.md)）
2. **「不悄悄丢数据」**：保存有外部修改 hash 保护；删除一律先进回收站（草稿等「临时」语义例外且要红色确认）；危险操作红色警示 + 确认。（[AGENTS.md](../../AGENTS.md)）
3. **修复尝试引入新问题时果断放弃**：`fix/typewriter-cleanup`（destroyed 方案）验证中发现两个新问题，整分支删除未合入，缺陷回到待修状态并要求**先聊方案再动手**——沉没成本不该绑架决策。（[index 第二节](../requirements/index.md)）
4. **CHANGELOG 条目必须与发布版本真实对应**：底色纹理在 v0.8.7 打标签后才合入 main，条目却写进了已发布的 `[0.8.7]` 段，会误导用户以为安装包含此功能——新变更一律写 `[未发布]` 段，随实际发布的版本归档。（2026-09-26 案例）
5. **文档欠账视为改动未完成**：行为变更同步 CHANGELOG / PRD FR / 设计文档实施记录 / index 状态——commit message 记录「改了什么」，文档记录「产品现在是什么」；push / 发版前的文档检查是**强制项**。（[AGENTS.md](../../AGENTS.md)）

## 四、明确不做的事

- 不换 UI 框架、不换编辑器内核、不上 Tauri——迁移成本远大于收益；
- **不引入 SQLite 或任何后端**：「纯文件 + git」是产品差异化根基；
- 不搞专门的「重构季」：小步快发的节奏是资产，改进项全部随功能顺路做（童子军军规）。

## 五、建议落地顺序（2026-09-25 评审提出，状态随版本更新）

1. ~~加固批次~~（§缺陷 1–7）——**已随 v0.8.5 修复**；
2. **搜索重构**：与「搜索支持标签维度」功能合并立项（形态讨论 + 索引生命周期重构同批落地，立项时补 FR 编号）——待立项；
3. **Playwright E2E 冒烟**：三条链路先行——待做（见 [tech_verification](tech_verification.md)）；
4. §二架构项随功能顺路。
