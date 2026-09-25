# 心流引用与速览增强 — 技术设计

> FR-2.9.10，2026-09-25。分支 `feat/flow-reference-enhance`。三个改动点相互独立，共用一条主线：心流下「手不离键盘」完成引用与速览。

## 1. Esc 分级消费（P1）

**现状**：`App.vue` 的 `onEscapeCapture`（document 捕获阶段）调 `onEscape()` 做应用级回退（浮层侧栏 → 悬浮预览 → 设置 → 心流），命中任一分支后 `return`——但**事件继续传播**，到达 CodeMirror 键位后 `completionKeymap` 的默认 `Escape: closeCompletion` 把补全面板也关了。

**修法**：`onEscape()` 改为返回 `boolean`（是否消费）；`onEscapeCapture` 在消费时 `preventDefault() + stopPropagation()`（捕获阶段阻断，事件不再下沉到编辑器 DOM）。分级语义：

| 按键时刻 | 消费者 | 效果 |
| --- | --- | --- |
| 悬浮预览开 | onEscape（阻断） | 关预览，补全面板保持 |
| 再按 Esc | CM completionKeymap（未阻断） | 收起补全 |
| 再按 Esc | onEscape | 退出心流 |

模态打开时 `hasModalOpen()` 照旧返回未消费（el-dialog 自己处理 Esc）。

## 2. `[[` 扁平模糊匹配（P2）

**现状**：补全源 `traceCompletions`（`MarkdownEditor.vue`）对 `[[` 前缀按 `/` 切分、逐级进目录、只列当前层。

**设计**：前缀**不含 `/`** 时走新增的扁平匹配；含 `/` 保持原逐级行为不动。纯函数抽到 `lib/noteCompletion.ts`（可单测）：

- `collectNotes(nodes, dir)`：递归收集 `{ name（无扩展名）, dir, rel }`；
- `flatNoteOptions(notes, prefix, currentRel)`：
  - 排除当前笔记（自引用）；
  - 评分：叶子名前缀命中（0）< 叶子名包含（1）< 完整路径包含（2）；同分按路径字典序；
  - 重名消歧：库内（大小写不敏感）同名 >1 篇时 label 用完整相对路径，否则用叶子名（双链按名解析 + 预览点击同名有消歧弹层兜底，见需求 D2）；
  - 上限 30 条；空前缀 = 全库笔记列表（按路径排序）。

接线：`traceCompletions` 的 wikilink 分支开头，`prefix.includes('/')` 为假时直接返回扁平结果（`from/to` 计算与原逻辑一致）。

## 3. 搜索结果键盘导航与预览（P2）

**现状**：`SearchDialog.vue` 结果列表纯鼠标点击；Enter 在输入框上只触发搜索。

**设计**：

- `activeIndex` 高亮态：结果变化时重置为 0（首项默认高亮）；`@keydown.down/.up`（preventDefault，循环移动，`scrollIntoView({ block: 'nearest' })` 跟随）；`@mousemove` 同步高亮；
- `@keydown.enter`：有结果 → 打开高亮项（原 `openResult`）；无结果 → 执行搜索（替代原 `@keyup.enter="performSearch"`，避免开笔记后又触发一轮搜索）；
- `@keydown.alt.enter.prevent`：关闭搜索框 + 经新事件 `preview-note(vault, path, title)` 请求预览；
- **跨组件预览管线**：悬浮预览的目标内容目前在 `EditorView` 本地（`completionPreview` ref），搜索框在 `App.vue` 层够不到。加一条 store 握手：app store 新增 `pendingNotePreview: { vault, path, name } | null` 与 `requestNotePreview()`；`EditorView` watch 它 → 清空并走既有 `onCompletionPreview`（读笔记 → `completionPreview` 覆盖 → 开悬浮预览）。补全预览与搜索预览共用同一条覆盖管线与「一瞥结束即清除」语义；
- 决策 D3：预览时关闭搜索框（模态遮罩压 z 序），Ctrl+F 可重开。

## 4. 测试

- `tests/noteCompletion.test.ts`：collectNotes 嵌套收集；flat 匹配的三级评分与排序、重名消歧（label 用路径）、排除自身、30 条上限、空前缀全量。
- P1 与搜索键盘导航为交互层，隔离实例 CDP 验证（真实按键）。

## 5. 实施记录

2026-09-25 实施（分支 `feat/flow-reference-enhance`）：

- **P1**：`onEscape` 返回是否消费，`onEscapeCapture` 消费时 `preventDefault + stopPropagation`。分支顺序经实测调整：**悬浮预览分支必须在补全让位分支之前**（两者同开时用户要的是先关预览；初版顺序反了，Esc① 关掉的是补全）。补全让位分支放预览之后、设置 / 心流之前——预览关掉后下一次 Esc 才轮到收补全，补全也开着时不会误退心流。
- **P2a**：新增 `lib/noteCompletion.ts`（collectNotes / flatNoteOptions），`traceCompletions` 前缀不含 `/` 时走扁平分支。测试中发现重名计数口径修正：消歧是「名字在库内是否唯一」的属性，**计数须含自身**（排除自身后计数会把真重名误判为唯一）。
- **P2b**：搜索框 `activeIndex` + 方向键循环 + `scrollIntoView` 跟随 + Enter 打开 / Alt+Enter 预览；预览经 app store `pendingNotePreview` 握手由 EditorView 消费（复用补全预览覆盖管线）。
- **关键踩坑：CM 内置模糊过滤对中文不可靠**——补全源已按前缀过滤并返回命中项，但 CM 还会用自带 FuzzyMatcher 对选项再滤一遍，**输入中文时会把候选项全部滤光、补全直接关闭**（`[[` 空前缀能列出、输入一个汉字就消失）。修法：两个 wikilink 补全分支返回 `filter: false`（源已过滤，以源为准）。该问题同样影响 v0.8.3 起的逐级补全输入中文笔记名，本次一并修复。
- **验证（隔离实例，CDP 真实输入）**：Esc 三级全过（Esc① 关预览留补全留心流 / Esc② 收补全留心流 / Esc③ 退心流）；`[[首` 扁平命中「首页」、`[[搜索` 两条完整路径消歧、`[[子目录/` 逐级列出「子目录/深层」；搜索框 ↑↓ 移动高亮、Alt+Enter 关搜索框并悬浮预览高亮项。测试脚本教训：CDP 直接 dispatch CM 事务不产生「用户输入」事件、不会触发补全，须经真实输入管线（keyDown 带 text / execCommand insertText）；冷启动需等 tree store 与搜索索引就绪。
