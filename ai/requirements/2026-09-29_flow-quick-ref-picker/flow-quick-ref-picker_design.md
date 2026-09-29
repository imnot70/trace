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
| `Alt+Enter` | 关面板 + 悬浮预览 | 同左 |
| `Esc` | 关面板（el-dialog 内建） | 同左 |
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
