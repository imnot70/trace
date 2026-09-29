# Vim 模式技术设计（FR-2.4.23）

> 2026-09-28 设计与实施。需求见 [vim-mode.md](vim-mode.md)；键位冲突策略已于 2026-09-28 与用户拍板（四项决策见第 2 节）。

## 1. 包选型修正：`@replit/codemirror-vim`

立项文档写的「官方 `@codemirror/vim`」在 npm 上**不存在**（实装时 registry 返回 404 验证）。CM6 生态的 vim 集成事实标准是 **`@replit/codemirror-vim`**（Replit 维护，CodeMirror 5 vim 键位的移植，`@codemirror/vim` 名称被官方占位但从未发布）。本设计基于 `@replit/codemirror-vim@6.4.0`（依赖 `@replit/codemirror-vim-core`）：

- normal / insert / visual（含 line / block）/ replace 完整实现，计数、寄存器、标记、`.` 重复等齐备；
- 自带 normal 模式方块光标（BlockCursorPlugin + fat-cursor 主题，`Prec.highest` theme）；
- IME：compositionstart/update/end 仅透传 inputEvent，正文输入经 `inputHandler`——组词文本不经过 vim 键位状态机（真机验证仍必需，CDP 测不出）。

**关键机制（决定冲突策略的实现方式）**：该包**不使用 CM keymap**，而是 `EditorView.domEventHandlers` 在 keydown DOM 事件上直接接管（`handleKey`）+ `EditorView.inputHandler` 承接文本插入。已映射的键会被它拦截并 preventDefault，**不会穿透**给后续 handler——因此「应用键位优先」无法靠扩展顺序或 `Prec` 达成（keymap 与 domEventHandlers 在同一条 handlers 管线里按扩展顺序执行，vim 在前必拦截），只能用包内 `Vim.unmap()` 把冲突键从其全局键位表显式移除。`unmap` 按 `keys + context` 精确匹配 `defaultKeymap` 条目、无匹配时返回假值不抛错；同一键可能在多个 context 有条目，需循环删到无残留。

## 2. 键位冲突策略（2026-09-28 用户拍板）

| 决策点 | 结论 |
| --- | --- |
| **Esc** | **浮层优先、心流退出让位**：浮层类（浮层侧栏 / 悬浮预览 / 各弹窗 / `[[` 补全 / 查找面板）的 Esc 仍由应用级分级链先消费（行为不变）；无浮层且编辑器聚焦时 Esc 让位 vim 返回 normal；**退出心流改走 Alt+W / 顶栏咖啡杯**。焦点不在编辑器（悬浮预览 / 工具栏按钮等）或 vim 未开启时，Esc 行为完全不变。 |
| **Ctrl 系** | **应用优先、vim 保留空闲键**：卸载 vim 的 `<C-f>`（翻页）、`<C-b>`（翻页）、`<C-e>`（下滚一行）、`<C-i>`（跳转前进）、`<C-n>`（补全下一项）、`<C-t>`（缩进标签）——对应应用的 Ctrl+F 查找 / Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+E 编辑形态 / Ctrl+N 新建 / Ctrl+T 表格。vim 保留应用未占用的键：`<C-d>` / `<C-u>` 半页滚动、`<C-y>` 上滚一行、`<C-o>` 跳回与 insert 临时 normal、`<C-r>` 重做、`<C-v>` 块可视、`<C-w>` 删词（insert）、`<C-a>` / `<C-x>` 数字自增减（应用无菜单加速键，Ctrl+W 无占用）。Alt 系 vim 不绑定，无冲突。**2026-09-29 用户反馈**：`<C-v>` 与系统粘贴冲突（最初拍板遗漏）——待办 #13 待拍板修法，见 [index 待办清单](../index.md)。 |
| **模式指示** | **工具栏右端小徽标**：等宽字体胶囊（NORMAL / INSERT / VISUAL / V-LINE / V-BLOCK），配色按模式区分（normal 中性 / insert accent 描边 / visual accent 底）；心流 / 专注（顶栏隐藏）下靠光标形状区分，不占状态区。 |
| **相对行号** | **首发不做**，按真机反馈再议（行号槽自绘，后续加设置项改动可控）。 |
| **Ctrl+[ 退出 insert**（2026-09-28 用户反馈补） | 标准 vim 的 Esc 等价键。包内 defaultKeymap 虽有 `<C-[>` → `<Esc>` 映射，但被 CM 基础装配（traceSetup 的 defaultKeymap）自带的 `{ key: "Mod-[", run: indentLess }` 在 keymap 层**先命中即停**，形同虚设。修法：vimCompartment 内随 vim() 挂 `Prec.high` 的 `Ctrl-[` 绑定，run 转发 `Vim.handleKey(cm, '<Esc>')`；非 vim 用户（compartment 为空）保持 indentLess 不变。 |

其余既定口径：设置 → 编辑器分类开关（默认关）；源码与所见即所得通用（都在 CM 层）；心流 / 专注可用；关闭开关完全恢复现状（Compartment 摘除，无残留）。

## 3. 实现

### 3.1 模块：`src/renderer/src/lib/vimMode.ts`（新）

- `VIM_YIELDED_KEYS`：六个让渡键常量（CM5 记法 `<C-f>` 等），单测锚定；
- `buildVimExtension()`：模块级幂等执行 `removeYieldedKeys()`（循环 `Vim.unmap(key)` 直到无匹配）后返回 `vim()` 扩展——卸载作用于包内全局键位表，与编辑器实例无关，且**永久让渡**（开关关闭不恢复这些映射：它们本来就与应用键位相撞）；
- `readVimMode(view)` / `formatVimModeLabel(mode)`：经 CM5 适配层 `getCM(view).state.vim.mode` 读当前模式（`vim-mode-change` 事件维护）；徽标文案大写化、子模式缩写；
- `shouldYieldEscapeToVim(vimEnabled, editorFocused)`：Esc 让位纯函数（单测覆盖三态）。

### 3.2 编辑器集成：`MarkdownEditor.vue`

- 仿既有 typewriter 模式新增 `vimCompartment`：初始按 `props.vimEnabled` 挂载空扩展或 `buildVimExtension()`，开关变化经 `Compartment.reconfigure` 换装（键位扩展无 StateField，允许增删）；
- view 创建后 `getVimCM(view)?.on('vim-mode-change', ...)` 把当前模式写入 editor store（`vimMode` 字段，null = 未开启）；卸载与开关关闭时清空；
- 徽标渲染在 `EditorView.vue` 工具栏右端（`margin-left: auto`），读 store 显隐。

### 3.3 Esc 分级链：`App.vue`

`onEscape()` 的心流分支前置让位判定（焦点判定 `document.activeElement.closest('.cm-editor')`）：

```ts
if (app.flowMode) {
  if (shouldYieldEscapeToVim(app.settings.vimEnabled, isEditorFocused())) {
    return false  // Esc 下沉到 CM → vim 返回 normal；心流退出走 Alt+W / 咖啡杯
  }
  app.exitFlow()
  return true
}
```

分级链的更早分支（模态 / 浮层侧栏 / 悬浮预览 / 补全 / 查找面板）不动——即「浮层优先」天然成立；vim 关闭时整条链行为不变。

### 3.4 设置链路

`AppSettings.vimEnabled: boolean`（默认 `false`）→ 主进程默认值对象（JsonStore 深合并自动回填老 settings.json，无需迁移）→ app store 前端兜底默认值同步补齐 → 设置页「编辑器」分类 el-switch + 冲突速查说明（开关开启时显示，102px 缩进对齐）→ `config/shortcuts.ts` 登记 Esc 让位与 vim 键位两条速查。

## 4. 已知边界与验证清单

- **`Vim.unmap` 是全局副作用**：卸载六个键在模块首次调用 `buildVimExtension()` 时发生一次；对单编辑器实例架构无影响；
- **中文输入法**：insert 模式组词理论上经 inputHandler 透传不受 vim 键位状态机影响，但 **CDP 无法驱动真实 IME，必须真机验证**（Windows 微软拼音 / 五笔 + Linux fcitx）；
- **normal 模式下的 `s` / `x` 等改动键**直接作用于文档，依赖既有 1s 防抖自动保存与 hash 保护，无额外处理；
- CDP / 真机验收清单：开关开 → 工具栏出现 NORMAL 徽标；`i` → INSERT + 竖线光标；`Esc` → NORMAL + 方块光标；`v` / `V` / `Ctrl+v` → VISUAL / V-LINE / V-BLOCK；`j`/`k`/`dd`/`u`/`Ctrl+r` 动作正常；Ctrl+F 开查找面板、Ctrl+T 表格、Ctrl+E 切形态（应用键位未被 vim 抢走）；Esc 在心流内不退心流、Alt+W 退；关闭开关后全部恢复。

## 5. 实施记录（2026-09-28）

- 依赖：`@replit/codemirror-vim@6.4.0`（`npm install`，含 `@replit/codemirror-vim-core`）；
- 代码：`lib/vimMode.ts`（新）、`MarkdownEditor.vue`（compartment + 模式监听 + 卸载清理）、`EditorView.vue`（props 透传 + 徽标 + 样式）、`App.vue`（Esc 让位分支 + `isEditorFocused`）、`SettingsView.vue`（开关 + 速查说明）、`config/shortcuts.ts`（2 条登记）、`shared/types.ts` + `main/index.ts` + `stores/app.ts` + `stores/editor.ts`（设置与状态字段）；
- 测试：`tests/vimMode.test.ts` 8 项（Esc 三态 / 让渡键清单 / 构建幂等 / **unmap 真实生效断言** / 徽标文案）；既有 3 个测试文件的合成 settings 补 `vimEnabled: false`（类型必需）；
- 顺手修复：音色收敛迁移目标 bug——retro2 批次把 `SOUND_VARIANTS` 改为 `['retro2']` 但迁移目标漏改为 `'retro2'`（仍写 `'retro'`），存量值永不收敛、每次启动重复写盘且设置页选择器可能出现空值；已改为迁移到 `'retro2'`；
- 单测全绿；**CDP 隔离实例验证全过**（见第 6 节）；真机 IME / 键位手感待用户验证。

## 6. CDP 验证记录（2026-09-28，隔离实例 TRACE_TEST_USERDATA + TRACE_CDP=9222）

全部通过（页面内合成 KeyboardEvent 注入 + DOM/ store 双侧断言）：

| # | 断言 | 结果 |
| --- | --- | --- |
| 1 | 开启 vim → 工具栏出现 NORMAL 徽标（watch → compartment 挂载 → readVimMode） | ✅ |
| 2 | `i` → INSERT（cm.state.vim → vim-mode-change 事件 → store → 徽标全链路） | ✅ |
| 3 | `Esc` → NORMAL（含 vim 返回 normal + preventDefault） | ✅ |
| 4 | `v` → VISUAL、`Shift+V` → V-LINE（子模式文案缩写） | ✅ |
| 5 | `Ctrl+F` 打开查找面板——**unmap 生效，应用键位优先**（vim 已卸载 `<C-f>`） | ✅ |
| 6 | normal 模式 `dd` 删行（vim 文本动作，status "d" → 删行） | ✅ |
| 7 | `Alt+W` 进 / 出心流（应用键位未被 vim 干扰） | ✅ |
| 8 | **心流内 Esc 不退出心流**（vim 让位判定生效，Esc 归 vim；徽标保持） | ✅ |
| 9 | 关闭开关 → 徽标消失、`i` 恢复普通输入（Compartment 摘除无残留） | ✅ |
| 10 | **`Ctrl+[` 退出 insert**（Esc 等价键转发绑定；同时确认 store / 徽标同步、normal 模式下无副作用） | ✅ |

### 实施中发现并修复的缺陷（重要教训）

- **适配层监听器随 Compartment 换装失效**：vim 的模式变化事件（`vim-mode-change`）挂在 CM5 适配层实例上，而**适配层实例随扩展的挂载/摘除整个重建**（`vimCompartment.reconfigure` → ViewPlugin 重建 → `new CodeMirror(view)`）。只在 `createView` 时挂一次监听的话，开关切换后所有模式事件丢失——表现为**功能正常但徽标永久停留在挂载初值**。修法：`attachVimModeListener()` 在 createView 与每次开关挂载后调用，记录已挂的适配层实例避免重复。**泛化教训：Compartment 换装一个 ViewPlugin 类扩展 = 插件实例与其持有的一切资源/事件订阅全部重建，跨实例的订阅必须在每次挂载后重挂。**
- 验证过程的其他观察（记入验证方法学）：① CDP `Input.dispatchKeyEvent` 在本环境对后台窗口不可靠（与既有教训一致），**页面内合成 `KeyboardEvent`（在 contentDOM 上 dispatch、bubbles）是可靠的按键注入方式**，编辑器键位（target 阶段）与应用层 window 监听（冒泡）都能收到；② 心流 / 专注的顶栏隐藏是 **CSS 隐藏而非 DOM 移除**，验证脚本不能用「元素不存在」判定顶栏隐藏，应读 app store 的 `flowMode` / `zenMode`；③ 调试通道：`.editor-pane.__vueParentComponent.setupState.view` 可从页面直接拿到 CM `EditorView` 实例，配合 `getCM(view).state.vim` 三点联动（包状态 → 事件 → store）可精确定位断链层。

## 7. 块级公式光标可进入（方案 A，2026-09-28 接力实施）

> 交接来源：[handoff-2026-09-28 第二节](../changelog/handoff-2026-09-28.md)（根因实验数据与设计已拍板，本文记录落地实现与验证）。

### 7.1 实现与交接设计的差异

按交接候选 1 的方向落地，但 **Vim 侧改用 `Vim.defineMotion` + `Vim.mapCommand`（motion 替换）而非 action 映射**——action 会绕过包内可视模式的选区扩展机制（`updateCmSelection` 未导出，V-LINE / V-BLOCK 的行 / 块语义需手工复刻）；motion 只需返回落点，`evalInput` → clip → 可视选区扩展全部由包内既有机制自理，同时天然获得计数（`3j` 经 `motionArgs.repeat`）。

- **motion `traceMoveByLines`**（`lib/vimMode.ts`）：逐行复刻包内 `moveByLines`（粘滞列 `lastHPos` / `lastHSPos`、文档边缘 `moveToStartOfLine` / `moveToEol` 分支），**唯一语义改动**：`findPosV` 的落点在 `hasMarkedText` 调和前经 `crossBlockLanding` 拉回被飞跃块的近端边界——护城河的传播机制（远端 posV 使 `hasMarkedText` 判真、劫持落点）由此消除，调和回到「理想行」文档语义，光标落进公式源码。粘滞列像素坐标在落点处于渲染块内时（`coordsAtPos` 为 null、left 为 0）保留旧值。
- **只映射 `context: normal` / `visual`**（`j`/`k` 各两条，`mapCommand` unshift 先于默认命中）：`operatorPending` 不映射——`dj`/`dw` 等操作符仍走包内默认 motion，区间按远端截断（删过整块）是合理的删除语义。`<Down>`/`<Up>` 经包内 keyToKey 映射到 `j`/`k` 自动获得修正。
- **非 Vim**：`smartVerticalMove(view, dir)`（`lib/livePreview/smartMove.ts`）——执行默认 `cursorLineDown`/`cursorLineUp` 后对跨块落点改写近端边界（第二事务 dispatch，`occupied` 贴边触发源码回落）；无渲染块（含所见即所得关）返回 false 放行 defaultKeymap。`ArrowDown`/`ArrowUp` 绑定挂在 MarkdownEditor.vue 应用级 `Prec.high` 键位组；vim 开启时方向键被 vim 的 keydown 观察器先行接管（plugin observers 先于一切 keymap handler），不会双触发。
- **区间来源**：`computeBlockDecorations` 结果新增 `blocks`（本次**实际渲染**为块级 widget 的源码区间，光标回落源码的块不在其中——坐标扫描只会飞跃渲染中的块，判定必须以此为据），经 StateField 持有、`renderedBlockRanges(state)` 导出（decorations.ts；连带覆盖表格 / HTML 块 / 水平线 / frontmatter 的同类缺口）。位置在 decorations.ts 而非装配层 index.ts：`tests/**` 在主进程 tsconfig（无 DOM lib、无 env.d.ts 的 `window.trace` 增强）下编译，装饰模块的依赖链测试安全，index.ts → `../wikilink` 不是。

### 7.2 验证（CDP 隔离实例，2026-09-28，全过）

`TRACE_TEST_USERDATA=1 TRACE_CDP=9222`，页面内合成 KeyboardEvent 注入 + DOM/store 断言；笔记 = 标题行 + `top line` / 三行 `$$…$$` 块 / `bottom line` / 行内 `$t$`：

| # | 断言 | 结果 |
| --- | --- | --- |
| 1 | 非 Vim `↓` 自块上一行 → 光标落块首行（`line4.from`），块回落源码（`.lp-math-block` 1→0，DOM 行 7→10） | ✅ |
| 2 | 非 Vim 源码内 `↓` 逐行（块首行 → 公式正文行） | ✅ |
| 3 | 非 Vim `↑` 自块下一行 → 光标落块尾行（`line6.to`），回落保持 | ✅ |
| 4 | 非 Vim 光标离开区间 → 块重新渲染（现行为不回归） | ✅ |
| 5 | 点击 widget 进入源码不回归（mousedown 于 widget 中心 → 贴边 → 回落） | ✅ |
| 6 | 行内公式：`↓` 正常落行，busy 行行内 widget 隐藏（`$t$`） | ✅ |
| 7 | 源码模式（所见即所得关）：`↓` 逐行零变化 | ✅ |
| 8 | Vim `j` 自块上一行 → 落块首行内（粘滞列钳制到 `$$` 行内），回落 | ✅ |
| 9 | Vim `k` 自块下一行 → 落块尾行内 | ✅ |
| 10 | Vim `3j` 计数 → 理想行（块内最后一行） | ✅ |
| 11 | Vim `v` + `j` → 选区 head 落块首行内（不跳块） | ✅ |
| 12 | Vim `V` + `j` → 行选扩展至块首行整行（`updateCmSelection` 机制自理） | ✅ |
| 13 | Vim 源码模式 `j` 逐行（语义与改动前一致） | ✅ |
| 14 | Vim `dj` 操作符 linewise 删 2 行 + `u` 撤销（默认 motion 未受扰动） | ✅ |

单测：`tests/smartMove.test.ts` 10 项（跨块判定纯函数八态 + 无块放行两态），全仓 450 项全绿。

### 7.3 实施中发现的坑（防再踩）

- **跨块判定多块方向不对称**：向下连跨多块应取文档序**首个**命中（离起点最近），向上应取**最后一个**——首版统一取首个，单测当场抓出（向上两块时落点错到最远的块尾）。
- **CDP 断言读到过期文档**：`const doc = view.state.doc` 捕获后，删除类事务产生**新 state**，旧 `doc` 常量读出的长度 / 行号恒为事务前——`dj` 一度误判为「无删除」。断言一律经 `view.state.doc` 现取（「验证脚本自身要自证正确」的又一实例）。
- **vim motion 的粘滞列**：包内 `moveByLines` 每步把 `lastHSPos` 更新为落点行的 `charCoords().left`；落点在渲染块内时 `coordsAtPos` 返回 null（适配层取 `|| 0`），照抄会把粘滞列写成 0——修正发生时保留旧值更接近真实列（回落源码后列号不变）。

## 8. 打字机锚定失效（2026-09-28 用户实测截图反馈，当日修复）

### 8.1 现象与根因

- **现象**：心流 / 打字机 + vim 时，normal 移动（`j`/`k` 及 `gg`/`G`/计数跳转）后视图不跟随，光标漂离锚点线且「时灵时不灵」——截图里光标停在视口上部，远离心流低位锚点（80%）。
- **根因**：打字机的重锚判定按事务的 `Transaction.userEvent` 注解分流（`typewriter.ts` 的 `isAnchorEvent`，匹配 `input|delete|undo|redo|select|move` 前缀 → 强制重锚；无匹配只剩会被滚动冷却吞掉的几何软调度）。而 **vim 适配层绕过 CM 输入管线直接 `view.dispatch`，移动类事务不带任何 userEvent**（探针实证：`j`/`k` 事务注解为 null）——打字机对 vim 的移动完全失明；normal 编辑（`x`/`dd`/`o`/`p`）由包内 `dispatchChange` 自带 `input.type.compose` 注解、insert 打字走原生管线自带 `input.type`，这两条线本就正常——**缺口恰为纯选区事务（移动 / 可视选区 / 模式切换后的选区重置）**。长距离跳转偶尔能追上是 `viewportChanged` → 几何软调度在起作用（不受滚动冷却时），造成「时灵时不灵」的观感。

### 8.2 修法

`vimMode.ts` 新增 `annotateVimDispatch`（挂 `buildVimExtension` 返回的插件里，每 view 一次）：包装 `view.dispatch`，仅当事务产生于 vim 操作内（包内 `findKey` 的 `cm.operation` 包裹置位 `curOp.isVimOp`）且 spec 未带注解时按形状归类——有 `changes` → `input.trace-vim`、纯选区 → `select.trace-vim`；vim 之外的 dispatch（含打字机自身的 `scrollIntoView`）与已注解的 spec 一律原样透传。vim 关闭后适配层随之移除（`getCM` 为 null），包装层恒走透传分支，无副作用。

连带调整：回车音效的 `isReturnInsertion`（MarkdownEditor.vue）排除 `input.trace-vim`——回车音效语义是打字流中的回车（insert 模式 Enter 走原生 `input.type` 照常发声），vim normal 的结构编辑（`o`/`O`/`p`）不误响。`isAnchorEvent` 无需改动（`input` / `select` 前缀已覆盖两个注解值）。

### 8.3 验证（CDP 隔离实例，心流 + 打字机低位 + vim，与用户截图同态）

| # | 断言 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| 1 | `3j` 移动后光标行视口占比 | **23.2%**（不跟随，截图同症状） | **80.0%**（精确回锚） |
| 2 | `k` / `20j` / `x` 编辑后 | 23.2% / 83.4%（软路径偶追）/ 偏移 | 80.0% / 80.0% / 80.0% |
| 3 | vim insert 模式打字（原生管线） | 80%（本来就正常） | 80%（回归不变） |
| 4 | 非 vim `↓`（原生 select 注解路径） | 80% | 80%（回归不变） |

单测 +4（`tests/vimMode.test.ts`）：移动事务带 select 注解（修复前为 null）/ 编辑事务自带包内 input 注解（既有行为锚定）/ 无注解 spec 按形状归类且已注解的不改写 / vim 操作之外透传；`tests/typewriter.test.ts` 的 `isAnchorEvent` 清单纳入两个注解值。全仓 454 项全绿。

**泛化教训**（已登记 tech_cm6-editor）：CM6 生态里绕过输入管线的第三方 dispatch（如各编辑器适配层）不带 userEvent——凡按 userEvent 分流的扩展（打字机锚定 / 回车音效 / 将来任何类似机制）集成此类组件时必须显式补注解，不能假定事务自带来源标记。
