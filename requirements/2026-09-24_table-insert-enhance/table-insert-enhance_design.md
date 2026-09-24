# 表格插入增强（尺寸输入 + 表内跳转）技术设计

> 创建：2026-09-24 ｜ 状态：**已实施（已随 v0.8.0 发布）** ｜ 需求见 [table-insert-enhance.md](table-insert-enhance.md) ｜ 实施记录见第 7 节
> 分支：`feature/flow-mode`

## 1. 总体方案

**一句话**：尺寸输入是**编辑器外的一层瞬态交互**——一个纯函数状态机（`lib/tablePrompt.ts`）负责解析与决策，一个轻量浮层负责**把状态显示出来**（这正是 FR-2.4.20 相对用户原方案的核心改进），键位层在输入期间拦截数字/空格/回车；表内跳转是**语法树驱动的命令**（`lib/tableNav.ts`），只在光标位于 `Table` 节点内时接管 `Tab`。

两者都不写文档、都不新增依赖；尺寸状态机与跳转计算均为纯函数，可单测。

## 2. 关键背景

| 项 | 现状 | 影响 |
| --- | --- | --- |
| FR-2.4.16 实现 | `lib/table.ts`：`tableTemplate` / `tableInsertPlan` / `insertTable`；工具栏按钮与 `Mod-t` 都直接插入 2×2 | 本次把「直接插入」改为「先进提示态」，插入仍复用 `tableTemplate`（列数可传） |
| 浮层 / 弹层先例 | 仓库既有 `flow-save-dot`（绝对定位在编辑卡片内）、各类 el-popover；AGENTS 记录过 popper 闪影教训 | 浮层用**绝对定位的自绘卡片**（不用 el-tooltip / el-popover），避开已知闪影与 tooltip 禁则 |
| 光标坐标 | `view.coordsAtPos(pos)` 可取光标屏幕坐标（打字机 / 预览同步已在用同类 API） | 浮层锚点用光标坐标；编辑卡片为定位上下文 |
| `Tab` 现状 | 编辑器未绑定 `Tab` → 浏览器默认移动焦点；补全浮层打开时由 `completionKeymap` 接受补全 | 新绑定必须：① 只处理「表格内」；② 补全浮层打开时让位 |
| 语法树 | GFM 表格：`Table` → `TableHeader` / `TableRow` → `TableCell`（行优先，文档序即遍历序） | 单元格序列可直接由子树遍历收集，天然行优先 |

## 3. 决策记录

| # | 决策点 | 结论 | 理由 |
| --- | --- | --- | --- |
| D1 | 交互形态（对用户原方案的优化） | **在进入尺寸输入态时弹出跟随光标的浮层**，实时显示「将插入 N 行 × M 列」、操作提示与逐状态脚注 | 用户反馈「没有交互、不知道自己输的对不对」——反馈必须可见：尺寸实时回显 + 非法输入红字 + 默认行为预告 |
| D2 | 输入语法 | 数字串累加 → 空格提交当前数并推进（行 → 列）；再空格（列已就位）即插入；回车 = 用当前状态立即插入；首个空格（未输数字）= 默认尺寸插入 | 与用户描述的「数字 空格 数字 空格/回车」一致，且每一步都有浮层回显 |
| D3 | 倒计时（**2026-09-24 晚已撤销**） | **不做倒计时自动插入**：提示态一直等待用户输入数字 / 空格 / 回车 / `Esc` / 点击他处 | 用户实测反馈——有了浮层之后「1 秒自动插入」反而抢跑：提示还没看清就被插入，体验更差。撤销后「空格」成为唯一的一键默认插入路径，脚注逐状态写明其效果（见第 8 节） |
| D4 | 输入拦截层 | `Prec.highest(keymap.of([...]))`，仅在提示态激活时消费 `0-9` / `空格` / `回车` / `Esc`；其它任意键 → 取消提示态并把该键放行 | 阻止数字落进正文；「其它键」让用户随时能正常打字（不制造第二套模式） |
| D5 | 状态归属 | 新增 `stores/tablePrompt.ts`（pinia）：`active` / `rows` / `cols` / `pending` / `anchor`；`begin()` / `step()` / `cancel()` | 浮层在 `EditorView`（卡片内绝对定位）、键位在 `MarkdownEditor`、插入需要 `view`——跨组件共享状态用 store，插入动作仍留在编辑器组件 |
| D6 | 范围与默认 | 行 1–50、列 1–20；默认 2 行 × 2 列 | 上限防止误输入生成巨型表格（50×20 = 1000 格已远超手写需要）；默认与 FR-2.4.16 现状一致 |
| D7 | 表内跳转的接管范围 | 仅当：光标在 `Table` 节点内 **且** 补全浮层未激活 | 不破坏「Tab 移动焦点」的默认行为与补全交互 |
| D8 | `Tab` 到最后一格的行为 | **追加一行**（列数与表头一致）并跳到首个单元格 | 与 Word / 表格工具一致，填表流不中断；可一步撤销 |
| D9 | 跳转后是否选中单元格内容 | 选中非空单元格的内容（空格子只落光标） | 「逐格填表」场景下直接覆盖输入；与 Word 一致 |
| D10 | `Shift+Tab` 在首格 | 光标移到表格**上一行行尾**（离开表格） | 提供明确的「出表」通道，避免困在表内 |

## 4. 实现要点

### 4.1 尺寸状态机（`lib/tablePrompt.ts`，纯函数）

```ts
export const TABLE_PROMPT_LIMITS = { maxRows: 50, maxCols: 20, defaultRows: 2, defaultCols: 2 }
export interface TablePrompt { rows: number | null; cols: number | null; pending: string }
export type PromptKey = 'digit' | 'space' | 'enter' | 'escape' | 'other'
export interface PromptStep { next: TablePrompt; action: 'stay' | 'insert' | 'cancel'; warning?: string }
export function startPrompt(): TablePrompt
export function stepPrompt(cur: TablePrompt, key: PromptKey, digit?: string): PromptStep
/** 当前将插入的尺寸（含默认与上限钳制） */
export function promptDims(cur: TablePrompt): { rows: number; cols: number }
/** 浮层文案：尺寸 + 提示 + 警告 */
export function promptText(cur: TablePrompt): { dims: string; hint: string; warning: string | null }
```

规则要点：数字串最长 3 位；超限时 `warning` 给出「最多 50 行 / 20 列」，`promptDims` 钳制到上限；
**空格**：正在输第二个数时作为分隔（提交行数、等待列数），其余情况（无待提交数字 / 行数已提交 / 行列都齐）→ 直接 `insert`；
**回车**：先把 `pending` 提交掉，再 `insert`。

### 4.2 提示态与浮层

- `stores/tablePrompt.ts`：状态 + `begin(anchor)`（启动 1s 定时器）/ `step(key, digit)`（首数字取消定时器）/ `finish()` / `cancel()`；定时器到点 → 置为「待插入（默认尺寸）」并通知编辑器执行插入。
  - 插入动作由 `MarkdownEditor` 的 `pendingInsert` 消费（同 `editPosition` 的「意图 + 消费」模式）：store 给出 `pendingInsert: { rows, cols } | null`，编辑器 watcher 消费并调用 `insertTable(view, { rows, cols })`。
- 浮层组件 `components/TablePromptHud.vue`：卡片内含
  - 标题行：`插入表格` + 尺寸大字（`5 行 × 6 列`）；
  - 提示行：`输入 行 列（如 5 6）· 空格/回车 插入 · Esc 取消`；
  - 脚注行（逐状态精确）：未输入 → `按空格或回车插入 2 行 × 2 列`；正在输第一个数 → `空格继续输入列数 · 回车插入 5 行 × 2 列`；行数已提交 / 行列都齐 → `空格或回车插入 N 行 × M 列`；
  - 警告行（红字）：仅在有 `warning` 时显示；
  - 位置：`position: absolute` 于 `.editor-card`，坐标来自 `view.coordsAtPos(caret)`，超出卡片下方时翻到光标上方。
- 浮层样式沿用 CSS 变量（`--bg-primary` / `--border-color` / `--text-secondary` / `--danger`），圆角与阴影对齐既有卡片语言。

### 4.3 表内跳转（`lib/tableNav.ts`）

```ts
export interface CellRange { from: number; to: number }
export function tableAt(state: EditorState, pos: number): { from: number; to: number; cells: CellRange[]; index: number } | null
export function tableTab(view: EditorView, dir: 1 | -1): boolean
```

- `tableAt`：`syntaxTree(state).resolveInner(pos, -1)` 向上找到 `Table`；在 `[from, to]` 内遍历收集 `TableCell`（行优先）；`index` = 包含光标的单元格（光标落在分隔符时：`dir=1` 取其后第一个单元格，`dir=-1` 取其前最后一个）；
- `tableTab(view, 1)`：`index+1` 存在 → 光标/选区到该单元格内容；不存在 → **追加一行**（按表头列数生成 `|  |  |`）并跳到新行首格；
- `tableTab(view, -1)`：`index-1` 存在 → 前一个单元格；`index === 0` → 光标到表格起始行**上一行行尾**（出表）；
- 单元格内容选区：`cell.from..cell.to` 去掉两端空格与 `|`（用文本扫描找内容区间），非空则选中，空则落光标；
- 键位注册在 `Prec.high`：`Tab` / `Shift-Tab` → `tableTab`，内部先判「是否在表格内」与「补全浮层是否打开」（`completionStatus(state) !== null` → 返回 false 让位）。

### 4.4 涉及文件

| 文件 | 改动 |
| --- | --- |
| `lib/tablePrompt.ts`（新） | 尺寸状态机与文案（纯函数） |
| `lib/tableNav.ts`（新） | 表内定位与 Tab 跳转命令 |
| `lib/table.ts` | `insertTable(view, dims)` 支持行列数；`tableTemplate(cols, rows)` 复用 |
| `stores/tablePrompt.ts`（新） | 提示态 + 定时器 + 待插入意图 |
| `components/TablePromptHud.vue`（新） | 浮层 UI |
| `components/MarkdownEditor.vue` | 提示态键位（数字/空格/回车/Esc）、消费插入意图、`Tab`/`Shift-Tab` 绑定、上报浮层锚点 |
| `views/EditorView.vue` | 工具栏按钮 → `beginPrompt()`；渲染浮层 |
| `config/shortcuts.ts` | 登记 `Tab` / `Shift+Tab`（表格内） |
| `tests/tablePrompt.test.ts`、`tests/tableNav.test.ts`（新） | 单测 |

## 5. 测试计划

**单元测试**：

- `stepPrompt`：数字累加、空格推进（行 → 列 → 插入）、首个空格 = 默认插入、回车提交（含只给行数时列取默认）、Esc 取消、起点/上限钳制与警告文案、超长数字串截断；
- `promptDims` / `promptText`：默认尺寸、部分输入、超限；
- `tableAt`：表头/数据行定位、光标在分隔符上的取舍、非表格返回 null；
- `tableTab`：下一格 / 上一格、末格追加行（列数正确）、首格 `Shift+Tab` 出表、选中内容与空格子落光标。

**实测（隔离实例，CDP）**：

| 场景 | 期望 |
| --- | --- |
| `Ctrl+T` | 浮层出现（含默认尺寸与提示），正文不变 |
| 输入 `5 6 ` | 浮层实时显示 `5 行 × 6 列`；插入后表格为 5 行 6 列、光标在首格 |
| 输入 `5 6` + 回车 | 同上 |
| 只输入 `3 ` + 回车 | 3 行 2 列 |
| 什么都不做（≥2 秒） | 不插入任何内容，浮层保持等待（倒计时已于第 8 节撤销） |
| 直接空格 | 立即插入 2×2 |
| `Esc` | 浮层消失、正文与光标无残留 |
| 输入 `99 99` | 浮层红字上限提示；插入为 50×20（或输入被钳制后的尺寸） |
| 表内 `Tab` ×N | 依次经过各单元格；末格追加行；`Shift+Tab` 反向；首格 `Shift+Tab` 出表 |
| 表格外 `Tab` | 焦点移动（行为不变） |
| 所见即所得模式 | 上述跳转同样可用 |

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 浮层与光标位置不同步（滚动 / 换行） | 交互期间光标不动（数字被拦截、不触发滚动），仅在一处计算坐标；取消/插入即销毁 |
| 拦截层影响正常输入 | 拦截仅在提示态激活时生效，且任意「其它键」立即取消提示态并放行 |
| 定时器泄漏 / 组件卸载后触发插入 | store 统一持有定时器，`cancel()` / `finish()` / 组件卸载均清理；插入意图一次性消费 |
| 追加行破坏表格语法 | 新行按表头列数生成同样的 `| … |` 结构，插在原表格最后一行之后，属合法 GFM；单测断言生成文本 |
| 与补全 / IME 冲突 | 补全浮层打开时让位；提示态期间不涉及 IME（只吃数字与空格） |

## 7. 实施记录（2026-09-24 完成，分支 `feature/flow-mode`）

**交付**：

| 文件 | 改动 |
| --- | --- |
| `lib/tablePrompt.ts`（新） | 尺寸输入状态机与浮层文案（纯函数） |
| `lib/tableNav.ts`（新） | 表内定位、单元格内容区间、Tab / Shift+Tab 跳转、末格追加行 |
| `lib/table.ts` | `insertTable(view, dims)` 支持行列数（`rows` 为含表头的总行数） |
| `stores/tablePrompt.ts`（新） | 提示态 + 一次性插入意图（倒计时已于第 8 节撤销） |
| `components/TablePromptHud.vue`（新） | 跟随光标的浮层（尺寸回显 / 操作提示 / 逐状态脚注 / 红字警告） |
| `components/MarkdownEditor.vue` | 提示态键位（数字 / 空格 / 回车 / Esc + `any` 兜底取消）、`Tab` / `Shift-Tab`、消费插入意图、浮层锚点计算 |
| `views/EditorView.vue` | 工具栏按钮改为进入提示态；卡片内渲染浮层 |
| `tests/tablePrompt.test.ts`（11 项）、`tests/tableNav.test.ts`（9 项） | 单测 |

**实现中发现并修掉的三处问题**：

1. **`Tab` 绑定带 `preventDefault: true` 会在「未处理」时也吞掉按键**：CM 的语义是「绑定上声明了 preventDefault 就无条件阻断默认行为」（即使命令返回 `false`），导致表格外按 Tab 也无法移动焦点。已去掉这两个绑定的 `preventDefault`——命令返回 `true` 时 CM 自会 preventDefault，返回 `false` 时行为与从前完全一致。
2. **点击渲染态表格后 Tab 失效**：所见即所得下点击表格会把光标落在**块边界**（`table.from`），反向偏置的 `resolveInner` 会解析到相邻节点 → 判定为「不在表格内」。已补边界认领（位置正好等于表格起点 / 终点时也算在表内），并加单测。
3. **超限警告被下一次按键立即清掉**：警告改为保留到下一次提交（空格 / 回车）或提示态结束，否则用户根本看不到「最多 50 行 / 20 列」的说明。

**实测（隔离实例 + CDP 真实键盘注入）**：

| 场景 | 结果 |
| --- | --- |
| `Ctrl+T` | 浮层出现：`2 行 × 2 列` + 「按空格或回车插入 2 行 × 2 列」；正文零变化 |
| 输入 `5` → 空格 → `6` → 空格 | 浮层依次显示 `5 行 × 2 列` → `5 行 × 6 列`；插入 5 行 6 列表格（表头 + 4 数据行），光标在首列表头 |
| `3 5` + 回车 | 插入 3 行 5 列 |
| 什么都不做（≥2 秒） | 不插入，浮层保持等待（第 8 节修订） |
| 直接空格 | 立即插入 2 行 2 列 |
| `Esc` | 浮层消失、正文与光标无残留 |
| 输入 `99 99` | 浮层红字「最多 50 行 / 最多 20 列，已按上限处理」并保留；尺寸钳制到 50 × 20 |
| 表内 Tab | 依次选中 `B` → `1` → `2` → 末格 Tab 追加一行并落在新行首格；`Shift+Tab` 回退到上一格 |
| 点击渲染态表格后 Tab | 同样正常跳转（边界修复） |
| 表格外 Tab | 正文不变、焦点移出编辑器（默认行为未受影响） |

**验收**：需求第 4 节 12 项全部通过（单测 20 项 + 上表实测）。

**验证方法学**：合成 `KeyboardEvent` 无法验证修饰键组合（`event.keyCode` 恒为 0），本轮的 `Tab` / `Ctrl` 组合一律用 `Input.dispatchKeyEvent`（带 `windowsVirtualKeyCode`）注入；另注意 Vite HMR 可能让页面停留在旧模块上——改动后先 `location.reload()` 再验证（本轮因此白跑过一轮）。

## 8. 迭代记录（2026-09-24 晚）：撤销倒计时自动插入

**反馈**：用户实测验收通过，但指出「有了提示之后，1 秒自动插入反而不好——用户会知道按空格插入，而 1 秒自动插入会把提示抢在前面消失，还没看清」。

**决策**：**撤销倒计时**（D3 修订）。提示态不再自动结束，一直等待用户：输入数字、按空格 / 回车确认、`Esc` / 点击他处取消。

**随之调整的两处**：

1. **空格成为唯一的一键默认插入路径**，且语义在三种状态下都成立：什么都没输 → 默认尺寸；行数已提交 / 行列都齐 → 当前尺寸；正在输第二个数时仍是「分隔」。为避免误解，浮层脚注改为**逐状态精确描述**（见 §4.2）。
2. **文案不再出现「秒」**：脚注只说明「按空格 / 回车会发生什么」，不再预告自动行为。

**实测（隔离实例 + CDP）**：

| 场景 | 结果 |
| --- | --- |
| `Ctrl+T` 后等 2.5 秒 | 浮层仍在，正文零变化（不再自动插入） |
| 未输入时按空格 | 立即插入 2 行 × 2 列 |
| 输入 `5` | 脚注变为「空格继续输入列数 · 回车插入 5 行 × 2 列」 |
| 再按空格（行数已提交） | 脚注变为「空格或回车插入 5 行 × 2 列」 |
| 接着输入 `6` 再空格 | 插入 5 行 × 6 列 |
| 输入 `5` 后连按两次空格 | 插入 5 行 × 2 列 |
| `Esc` | 浮层消失、正文零变化 |

单测：`tests/tablePrompt.test.ts` 12 项（含逐状态脚注与「空格既是分隔也是确认」）。
