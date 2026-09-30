# 双链悬浮预览 + 心流窗口标题（FR-2.4.27 / FR-2.10.7）

> 2026-09-30 立项当日实施（分支 `feat/preview-batch`）。双链悬浮预览自 [建议存档](../suggest/wikilink-preview.md) 立项（P3 复验时用户提出）；心流窗口标题自 [建议存档](../suggest/flow-window-title.md) 立项（历史导航复验时用户提出）。两案打包一个小版本。

## 需求

### FR-2.4.27 双链悬浮预览

写作中点击引用多半是想「看一眼」目标笔记——双链的浏览动作不再直接切换笔记：

- **分栏预览**：单击双链 = 悬浮预览（不切走、可连续点）；`Ctrl/Cmd+点击` = 直接打开跳转（保留直达出口）；多候选弹层消歧后同样按当前动作交付（预览 / 打开）；断链维持提示。预览分栏不可编辑，单击预览零代价。
- **所见即所得（编辑器内）**：单击维持落光标（编辑入口）；`Alt+点击` 渲染态双链 = 悬浮预览；`Ctrl/Cmd+点击` = 直接打开（既有）；`Alt+Enter`（光标在双链内部，源码与所见即所得通用）= 悬浮预览该笔记。断链提示 / 多候选消歧与点击打开同一套（`openWikilinkByName`）。
- **悬浮预览容器内**：双链点击维持「预览内导航」（顺藤摸瓜，v0.8.3 语义）不变。
- 预览打开后可从预览卡「打开笔记」按钮 / `Esc` 后继续编辑——与搜索 / Alt+I 的预览动线完全一致。

### FR-2.10.7 窗口标题跟随当前笔记

- 常规模式：`笔记名 - Trace 笔迹`（桌面应用惯例，任务栏 / Alt+Tab 直接可辨当前笔记）；
- 心流模式：`库名 / 笔记名`（顶栏隐藏后标题让给路径，与编辑卡面包屑同风格，不带 .md）；
- 无打开笔记：恢复 `Trace 笔迹`。全模式跟随（用户拍板），随重命名即时更新。

## 决策记录

- **D1 单击语义分场景**（用户拍板）：初版按「所见即所得单击 = 预览」设计，实施前查证发现**不成立**——CM 对原子区（replace decoration）mousedown 从不设置 selection，「点击回落源码编辑」机制不存在（编辑靠键盘光标移入触发 occupied 回落，冷启动基线核实）。因此分栏预览单击预览无代价，所见即所得保留单击现状、预览走 `Alt+点击` / `Alt+Enter`。
- **D2 跳转出口**：各场景 `Ctrl/Cmd+点击` 统一直接打开；预览卡「打开笔记」按钮兜底。
- **D3 `Alt+Enter` 范围**：光标在双链**严格内部**（边界不触发——widget 回落源码后属常规编辑态）；悬浮预览开着时优先「落引用」（既有 previewTarget 语义在前）。
- **D4 标题全模式跟随**（用户拍板，否决仅心流原案）：常规 `笔记名 - Trace 笔迹`；心流 `库名 / 笔记名`。
- **D5 实现走 `document.title`**：初版走 `win:setTitle` IPC，联调发现 CDP `targetInfo.title` 度量的是网页标题而非原生窗口标题（探针量错对象），而 **Electron 自动把 document.title 同步为原生窗口标题**——撤掉 IPC 三处接线，渲染端直接赋值，顺带获得 CDP 可验证性。
- **D6 所见即所得 `Alt+点击` 走 widget 事件源**：livePreview 的 `domEventHandlers mousedown` 对原子 widget 的点击**不触发**（事件到达 document 但 CM 内部不派发给扩展 handler，探针证实）——改为 `WikilinkWidget.toDOM` 自挂 mousedown（Alt 单击时 `preventDefault + stopPropagation` 并冒泡自定义事件 `trace-wikilink-preview`），组件根节点接收。附带修复：clickHandler 的 `findTarget` 加 ±1 相邻容差（原子 widget 上 `posAtCoords` 返回区间外相邻位置，此前 Ctrl+点击渲染态链接经常不命中）。

## 实现要点

- `lib/wikiTarget.ts`：新增 `wikilinkNameAt(lineText, offset)`（光标处双链识别，与装饰层同正则口径，严格内部）；`MarkdownEditor` 的 `Alt-Enter` 键位绑定在 previewTarget（落引用）之后、补全预览之前插入双链分支；
- `lib/livePreview/`：facet 配置加 `previewNote`；`clickHandler` 支持 `Alt+点击`（非 Shift）与 ±1 容差；`WikilinkWidget` 增加 `name` 字段（eq 同步比较）与事件源；
- `MarkdownPreview.vue`：`linkAction` prop（`'preview'` 分栏 / 默认 `'open'` 悬浮容器），点击分发与多候选弹层按动作交付；
- `EditorView.vue`：分栏实例传 `link-action="preview"` + `@preview-note → app.requestNotePreview`（悬浮容器实例不动）；
- `lib/windowTitle.ts`：`buildWindowTitle` 纯函数；`App.vue` watch（deep，覆盖原地重命名）。

## 验证（2026-09-30，CDP 隔离实例，13/13 全过）

| # | 断言 | 结果 |
| --- | --- | --- |
| T1–T3 | 常规标题 `随笔 - Trace 笔迹` / 心流 `测试库 / 随笔` / 退心流恢复 | ✅ |
| P0–P4 | 分栏预览单击 = 悬浮预览未切走；Ctrl+点击跳转；跳转后标题跟随 | ✅ |
| W1–W3 | 所见即所得 widget 存在；Alt+点击 = 悬浮预览；单击无操作（不误开不跳转） | ✅ |
| S1–S2 | 源码光标在双链内 Alt+Enter = 预览；断链提示不开预览 | ✅ |

单测 +7（`buildWindowTitle` 三态 / `wikilinkNameAt` 内部命中·严格边界·空目标），全仓 546 项绿。待真机复验后合并发版。
