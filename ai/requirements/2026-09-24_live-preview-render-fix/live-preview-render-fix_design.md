# 所见即所得渲染修正（Live Preview Render Fix）技术设计

> 创建：2026-09-24 ｜ 状态：**设计完成，待实施** ｜ 需求见 [live-preview-render-fix.md](live-preview-render-fix.md)
> 分支：`feature/flow-mode`（与本轮编辑器工具同批实施）

## 1. 总体方案

**一句话**：缺陷 1 是 **CSS 层面的几何问题**——块级 widget 的视觉间距用 `margin` 实现，而 CodeMirror 6 测量行高时只认元素自身的 border-box，不看外边距，于是行高映射（heightmap）比真实占位小，其后所有行号整体上移；修正方式是把这些间距改成「可被测量的等价形式」，不动 CM 的任何测量逻辑。缺陷 2 是**装饰覆盖缺口**——`ListMark` / `QuoteMark` 从未被处理，`TaskMarker` 的复选框样式被作用域挡在编辑器之外；修正方式是补齐装饰与样式作用域。

不新增依赖、不改变磁盘产物、不触碰预览与导出管道。

## 2. 根因分析

### 2.1 缺陷 1：CM6 的行高记账不含外边距

CM6 维护一份「行 → 高度」的映射（heightmap），供行号列定位、`scrollIntoView`、可视区计算等使用。块级 widget（`Decoration.replace({ block: true, widget })`）的记账高度取自 **widget 元素自身的 border-box 高度**，**不含其外边距**。

当前实现里，块级 widget 的垂直间距恰好全由外边距承担：

| 来源 | 规则 | 折叠后的实际间距 |
| --- | --- | --- |
| `.lp-math-block` | `margin: 0.5em 0`（lpTheme） | 与内层 `.katex-display { margin: 1em 0 }` 折叠 → **1em ≈ 16px** |
| `.lp-block`（表格 / HTML 块） | `margin: 0.4em 0` | 与内层 `.markdown-body table { margin: 0.8em 0 }` 折叠 → **0.8em ≈ 12.8px** |
| `.lp-hr` | 无自有规则，由内层 `.markdown-body hr { margin: 1.5em 0 }` 提供 | **1.5em ≈ 24px** |

于是「元素高度」与「实际占位」出现差额，且**逐块累加**。隔离实例实测（2026-09-24）：

| 对象 | 元素高度（CM 记账） | 实际占位 | 差额 |
| --- | --- | --- | --- |
| 多行块级公式 widget | 94px | 109px | 15px |
| 表格 widget | 197px | 208px | 12px |

累积结果与需求文档 §2.2 的偏差表一致（公式后 +15px、表格后累计 +27px）。同一映射失真还会轻微影响预览行级同步与「跳转到指定行」的落点。

### 2.2 缺陷 2：装饰缺口与样式作用域

| 项 | 现状根因 |
| --- | --- |
| 无序列表 `-` 可见 | `decorations.ts` 的语法树遍历**没有处理 `ListMark`**（仅有 TaskMarker / Image / Link 等分支），标记自然按源码显示 |
| 任务复选框不可见 | widget 已渲染（`.task-item-checkbox.lp-task-box` 存在于 DOM），但样式在 `markdown.css` 里写作 `.markdown-body .task-item-checkbox`——编辑器内容区（`.cm-content`）**没有 `.markdown-body` 祖先**，故 `display/width/border` 全部未命中，元素退化为无尺寸的行内空元素（实测 `display:inline; width:auto; border:0`）。用户看到的就是「`[ ]` 没了、方框也没有」 |
| 引用 `>` 可见 | 语法树遍历的 `Blockquote` 分支只加行级样式（`lp-quote`：左边框 + 缩进），**没有隐藏 `QuoteMark`**（这是 v0.6.0 的既定呈现边界，本次按用户反馈改为隐藏） |
| 回落粒度不一致 | `TaskMarker` 用「节点区间被占用」判定：光标停在同一行的其它位置时，复选框仍处于渲染态、该行其它部分却是源码，观感割裂 |

## 3. 决策记录

| # | 决策点 | 结论 | 理由 |
| --- | --- | --- | --- |
| D1 | 缺陷 1 的修复层次 | **改 CSS（容器 `display: flow-root` + `margin: 0`），使其高度可被 CM 正确测量** | 不动 CM 测量逻辑、零运行时开销；`flow-root` 令容器成为 BFC，内层首尾外边距不再折叠出去，容器高度即真实占位高度；视觉间距由内层内容自身外边距提供（数值与现状完全相同，观感零变化） |
| D2 | 行级标记的回落粒度 | **统一为「行占用」判定**：`ListMark` / `TaskMarker` / `QuoteMark` 均以「光标是否在所在行」决定是否回落 | 行级结构（列表项 / 引用）的语法与整行绑定，按行回落才能消除「同一行半渲染半源码」的割裂感；**行内标记（加粗 / 斜体 / 删除线 / 行内码）粒度更细——2026-09-24 晚修订为「贴到或选中定界符才露出」，见第 7 节** |
| D3 | 无序列表标记的呈现 | 标记替换为 **`•` 字形 widget**（次级色，`user-select: none`） | 完全隐藏会让列表项失去缩进锚点；渲染为圆点与主流编辑器一致，且不改动后续文本 |
| D4 | 有序列表 | **不装饰，保留源编号** | 编号本身即渲染形态；重排编号会与源码近似性冲突（且需处理起始序号 / 中断续号等边界） |
| D5 | 任务列表的标记 | `- `（ListMark + 其后一个空格）**整体隐藏**，由复选框取代；不显示圆点 | 复选框本身就是该行的「标记」，圆点 + 复选框并列冗余；Obsidian 同款处理 |
| D6 | 引用标记的隐藏范围 | `QuoteMark` **连同其后一个空格**一并隐藏 | 只隐藏 `>` 会残留一个前导空格，与左侧引用条的缩进叠加后文字偏右 |
| D7 | 复选框样式来源 | 在 `markdown.css` 把选择器扩为 **`.markdown-body .task-item-checkbox, .cm-content .task-item-checkbox`** | 单一来源（预览 / 编辑器同一套变量与形态），避免在 lpTheme 里复制一份样式；`.cm-content` 前缀保证不会外溢到其它 UI |
| D8 | 块级 widget 的几何约定 | 今后块级 widget **垂直间距一律用 padding 或 `flow-root` 包裹，禁止裸 `margin`**；写入 AGENTS.md | 本次缺陷的通用教训——任何未被测量的外边距都会让行号列漂移；约定成文可避免复发 |

## 4. 实现要点

### 4.1 几何修正（`lib/livePreview/index.ts` 的 `lpTheme`）

```ts
// 块级 widget：flow-root 让内层首尾外边距留在盒内 → CM 测量到的即真实占位
'.lp-math-block': { margin: '0', display: 'flow-root', textAlign: 'center', overflowX: 'auto' },
'.lp-block':      { margin: '0', display: 'flow-root' },
'.lp-hr':         { margin: '0', display: 'flow-root' }
```

- 视觉间距由内层提供（`.katex-display` 的 1em、`.markdown-body table` 的 0.8em、`hr` 的 1.5em），与现状数值一致；
- `.lp-frontmatter` 本就用 padding、无内层外边距，无需改动（保持现状，作为对照）；
- 验收方式：CDP 实测「行号列 y ≡ 正文行 y」。

### 4.2 标记装饰（`lib/livePreview/decorations.ts`）

- 新增 `lineOccupied(state, pos)`：选区是否与 `doc.lineAt(pos)` 区间相交；
- `case 'ListItem'`：读取该列表项的 `ListMark`：
  - 该行被占用 → 不装饰（源码回落）；
  - 命中 `TaskMarker`（任务项）→ 替换 `ListMark` + 后随空格为空；
  - 否则（无序）→ 替换 `ListMark` 为 `BulletWidget`；
  - 有序列表 → 直接返回（D4）；
- `case 'QuoteMark'`：行未被占用时替换「标记 + 后随一个空格」为空（含多行引用逐行生效；嵌套引用逐层生效）；
- `TaskMarker`：判定改为 `lineOccupied`（D2）；
- 所有替换同时登记 `atomic` 区间（沿用既有机制，光标不可落入标记内部）。

### 4.3 新增 `BulletWidget`（`lib/livePreview/widgets.ts`）

```
span.lp-bullet（内容 '•'，color: var(--text-secondary)，user-select: none）
```
样式加在 lpTheme 的 `.lp-bullet`（不依赖 `.markdown-body`，避免重蹈复选框的覆辙）。

### 4.4 复选框样式作用域（`styles/markdown.css`）

选择器扩展为 `.markdown-body .task-item-checkbox, .cm-content .task-item-checkbox`（含 `[data-checked='true']` 的两条变体），其余样式不变。

## 5. 测试计划

**单元测试**（`tests/livePreview.test.ts` 扩展，纯函数层可覆盖）：

- 无序列表：非光标行 `-` → BulletWidget；光标行回落源码；
- 有序列表：无装饰；
- 任务列表：`- ` 隐藏 + CheckboxWidget 存在；光标行回落；勾选切换写回（既有用例保持）；
- 引用：单行 / 多行 / 嵌套引用的 `> ` 隐藏规则；光标行回落；
- 反向回归：上述装饰**不影响**同行其它节点（加粗 / 行内码 / 链接 / 公式）的既有断言。

**实测验证**（CDP，`TRACE_TEST_USERDATA=1 TRACE_CDP=9222`）：

- 几何：含「公式块 + 表格 + 水平线」的文档，逐行比较行号列与正文行 y 坐标（要求 ≤1px）；插入 / 删除块级 widget 后复测；
- 呈现：列表 / 任务 / 引用的渲染态与光标行回落；
- IME：组词期间不抖动（复用既有冻结策略）。

几何修复不写单测（依赖真实排版，jsdom 无法覆盖），以实测数据记录在本文件第 8 节。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| `flow-root` 在小众浏览器 / 旧内核缺失 | Electron 44（Chromium 130+）原生支持；无需降级路径 |
| 行占用判定导致「光标行频繁在源码 / 渲染间切换」的观感变化 | 与标题 / 加粗既有行为一致；本次改动让四处规则统一，减少而非增加切换 |
| 隐藏范围算错波及正文 | 只替换语法树给出的标记区间；单测逐类断言区间与正文完整 |
| 与「列表项内块级公式」的既有特例互相干扰 | 该特例在 `scanBlocks` 层（块级识别）先行剥离列表标记，与行内装饰互不重叠；测试计划中包含既有公式用例的回归 |

## 7. 迭代记录（2026-09-24 晚）：行内标记的露出粒度（修订 D2）

**反馈**：用户实测截图指出——光标停在 `~~删除~~` 的**内容末尾**时，定界符 `~~` 露出源码，与删除线叠加后看着像是「删除线下面挂了两条波浪号」。

**决策（用户选定方案 B）**：强调类标记（加粗 / 斜体 / 删除线 / 行内码）不再按「光标与节点区间相交」判定，改为**只有真的贴到定界符本身才露出**——与「列表 / 引用标记按行回落」相比粒度更细，语义上更接近「编辑标记时看标记、编辑内容时看渲染」。

| 光标 / 选区位置 | 旧行为 | 新行为 |
| --- | --- | --- |
| 其他行 / 区间之外 | 隐藏 | 隐藏 |
| 内容中间 | **露出** | **隐藏**（本次改动） |
| 内容两端（标记内侧边界） | **露出** | **隐藏**（用户截图场景） |
| 紧贴标记外侧（打开标记之前 / 闭合标记之后） | 露出 | 露出 |
| 标记内部（多字符标记的字符之间，如 `~~` 两字之间） | 露出 | 露出 |
| 选区与标记**严格重叠**（选中标记或其一部分） | 露出 | 露出 |
| 选区只覆盖内容（端点贴边） | 露出 | **隐藏**（与光标规则对齐） |

**实现**：`decorations.ts` 新增 `markTouched(state, marks)`（`lineBusy` 用于行级标记，两者并存）；`occupied` 仍用于标题 `#`、链接、双链 / 图片 / 公式 / 任务框等 widget——它们的隐藏部分是 URL 或整块内容（需要「点一下就回落源码」才能编辑），语义与「标记对」不同，故不改动。

**实测（隔离实例，CDP；文档 `~~删除~~`）**：

| 光标位置（按 Home 后逐次 →） | 渲染 |
| --- | --- |
| 行首（贴打开标记外侧） | `~~删除~~` 露出 |
| 打开标记两 `~` 之间 | `~~删除~~` 露出 |
| 内容开头 / 内容末尾（含在内容里继续输入） | `删除` 保持渲染（无波浪号，删除线正常） |
| 闭合标记两 `~` 之间 | `~~删除~~` 露出 |
| 标记处按退格 | `~~删除~` ——定界符仍可正常编辑 |

**单测**：`tests/livePreview.test.ts` 22 项（加粗四位置矩阵 + 删除线 + 行内码边界，均含「内容内不露出」的断言）。

## 8. 实施记录（2026-09-24 完成，分支 `feature/flow-mode`）

**交付**：

| 文件 | 改动 |
| --- | --- |
| `lib/livePreview/index.ts` | lpTheme：块级 widget 几何（`margin: 0` + `padding` + `display: flow-root` + `whiteSpace: normal` + `maxWidth: none`）、`.lp-bullet` 样式 |
| `lib/livePreview/decorations.ts` | 新增 `lineBusy`（行占用回落）、`listMarkOf` / `isTaskItem`、`ListItem` 与 `QuoteMark` 分支、`TaskMarker` 改按行回落、跨可视区间去重 `seenMarks`、**修正 frontmatter 剪枝** |
| `lib/livePreview/widgets.ts` | 新增 `BulletWidget` |
| `styles/markdown.css` | 任务复选框样式作用域扩到 `.cm-content`（预览 / 编辑器共用一套） |
| `tests/livePreview.test.ts` | +6 项（列表 / 有序 / 任务 / 引用 / 嵌套引用 / frontmatter 剪枝回归），共 20 项 |

**实测数据（隔离实例，CDP；`TRACE_TESTUSERDATA=1 TRACE_CDP=9222`）**：

| 项 | 修正前 | 修正后 |
| --- | --- | --- |
| 块级公式之后的正文行（行号列 y / 正文行 y） | 716 / 731（**+15px**） | 663 / 663（**0**） |
| 表格之后（第 28 行） | 989 / 1016（**+27px**） | 830 / 830（**0**） |
| 滚动到 `scrollTop=320` 后 | —— | 全部可见行仍逐行一致（0px） |
| 水平线 widget | 容器高 114px（继承 `.markdown-body` 卡片 padding 20/48，上下不对称） | 46px（22.5 / 22.5 对称） |
| 表格 widget | 容器高 197px（渲染 HTML 的换行在 `break-spaces` 下变成空行） | 91px |

**实现中的三处修正（设计稿之外的实测发现，均已闭环）**：

1. **间距的实现方式**由「内层内容的外边距提供」改为「**容器 padding + 内层首尾外边距清零**」。原因：内层是 KaTeX / 表格 / `<p>` 等第三方渲染产物，其外边距行为不可控（与卡片 padding、相邻元素折叠后数值不一）。改为容器 `padding: 0.5em`（公式）/ `0.4em`（表格 / HTML 块）+ `.lp-block > :first-child/:last-child` 清边距后，**长期稳定且数值与修正前一致**（公式 8px、表格 6.4px）。
2. **必须显式归零 `max-width` / 卡片 padding**：widget 带 `markdown-body` 类是为了排版（字号 / 行高 / 表格样式），但该类同时带预览卡片的 `padding: 20px 28px 48px` 与 `max-width: 860px`。水平线的上下间距原本因此变成 20/48（视觉不对称），表格也有 860px 限宽。
3. **`white-space: normal`**：编辑器内容区是 `break-spaces`（源码需保留空白），而 widget 里是渲染 HTML——标签之间的换行 / 缩进会被当成真实换行与空格，表格容器因此从 197px 虚高。归零后与右侧预览排版一致。

**额外发现并修复的既有缺陷（本需求范围之外，复现过程中暴露）**：

- **文档以 frontmatter 开头时，所有依赖语法树的装饰全部消失**：`computeBlockDecorations` 与 `computeInlineDecorations` 的 frontmatter 剪枝写作「区间相交」判定，而 `Document` 根节点（`0..doc.length`）与 frontmatter 区间必然相交 → **整棵树在根节点被剪掉**。表现：带标签（frontmatter 存 tags）的笔记进入所见即所得后，只有块级公式还能渲染，标题 / 列表 / 引用 / 表格 / 行内样式全是源码（实测确认）。修正为「节点**完全落在** frontmatter 区间内才跳过」，并补回归单测（含标记与正文装饰的断言）。
  - 该缺陷对「带标签的笔记」是 100% 复现，属所见即所得可用性级别的问题；缺陷 2 的部分现象（表格未渲染）在带 frontmatter 的笔记上也由此叠加。

**验收**：

| 验收标准（需求第 5 节） | 结果 |
| --- | --- |
| 1. 行号 / 行号高亮 / 正文行三者对齐（≤1px），含公式 + 表格 + 水平线的文档 | ✅ 0px；滚动后、增减 widget 后复测仍为 0 |
| 2. 无序列表呈「•」，嵌套缩进正常 | ✅ `• 一级项` / `  • 嵌套项` |
| 3. 任务复选框可点击写回 | ✅ 13×13、未勾选次级色边框 / 已勾选主题色 + √；写回由既有 `toggleTaskAt` 覆盖 |
| 4. 引用 `>` 不再显示、引用条保留、多行生效 | ✅ |
| 5. 光标行整体回落源码 | ✅ 单测覆盖（列表 / 任务 / 引用） |
| 6. IME 组词不抖动 | ✅ 装饰仍走既有 `view.composing` 冻结路径，未改动 |
| 7. 单测覆盖标记与回落规则 | ✅ `tests/livePreview.test.ts` 20 项全绿 |
| 8. 磁盘产物不变 | ✅ 仅装饰 / 样式层，无格式改写 |
| 既有测试不回归 | ✅ 全量 319 项：318 通过；`gitService` 集成测试为既有的 Windows 慢测（需 `--testTimeout` ≥ 60s），与本改动无关 |
