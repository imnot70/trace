# 标签功能优化 二期设计（FR-2.6.15–17）

> 2026-10-09 实施（分支 `feat/tag-enhance-2`，基线 v0.18.0）。需求见 [tag-enhance.md](tag-enhance.md)；
> 一期（FR-2.6.12–14）已随 v0.11.0 发布。本文记录三项的方案要点、实施修正与验证。

## 1. 总体

| FR | 内容 | 渲染端 | 主进程 |
| --- | --- | --- | --- |
| 2.6.15 | 标签合并 | 侧栏合并弹窗 + `tagRowItems` 菜单项（⋮ / 右键同源） | `TagsService.mergeTags`（全库一趟改写 + 删定义） |
| 2.6.16 | 笔记数 / 最近使用排序 | `composables/tagSort.ts` 单一口径（侧栏 + 打标签弹窗共用） | `TagsService.tagStats`（全库一趟聚合 + `fsTree.noteMtime`） |
| 2.6.17 | frontmatter 胶囊编辑 | `FrontmatterWidget` 胶囊化 + 编辑器接线 TagPickerDialog | —（全部走既有缓冲区写入路径） |

新增 IPC：`tag:stats`（统计）、`tag:merge`（合并）；shared：`TagStatInfo` 类型 + `api.ts` 两签名。

## 2. FR-2.6.15 标签合并

- **数据流**：`mergeTags(sourceId, targetId)` 校验（存在性 / 不能合并到自身，同 id 与大小写同名都拦）→ 遍历全部笔记（一趟 `walkNotes`）：含来源名（大小写不敏感）的笔记 → 移除来源名；剩余里没有目标名（大小写不敏感）时补上**定义的规范写法** → `writeNoteTags` 写回（hash 防覆盖、YAML 解析失败保护原文，与重命名 / 删除同管线）→ 统计实际改写篇数 → 删除来源定义。
- **UI**：`tagRowItems` 加「合并到…」（`menuItems.ts` 单一定义源，⋮ 与右键同时获得）；合并弹窗展示来源笔记数（来自 `tag:stats`）+ 目标选择下拉（选项带笔记数，filterable）；确认后调用并 toast 改写篇数。
- **筛选集合善后**：正在按来源标签筛选的网格，合并后从 `app.view.tagIds` 移除来源 id，清空则回欢迎页（避免残留「幽灵筛选」）。

## 3. FR-2.6.16 排序

- **统计来源**：不用搜索索引（其含草稿、且启动期可能未建好），由 `TagsService.tagStats()` 全库扫描一趟聚合：按标签名（小写）聚合计数与最大 mtime（`fsTree.noteMtime`，文件缺失回 0）。未登记定义的 frontmatter 标签同样计入（与筛选可见口径一致）。
- **按需拉取**：默认（创建序）不拉统计——保持既有加载成本为零；切到非默认模式或标签操作后（`refreshTagData`）才拉。打标签弹窗同理（每次打开重建，从 localStorage 读模式后按需补拉）。
- **单一口径**：`composables/tagSort.ts` 输出模式定义 / localStorage 键（`trace.tagSort`）/ `sortTags`（并列时中文名 `localeCompare` 兜底，顺序稳定不抖动）；侧栏与弹窗共用。非默认排序时侧栏标签行显示笔记数（让排序依据可见）。
- 模式：`default`（创建序，现状不变）/ `count`（降序，缺失视同 0）/ `recent`（笔记最大 mtime 降序）。

## 4. FR-2.6.17 frontmatter 胶囊

- **渲染**：`FrontmatterWidget` 从「摘要文本」升级为「badge + 彩色胶囊列表 + ＋ 标签」；无标签时退回「N 行元数据」。颜色来自 `LivePreviewConfig.tagColors` 快照（MarkdownEditor 从 tree store 的标签定义构建，小写名映射）；`eq` 比较名字 + 颜色——改色后经 Compartment 重配（watch 源加入 `tree.tags`）触发 StateField 重算 → eq 失配 → DOM 重建。
- **交互**（全部 mousedown 即处理 + `ignoreEvent`，复选框 widget 同款竞态规避——等 click 会被光标定位展开源码抢走）：
  - 胶囊悬浮出现 ×，点击 → `removeFrontmatterTags`：`setFrontmatterTags` 算新全文 → **公共前 / 后缀收敛成最小替换区间** dispatch（正文零触碰、光标稳定、撤销为单步）；
  - 「＋ 标签」→ 冒泡自定义事件 `trace-frontmatter-add-tag` → MarkdownEditor 打开自挂的 `TagPickerDialog`（编辑中笔记走缓冲区分支，增删 / 内联新建 / 过滤全部复用）；`changed` 后刷新 tree store 标签定义快照（新标签的胶囊配色）。
- **配色刷新链**：改色 → `tree.loadTags()`（数组整体替换）→ watch 触发重配 → facet 引用变化 → `lpBlockField` 的 `cfgChanged` 分支重算。

## 5. 实施修正（相对原设想）

1. 弹窗内 `v-model` 直绑 `mergeDialog.targetId` 会空引用——el-dialog 关闭后 DOM 驻留（已知坑），改 computed 兜底（与 `colorDialogColor` 同款）。
2. 统计聚合不依赖搜索索引：索引含草稿（`updateFileIndex` 手动喂入）且启动期未就绪，标签统计必须与「网格可见」口径严格一致。
3. `filteredTags` 原实现无查询时直接返回原数组引用；改为始终经 `sortTags` 返回新数组（排序模式下弹窗列表与侧栏同源排序）。

## 6. 验证

- 单测 +9：`services.test.ts` 标签块 +4（合并改写与大小写归并 / 拒绝同自身与未知 id / 统计聚合计数与 mtime 最大值 / 既有 47 项不回归）、`tagSort.test.ts` 新文件 4 项、`livePreview.test.ts` frontmatter 用例升级（胶囊载荷 + 配色快照映射）。全仓 566 项全绿（90s 口径）。
- `npm run typecheck`（主 / 渲染双端）与 `npm run lint` 全绿。
- **CDP 隔离实例冒烟 10/10 过**（`TRACE_CDP=9222 TRACE_TEST_USERDATA=1`）：建库 / 建笔记 / 建标签定义 → 开笔记写 frontmatter → 开所见即所得 → 胶囊渲染 2 枚、文字与首胶囊配色（rgb 231,76,60 = #e74c3c）正确 → × 移除「随笔」缓冲区与磁盘双重断言（`tags:\n  - 工作`）、剩余胶囊 1 枚 → 「＋ 标签」呼出「管理标签」弹窗 → 侧栏排序按钮存在、按笔记数模式行显计数 `[1, 0]`（随笔已移除后为 0，符合预期）。
- **验证手法教训**：CDP 合成鼠标（`Input.dispatchMouseEvent`，命中测试正确落在 `.cm-content`）与合成方向键都**不驱动 CM 光标**（与 2026-09-26「原始字符按键不稳定」同类）；可靠手法 = `.cm-content.focus()` + `Selection.collapseToEnd()`（经 selectionchange 被 CM 采纳）。另：frontmatter 折叠 widget 只在光标不相交 frontmatter 区间时渲染（`occupied` 回落源码语义），脚本断言前必须先把光标挪到正文——真实用户交互天然满足。
- 真机验证待用户确认后随版发布（焦点：合并大库的耗时体感、胶囊交互手感、排序稳定性）。
