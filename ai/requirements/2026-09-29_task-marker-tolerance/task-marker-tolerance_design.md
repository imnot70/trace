# 任务标记容忍与不可见字符治理 — 技术设计

> 需求文档：[task-marker-tolerance.md](task-marker-tolerance.md)（FR-2.4.24 容忍识别 / FR-2.4.25 治理）。
> 诊断事实基础：[tech_product-interaction 教训 8](../../tech/tech_product-interaction.md)。

## 1. 决策记录

| # | 决策 | 拍板 | 说明 |
| --- | --- | --- | --- |
| D1 | 粘贴归一化范围 | **所有粘贴文本一律归一**（AI 建议，用户认可方案后实施） | 不做 `text/html` 来源探测：简单可预期；NBSP 在本产品场景的代码内合法用途几乎不存在 |
| D2 | 层 2（写侧）是否随首批 | **随首批一起实施** | 用户拍板「开始设计实现」未分层交付；层 2 拍板由 D1 覆盖 |
| D3 | 中括号内空白变体 | **容忍为「未勾选」** | 与 GFM「空即未勾」语义一致；只在列表项首段位置生效，不放大误判面 |
| D4 | 归一化字符集 | NBSP 类（U+00A0 / U+202F）→ 空格；零宽（U+200B / U+2060 / U+FEFF）→ 删除；**U+200D / U+200C 不动** | ZWJ 是 emoji 组成部分、ZWNJ 是阿拉伯系文字合法字母，动了毁字 |
| D5 | 粘贴挂点 | **DOM `paste` 事件拦截**（`EditorView.domEventHandlers`），非 `EditorState.inputHandler` | 见 §4——inputHandler 的调用点在所有 DOM 输入路径上（含 IME 组词），踩不得 |
| D6 | 行首污染 | 解析层不兜，交给粘贴归一化（防新增）+ 清理命令（治存量） | 容忍会改变「整行是不是列表」的块结构判定，涉面失控 |
| D7 | `- [x]` 行尾无分隔空白 | 仍不视为任务 | 与 GFM 及两管线既有行为一致（markdown-it `\s+`、lezer `[ \t]` 都要求分隔符），不借本次放宽 |

## 2. 单一定义源：`src/renderer/src/lib/invisibleChars.ts`

两个消费方都在渲染进程（markdown.ts 渲染管道 / livePreview 装饰层），故放 `renderer/src/lib/` 而非 `shared/`（shared 仅主 / 渲染共用时使用）。四组导出：

### 2.1 任务标记容忍匹配 `matchTaskMarker(content: string)`

```ts
export interface TaskMarkerMatch {
  checked: boolean        // [x]/[X] → true；[ ] 与括号内空白变体（D3）→ false
  start: number           // `[` 在输入串中的下标
  end: number             // `]` 的下一个字符下标（恒 = start + 3）
  contentStart: number    // 标记 + 其后连续容忍空白之后的位置（渲染侧切片用）
}
```

- 前导容忍集 `[\s\u200b\u2060]*`：`\s` 已覆盖 NBSP / 窄 NBSP / BOM（JS `\s` 语义，实测验证），ZWSP / 词连接符显式补入；**不含 ZWJ / ZWNJ**（合法文字成分，绝不越过它们认任务）；
- 括号内容集 `[ xX\u00a0\u202f]`：空白变体按未勾选（D3）；
- 分隔符要求：`]` 后至少一个容忍空白（`[\s\u200b\u2060]`），`contentStart > end`；行尾裸 `[x]` 返回 null（D7）。

### 2.2 归一化与统计（层 2 / 层 3 共用）

```ts
export function normalizeInvisibleChars(text: string): { text: string; nbsp: number; zeroWidth: number }
export function scanInvisibleChars(text: string): { nbsp: number; zeroWidth: number }
export function collectDocInvisible(doc: Text): { nbsp: number; zeroWidth: number; changes: { from: number; to: number; insert: string }[] }
```

- `collectDocInvisible` 逐字符扫 `Text`，NBSP 类产出 `{insert: ' '}`、零宽产出 `{insert: ''}` 的替换区间（相邻同类合并）；确认框计数与写回 change 同源，不会算错。

## 3. 层 1 — 双管线接入

### 3.1 markdown-it（`lib/markdown.ts` 的 `trace_task_lists` core rule）

`first.content.match(/^\[([ xX])\]\s+/)` 替换为 `matchTaskMarker(first.content)`：

```ts
const m = matchTaskMarker(first.content)
if (!m) continue
first.content = first.content.slice(m.contentStart)
const box = new state.Token('html_inline', '', 0)
box.content = `<span class="task-item-checkbox"${m.checked ? ' data-checked="true"' : ''}></span>`
children.unshift(box)
```

切片口径与旧规则等价（旧 `\s+` 贪婪吃掉全部尾随空白 → 新 `contentStart` 同）；预览只做 token 内容级切片，不涉行号映射。导出 PDF / HTML 与 `RenderedBlockWidget`（所见即所得块级渲染）走同一 `md` 实例，自动同步受益。

### 3.2 所见即所得装饰（`livePreview/decorations.ts`）

lezer 的 TaskParser 守卫不可配置，采用**兜底扫描**：`ListItem` 分支中 `!isTaskItem(ref.node)` 时，对标记行做文本扫描：

- 扫描域：`doc.sliceString(mark.to, line.to)`（列表标记后到本行行尾——列表项首段内容必起于此，嵌套列表的内层项由其自身节点处理，外层首段无 Paragraph 不误判）；
- `matchTaskMarker` 命中 → 复选框 widget 挂在真实 `[` 位置（`mark.to + m.start`），勾选态用 `m.checked`；
- 列表标记隐藏范围从旧「标记 + 一个空格」改为 `mark.from .. mark.to + m.start`（把标记与 `[` 之间的 NBSP 一并吞掉，否则复选框前残留空隙）；正常 ASCII 任务行 `m.start` 恰为旧口径（标记后 1 个空格），**行为逐字节一致**；
- `lineBusy`（光标在行 → 整行回落源码）与 `seenMarks` 去重沿用既有判定；
- 有 `Task` 子节点（lezer 已认）时走既有 `TaskMarker` 分支，兜底不触发——**不会出现双复选框**。

### 3.3 写回 `toggleTaskAt`（`livePreview/widgets.ts`）

**零改动**。widget 的 `pos` 指向真实 `[`（写回只动 3 个 ASCII 字符，NBSP 在括号外）；既有 `[ ]/[x]/[X]` 三态守卫天然兜底。index 待办 #11 原文的「写回适配」经核实为无需适配（pos 来源换成就够了）。

## 4. 层 2 — 粘贴归一化（D5：DOM paste，不走 inputHandler）

**为什么不是 `EditorState.inputHandler`**：其实际调用点在 `@codemirror/view` 的 `applyDOMChange`（dist 4354 行）——**所有 DOM 驱动的文本输入都经过它，包括 IME 组词提交**，且签名不携带事件无法分流。项目有「介入组词渲染破坏组词锚点」的既有教训（AGENTS.md / 留白重设计 §6.5），把归一化挂上去等于在 IME 关键路径上埋雷，排除。

**落点**：`EditorView.domEventHandlers({ paste })`——CM 官方支持的自定义粘贴模式（preventDefault + 自行 dispatch）。挂在 MarkdownEditor 扩展装配处，实现为可测的独立工厂：

```ts
// invisibleChars.ts
export function invisiblePasteExtension(onClean?: (count: number) => void): Extension
```

- `event.clipboardData?.files.length` → 直接让路（返回 false，文件粘贴管线是外层 Vue `@paste` 的既有职责）；
- `getData('text/plain')` 为空 → 让路；`normalizeInvisibleChars` 零替换 → 让路（原生路径，零行为差）；
- 有替换 → `preventDefault()` + `view.dispatch(view.state.replaceSelection(cleaned), { userEvent: 'input.paste', scrollIntoView: true })`——**手工补 `input.paste` 注解**，下游按 userEvent 分流的逻辑（打字机重锚排除 `input.paste`、vim 注解等）不受影响；
- 已知边界：多光标粘贴不再按「光标数 = 行数」分行（应用未启用多光标编辑，接受）；替换数 > 0 时经 `onClean` 回调 toast「已清理 N 个不可见字符」（组件层 ElMessage）。

## 5. 层 3 — 清理本文命令

- **斜杠命令**：`slashCommands.ts` 新增 action kind `{ kind: 'cleanInvisible' }`，命令 `/清理字符`（别名 clean / invisible）；`runSlashAction` 落到 `cleanInvisibleInEditor(view)`——与「命令化封装」原则一致，斜杠与按钮同一函数；
- **工具栏按钮**：EditorView 格式工具栏 TipButton（Brush 图标，「公式块」按钮右侧——用户指定位置；图标包无 Eraser），经 `editorRef.cleanInvisibleChars()` 调用（`defineExpose` 增补）；
- **交互**：扫描零结果 → `ElMessage.info('未发现不可见字符')`；有结果 → `ElMessageBox.confirm` 列明种类与处数（如「发现 3 处不换行空格（将替换为普通空格）、1 处零宽字符（将删除）」）→ 确认后**单事务** dispatch `collectDocInvisible` 的 changes（自动保存 / 撤销 / 外部修改保护既有机制全部自然生效），成功 toast 处数。

## 6. 测试设计

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| matcher | `tests/invisibleChars.test.ts`（新） | 四类污染位置 × ASCII 对照 / `[X]` 大写 / 括号内变体 / 行尾裸 `[x]`（null）/ 非行首 `[x]`（null）/ ZWJ 不越界；normalize 字符集边界（ZWJ/ZWNJ 保留、U+202F→空格、U+FEFF 删除）；collectDocInvisible 区间正确性 |
| 预览 | `tests/markdownRender.test.ts` 追加 | `- ⍽[x] 任务` / `[x]⍽任务`（变体由前导容忍覆盖）渲染复选框；`[⍽]` 渲染未勾选；ASCII 行为回归 |
| 装饰 | `tests/livePreview.test.ts` 追加 | 兜底扫描产出 CheckboxWidget（`- ⍽[x]` / `- [x]⍽` / `[⍽]`）；ASCII 任务行走 TaskMarker 分支不双渲染；lineBusy 回落 |
| 粘贴 | `tests/invisiblePaste.test.ts`（并入 invisibleChars.test.ts） | jsdom 合成 paste 事件（clipboardData 桩）：污染文本被归一写入、`input.paste` 注解在、零污染走原生、文件粘贴让路 |
| 清理 | 同上 | collectDocInvisible → dispatch 后落盘断言（确认框文案数字同源） |

CDP 冒烟（隔离实例，沿用教训 8 的同字节复现手法）：构造含 NBSP 的任务行笔记，断言预览与所见即所得复选框渲染、点击勾选写回、`cat -A` 核对最小写入；粘贴含 NBSP 文本后落盘已归一。

## 7. 影响面与回滚

- 改动集中渲染进程 5 个文件 + 新模块 1 个 + 测试 2 个；无主进程 / IPC / 存储结构变更，无迁移；
- 容忍逻辑只在「本已拒绝」的位置生效（D7 / ASCII 零变化原则），最坏情况回滚 = revert 单 commit；
- 观察项登记 long-term-watch：容忍后 GitHub 端与本地渲染的一致性（GitHub 仍不认 NBSP 任务——清理命令即对策）。

## 8. 实施与验证记录（2026-09-29，分支 `feat/task-marker-tolerance`）

### 8.1 交付清单

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/lib/invisibleChars.ts`（新） | 字符集定义 + `matchTaskMarker` 容忍匹配 + `normalizeInvisibleChars` 归一化 + `collectDocInvisible` 文档扫描（计数与写回 change 同源）；纯逻辑无 CM 运行时依赖 |
| `src/renderer/src/lib/invisibleEdits.ts`（新） | CM 接线：`invisiblePasteExtension`（DOM paste 拦截，D5）+ `handleInvisiblePaste`（导出供单测）+ `buildCleanInvisibleTransaction`（单事务清理） |
| `src/renderer/src/lib/markdown.ts` | `trace_task_lists` 规则内联正则 → `matchTaskMarker`（§3.1） |
| `src/renderer/src/lib/livePreview/decorations.ts` | `ListItem` 分支加 `scanFallbackTask` 兜底（§3.2），与 Task 分支互斥防双渲染；标记隐藏范围吞掉标记与 `[` 之间的污染空白 |
| `src/renderer/src/lib/slashCommands.ts` | 新 action kind `{ kind: 'cleanInvisible' }` + 命令 `/清理字符`（别名 clean / invisible） |
| `src/renderer/src/components/MarkdownEditor.vue` | 挂 `invisiblePasteExtension`（替换 toast）；`cleanInvisibleChars()`（确认框 → 单事务 → 成功 toast）；`runSlashAction` 分支；`defineExpose` 暴露 |
| `src/renderer/src/views/EditorView.vue` | 格式工具栏清理按钮（Brush 图标，「公式块」右侧，用户指定位置；图标包无 Eraser。实施后从顶栏 V 按钮旁迁入工具栏） |

`toggleTaskAt` 零改动（§3.3 结论成立：widget pos 指向真实 `[`，写回仍是 3 个 ASCII 字符）。

### 8.2 实施中发现与修正

- **`EditorView.inputHandler` 排除的实证**：其调用点在 `@codemirror/view` dist 4354 行 `applyDOMChange`——所有 DOM 驱动输入（含 IME 组词提交）都经过且签名无事件可分流（D5 的依据，写代码前核实）；
- **`Transaction` 无 `userEvent` 属性**：读取用 `tr.annotation(Transaction.userEvent)`（本仓既有代码即此写法，`isUserEvent` 也走注解）；spec 里的 `userEvent:` 字段会转成注解，单测初版误用属性读取已修正；
- **装饰层双渲染防线**：兜底扫描最初误放在 Task 分支之外，ASCII 任务行（lezer 已认）会被重复处理——修正为 if/else 互斥（§3.2），并有单测「恰好一个复选框」守卫；
- `changes` 支持 `{from,to,insert}[]` 数组（`ChangeSpec = ... | readonly ChangeSpec[]`），清理事务单 spec 搞定。

### 8.3 验证结果

- **单测**：新增 17 项（matcher 矩阵 / 归一化字符集含 ZWJ 保留 / 文档扫描区间合并 / 粘贴桩四类让路 / 清理事务注解）+ 渲染 4 项 + 装饰 5 项 + 斜杠注册 1 项；全仓 **496 项**（39 文件）——Windows 下 gitService 集成测试按既有口径 `--testTimeout=90000` 单独验证 8/8 通过，其余全绿；
- **lint / typecheck**：`eslint src tests` 无错误；主 / 渲染双 tsc 全绿；
- **CDP 冒烟（隔离实例 10/10）**：预置临时工作区 + 受染笔记（`cat -A` 核对字节，`20 c2a0` / `5d c2a0` / `5b c2a0 5d` 三种污染位）——
  ① 预览渲染 4 个复选框（3 勾选 + 括号内 NBSP 为未勾选）；② 所见即所得同样 4 个；③ 点击兜底复选框写回 `[x]→[ ]` 且**行内 NBSP 原样保留**（磁盘真值断言，最小写入）；④ ASCII 行与分隔污染行零误改；⑤ 合成 `ClipboardEvent` 粘贴含 NBSP+零宽文本 → 归一化入库、事件被接管（defaultPrevented）、toast「已清理 2 个不可见字符」；⑥ 清理命令确认框列明「3 处不换行空格」、确认后编辑器与磁盘 NBSP 清零、成功 toast 报告处数；
- **冒烟调试中的两条假阳性**（防再踩，均已写明）：打开笔记光标落位在首行 → 该行 `lineBusy` 回落源码不渲染复选框（非缺陷，脚本须先移开光标再计数/点击）；断言 toast 前须等上一条 ElMessage 消失或取「最后一条」（index §3 既有教训的再次实例）。

