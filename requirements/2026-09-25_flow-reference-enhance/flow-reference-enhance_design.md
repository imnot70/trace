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
- **二轮实测反馈修复（2026-09-26）**：
  1. **子目录笔记预览报 ENOENT**：扁平补全的唯一名候选项 label 只是叶子名（如 `file_1`），而预览管线按 `label + '.md'` 当路径找文件，丢失目录段。修法：候选项自带 `notePath`（完整相对路径），预览 / 插入引用一律取 `notePath`。
  2. **扁平模式丢文件夹浏览**：v0.8.3 输入文件夹前缀会列出文件夹，扁平初期只列笔记。现 `flatCompletionOptions` 并入文件夹候选（label 以 `/` 结尾、detail「文件夹」，选中进入逐级导航，apply 复用逐级文件夹的既有实现）；有查询时按名字 / 路径包含命中，空前缀只列根级文件夹（浏览入口）。另支持 **`[[/` 从库根开始浏览**（空段归一化：跳过空段且 basePath 过滤空段，label 不再带前导斜杠）。
  3. **悬浮预览「插入引用」**：预览头新增按钮（补全预览态显示）+ 预览态再按 Alt+Enter 同效——把光标前未完成的 `[[xxx` 整段替换为完整引用 `[[路径]]`；补全已不在活动态时兜底在光标处插入。MarkdownEditor 新增 `previewingCompletion` prop 与 `insertReferenceFromCompletion()`。
  4. **「断链引用」计数在输入中出现为预期行为**：自动保存（1s 防抖）会把输入中的未完成 `[[xxx]]` 落盘，双链索引按保存态解析——目录名 / 未完成的引用暂时无法解析即计入断链，补全引用后自动消失。不改代码。

### 三轮实测反馈（2026-09-26）

1. **插入引用括号数量错误（三轮实测：预览后插入前后都没了 `[]`、直接接受缺右 `]`）**：编辑器 closeBrackets 会在输入 `[[` 时自动补出成对 `]]`。两条落成路径语义不同，不能用同一个「吸收」函数：
   - **Enter 接受补全**（替换范围在 `[[` 之后）：光标后的 `]]` 就是闭合符——**保留它，只插 label**；仅当光标后无 `]` 时才补 `]]`。吸收删除会产出 `[[label` 缺右括号；
   - **预览态插入**（替换范围含 `[[` 起点到光标）：必须插完整 `[[路径]]` 并**吸收光标后紧邻的至多两个 `]`**（否则残留成 `[[x]]]`，多余 `]` 并进链接目标渲染为断链）。
   首版用「吸收」统一两路，两个方向各错一半（三轮复测暴露），已拆分为各自语义。
2. **搜索 Alt+Enter 两处**：① `@keydown.enter` 未加 `.exact`，Alt+Enter 同时触发了「打开高亮结果」——现改为 `.enter.exact`（Alt+Enter 只走预览）；② 预览态 Alt+Enter 的插入兜底直接落给 CM 默认 Enter（插入一个换行，即「编辑区闪一下」）。现 MarkdownEditor 以 `previewTarget` prop 感知预览目标，Alt+Enter 三种情况都消费 Enter：补全活动 → 整段替换；补全已关 → 光标处插完整引用；**目标为当前笔记自身 → 仅收起预览不插入**（「插入引用」按钮同口径）。
3. **底色过渡（FR-2.9.8 扩展，用户提出；四轮调整）**：写作底色新增「底色过渡」开关——写作栏两侧各 **15%** 栏宽的渐隐带，底色向两侧渐变透明。实现：`linear-gradient` 画在滚动层（透明 → 底色 → 透明，与栏宽 padding 同口径），中段实心区被上方行号槽 / 内容层的实底覆盖。**接缝教训**：首版渐变的实心段比真栏边晚 24px 才达全浓度（滚动条补偿量误算进渐变段），栏边处浓度只有 ~17%、一进编辑区跳到 100%，形成明显分界——现改为渐变在栏边前 8px 即达全浓度（8px 仅吸收滚动条宽度差），分界消失。设置页在「底色颜色」下新增「底色过渡」开关（`flowPaperFade`，默认关）。
- **验证（隔离实例，CDP 真实输入）**：Esc 三级全过（Esc① 关预览留补全留心流 / Esc② 收补全留心流 / Esc③ 退心流）；`[[首` 扁平命中「首页」、`[[搜索` 两条完整路径消歧、`[[子目录/` 逐级列出「子目录/深层」；搜索框 ↑↓ 移动高亮、Alt+Enter 关搜索框并悬浮预览高亮项。测试脚本教训：CDP 直接 dispatch CM 事务不产生「用户输入」事件、不会触发补全，须经真实输入管线（keyDown 带 text / execCommand insertText）；冷启动需等 tree store 与搜索索引就绪。
