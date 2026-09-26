# 搜索体系重设计（FR-2.9.11 + FR-2.9.10 补充）

> 2026-09-26 立项（用户提出），同日实施完成。合并原待办「搜索支持标签维度」与此新提案。
> 状态：**✅ 已实施**（分支 `feat/search-redesign`，隔离实例 CDP 验证通过，实施记录见第 6 节）。

## 1. 需求背景

当前 `Ctrl+F` 打开全局搜索（跨库），但缺少两个常用搜索维度：

1. **当前库搜索**：类似 JetBrains 的 Double-Shift，快速在当前笔记库内检索（不跨库），用于「记得大概在哪篇，想快速定位」；
2. **当前笔记内搜索**：在正在编辑的笔记内查找 / 替换字符串（CodeMirror 6 内置 `searchKeymap` 已有完整面板，此前 `Ctrl+F` 被全局搜索拦截导致编辑器内不可达）。

同时原待办「搜索支持标签维度」合并入本次重设计。

## 2. 需求

### FR-2.9.11 搜索体系重设计

| 搜索层级 | 触发（拍板后） | 范围 | 实现 |
| --- | --- | --- | --- |
| 全局搜索 | `Ctrl+F`（编辑器外） | 跨所有库 | SearchDialog + SearchService（不变），新增标签筛选下拉 |
| **当前库搜索** | `Shift Shift`（连按两次，D1 拍板） | 预置为当前笔记所在库（可下拉改回所有库） | 复用 SearchDialog，`stores/search.openSearch(vault)` 携带预置范围 |
| **当前笔记内搜索** | `Ctrl+F`（编辑器聚焦时，D2 拍板焦点分流） | 当前笔记 | CodeMirror 6 内置 searchPanel（查找 / 替换 / 全部替换 / 大小写 / 整词 / 正则），面板文案经 `EditorState.phrases` 中文化 |

#### 子需求

- **标签维度搜索**（D4 拍板：独立多选下拉）：搜索索引结构化提取 frontmatter 标签（`@shared/noteTags` 的 `getFrontmatterTags`）；搜索框新增「标签」多选下拉（跨库聚合 + 篇数，命中任一选中标签即入围、与关键词取交集）；**只选标签不输关键词 = 浏览模式**（该标签下全部笔记各出一条，按最近修改排序）；
- **草稿范围**：搜索范围下拉含「草稿」选项（FR-2.3.9 已实现，保持不变）；
- **当前库搜索**：限定为当前笔记所在库；无当前笔记时回落全局搜索；模态打开时不触发（防误触）；
- **当前笔记搜索 / 替换**：searchPanel 完整能力，`Esc` 先收面板再逐级回退。

### 跨库引用改进（FR-2.9.10 补充，用户提出；语义已拍板为「复制」）

搜索跨库预览后 Alt+Enter 插入原本产出断链 `[[引用]]`。改进：

- **视觉区分**：悬浮预览框对跨库笔记加**红色萤光细边框**（`box-shadow` 走 `--danger` 主题变量），标题区显示「跨库文件」徽标；
- **插入确认（D3 拍板 ElMessageBox）**：跨库预览态按 Alt+Enter / 「插入引用」按钮时**不再直接插入断链**，弹出确认框「跨库文件会将笔记从原库复制到当前库中，改变原笔记时复制笔记内容不会同时改变，确定要强制引用吗？」；确认后**把笔记复制进当前库**（图片附件随迁并改写引用、目标目录重名自动加后缀 `-2`，对齐回收站「冲突加后缀不覆盖」约定），再插入指向副本的 `[[引用]]`——链接真实可跳转，与原笔记不再同步；
- **设置开关**：设置 → 通用 → 编辑器新增「跨库引用免确认」开关（`skipCrossVaultCopyConfirm`，默认关 = 默认弹确认），开启后跨库 Alt+Enter 直接复制不再弹框；
- **草稿例外**：目标是草稿（scratch 伪库）→ 维持拦截提示「请先转正」；当前笔记是草稿 → 维持 D7 直接落引用文本（转正时再定归宿）。

## 3. 决策记录（2026-09-26 与用户逐项确认）

- **D1 当前库搜索触发方式**：✅ **Double-Shift**（JetBrains 惯例，不占新快捷键）。350ms 窗口、中间无其他键、非 repeat、非输入法组词；带修饰键的 Shift（如 Ctrl+Shift+H）不计数。
- **D2 当前笔记搜索快捷键**：✅ **焦点分流**——编辑器聚焦时 `Ctrl+F` 走 CM 搜索面板，编辑器外仍开全局搜索。无新增键位；编辑中想开全局搜索用侧栏搜索按钮或 Double-Shift。
- **跨库「强制引用」语义**（实施中发现的文档歧义，补充拍板）：✅ **复制笔记到当前库**——确认框文案「会将笔记从原库复制到当前库中」即此义；直接插 `[[引用]]` 在当前库必然断链，无实用价值。
- **D3 确认框交互**：✅ **ElMessageBox 模态弹窗**（与删除确认等全局交互一致；`hasModalOpen` 已纳入其 wrapper，Esc 不会级联）。
- **D4 标签维度搜索形态**：✅ **独立标签多选下拉**（发现性好、零学习成本；选项从搜索索引跨库聚合，`search:listTags` IPC）。

## 4. 主要改动

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 主进程 | `services/search.ts` | 索引项加 `tags`（结构化标签）+ content 掩码 frontmatter（行号对齐不变、不再误命中 frontmatter 行）；`search()` 支持 `tags` 过滤（OR + 交集）与空关键词浏览模式；新增 `listTags()`；移除无人调用的 `clearIndex()` |
| 主进程 | `services/noteCopy.ts`（新） | `copyNoteAcrossVaults`：读源笔记 → `createNote` 命名校验 + 重名自动后缀 → 库内相对引用（markdown 圆括号 / HTML img src）解析到源库根、复制文件到目标附件目录（重名加序号）+ `relReference` 改写 → `writeNote` 落盘；依赖注入仿 `scratchPromote` |
| IPC | `registerIpc.ts` / `shared/api.ts` / `preload` | 新增 `search:listTags`、`note:crossVaultCopy`；删除死通道 `search:updateFile` / `search:removeFile` / `search:clearIndex` |
| 设置 | `shared/types.ts` + `main/index.ts` + `stores/app.ts` + `SettingsView.vue` | `skipCrossVaultCopyConfirm`（三处默认值 + 编辑器区块开关行） |
| 编辑器 | `MarkdownEditor.vue` | 删除 `Mod-f` 拦截绑定（searchKeymap 自然接管）；`EditorState.phrases` 中文化面板；traceTheme 补 `.cm-panel.cm-search` 配色；Alt-Enter 跨库分支改为 emit `insert-cross-vault` 交外层统一处理 |
| 应用壳 | `App.vue` | `Ctrl+F` 焦点分流（`activeElement` 在 `.cm-editor` 内则让位）；`onEscape` 给搜索面板让位（先收面板）；注册 Double-Shift 检测器（`hasModalOpen` 防误触）；Alt 系键在 CM 面板聚焦时让位（面板自带 Alt+C/R/W 切换键，避免 Alt+W 双触发） |
| 搜索 UI | `SearchDialog.vue` + `stores/search.ts` | store 清理为 `visible / presetVault / openSearch(vault?)`（死链路销账）；预置范围消费；标签多选下拉；空关键词 + 标签的浏览模式 |
| 悬浮预览 | `EditorView.vue` | `insertPreviewTarget` 收口库内直插 / 跨库确认复制两条路径（编辑器 Alt+Enter 与插入按钮共用）；跨库态 class（萤光边框 + 徽标）；移除旧 `canInsertReference` 拒绝式校验 |
| 快捷键表 | `config/shortcuts.ts` | `Ctrl+F` 双语义、`Shift Shift`、Esc 链更新 |

## 5. 测试

- 新增单测 28 项：`tests/searchService.test.ts`（标签提取 / 掩码行号对齐 / 标签过滤 OR 与交集 / 浏览模式 / 库范围叠加 / 增量刷新 / 草稿伪库）、`tests/noteCopy.test.ts`（引用提取 / 基础复制 / 重名后缀 / 图片随迁与 `../` 引用改写 / 附件重名加序号 / 源不存在 / URL 不随迁）、`tests/doubleShift.test.ts`（窗口 / 中间键清零 / repeat / 组词 / 修饰键 / 触发重置 / 手动 reset）。全量 392 项通过，lint / typecheck 干净。

## 6. 实施与验证记录（2026-09-26，隔离实例 CDP）

实测环境：`TRACE_CDP=9222 TRACE_TEST_USERDATA=1`，工作区 `/tmp/fr-search-ws`（库A / 库B，含 frontmatter 标签与附件图片）。

| # | 验证项 | 结果 |
| --- | --- | --- |
| 1 | 编辑器外 `Ctrl+F` → 全局搜索框 | ✅ |
| 2 | 标签下拉选项与篇数（重要(2)/工作(1)/生活(1)/素材(1)/学习(1)） | ✅ 与夹具一致 |
| 3 | 标签 × 关键词交集（生活 × 「的」→ 空）；取消后命中恢复 | ✅ |
| 4 | 空关键词 + 标签 = 浏览模式（生活 → 仅「购物 @库A」） | ✅ |
| 5 | 搜索结果点击 / Enter 打开笔记 | ✅ |
| 6 | Double-Shift → 搜索框打开且范围预置「库A」 | ✅ |
| 7 | 编辑器聚焦 `Ctrl+F` → CM 面板打开、焦点入面板、文案中文（下一个（Enter）/区分大小写（Alt+C）/正则表达式（Alt+R）…） | ✅ |
| 8 | `Esc` 先收面板；编辑视图与心流等层级不受影响 | ✅ |
| 9 | 跨库预览：红色萤光边框 class + 「跨库文件」徽标（截图确认） | ✅ |
| 10 | Alt+Enter → ElMessageBox 确认框（需求原文文案 + 取消 / 复制并引用） | ✅ |
| 11 | 确认后复制：库A/素材.md + attachments/pic.png 落盘、引用改写 `./attachments/pic.png`、frontmatter 保留、`[[素材]]` 插入并自动保存、新副本即时进索引 | ✅ |
| 12 | 免确认开关（设置页切换 → is-checked）后重复跨库插入：无弹框直接复制 | ✅ |
| 13 | 重名自动后缀：素材-2.md + pic-2.png、引用同步改写 `pic-2.png` | ✅ |
| 14 | 顺带回归：自动保存、外部修改静默重载、watcher → 搜索索引增量更新 | ✅ |

**踩坑记录**（已同步 `ai/tech/tech_cm6-editor.md` 与 index 〇.3）：

- **@codemirror/search 6.7+ 的面板类名是 `.cm-panel.cm-search`**，不是旧文档 / 旧教程的 `.cm-searchPanel`——Esc 让位判断与主题样式若按后者写会静默失效（本次实测第一次就踩中，探针查 `anyPanel` 才发现面板其实已打开）；
- 验证探针教训（旧话重提）：**el-dialog 关闭后 DOM 仍驻留**（仅隐藏），以「元素存在」判断对话框开合会误判，须查 overlay 的 `display`；
- `Input.dispatchKeyEvent` 的组合键在本环境对 Element Plus 组件内的 Vue 修饰符监听（`@keydown.alt.enter`）不可靠，DOM `dispatchEvent(new KeyboardEvent(...))` 可靠；CM（contentDOM 级监听）则两种都可靠。

**已知边界（有意保留）**：

- 搜索对话框的范围 / 标签筛选跨开合保持（与库范围的既有行为一致），重开不重置；
- 跨库悬浮预览中的图片按**当前库**解析相对路径，源库图片在预览里显示为占位图（复制后即正常）——既有行为，不在本次范围内修正。

## 7. 难度与工时（立项时预估 → 实际）

| 子项 | 预估 | 实际 |
| --- | --- | --- |
| 当前笔记搜索（CM searchPanel 接线） | ★ 0.5 天 | ★ 0.5 天 |
| 当前库搜索（Double-Shift + 预置范围） | ★★ 1 天 | ★★ 1 天 |
| 标签维度搜索（索引 + 匹配 + UI） | ★★ 1 天 | ★★ 1 天 |
| 跨库引用改进（复制语义，比原「视觉 + 确认框」估的重） | ★ 0.5 天 | ★★ 1~1.5 天 |
| 死链路清理 / 文档 | — | 0.5 天 |
| **合计** | ★★☆ 2.5~3.5 天 | **★★☆ 约 4 天**（含验证与文档） |
