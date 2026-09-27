# 打字机留白生命周期重设计 — 技术设计

> 需求见 [typewriter-padding-redesign.md](typewriter-padding-redesign.md)。本文件记录机制分析、
> 承载层改造、会话态设计与同步修正；实施与验证记录见第 6 节。

## 1. 机制分析：留白是怎么残留的

### 1.1 现状链路（改造前）

```
typewriter(mode)                          # lib/typewriter.ts
  ├─ off  → []                            # 空扩展，compartment 摘除
  └─ on   → ViewPlugin（插件实例）
              ├─ 构造/RO/anchor → applyPadding()：把 padding 写成 .cm-content 内联样式
              └─ destroy()：removeProperty 清理 + cancel rAF + RO.disconnect
```

清理完全依赖「destroy() 那一刻 JS 正确执行」。静态审查发现的漏洞：

1. **scroll 监听泄漏**：构造时 `view.scrollDOM.addEventListener('scroll', …)`，`destroy()` 没有对
   应 remove——每次模式切换泄漏一个闭包（该监听本身只置冷却窗口，不写留白，但属于无主残留）。
2. **RO 回调不看 entries**：回调签名忽略参数、无条件 `applyPadding() + schedule()`； disconnect()
   后若仍有已入队的投递（规格允许空投递），会执行「僵尸写回」。
3. **清理窗口竞态**：`destroy()` 清理与排队中的 rAF / RO 投递之间的先后没有硬性保证，真机上
   （更多切换、IME、窗口失焦）存在时序偏差空间——与「本机隔离实例无法复现」吻合。

### 1.2 缺陷①的语义盲区（静态可证，与本机无关）

`lib/flow.ts` 的 `effectiveTypewriterMode`：心流内「关」→ 强制「低位」。于是心流内 `Alt+T`
切到「关」时：设置写入「关」✓、观感仍是低位 ✗——「关」在心流内不可表达。这是**设计使然的
语义矛盾**，与 1.1 的时序问题相互独立，须分别修。

### 1.3 预览错位的精确边界

行级同步两侧各自坐标空间自洽：编辑器 `lineBlockAtHeight(scrollTop)` 与预览 `offsetTop` 都在
「含留白的内容坐标系」内，**中段映射与留白无关**。失义只发生在：

- **头部**：编辑器视口顶边落进留白区（`scrollTop ≤ paddingTop`）——映射函数把整个留白区折算成
  第 1 行、比例钳 0，预览被推到第 1 块顶部（= 留白区底部），而编辑器顶边其实在留白区中间；
- **尾部**：编辑器有底部留白可以滚过末行，预览没有 → 同步目标被钳在预览可滚动范围外。

## 2. D1：声明式承载（theme + CSS 变量）

### 2.1 职责重划

| 职责 | 归属 | 说明 |
| --- | --- | --- |
| 留白**规则**（padding 用哪个变量） | 打字机扩展的 theme | `.cm-content { padding-top: var(--tw-pad-top, 0px); padding-bottom: var(--tw-pad-bottom, 0px) }`；扩展摘除时规则被 CM 自动移除，padding 无条件回基线 |
| 留白**数值**（变量 = 比例 × 视口高） | EditorView（Vue 层） | 监听 `effectiveTypewriterMode` + ResizeObserver 跟随滚动区高度，写进编辑卡 `:style`（与 `--flow-measure` 同一挂点；预览组件可消费同一套值） |
| 锚定滚动 | 插件 | **不再写任何样式**；`destroy()` 无需清理，无残留面 |

关键收益：**清理路径从 JS 消失**。off 时 theme 随扩展摘除——即使有僵尸回调把变量写回，也没有
规则消费它，padding 不可能残留。`destroyed` 标志降级为纯防御（守卫锚定滚动），与留白清理彻底
解耦（上次失败分支中 flag 同时承担两职，且混入了状态条等无关改动）。

### 2.2 typewriter.ts 改造点

1. 返回值改为 `[theme, ViewPlugin.fromClass(…)]`；
2. 删除 `applyPadding()` 与内联样式写入（`typewriterPadding` 纯函数保留，EditorView 复用）；
3. `destroyed` 标志：`destroy()` 置位，`schedule()` / `anchor()` / RO 回调 / `onScroll` 入口检查；
4. `destroy()` 补删 scroll 监听；RO 回调 entries 为空早退；
5. 其余（nudge 补滚、用户滚动冷却、组词冻结、拖选挂起）不动。

### 2.3 EditorView 变量写者

- `twPad = ref({ top: 0, bottom: 0 })`；来源 = `anchorRatioFor(mode)` × 滚动区高度
  （`typewriterPadding` 纯函数）；off → `{0, 0}`。
- 触发：watch `app.effectiveTypewriterMode`；ResizeObserver 观察 `.editor-cm` 包裹层（常驻
  元素，MarkdownEditor 随笔记 v-if 重建也不需要重挂 RO；滚动区与包裹层高度同步变化，取值仍
  读 `.cm-scroller` 的 clientHeight）。RO 建立沿用「观察 ref 绑定的 watcher」模式（openNote
  异步晚于挂载的项目教训）。
- 写入：编辑卡 `:style` 增 `'--tw-pad-top' / '--tw-pad-bottom'` 两键。

## 3. D2：心流内三态循环（会话态）

### 3.1 状态与数据流

```
settings.typewriterMode ──(进入心流，off→bottom 一次性推导)──▶ flowTypewriter（会话态）
        ▲                    effectiveTypewriterMode 纯函数                  │
        │                                                                    │
        └──(Alt+T / 设置页改 typewriterMode，经 updateSettings 收口同步)──────┘
effective = flowMode ? flowTypewriter : settings.typewriterMode
```

- `enterFlow`：`flowTypewriter = effectiveTypewriterMode(true, settings.typewriterMode)`
  （设置关 → 低位，原「进心流自动低位」语义保留在进入瞬间）；
- `exitFlow`：`flowTypewriter = null`；
- `toggleTypewriter`：心流内走三态循环（`nextTypewriterCycle` 纯函数：center→bottom→off→center），
  **经 `updateSettings` 写回设置**（退出心流后内外一致）；非心流保持「关 ↔ 上次形态」二态；
- `updateSettings`：补一条收口——心流内改 `typewriterMode` 时同步 `flowTypewriter`（覆盖设置页
  入口）；`typewriterResume` 记忆维护随循环更新（切到关时记住离开前的形态）。

### 3.2 消费端

`effectiveTypewriterMode` getter 改为「心流读会话态」；MarkdownEditor 的 prop、状态区图标、
状态提示全部自动跟随（均绑定该 getter）。顶栏打字机按钮仅在非心流可见（心流隐藏顶栏），无需
改绑。

## 4. D3：预览同比例留白 + 头部区 1:1 同步

### 4.1 预览留白

`MarkdownPreview` 新增可选 props `typewriterPadTop / typewriterPadBottom`（px，默认 0），绑在
滚动根 `.preview-pane` 的内联 style。EditorView 传入 `twPad`：

- 分栏预览：总是当前笔记 → 直接传；
- 悬浮预览：当前笔记（参与同步）传，**补全预览**（展示别的笔记、不参与同步）传 0
  （`:typewriter-pad-top="completionPreview ? 0 : twPad.top"`）。

等量底部留白让预览能滚过末行（尾部同步不再被钳住）；顶部留白使两容器内容起点一致。

### 4.2 头部区 1:1 直传

`rebindScrollSync` 两个方向 + 初始同步共用规则：

```ts
// 编辑器视口顶边落在打字机留白区内：行号映射失义（留白区整体折算为第 1 行、比例钳 0），
// 改按滚动坐标 1:1 直传；两容器顶部留白等量（D3），坐标直接可比
if (padTop > 0 && scroller.scrollTop <= padTop) previewEl.scrollTop = scroller.scrollTop
else /* 原行级映射 */
```

反向（预览→编辑器）对称；直接写 `scrollTop` 不产生 CM 事务，打字机插件把它当普通滚动（冷却
窗口抑制被动重锚，输入仍强制回锚）——与「用户滚动绝不干预」规则不冲突。

## 5. 测试与验证

- 单测：`nextTypewriterCycle` 纯函数；`effectiveTypewriterMode` / `typewriterPadding` 既有用例
  保留（语义未变）。store 会话态流转属交互，进手动清单。
- 隔离实例 CDP：验收标准 1–4 逐条断言（computed padding、Alt+T 循环、退出残留、预览坐标）。

## 6. 实施与验证记录（2026-09-27，分支 `fix/typewriter-padding-redesign`）

### 6.1 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/renderer/src/lib/typewriter.ts` | 扩展瘦身为纯锚定：padding theme（`var(--tw-pad-top/bottom, 0px)`）随扩展挂载 / 摘除；删 `applyPadding()` 与内联样式写入；`destroyed` 守卫（schedule / anchor / RO 回调 / onScroll 入口）；`destroy()` 补删 scroll 监听；RO 空投递早退 |
| `src/renderer/src/lib/flow.ts` | 新增 `nextTypewriterCycle` 三态循环纯函数；`effectiveTypewriterMode` 注释收窄为「进入心流瞬间推导一次」 |
| `src/renderer/src/stores/app.ts` | 新增会话态 `flowTypewriter`（enterFlow 推导落值 / exitFlow 置 null）；`effectiveTypewriterMode` getter 心流读会话态；`toggleTypewriter` 心流分支三态循环（经 `updateSettings` 写回 + `typewriterResume` 记忆维护）；`updateSettings` 收口同步会话态 |
| `src/renderer/src/views/EditorView.vue` | CSS 变量唯一写者：`twPad` ref（watch 生效形态 + RO 观察 `.editor-cm`）→ 编辑卡 `:style` 的 `--tw-pad-top/bottom`；`rebindScrollSync` 两方向与 `syncPreviewToEditor` 的头部留白区 1:1 直传；两个 `MarkdownPreview` 传留白 props（悬浮预览在补全预览态传 0） |
| `src/renderer/src/components/MarkdownPreview.vue` | 新增 `typewriterPadTop/Bottom` props，滚动根按 `calc(基础 + 留白)` 叠加 |
| `src/renderer/src/styles/markdown.css` | `.markdown-body` 上下基础内边距抽成 `--preview-pad-top/bottom` 变量（默认值不变，行为中性） |
| `tests/flow.test.ts` | +2 项：三态循环、循环闭合（全仓 421 全绿；typecheck / lint 通过） |

### 6.2 探针自证与两轮修正（验证纪律实例）

v1 探针三处自身缺陷被逐一识破、未误判为产品 bug：① 「0px」断言写错——`.cm-content` 关闭态本有 4px CSS 基线，断言应对比「基线一致」；② 期望值用进心流前的视口高（顶栏隐藏后 765→847，0.8×847=678 恰与实测吻合）；③ 预览按钮 title 在 el-tooltip 里不落 DOM——改走 `$pinia._s.get('app')` 直读状态（`effectiveTypewriterMode` / `flowTypewriter` / `settings.typewriterMode`），断言反而更强。v2 又暴露探针遗留状态污染（上轮停在 center 被当基线）——起始强制 `updateSettings({ typewriterMode: 'off' })` 清场后重跑。

### 6.3 CDP 验证（隔离实例，13/13 通过）

- **1a–1d 基线与快速切换**：off 基线 4px、无内联 padding（theme 承载证明）；Alt+T → 高位 computed 383px = 0.5×765 精确；**连续 21 次切换落点关，回到基线、零内联残留**。
- **2a–2c 心流三态**：进心流（设置关）自动低位 678px = 0.8×847（即时视口高）精确，会话态 `flowTw=bottom`；Alt+T 低位→关 **留白立即回基线**、`flowTw=off` 且**设置写回 off**；再按 关→高位 424px = 0.5×848、`flowTw=center` 与设置同步。
- **3a–3b 退出一致**：退出心流后设置（center）生效保持 0.5×、`flowTw=null`；非心流 Alt+T 二态正常切关回基线。
- **4a–4d 预览对齐**：预览顶 padding 403px = 20（基础）+ 383（编辑器同值）精确叠加；**头部区 1:1**（编辑器 192 = 预览 192，落在 383 留白区内）；中段滚动比例 0.400 vs 0.362（行级映射正常随动）；关打字机后编辑器回基线、预览回 20px。
- 快速切换压力（21 次连按）未复现任何残留——与机制分析一致（清理路径已不存在于 JS）。

### 6.4 遗留与备注

- 真机复验建议：用户下次真机试用时顺带确认原场景（打字机开关 / 进出心流）不再出现残留（本机机制上已不可能，真机验证为收尾确认）。
- 验证用「验证库」建在真实工作区（`TRACE_TEST_USERDATA` 只隔离应用元数据、不隔离工作区），验证后已删除——后续探针建库 / 建笔记后记得清理。
