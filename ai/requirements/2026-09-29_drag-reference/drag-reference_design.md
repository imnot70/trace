# 拖曳插入引用 — 技术设计（FR-2.9.10 P3）

> 需求与决策见 [drag-reference.md](drag-reference.md)。HTML5 Drag & Drop（原生 dataTransfer），不引第三方库。

## 1. 总体数据流

```
源组件 dragstart                          编辑器
  beginNoteRefDrag(e, payload)  ──┐        @dragover：全量放行维持（外部文件 / 文本不回归），
  ├─ dataTransfer.setData(MIME)   │        note-ref 在拖时 dropEffect = 'copy'
  ├─ effectAllowed = 'copy'       │        @drop：先认 note-ref（preventDefault + posAtCoords
  └─ 遮罩让行（.drag-yield）       │        定释放点）→ emit('drop-note-ref')；否则走既有图片分支
                                  ▼
document 捕获级 dragend / drop   EditorView.onDropNoteRef
  （一次性）遮罩恢复              → insertPreviewTarget(target, { at })  三路语义不变
                                  → D2 消歧（at 存在且当前库非草稿时）
                                  → insertReferenceAtPath(text, at)  两态括号一致性（位置参数化）
```

**载荷只带自定义 MIME、不带 text/plain**：`@replit` 系 CM6 的原生 drop 管线会接管 text/plain 与 Files——若同时设 text/plain，CM 会在 contentDOM 层先把纯文本插进去（事件从 contentDOM 冒泡到根 div 之前），我们的分支再插一次就是双插。只带 `application/x-trace-note-ref` 时 CM 原生分支认不出、不消费，事件完整落到根 div 的 `@drop`。代价是拖到编辑器以外（预览 / 其他应用）无效果——可接受，编辑器是唯一目标。

## 2. `lib/dragDrop.ts`（新，纯逻辑可单测）

- `NOTE_REF_MIME = 'application/x-trace-note-ref'`；`NoteRefPayload { vault, path, name }`（path 统一带 `.md`——四个源天然带：树 `node.path`、搜索 `result.path`、反向链接 `item.path` 都含扩展名，面板 `targetOf()` 已补 `.md`）；
- `beginNoteRefDrag(e, payload)`：setData + `effectAllowed='copy'` + 遮罩让行；dataTransfer 参数按**结构化最小接口**声明（`types/setData/getData`），jsdom 无需真 DataTransfer 即可桩测；
- `readNoteRefDrag(dt)`：types 含 MIME 才读，JSON.parse 容错（非法 / 字段缺失返回 null）；
- `hasNoteRefDrag(dt)`：dragover 分流用；
- **遮罩让行**：`document.querySelectorAll('.el-overlay, .sidebar-backdrop')` 中**实际可见**者（`getClientRects().length > 0`，跳过 EP 关闭后驻留的隐藏 DOM）加 `drag-yield` 类；同时在 document 上挂**捕获级一次性** `dragend` + `drop` 监听统一恢复（dragend 在 drop 之后必发、Esc 取消也发，恢复幂等）——源组件因此不需要各自写 dragend 清理。

## 3. 编辑器接线：`MarkdownEditor.vue`

- 模板 `@dragover.prevent` 改 `@dragover="onDragover"`：维持**全量放行**（`preventDefault()` 无条件——外部文件 / 外部文本拖入的既有行为不回归），note-ref 在拖时设 `dropEffect = 'copy'`；
- `onDrop` 加分支：`readNoteRefDrag` 命中 → `preventDefault()` + `view.posAtCoords({x, y})` 定释放点（null 回落）→ `emit('drop-note-ref', payload, at)`；否则走既有图片分支。`posAtCoords` 对渲染块 widget 返回最近位置（所见即所得与源码一致）；
- `insertReferenceAtPath(path, at?)`：`cursor = at ?? selection.main.head`，其余逻辑（`lineAt` + `referenceInsertSpec` 两态括号一致性）不变——位置参数化后拖曳 / 光标两用。

## 4. `EditorView.vue`：三路语义复用 + D2 消歧

- `insertPreviewTarget(target, opts?: { at?: number })`：三个落引用出口把 `at` 传给 `insertReferenceAtPath`（补全活动态出口不动——拖曳时补全必然不活动，走 `insertReferenceAtPath` 兜底）；
- **D2 消歧**（`at` 存在且 `current.vault !== SCRATCH_VAULT` 时，草稿不进双链索引不消歧）：`resolveByNameCandidates(current.vault, leaf(insertRel))` 恰返回 1 个候选 → 插叶子名，否则插完整路径（0 候选 = 笔记刚被删，路径形式保留更多信息）。决策抽纯函数 `preferNameInsert(paths?: string[])` 放 `lib/dragDrop.ts`；
- `onDropNoteRef(target, at)`：不关任何弹窗（搜索 / Alt+I 保持打开——与 Alt+Enter 预览态「弹窗保持」同语义），直接 `void insertPreviewTarget(target, { at })`。拖曳后立即 `dragend` 恢复遮罩，跨库 / 草稿确认框弹出时不受影响（确认框自带遮罩与 z 序）。

## 5. 四源改造（每处 ≤10 行）

| 源 | 文件 | 改造 |
| --- | --- | --- |
| 文件树 | `VaultNode.vue` | `.tree-row` 加 `:draggable="!isDir"` + `@dragstart`（载荷 `{vault, node.path, node.name}`） |
| 搜索结果 | `SearchDialog.vue` | `.result-item` 加 `draggable` + `@dragstart`（载荷 `{result.vault, result.path, result.title}`；草稿结果 vault=`__scratch__` 天然走草稿分支） |
| 反向链接 | `BacklinkPanel.vue` | `.backlink-item` 加 `draggable` + `@dragstart`（载荷 `{item.vault, item.path, item.title}`）；面板收回条件是「点击外部」非「hover 离开」，拖曳不误收，无需额外处理 |
| 引用面板 | `QuickRefPicker.vue` | `.qr-row` 加 `:draggable="item.kind === 'note' || item.kind === 'draft'"` + `@dragstart`（复用 `targetOf(item)`；dir / header 不可拖） |

## 6. 样式

全局 `styles/main.css`：`.drag-yield { pointer-events: none; }`——遮罩在 body 层（append-to-body），scoped 样式够不到；不动遮罩外观（半透明底下编辑器本就可辨，拖曳光标 + dropCursor 已给出落点反馈）。

## 7. 边界与风险

- **取消拖曳**（Esc / 拖回源松手）：dragend 照发，遮罩恢复——一次性监听覆盖；
- **drop 与 dragend 顺序**：drop 先于 dragend，insertPreviewTarget 中的 await（确认框）期间遮罩已恢复，确认框浮于其上，无叠层问题；
- **双插**：见 §1，载荷不带 text/plain 规避；CDP 冒烟加「拖入后文档中引用只出现一次」断言；
- **外部文件拖入**：dataTransfer 同时有 Files 与无 MIME——`readNoteRefDrag` 返回 null，走图片分支，回归不变；
- **隐藏 el-overlay**：EP 关闭后 DOM 驻留（display:none），让行扫描按可见性过滤，不误改；
- **释放点在编辑器卡片 padding**（行号槽 / 空白）：`posAtCoords` 返回最近合法位置或 null，null 回落光标处。

## 8. 验证计划

- 单测（`tests/dragDrop.test.ts`）：载荷 round-trip / 非法 JSON 容错 / types 不含时拒读 / 遮罩让行与 dragend 恢复（jsdom）/ `preferNameInsert` 三态；
- `referenceInsertSpec` 已有纯函数覆盖，位置参数化不改动其签名语义；
- typecheck + lint + 全仓；
- CDP 隔离实例冒烟（合成 DragEvent + DataTransfer）：侧栏树拖起（drag-yield 类出现 / dragend 恢复）→ 释放点插入（段中间落点、文档引用恰一次、跨库确认框文案、弹窗保持打开）→ 图片拖入回归。

## 9. 实施与验证记录（2026-09-29，分支 `feat/flow-reference-drag`）

### 9.1 实施清单（与 §2–§6 一致，无方案偏差）

- `lib/dragDrop.ts`（新）：MIME / 载荷读写（结构化最小接口，jsdom 可桩）/ 遮罩让行（可见性过滤 + document 捕获级一次性 dragend/drop 恢复）/ `preferNameInsert` 消歧决策；
- 四源：`VaultNode.vue`（`:draggable="!isDir"`）/ `SearchDialog.vue` / `BacklinkPanel.vue` / `QuickRefPicker.vue`（`:draggable="kind === 'note' || kind === 'draft'"`，载荷复用 `targetOf`）；
- `MarkdownEditor.vue`：`@dragover="onDragover"`（全量放行维持 + note-ref 设 copy 效果）、`onDrop` 分流（note-ref → `posAtCoords` → emit，null 回落光标）、`insertReferenceAtPath(path, at?)` 位置参数化（`lineAt(at)` 后同一 `referenceInsertSpec`）；
- `EditorView.vue`：`insertPreviewTarget(target, { at })`——`at` 存在且当前库非草稿时经 `resolveByNameCandidates` 做 D2 消歧，草稿内引用 / 草稿态保持既有路径形式；`onDropNoteRef` 不关弹窗（搜索 / Alt+I 保持打开）；
- 全局 `styles/main.css`：`.drag-yield { pointer-events: none }`；
- 单测 `tests/dragDrop.test.ts` +7：载荷 round-trip / MIME 拒读 / 非法 JSON 与字段缺失容错 / 遮罩让行（含隐藏 DOM 跳过）/ dragend 恢复 / 重复让行幂等 / `preferNameInsert` 三态。

### 9.2 CDP 隔离实例冒烟（11/11 全过，playwright-core connectOverCDP）

场景：测试工作区（`TRACE_TEST_USERDATA=1` 预写 settings.json）含 `首页.md`（多行落点靶）/ `随笔.md`（唯一名源）/ `a/重名.md` + `b/重名.md`（重名源）；合成 DragEvent + DataTransfer 走**真实冒泡路径**（事件派发在 `.cm-line` 上，经 CM 层到根节点分流）；断言全部落在磁盘真值（1s 自动保存后读文件）。

| # | 断言 | 结果 |
| --- | --- | --- |
| A1 | 侧栏树拖 `随笔.md` 释放在第 5 行行尾 → 该行尾出现 `[[随笔]]`（非光标处，文首零写入） | ✅ |
| A2 | 引用恰一次（无双插——载荷只带自定义 MIME 的设计生效） | ✅ |
| A3 | 光标原位置（文首）零写入 | ✅ |
| A4 | D2 消歧：库内唯一名插叶子名 `[[随笔]]` | ✅ |
| B0 | Alt+I 面板过滤「重名」命中 a/b 两行 | ✅ |
| B1 / B1b | 拖起后可见 `.el-overlay` 带 `drag-yield` 且 `pointer-events: none` | ✅ |
| B2 | dragend 后 `drag-yield` 全部摘除 | ✅ |
| B3 | 面板保持打开（拖完继续选） | ✅ |
| B4 / B5 | 重名拖入：释放点（第 7 行行尾）插完整路径 `[[a/重名]]`、恰一次 | ✅ |

**探针排障记录（防再踩）**：首轮冒烟 A1/A3 假挂——**脚本 bug**（非产品缺陷）：传给 playwright `dispatchEvent` 的坐标键写成 `x/y`（DragEvent init 只认 `clientX/clientY`），事件坐标落在 (0,0) → `posAtCoords` 返回 null → 走「释放点解析失败回落光标」兜底——**兜底路径本身被意外验证**。二分定位手段：页面内经 `.editor-pane.__vueParentComponent.setupState.onDrop` 直调组件 handler（dev 模式 setupState 暴露全部绑定）+ 磁盘真值比对，绕开事件传输层后立刻复现成功，证明产品代码无误。另：CM view 的 `EditorView.findFromDOM` / `.cmView` 两条获取路径在本装配下均不可用，setupState 是 CDP 探针拿 view / 组件函数的可靠路径（登记 tech_verification 备查）。

**跨库 / 草稿拖入语义未单独冒烟**：与 Alt+I 面板**共用同一 `insertPreviewTarget`**（v0.15.0 已真机验证的三路逻辑），拖曳仅新增载荷来源；图片拖入回归的改动面（onDrop 分支前置 + dragover 显式 preventDefault）经 A2/A4 间接覆盖（引用分支与图片分支互斥分流正确）。

### 9.3 遗留与待真机验证

- 真实鼠标拖曳（CDP 合成的是事件序列，非真实拖拽手势）的手感：拖影、dropCursor 竖线跟随、遮罩让行时编辑器的视觉可辨性——需真机确认；
- 心流模式下 Alt+B 浮层侧栏拖曳（`.sidebar-backdrop` 让行路径）——逻辑同一机制，建议真机顺手过一遍；
- 反向链接面板条目拖出（源就绪，机制同侧栏树）——同上真机顺手项。

### 9.4 真机首轮反馈修复（2026-09-29 用户真机验证，四问题当日修复）

用户真机验证结论：侧栏树 / 反向链接拖曳正常；**Alt+I 面板与搜索弹窗条目拖不动**、**搜索预览态 Esc 顺序错**（一击连弹窗一起关、预览反而不关）、**搜索预览态 Alt+Enter 无法二段插入**。三项根因与修法：

| # | 根因 | 修法 |
| --- | --- | --- |
| 弹窗源拖不动 | 遮罩让行把整个 `.el-overlay` 设 `pointer-events: none`，而**拖曳源就在遮罩内**——Chromium 在 dragstart 发起时要对按下元素做命中测试，命中失败即**静默取消拖曳**（连 dragstart 都不派发；侧栏 / 反向链接不在遮罩内故正常） | 遮罩放行但**弹窗盒子保持可命中**：`.drag-yield .el-dialog { pointer-events: auto }`——源可命中拖曳照常发起，遮罩区域照常穿透落点 |
| Esc 顺序错 | 搜索弹窗 `close-on-press-escape` 写死 `true`——EP 内建监听直接关弹窗，应用级「预览优先」分级链无机会消费（tech_verification 第 9 条教训的又一实例；Alt+I 面板 v0.15.0 已修过同类，搜索弹窗漏配） | ① `:close-on-press-escape="!app.floatingPreview"`（随预览禁用 EP 内建）；② `onDialogKeydown` 加 Esc 分支：预览开着时先关预览并回焦搜索框，再按才轮到 EP 内建关弹窗（与快速引用面板同款收口） |
| Alt+Enter 缺二段 | 搜索弹窗的 Alt+Enter 只实现「预览」，未对齐 Alt+I 面板的「预览开着再按 = 插入」两段语义 | `onPreviewKey` 二段化：预览开着 → `app.requestNoteInsert()` 计数意图 → EditorView watch 消费 → `insertFromPreview()`（与悬浮预览「插入引用」按钮同一收口，自带无预览 / 自引用守卫；插入目标以 `completionPreview` 为准） |

**复验（CDP 隔离实例，真实手势 / 真实按键，12/12 全过）**：侧栏树拖曳回归 ✅；搜索结果与 Alt+I 面板**手动 mouse 序列真实拖曳**落点插入 ✅（dragstart 发起 → yield=true → dragover 穿过弹窗区 → drop 命中 `.cm-content` → dragend 恢复，全程事件序列核实）；Esc 分级两击 ✅；Alt+Enter 二段插入 ✅；面板保持打开 / 无 drag-yield 残留 ✅。

**验证方法学增补**（已登记 [tech_verification](../../tech/tech_verification.md) 第 11 条）：`locator.dragTo` 在「遮罩已让行 + 弹窗盒子可命中」场景会在 mouseup 前做目标命中测试并无限重试超时（Playwright 自身机制，与产品无关）——弹窗源拖曳冒烟须用手动 `page.mouse` 分步序列（分 10 步移动让 Chromium 识别拖拽手势）；首轮合成事件（`dispatchEvent` 构造 DragEvent）完全测不出本节第 1 项（合成 dragstart 不经 Chromium 拖拽控制器的命中测试，取消逻辑不运行）——**拖曳类功能的验证必须走真实手势**。

### 9.5 弹窗拖曳期隐藏（2026-09-30 用户截图反馈：弹窗遮挡落点）

- **反馈**：从 Alt+I 面板 / 搜索弹窗拖动条目时，弹窗本体仍盖在编辑器上，**要插入的位置被遮挡**（真实手势截图为证）。
- **修法**：拖曳期把可见 `.el-overlay` 整体藏掉（`drag-hide` 类 = `visibility: hidden`，不参与命中测试），松手（落下 / 取消）经既有一次性 dragend / drop 监听立即恢复——「拖完继续搜 / 继续选」语义不变。遮罩的 `drag-yield`（pointer-events 放行）保留：覆盖「dragstart → 隐藏生效前」的一拍窗口。
- **关键时序**：**不能在 dragstart 处理器里同步隐藏**——源元素所在子树变为不可见，Chromium 拖拽发起的命中测试失败、拖曳静默取消（§9.4 第 1 项的根因本体）。实现为 `setTimeout(0)` 延后一拍隐藏（拖拽发起完成、拖影已快照，之后隐藏安全），并以**代数计数守卫**：拖曳若在定时器触发前已结束（恢复先到），过期回调不得再把弹窗藏掉——否则没有任何 dragend 能把它救回来。
- **复验（CDP 真实手势，冒烟 17/17 全过）**：F1 落点拖曳前确实被 `.el-dialog` 盖住 → F2 拖曳中弹窗 `drag-hide` + `visibility: hidden` → F3 **原被盖住的点命中测试直落编辑器内容层** → F4 释放正常插入 → F5 松手后弹窗恢复可见、无残留类；C / D / E 三组（侧栏 / 搜索 / Alt+I 全动线）无回归。单测 +2（隐藏延后一拍的时序、代数守卫防「藏掉无法恢复」，`tests/dragDrop.test.ts` 9 项）。

### 9.6 插入即关 + Alt 保留（2026-09-30 用户反馈拍板，D6）

- **反馈**：鼠标拖入 / 键盘二段插入后弹窗都不关，单插用户得手动 Esc——摩擦。
- **语义**（D6，需求文档已同步）：**插入成功 → 默认关闭来源弹窗**；**Alt 拖入 → 保留**（连续插入）；**取消拖曳 → 永不关**（无 drop 无副作用）。键盘对齐：搜索预览态 Alt+Enter 二段插入成功后同样关闭搜索弹窗。Alt+I 面板键盘 Enter 插入本就关面板（v0.15.0 既有），本次拖入路径与其对齐。侧栏树 / 反向链接来源无弹窗可关，不受影响。
- **实现**：
  - 载荷加 `from?: 'dialog'` 标记（搜索 / Alt+I 的 dragstart 打上）；`readNoteRefDrag` 重组载荷时**保留该字段**（首轮单测抓到丢失——丢了标记关闭逻辑就永不触发）；
  - MarkdownEditor 的 drop emit 增传 `modifiers: { alt }`（DragEvent 自带修饰键状态，读取零成本；右键拖动不可行——HTML5 拖拽仅主键发起）；
  - `insertPreviewTarget` 改返回 `Promise<boolean>`（用户取消确认框 / 复制失败 / 无当前笔记 = false）——**只有插入真正成功才关**，跨库确认框取消时弹窗保留原状；
  - 收口两处：`onDropNoteRef`（ok && from === 'dialog' && !alt → `closeInsertDialogs()`）、`insertFromPreview`（ok → close，覆盖悬浮预览按钮与搜索二段插入两条动线）；`closeInsertDialogs` = 关搜索弹窗 + 关 Alt+I 面板（未开的那个本来关着，双关无害）。
- **复验（CDP 真实手势 / 真实按键，15/15 全过）**：普通拖入关（搜索 D1 / Alt+I E1）✅；Alt+拖入保留（D6 / E2）✅；二段插入关（D4b）✅；Esc 分级（D3）✅；拖曳期弹窗隐藏 + 松手恢复（F 组，Alt 拖入路径）✅；侧栏树回归（C1）✅。单测 `readNoteRefDrag` 补 from 字段 round-trip（并由此抓到字段丢失缺陷），全仓 517 项绿。
- **边界说明**：搜索弹窗重开**不保留查询与结果**（v0.9.0 起开屏清空的既有口径，防旧结果与预置范围错配）——「插入即关」后连续查找需重输查询；若未来要做「关闭后重开恢复上次会话」，另行立项。

### 9.7 真机复验反馈：闪现 + Alt 失效（2026-09-30 用户复验，当日修复）

- **反馈**：拖动 / Alt+拖动表现一致——插入成功，但弹窗「闪现一下」（恢复显示不到 1 秒）后被关闭。两个缺陷叠加：
  1. **闪现（普通拖入也该修）**：恢复挂在 dragend（drop 后立即触发），而关闭要等插入 IPC 完成后才执行——中间几十毫秒弹窗被恢复可见。修法：drop 落到编辑器（带笔记引用载荷）时**抑制 dragend 的自动恢复**，恢复职责移交给 `onDropNoteRef` 的 `finally`——与关闭 / 保留决策在**同一同步续体**执行，浏览器只绘制一次直达终态（恢复 + 关闭背靠背无中间帧）；另设 800ms 兜底恢复（收口异常未清理时兜底，正常流程先清理故为空操作）。
  2. **Alt 失效（Alt+拖入被误关）**：不信任 drop 事件的 `altKey`——真机各平台对拖拽会话中的 Alt 交付不一（Windows 菜单键 / macOS Option / Linux WM）。改为 **dragstart 时刻锁存**（`beginNoteRefDrag` 记录 `e.altKey`，模块级锁存值 + `consumeDragAltLatch()` 取走复位），drop 时取「事件状态 ∨ 锁存值」——约定手势「按住 Alt 再拖」必被锁存覆盖。
- **复验**：单测 +2（drop 抑制恢复 / Alt 锁存取走复位，`tests/dragDrop.test.ts` 11 项），全仓 519 项绿；CDP 真实手势冒烟 15/15 全过（D6 Alt+拖入保留 / E2 同 / D1·D4b·E1 插入即关 / F 组隐藏恢复全链路）。冒烟首轮曾出现 D 系列三项假挂，探针单跑同链路正常 + 全量重跑通过，判定为改码后首次热启动的页面状态竞态（不可复现），未调整产品代码。

### 9.8 附带修复：路径形式双链误报断链（2026-09-30 用户复验发现，既有缺陷）

用户复验 P3 时发现 `[[dir_02/for_test_02]]` 等路径形式引用在所见即所得中误报断链（删除线），而笔记存在、点击可开——**v0.6.0 起的既有缺陷，与 P3 代码无关**：装饰层断链判定（MarkdownEditor 注入的 `resolveName`）只比叶子名；P3 的同名消歧插入（D2，重名时插路径形式）让存量缺口显形。修复为独立纯函数 `lib/wikiTarget.ts`（口径对齐主进程 `resolveByName`：叶子名 ∨ 路径形式），MarkdownEditor 接线，测试独立成 `tests/wikiTarget.test.ts`（零依赖模块可进 tsconfig.node 测试图，不经过带 `window.trace` 的 `lib/wikilink.ts`——首轮放 wikilink.ts 被 node 端 typecheck 拦下，教训：**渲染端纯函数若要进 tests/ 的 node 类型图，必须放零依赖模块**）。明细见 [CHANGELOG 未发布段](../../CHANGELOG.md)。
