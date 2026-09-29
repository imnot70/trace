# 心流快速引用面板 — 技术设计

> 需求文档：[flow-quick-ref-picker.md](flow-quick-ref-picker.md)（FR-2.9.12，决策 D1–D5 见该文档）。
> 建议存档（思路原稿）：[../../suggest/flow-quick-ref-picker.md](../../suggest/flow-quick-ref-picker.md)。

## 1. 总体形态

一个挂在 `EditorView` 的模态组件 `QuickRefPicker.vue`（el-dialog，`SearchDialog.vue` 同构），呼出状态放 app store（`quickRefPickerOpen`），三个入口都只翻转这一个状态：

```
Alt+I（App.vue 全局键，编辑视图守卫）──┐
/引入 斜杠命令（MarkdownEditor.runSlashAction）──┼─→ app.openQuickRefPicker() ─→ QuickRefPicker 显示
（二期预留：其他调用方）──────────────┘
```

与搜索弹窗挂 `App.vue` 不同，本面板挂 `EditorView`：引入 / 跨库确认都强依赖编辑器上下文（`insertPreviewTarget` / 编辑器 expose 方法都在这一层），不需要跨视图握手。

## 2. 入口与键位（D1）

- **`Alt+I`**：注册在 `App.vue` 的全局 Alt 系键处理链（与 `Alt+T` / `Alt+M` 同款守卫 `app.view.name === 'editor' && editor.current`）；`Alt+I` 全局空闲已核查（App.vue 处理链与 shortcuts 均无占用）。开关语义：开面板 / 关面板；
- **`/引入`**：`slashCommands.ts` 新增 action kind `{ kind: 'insertRef' }`（别名 `ref` / `insert`）；`runSlashAction` 里 `app.openQuickRefPicker()`（补全 apply 已先删除 `/引入` 文本，既有机制）。注意斜杠命令执行后编辑器失焦由面板接管，无需 `view.focus()`；
- **速查表**：`config/shortcuts.ts` 「编辑器」分组登记一行（`Alt + I`，注明心流可用与 `/引入` 同义）。

## 3. 面板组件 `QuickRefPicker.vue`

### 3.1 结构（单栏：过滤框 + 视图区）

```
┌─ 插入引用 ──────────────────────── ✕ ─┐
│ [ 过滤笔记…                （可留空） ] │
│ ┌──────────────────────────────────┐ │
│ │ ▾ 测试库                          │ │  ← 树形态（过滤为空）
│ │   ▾ 日记/                         │ │
│ │       📄 2026-09-28   ← 高亮       │ │
│ │   ▸ 项目/                         │ │
│ │ ── 草稿（不进同步与双链）────────── │ │  ← 草稿分组（D3/D4）
│ │     📄 未命名笔记 · 2 小时前       │ │
│ └──────────────────────────────────┘ │
│  Enter 引入   Alt+Enter 预览   Esc 关闭 │  ← 底部键位提示条（搜索弹窗同款）
└──────────────────────────────────────┘
```

- **el-dialog** 参数照抄 SearchDialog：`:close-on-click-modal="false"`、`:close-on-push-escape="true"`、`@close` 归 `app.closeQuickRefPicker()`；宽度收窄（树不需要 52%，取 420px 左右固定宽）；
- **数据源**：
  - 当前库树：`treeStore.trees[vault]`（`NoteTreeNode[]`，懒加载——若当前库树未拉取，打开时触发一次 `refreshVault`）；渲染直接递归 `kind === 'dir'` 展开 / `kind === 'note'` 叶子，**不引入 `collectNotes` 扁平化**（那是补全 / 过滤态用的）；
  - 草稿：`draftStore.drafts`（`DraftItem[]`，含名称与时间；未加载时打开面板触发一次 `scratchList`）；
- **过滤态**：输入非空 → 视图切为扁平列表，匹配复用 `flatCompletionOptions(nodes, prefix, '')`（同一实现保证与 `[[` 补全行为一致；含路径消歧 detail、重名插完整路径）；输入清空 → 回树形。草稿项以 `草稿：名称` 形式参与过滤匹配（独立数组拼接在结果尾部，标草稿徽标）；
- **落位（D5）**：`onMounted`（面板打开）时按 `editor.current.path` 逐级展开树路径并高亮该笔记、滚动到可视区。

### 3.2 键盘导航（列表模式与树模式同一套光标语义）

内部维护**扁平化光标序列**：树形态把「当前展开状态下的可见节点」投影成一维数组（文件夹节点也在序列里，`→` 展开、`←` 收起或跳回父文件夹），高亮索引 `hl` 驱动滚动定位（`scrollIntoView({ block: 'nearest' })`）。

| 键 | 树形态 | 过滤态 |
| --- | --- | --- |
| `↑` / `↓` | 高亮上 / 下移（文件夹未展开则不进入其子级） | 列表上 / 下移 |
| `→` | 展开文件夹；已是笔记则无操作 | — |
| `←` | 收起文件夹；笔记则高亮跳到父文件夹 | — |
| `Enter` | 引入高亮项 | 引入高亮项 |
| `Alt+Enter` | 两段：预览未开 = 悬浮预览（面板**保持打开**——2026-09-29 用户反馈修订，预览随 ↑/↓ 选中自动跟随）；**预览开着 = 插入当前选中引用**（同日二次定案，与 `[[` 补全预览态一致） | 同左 |
| `Esc` | 分级消费：预览开着先关预览回焦过滤框，再按关面板（组件内显式收口，幂等于 el-dialog 内建） | 同左 |
| 任意字符 | 落入过滤框（焦点常驻输入框，导航键在输入框 keydown 上拦截 `preventDefault`） | 同左 |

焦点模型照抄搜索弹窗：**焦点常驻过滤输入框**，↑↓/Enter/Alt+Enter 在输入框的 keydown 处理器里消费（`@keydown.enter.exact` / `@keydown.alt.enter.prevent` / 自定义 ↑↓ 处理）——避免焦点在树与输入框之间来回搬运；树节点 hover 高亮 + 点击即选中并引入（单击选中、双击引入会拖慢动线，取单击引入，鼠标用户与 `Enter` 同语义）。

## 4. 引入管线（三路，全部复用既有实现）

### 4.1 当前库：`insertReferenceAtPath(path)`（新增 expose）

现有 `insertReferenceFromCompletion()` 绑定补全活动态（`completionStatus === 'active'` + `selectedCompletion`），面板场景不可用。在 `MarkdownEditor.vue` 新增并 expose 一个**两态括号一致性**插入函数，算法照抄既有的 `from` / `end` 计算（tech 教训 5 的两路语义收敛为一处）：

```ts
function insertReferenceAtPath(path: string): void {
  // 态 A：光标前有未闭合 [[（/\[\[[^\]]*$/ 命中）→ 从 [[ 起替换为 [[path]]，
  //       并吸收光标后紧邻的至多两个 ]（照抄 insertReferenceFromCompletion 的 while 吸收）
  // 态 B：无 [[ 上下文 → 光标处直接插入 [[path]]，光标落在引用末尾
}
```

验收标准 3 的两种状态（裸 `[[` 前缀 / 正文中间）分别走 A / B，单测直接断言文档变化。

### 4.2 跨库与草稿：`insertPreviewTarget` 复用（D3）

- 跨库：面板 emit → `EditorView.insertPreviewTarget(target)`（既有：确认框 → `crossVaultCopy` 复制进当前库 → 插入引用；免确认开关内部处理）；
- 草稿：同一路径，但 `insertPreviewTarget` 需要一个**可选文案参数**（如 `kind: 'draft'`），确认框文案从「该笔记属于其他笔记库」特化为「草稿将复制为当前库正式笔记后引用」——这是主进程 / EditorView 该函数的唯一改动点，改动约 5 行；
- 面板关闭时机：引入动作发起即关面板（`app.closeQuickRefPicker()`），确认框属于 EditorView 层的既有交互（与悬浮预览「插入引用」按钮同动线）。

### 4.3 Alt+Enter 预览（复用握手）

面板内 `Alt+Enter` → `app.closeQuickRefPicker()` + `app.requestNotePreview(vault, path, name)`（既有 `pendingNotePreview` 握手，EditorView watcher 消费）——与搜索结果 Alt+Enter 完全同款。

## 5. Esc 分级与 WCO 适配（D2）

- **无新增分级链级**：el-dialog 的 Esc 由 Element Plus 内建关闭；`hasModalOpen()`（App.vue 单一 Esc 处置点）已把 el-overlay 模态计入，面板开着时应用级回退（含退心流）自然让位——与搜索弹窗同一机制，验收标准 6 用 CDP 断言「面板 Esc 关闭后心流仍在」；
- **WCO**：v0.13.0 的遮罩避让规则作用于全部 `.el-overlay`（`html.platform-win` 下经 `env(titlebar-area-height)`），本面板自动继承，零新增 CSS；验证时核对遮罩 top 即可；
- **打字机**：面板无编辑器几何变化，`geometryChanged` 不触发；浮层显示 / 隐藏不产生 CM 事务——无重锚风险（设计确认项，冒烟覆盖）。

## 6. 测试设计

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| 插入函数 | `tests/quickRefInsert.test.ts`（新；或并入既有 livePreview.test） | 两态括号一致性：裸 `[[` 前缀（态 A 替换 + 吸收 `]]`）、正文中间（态 B 完整插入）、已闭合 `[[x]]` 后追加、行尾无 `]]` 的 `[[`；核心算法抽纯函数（输入「行前文 / 光标后文 / path」→ 输出「from/to/insert」）便于无 DOM 测试 |
| 过滤 | 并入 `tests/noteCompletion.test.ts` | `flatCompletionOptions` 已有覆盖，补草稿项拼接的用例（如抽 `mergeDraftMatches` 小函数则测它） |
| 斜杠命令 | `tests/slashCommands.test.ts` 追加 | `/引入` 注册、别名 `ref` / `insert` 命中、action kind 正确 |
| CDP 冒烟 | 隔离实例 | 心流态 `Alt+I` 呼出 → 树渲染（含草稿分组）→ 落位高亮当前笔记 → ↑↓/→ 导航 → `Enter` 引入当前库笔记（文档断言）→ `[[` 前缀态引入不双括号 → 过滤态切列表 → 草稿引入弹特化确认框 → `Alt+Enter` 预览握手 → `Esc` 关面板心流仍在；WCO 遮罩 top 避让断言（Windows） |

## 7. 工时与实施顺序

一期合计 **约 1~1.5 天**：

1. store 状态 + Alt+I + 斜杠命令 + 速查表（0.25 天）；
2. `QuickRefPicker.vue` 骨架：树渲染 + 草稿分组 + 落位（0.5 天）；
3. 键盘导航 + 过滤态切换（0.25 天）；
4. 三路引入接线 + `insertPreviewTarget` 草稿文案参数（0.25 天）；
5. 单测 + CDP 冒烟 + 文档收口（0.25 天）。

二期（全库树）：+0.5~1 天（树根改多库分组，节点引入全部走跨库确认复制；过滤态切全库 `collectNotes`）。

## 8. 风险与边界

- **树数据懒加载竞态**：打开面板时库树可能未就绪（冷启动直接心流写作）——面板打开触发 `refreshVault` 并显示加载态；树到达前禁用 Enter（防止引入空目标）；
- **草稿重名**：当前库可能存在与草稿同名的笔记（复制产物冲突）——复用 `crossVaultCopy` 的既有重名处理（副本专用目录 / md5 去重），不新写逻辑；
- **`[[` 上下文跨行**：态 A 判定仅看光标所在行（与补全 `matchBefore` 同口径），上一行的 `[[` 不算——与既有补全行为一致，不放宽；
- **Vim 模式**：面板焦点在 el-dialog 输入框，vim 键位不生效（vim 只绑定编辑器）；`Esc` 归面板——`shouldYieldEscapeToVim` 只在编辑器聚焦时让位，模态存在时 `hasModalOpen` 已先行短路，无冲突。

## 9. 实施与验证记录（2026-09-29，分支 `feat/flow-quick-ref-picker`）

### 9.1 交付清单（与设计 §1–§5 的对应）

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/lib/quickRef.ts`（新） | §3 纯逻辑：`referenceInsertSpec`（两态括号一致性，`\[\[[^\]]*$` 口径 = 补全 matchBefore 同源）、`flattenVisibleTree`（光标序列投影，隐藏文件跳过）、`locateNote`（D5 祖先展开集）、`filterDrafts` |
| `src/renderer/src/components/QuickRefPicker.vue`（新） | §3 面板：树形态 + 草稿分组 + 过滤态（`flatNoteOptions(collectNotes())` 同源匹配）；窗口级 keydown（搜索弹窗同款）；焦点常驻过滤框；单击目录行 = 展开（修正设计稿「单击即引入」对目录行的二义——目录行单击/Enter 均为切换展开，笔记/草稿行单击/Enter 均为引入）；Esc 组件内显式关闭（见 9.2-③） |
| `src/renderer/src/stores/app.ts` | `quickRefPickerOpen` + `toggleQuickRefPicker` / `openQuickRefPicker` / `closeQuickRefPicker` |
| `src/renderer/src/App.vue` | `Alt+I` 全局键（编辑视图守卫，同 Alt+T/M；toggle 语义，面板开着时再按关闭） |
| `src/renderer/src/lib/slashCommands.ts` | `/引入`（别名 ref / insert，kind `insertRef`） |
| `src/renderer/src/components/MarkdownEditor.vue` | `insertReferenceAtPath` expose（区间计算委托 `referenceInsertSpec`，事务带 `input.quickref` 注解）；`runSlashAction` 分支 |
| `src/renderer/src/views/EditorView.vue` | 挂载面板 + `onQuickRefInsert`（三路语义收敛进 `insertPreviewTarget`）/ `onQuickRefPreview`（`pendingNotePreview` 握手）；`insertPreviewTarget` 草稿分支重构（见 9.2-①）+ 兜底插入升级为括号感知 |
| `src/main/services/scratchPromote.ts` + `registerIpc.ts` + `shared/api.ts` + `preload/index.ts` | `keepDraft` 开关四件套（复制模式：原草稿与其 assets 保留、不删搜索索引）；IPC handler 逐段创建目标目录（见 9.2-②） |
| `src/renderer/src/config/shortcuts.ts` | `Alt + I` 条目 + 斜杠命令描述补 `/引入`（用户明确要求同步） |

### 9.2 实施中发现与修正（防再踩）

1. **`insertPreviewTarget` 的草稿分支原是「阻止 + 提示转正」**，按 D3 重构为三分支：草稿→草稿直插引用（FR-2.3.9 D7，转正时随迁）；正式笔记→草稿确认复制（确认文案特化，目录 `跨库引用/草稿`）；原跨库分支不动。改动比设计预估的「5 行文案参数」大，但三条动线（悬浮预览按钮 / Alt+Enter / 面板）语义就此统一；
2. **`promoteDraft` 是转正（move）语义**——`scratch.remove` + 逐个 `removeAsset`，直接复用会消费草稿，与 D3「复制、原草稿保留」相悖：加 `keepDraft` 开关跳过两类删除；**其 `createNote` 对不存在的父目录抛「父目录不存在」**（`subdirAbs` 守卫），首次复制到 `跨库引用/草稿` 必失败——IPC handler 按 `noteCopy.ensureTargetDir` 同口径逐段 `createDir`（「已存在」容错，文案含「已存在」即放行）；
3. **Esc 显式收口**：el-dialog 的 close-on-press-escape 监听在 document 层、依赖焦点在弹窗内；焦点漂移（如确认框关闭后）时 Esc 收不到。面板 keydown 处理器显式处理 Escape → `emit('close')`（幂等，与 EP 内建关闭共存），任何焦点状态下都可关闭；
4. CDP 冒烟两轮假阳性（脚本侧，非产品）：el-dialog 关闭后 DOM 驻留——「查到 .qr-row」不等于面板可见，必须断言 overlay 计算样式（index §3 既有教训的再次实例）；Alt+I 是 toggle 语义，脚本每节操作前先确认面板实际开合状态。

### 9.3 验证结果

- **单测 +15 项**（`tests/quickRef.test.ts` 14 项：两态插入矩阵含已闭合误判守卫 / 扁平化与隐藏文件 / 定位展开集 / 草稿过滤大小写；`slashCommands.test.ts` 1 项注册），全仓 **481 项**——gitService 8 项集成测试按 Windows 慢环境口径 `--testTimeout=90000` 单独验证 8/8 通过，其余全绿；lint / 主渲染双 typecheck 全绿；
- **CDP 隔离实例冒烟 15/15**（心流态）：Alt+I 呼出（树 4 行含草稿分组）→ D5 落位高亮「首页」→ WCO 遮罩避让 top=36px → ↑/→/↓ 导航展开 → Enter 引入 `[[日记/2026-09-28]]` 且面板关闭、心流保留 → `[[` 未闭合前缀态（真实点击落位光标 + execCommand 输入）引入不产生双括号 → 过滤「会议」命中草稿 → 特化确认框 → 确认后 `[[跨库引用/草稿/会议草稿]]` 插入、**原草稿保留**（scratchList 仍 1 条）→ Esc 关面板心流保留。

### 9.4 实施后用户反馈修订（2026-09-29 同日）

**Alt+Enter 预览不再关闭面板**（用户真机反馈：原实现预览后面板消失，连续预览多篇要反复 Alt+I——正是 FR-2.9.10 ③ 在搜索弹窗上修过的同款问题，v0.10.0 已把搜索框改为「保持打开」）。修订为与搜索弹窗完全同款的三段语义：

1. `Alt+Enter` → 悬浮预览打开，**面板保持打开**、焦点仍在过滤框（`onQuickRefPreview` 不再 `closeQuickRefPicker`）；
2. 预览期间 `↑` / `↓` 移动高亮，**预览内容自动跟随**（`followPreview()`——搜索弹窗 `moveActive()` 后 `if (app.floatingPreview) onPreviewKey()` 的同款模式）；`Alt+Enter` 随时可换目标；
3. `Esc` 分级消费：预览开着 → 关预览 + 回焦过滤框（`app.closeFloatingPreview()` + `inputRef.focus()`）；预览已关 → 关面板。App.vue `onEscape` 的浮层顺序（预览先于补全/模式回退）与本组件内分级语义一致。

改动集中两处：`QuickRefPicker.vue`（previewCurrent 加目录行守卫 / followPreview / Esc 分支）+ `EditorView.vue`（onQuickRefPreview 去掉关面板一行）。CDP 冒烟补 4 项断言全过（Alt+Enter 后面板开 + 预览开 / ↑ 换目标预览跟随 / Esc 关预览面板仍在且焦点回过滤框 / 再按 Esc 关面板心流保留）。

### 9.5 实施后用户反馈修订二（2026-09-29 同日，真机）

上轮修订真机暴露两个问题，本轮修复：

1. **悬浮预览被面板遮罩压住**：置顶类 `above-search`（z 3000）原本只挂搜索弹窗可见时——扩展条件为 `searchStore.visible || app.quickRefPickerOpen`（确认框让位 `!confirmOverPreview` 逻辑不变），面板动线与搜索动线同享置顶；
2. **一次 Esc 把预览和面板都关了**：组件 window 级 Esc 分级只关了预览，但 **EP el-dialog 的 close-on-press-escape 在 dialog 元素上监听真实按键**，同一击把面板也关了——修法 = prop 动态化 `:close-on-press-escape="!app.floatingPreview"`（预览开着禁用内建关闭，关后恢复；与组件显式关闭幂等）；
3. 顺带让位修正：EditorView 的预览滚动 ↑/↓ 分支在面板打开时让位（面板的 ↑/↓ = 移动选中 + 预览跟随，不应同时滚动预览）——滚动条件补 `|| app.quickRefPickerOpen`。

**验证教训（合成事件的盲区）**：上一轮 CDP 冒烟 5/5 全过但真机仍双关闭——合成 `window.dispatchEvent(KeyboardEvent)` 到不了 EP 挂在 dialog 元素 / document 层的内建监听，**「组件自己的 window 处理器正确」不等于「真实按键路径正确」**；凡与 EP 内建按键行为共存的分级逻辑，须逐项核对内建监听是否也在消费同一按键（本轮用 prop 动态化从根上排除）。CDP 复验 5/5（z 序 3000 > 2011 / Esc 分级 / 心流保留）。

### 9.6 实施后用户反馈修订三（2026-09-29 同日，真机）

**预览态 Alt+Enter = 插入引用**（用户定案：让「插入引用」动作跨入口一致）：预览未开时 Alt+Enter 仍是预览（面板保持、跟随）；**预览开着再按 = 把当前选中笔记插入为引用**——与 `[[` 补全预览态的「再按落引用」（FR-2.9.10）、搜索弹窗的预览动线同一习惯。实现为 Alt+Enter 分支的一行分流：`app.floatingPreview ? insertCurrent() : previewCurrent()`（insert 走既有 onQuickRefInsert → 面板关闭 + 三路引入语义）。CDP 复验：预览态再按 Alt+Enter 后引用插入、预览与面板均关、心流保留。

