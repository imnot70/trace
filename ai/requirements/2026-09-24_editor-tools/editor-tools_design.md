# 编辑器工具（折叠按钮 / 标题层级 / 表格插入）技术设计

> 创建：2026-09-24 ｜ 状态：**设计完成，待实施** ｜ 需求见 [editor-tools.md](editor-tools.md)
> 分支：`feature/flow-mode`（与本轮所见即所得渲染修正同批实施）

## 1. 总体方案

**一句话**：三处都是**装配层的小改**——折叠按钮需要拿到 `foldGutter` 的配置入口（`basicSetup` 不开放配置，故按其官方建议改为自有装配清单）；标题与表格是纯函数 + 一次 `dispatch`（与既有 `insertSnippet` 同族），单测可覆盖。

不新增依赖、不改动磁盘产物。

## 2. 关键背景

| 项 | 现状 | 影响 |
| --- | --- | --- |
| `basicSetup` | 本仓库使用的 `codemirror` 版本其 `basicSetup` **不开放配置**（官方文档明示「若需自定义，请把它的源码拷贝出来自行调整」） | 想给折叠按钮换图标（`foldGutter({ markerDOM })`）就必须改为自有装配清单 |
| 折叠标记 | 默认是文本字形（未折叠 `⌄` / 已折叠 `›`），由 CM 内置样式渲染；`traceTheme` 里针对 `svg` 的规则因此**从未生效**（实测 `innerHTML` 为 `<span title="Fold line">⌄</span>`） | 用户反馈的「太小、样式不搭」正源于此 |
| 标题按钮 | 工具栏仅有 H1 / H2 直按按钮 | 三级以下无入口 |
| 表格 | 无任何入口 | —— |
| 键位占用 | `Alt+1..4` = 视图切换（App.vue 全局）；`Ctrl+<数字>`、`Mod-t` 在 CM 默认键位表与应用全局键中均**未被占用** | `Ctrl+1..6` / `Ctrl+0` / `Ctrl+T` 可用 |

## 3. 决策记录

| # | 决策点 | 结论 | 理由 |
| --- | --- | --- | --- |
| D1 | 折叠按钮的实现路线 | **用自有 `traceSetup` 替代 `basicSetup`**：逐项照搬 `basicSetup` 的扩展清单，仅把 `foldGutter()` 换成 `foldGutter({ markerDOM })` | 官方推荐的定制方式；比「再加一个 gutter 用 CSS 藏掉旧的那个」可靠（后者依赖 DOM 顺序，脆弱） |
| D2 | 折叠按钮的形态 | `markerDOM` 返回内联 SVG 箭头（未折叠 = 向下 V 形；已折叠 = 向右 V 形），16×16，`currentColor` 着色 | 与应用图标语言一致；`currentColor` 让主题 / 悬停态自动跟随 |
| D3 | 折叠按钮的尺寸与热区 | 图标 16px；`<button>` 热区 20×20，圆角 4px；常态 `--text-tertiary`，悬停 `--bg-tertiary` + `--text-primary` | 与侧栏折叠箭头、迷你导航条同一套语言（复用其变量） |
| D4 | 折叠按钮的插槽宽度 | gutter 保留 18px 宽（`cm-gutterElement` 内部用 20px 按钮会溢出时改为 22px，实测后取其一） | 规避行号列错位 / 抖动；以实测为准 |
| D5 | `lintKeymap` | **不纳入** `traceSetup` | 本项目未配置任何 linter（无 `@codemirror/lint` 直接依赖），无 linter 时该键位本就无作用；避免引入幽灵依赖 |
| D6 | 标题快捷键键位 | `Ctrl+1`…`Ctrl+6` 设级别、`Ctrl+0` 清除；开关语义（同级再按即清除） | 与主流编辑器一致（Obsidian / Typora）；`Ctrl+0` 补足「清除」这一常见需求 |
| D7 | 工具栏标题入口 | 原 H1 / H2 两个按钮 → 单个「标题」下拉（一级 ~ 六级 + 清除标题），菜单项右侧显示快捷键 | 六个级别在工具栏同等可达；两个直按按钮无法覆盖层级需求（避免按钮堆积） |
| D8 | 工具栏下拉的规范 | 触发器用原生 `title`（不用 `el-tooltip`）；沿用仓库既有 `menu-hold` / `popper-class="dd-instant-hide"` 下拉模式 | AGENTS.md 明令：tooltip 禁止包裹下拉触发器；menu-hold 防「点击后移除锚点」造成的残影 |
| D9 | 表格模板 | 2 列表头 + 1 行空数据行；表头占位文案「列 1 / 列 2」；分隔行 `---` | 最小可用结构；插入后光标落在首个表头单元格，用户直接改名 |
| D10 | 表格插入位置语义 | 光标处插入；若光标前本行已有非空白内容 → 先补 `\n`；表格后补 `\n` | 保证表格独占行块（GFM 表格必须从行首开始），同时不破坏已有段落 |

## 4. 实现要点

### 4.1 `traceSetup`（`components/MarkdownEditor.vue`）

```ts
// 与 basicSetup 逐项对齐，仅替换 foldGutter（D1 / D5）
lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(),
foldGutter({ markerDOM: foldMarker }), drawSelection(), dropCursor(),
EditorState.allowMultipleSelections.of(true), indentOnInput(),
syntaxHighlighting(defaultHighlightStyle, { fallback: true }), bracketMatching(),
closeBrackets(), autocompletion(), rectangularSelection(), crosshairCursor(),
highlightActiveLine(), highlightSelectionMatches(),
keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap,
           ...foldKeymap, ...completionKeymap])
```

导入来源均为本仓库直接依赖：`@codemirror/view` / `state` / `commands` / `language` / `search` / `autocomplete`；`codemirror` 仅保留 `EditorView` 的再导出用途（若最终无引用则从 import 中移除）。

`foldMarker(open: boolean)` 返回 `<button type="button" tabindex="-1" class="trace-fold-marker">` + 内联 SVG（`aria-hidden`），样式写在 `traceTheme`。

### 4.2 标题层级（纯函数 + keymap）

新增 `lib/heading.ts`：

```ts
/** 目标级别（1–6）或 0 = 清除；返回该行应替换成的文本（含行首缩进保留） */
export function headingLine(text: string, level: 0 | 1 | 2 | 3 | 4 | 5 | 6): string
```

规则：识别行首 `^(\s{0,3})(#{1,6}\s+)?`；若当前级别 === 目标级别 → 去掉标记（开关语义）；否则替换为 `#`.repeat(level) + 空格；`level = 0` 时只去掉标记。

keymap（并入现有 `Prec.high` 块，与 `Mod-b` / `Mod-i` 同处）：

```
Mod-1 … Mod-6 → setHeading(view, level)
Mod-0         → setHeading(view, 0)
```

`setHeading` 对选区覆盖的每一行生成 change（单次 dispatch，`userEvent: 'input.format'`），并把选区扩到整行（保证连续操作手感）。

### 4.3 表格插入（纯函数 + 工具栏 / keymap）

新增 `lib/table.ts`：

```ts
/** 生成默认表格模板文本（含首行占位） */
export function tableTemplate(cols = 2, rows = 1): string
/** 给定光标所在行文本与列号，决定插入用的前缀（是否需要前置换行）与插入后光标相对偏移 */
export function tableInsertPlan(lineText: string, col: number, template: string): { text: string; cursor: number }
```

工具栏按钮（`views/EditorView.vue`）：`<el-icon><Grid /></el-icon>`，`title="插入表格 (Ctrl+T)"`，点击 → `editorRef.insertTable()`（`defineExpose` 暴露，内部走 `tableInsertPlan`）。

keymap：`Mod-t` → `insertTable(view)`（消费按键，`preventDefault`）。

### 4.4 涉及文件

| 文件 | 改动 |
| --- | --- |
| `components/MarkdownEditor.vue` | 替换 `basicSetup` → `traceSetup`；新增标题 / 表格 keymap；`defineExpose` 增 `setHeading` / `insertTable`；`traceTheme` 增折叠按钮样式 |
| `views/EditorView.vue` | 工具栏：H1/H2 → 「标题」下拉；新增「表格」按钮 |
| `lib/heading.ts`（新） | 标题行前缀计算（纯函数，可单测） |
| `lib/table.ts`（新） | 表格模板与插入位置规划（纯函数，可单测） |
| `config/shortcuts.ts` | 登记 `Ctrl+1…6` / `Ctrl+0` / `Ctrl+T` |
| `tests/heading.test.ts`、`tests/table.test.ts`（新） | 单测 |

## 5. 测试计划

**单元测试**：

- `headingLine`：普通行 → 各级别；已同级 → 清除；跨级替换；`level = 0` 清除；空行；前导空格保留（≤3 空格）；含 `#` 但非标题（如 `#标签`、行内 `#`）不受影响；
- `tableInsertPlan`：行首插入不加前导换行；行中有内容时补前导换行；表格后补换行；光标偏移落在首列表头内容上；
- `tableTemplate`：结构与列数正确（表头 + 分隔 + 数据行）。

**手动 / CDP 验证**：

- 折叠按钮：图标尺寸、悬停背景、点击折叠与展开、折叠后占位符；折叠标记出现场景（标题 / 引用 / 代码块 / 表格）不回归；
- 标题快捷键：源码与所见即所得两种模式、多行选择、连续按两次的开关语义、撤销；
- 表格：工具栏与快捷键两种入口、行首 / 行中插入、插入后所见即所得与预览的渲染结果、撤销；
- 装配回归冒烟：撤销 / 重做、括号自动闭合、`[[` 补全、`Ctrl+F`（仍打开全局搜索、不弹原生查找面板）、`Ctrl+S`、多选、行号高亮。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| `traceSetup` 漏项导致能力退化 | 清单逐项对齐 `basicSetup`；实施后按 §5 的「装配回归冒烟」清单逐项验证 |
| 折叠按钮加宽挤压行号列 | gutter 宽度以实测为准（D4）；若溢出则保持 18px 插槽 + 20px 视觉按钮（负外边距不引入，避免 hit 区被裁切） |
| `Ctrl+数字` 在 macOS 上被系统 / 输入法占用 | 统一用 CM 的 `Mod-`（macOS = Cmd）；文档说明；如遇系统级冲突再评估 `Ctrl+Alt+数字` 备选 |
| 下拉菜单闪影（仓库历史问题） | 沿用 `menu-hold` / `dd-instant-hide` 既有模式；触发按钮不包裹 tooltip |
| 标题改写误伤列表内的 `#` | 只匹配行首 0–3 空格后的 `#{1,6}\s`；单测覆盖边界 |

## 7. 实施记录（2026-09-24 完成，分支 `feature/flow-mode`）

> 下表中的表格插入实测为首版交互（`Ctrl+T` 直接插入）；其后已改为尺寸输入提示浮层 + 表格内 Tab 跳转，见 [2026-09-24_table-insert-enhance/](../2026-09-24_table-insert-enhance/table-insert-enhance_design.md) 第 7 / 8 节。

**交付**：

| 文件 | 改动 |
| --- | --- |
| `lib/heading.ts`（新） | `headingLevelOf` / `headingLine`（纯函数）+ `setHeading`（单次 dispatch，可一步撤销） |
| `lib/table.ts`（新） | `tableTemplate` / `tableInsertPlan`（纯函数）+ `insertTable`（插入并选中首列表头占位） |
| `components/MarkdownEditor.vue` | `basicSetup` → **`traceSetup()`** 自有装配（清单逐项对齐，仅折叠按钮改自绘 SVG）；`foldMarker()` + `traceTheme` 样式；`Mod-1…6` / `Mod-0` / `Mod-t` 键位；`defineExpose` 增 `setHeading` / `insertTable` |
| `views/EditorView.vue` | 工具栏：H1/H2 两个直按按钮 → 「标题」下拉（一级 ~ 六级 + 清除，右侧显示快捷键）；链接按钮后新增「表格」按钮 |
| `config/shortcuts.ts` | 登记 `Ctrl + 1 … Ctrl + 6` / `Ctrl + 0` / `Ctrl + T`（编辑器分组） |
| `styles/main.css` | `.dd-keys`（下拉项右侧快捷键提示） |
| `tests/heading.test.ts`（新，7 项）、`tests/table.test.ts`（新，6 项） | 纯函数单测 |

**实测（隔离实例，CDP）**：

| 项 | 结果 |
| --- | --- |
| 折叠标记 | `button.trace-fold-marker`，**20×20 热区 + 16px 线性箭头**；点击折叠（6 行 → 2 行，出现 1 个 `⋯` 占位符）、再点展开（回到 6 行） |
| `Ctrl+1` → `Ctrl+1` → `Ctrl+3` → `Ctrl+0` | `# hello` → `hello` → `### hello` → `hello`（开关语义与清除均正确） |
| 多行选择 `Ctrl+2` | 选区覆盖的 4 行全部变为 `## …` |
| `Ctrl+T` | 行首插入 `\| 列 1 \| 列 2 \|` 表格（不补前导换行）；行中插入补前导换行；`Ctrl+Z` 单步撤销 |
| 工具栏「表格」按钮 | 插入成功（同一 `insertTable` 入口） |
| 工具栏「标题」下拉 | 菜单可见（7 项，含快捷键提示）；命令通道实测生效（`## toolbar-test`） |
| 所见即所得模式下同样生效 | ✅（上述快捷键测试在 `editorWysiwyg = true` 下进行） |

**与设计稿的两处偏差（实测后调整，均已在本文件更新）**：

1. **折叠 gutter 插槽宽度取 20px**（设计写 22px）：实测 20px 即可容纳 20×20 按钮且无裁切，取更紧凑值。
2. **未把选区扩到整行**（设计 D 提到「扩到整行以保连续操作手感」）：实现保持原选区（CM 自动映射）。扩为整行会在单行操作时把光标变成选区，反而干扰后续输入；连续按 `Ctrl+1`/`Ctrl+2` 时当前行仍会被正确识别（同一行），手感不受影响。

**回归冒烟（替换 `basicSetup` 后逐项确认）**：撤销 / 重做、括号自动闭合、`[[` 补全、`Ctrl+F`（打开全局搜索、不弹 CM 原生查找面板）、`Ctrl+S`、多选与矩形选择、活动行与行号高亮、所见即所得装饰、打字机、回车音效 —— 均正常。

**验收**：

| 验收标准（需求第 4 节） | 结果 |
| --- | --- |
| 1 / 2. 折叠按钮形态、热区、行为与出现场景 | ✅ 20×20 + 16px 箭头；折叠 / 展开正常；场景沿用 CM 默认（标题 / 引用 / 代码块 / 表格） |
| 3. `Ctrl+1…6` / `Ctrl+0`：两种编辑模式、开关语义、多行、可撤销 | ✅ |
| 4. 工具栏「标题」下拉 | ✅ 七项 + 快捷键提示；`command` 通道生效 |
| 5. `Ctrl+T` 与工具栏表格按钮；行中插入独占行块；光标落在首列表头 | ✅ |
| 6. 插入可单步撤销 | ✅ |
| 7. 单测（标题前缀 / 表格模板与插入位置） | ✅ 13 项全绿 |
| 8. 磁盘产物仍为纯 Markdown | ✅ |
| 既有测试不回归 | ✅ 全量 319 项（318 通过；`gitService` 为既有 Windows 慢测） |
