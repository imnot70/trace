# 心流模式（Flow Mode）技术设计

> 创建：2026-09-23 ｜ 状态：**设计完成，待评审** ｜ 需求见 [flow-mode.md](flow-mode.md)
> 建议分支：`feature/flow-mode`

## 1. 总体方案

**一句话**：新增两条互相独立的渲染层能力——「打字机锚定」是一个 CodeMirror 6 扩展（ViewPlugin + 留白 theme），「心流模式」是 app store 上的一个布尔预设（进入时快照外围状态、拨动各轴，退出时还原）。不引入任何新依赖，不改动磁盘产物。

```
app store（渲染态）
 ├─ editorWysiwyg       （已有，轴 1：源码 / 所见即所得）
 ├─ zenMode             （已有，轴 2：常规 / 专注）
 ├─ typewriterMode      （新，轴 3：off | center | bottom ← settings 持久化）
 └─ flowMode: boolean   （新；预设 = 一组开关的组合 + 外围状态快照）

MarkdownEditor.vue
 ├─ livePreview Compartment        （已有）
 └─ typewriter Compartment         （新：lib/typewriter.ts）
      ├─ 留白 theme（.cm-content 上下 padding = 锚点比例 × 视口高）
      └─ updateListener → rAF 合并 → 坐标差值滚动

lib/caretSound.ts                  （新：Web Audio 回车音效合成器，无资源文件）
EditorView.vue                     （心流按钮 / 栏宽变量 / 保存指示挂载）
```

三条轴与预设的关系见需求文档 1.3；本设计只负责把「打字机」做成一条干净的轴、把「心流」做成纯组合。

## 2. 决策记录

| # | 决策点 | 结论 | 理由与备选 |
| --- | --- | --- | --- |
| D1 | 打字机实现层 | **自研 CM6 扩展**（ViewPlugin + theme），不依赖 CSS `scroll-snap` 或第三方包 | 需要按「事件类型」决定是否重锚（输入锚、滚动不锚、组词冻结），纯 CSS 无法表达；CM6 是现有编辑层，扩展成本可控（一个模块）。备选 `scroll-padding` 方案无法实现「用户滚动不干预」 |
| D2 | 锚点可达性 | **给 `.cm-content` 加动态上下留白**：`paddingTop = ratio × 视口高`、`paddingBottom = (1 − ratio) × 视口高` | 文档首行/末行也要能到达锚点线；留白量随视口尺寸变化（ResizeObserver → CSS 变量），高位 = 50%/50%（同 Typora），低位 = 80%/20% |
| D3 | 滚动定位算法 | **屏幕坐标差值法**，不用 `EditorView.scrollIntoView` | `scrollIntoView` 只支持 start/center/end/nearest，表达不了「80% 处」；且其坐标基准与 padding 的关系有歧义。差值法直接自洽：`scrollTop += coordsAtPos(head).top − (scrollerTop + height × ratio)` |
| D4 | 重锚触发规则 | 见第 3 节规则表：输入 / 撤销 / 键盘移动 / 点击定位 → 锚；**用户滚动、拖选中、IME 组词中 → 不锚** | 需求 D5；拖选连续锚定会眩晕，组词锚定会让候选框抖（所见即所得已有 `view.composing` 冻结的成熟先例） |
| D5 | 扩展挂载方式 | 沿用既有 **Compartment** 模式（同 `livePreview`）：切换打字机形态只重配扩展，不重建 EditorView | 重建 EditorView 会丢失滚动位置与撤销历史；Compartment 是项目已验证的做法 |
| D6 | 心流预设语义 | `flowMode` 是 app store 运行态；进入时把外围状态存入 `flowSnapshot`，退出还原；**心流偏好（打字机形态 / 栏宽 / 音效）存 settings，不参与快照** | 需求 FR-F2 的状态语义表；复用 `zenMode.previewBeforeZen` 已有的快照先例，不发明第二套机制 |
| D7 | 音效合成参数 | 短噪声脉冲（带通 ~1.8kHz）+ 低频正弦（~140Hz）双分量，指数衰减，逐次随机微调；限流 120ms | 需求 D6；双分量是「thock」质感的关键（高频给"咔"、低频给"木"），单噪声听起来像爆音 |
| D8 | 音效触发点 | 在 CM6 `updateListener` 里检测 `tr.isUserEvent('input')` 且 **changes 插入内容含 `\n`** | 比监听 keydown 准确：IME 确认键、粘贴多行、列表自动续行都能正确区分（粘贴多行不发声，回车发声） |
| D9 | 保存指示位置 | 编辑卡右下角内侧的 6px 圆点，`position: absolute`，仅心流模式渲染 | 不占布局、不打断输入；数据源复用 editor store 既有 `dirty` / `saving` / `externalChanged`，不新增状态 |
| D10 | 栏宽实现 | `.cm-content { max-width: var(--editor-measure); margin-inline: auto }`，心流模式下注入变量 | 与打字机的上下 padding 天然共存（方向不同）；三档映射 32em / 42em / 52em（中文约 1em/字） |

## 3. 打字机滚动规则表（实现契约）

| 事件 | 是否重锚 | 说明 |
| --- | --- | --- |
| 输入字符 / 回车 / 删除 | ✅ | 主场景；`tr.isUserEvent('input' | 'delete')` |
| 撤销 / 重做 | ✅ | `undo` / `redo` |
| 键盘移动光标（方向键 / Home / End / Ctrl+Home） | ✅ | Typora 同款手感 |
| 鼠标点击定位 | ✅ | `select.pointer` 且非拖选 |
| 鼠标拖选过程中 | ❌ | mousedown → 挂起，mouseup → 补一次锚定 |
| 用户滚动（滚轮 / 滚动条 / 触控板） | ❌ | **绝不干预**；不产生事务，天然不触发；下次输入回到锚点 |
| IME 组词期间 | ❌ | `view.composing === true` 时直接跳过；`compositionend` 后补一次 |
| 程序化写入（外部文件变更、切换笔记、模式切换） | ❌ | 切换笔记由既有逻辑归零滚动，避免两套滚动互相打架 |

**合并策略**：所有重锚请求进 `requestAnimationFrame` 队列，一帧内多次变更只滚动一次（连续快速输入不掉帧）。

**与预览联动**：重锚修改的是 `scrollDOM.scrollTop`，会触发既有的编辑器 `scroll` 监听 → 自动同步预览（现有 100ms 防回环守卫只拦截「预览→编辑器」的回流，不冲突）。无需新增同步代码。

## 4. 模块与文件布局

```
src/shared/types.ts                    # + typewriterMode / flowLineWidth / flowSoundEnabled / flowSoundVolume
src/main/index.ts                      # 三处默认值同步（JsonStore 默认）
src/renderer/src/
├─ lib/typewriter.ts                   # CM6 扩展：typewriterExtension(ratio) / 锚点滚动 / 留白管理
├─ lib/caretSound.ts                   # Web Audio 音效合成器（init / playReturn / setVolume / dispose）
├─ components/MarkdownEditor.vue       # 挂载 typewriter Compartment；updateListener 里触发音效
├─ views/EditorView.vue                # 心流按钮 / Esc 退出 / 栏宽变量 / 保存指示
├─ stores/app.ts                       # flowMode / flowSnapshot / enterFlow / exitFlow（+ DEFAULT_SETTINGS）
└─ styles/main.css                     # .flow-mode 相关（栏宽变量、保存指示样式）
src/renderer/src/config/shortcuts.ts   # 登记 Alt+W；Esc 描述更新
tests/caretSound.test.ts 等            # 纯函数单测（见第 8 节）
```

## 5. 关键实现要点

### 5.1 锚点计算（纯函数，可单测）

```ts
/** 目标滚动位置：把光标的屏幕坐标对齐到编辑区 ratio 处（ratio 0.5 = 高位居中；0.8 = 低位） */
export function anchorScrollTop(
  cursorTop: number,      // view.coordsAtPos(head).top（屏幕坐标）
  scrollerTop: number,    // view.scrollDOM.getBoundingClientRect().top
  viewportHeight: number, // scrollDOM.clientHeight
  currentScrollTop: number,
  ratio: number
): number {
  return currentScrollTop + (cursorTop - (scrollerTop + viewportHeight * ratio))
}
```

### 5.2 留白管理

- 由扩展在挂载时读取 `scrollDOM.clientHeight`，写入 CSS 变量：`--tw-pad-top = ratio × H`、`--tw-pad-bottom = (1 − ratio) × H`；
- theme 规则：`.cm-content { padding-top: var(--tw-pad-top); padding-bottom: var(--tw-pad-bottom) }`；
- `ResizeObserver` 监听 scrollDOM 尺寸变化（窗口缩放、栏宽调整、预览分栏拖拽）后重算并补一次锚定；
- **关闭打字机时清零两个变量**（验收标准 10：无残留 padding）。

### 5.3 音效合成（`lib/caretSound.ts`）

```
playReturn():
  1. 限流：now - lastPlayAt < 120ms → return
  2. AudioContext 懒创建（首次播放；打字即用户手势，满足自动播放策略）
  3. 分量 A（"咔"）：白噪声 12ms buffer → Bandpass(freq≈1800Hz±6%, Q≈0.8) → Gain 包络（8ms 起音 / 45ms 指数衰减）
  4. 分量 B（"木"）：Sine(≈140Hz±6%) → Gain 包络（指数衰减 80ms）
  5. 主增益 = volume/100 × 0.5（上限防爆音）
  6. 播放后释放节点；dispose() 时 close AudioContext
```

无任何音频文件：零安装包体积、零版权问题，音色参数可后续调（未来若要更精致，可再评估随包 CC0 素材）。

### 5.4 心流预设（`app.ts`）

```ts
enterFlow():   // 快照外围状态 → 拨动各轴
  flowSnapshot = { sidebarVisible, zenMode, previewVisible, editorWysiwyg }
  zenMode = true; sidebarVisible = false; previewVisible = false; editorWysiwyg = true
  // 打字机 / 栏宽 / 保存指示 / 音效：由 flowMode=true 驱动（各组件自行响应 settings）

exitFlow():    // 还原外围状态；心流偏好不动
  还原 flowSnapshot → flowMode = false
```

- `Esc` 分级回退链插入位置：`关闭悬浮预览 → **退出心流** → 返回上级文件夹 → 关闭网格`（仅编辑视图且有内容时）；
- 心流模式内 Alt+B / Ctrl+E 等仍可用（用户手动调整仅影响本次会话，退出时按快照还原）。

### 5.5 设置项清单（需三处同步：types / 主进程默认值 / 渲染端 DEFAULT_SETTINGS + 测试夹具）

| 设置键 | 类型 | 默认 | 归属 |
| --- | --- | --- | --- |
| `typewriterMode` | `'off' \| 'center' \| 'bottom'` | `'off'` | 轴 3（独立于心流） |
| `flowLineWidth` | `'narrow' \| 'medium' \| 'wide'` | `'medium'` | 心流偏好 |
| `flowSoundEnabled` | `boolean` | `false` | 心流偏好 |
| `flowSoundVolume` | `number`（0–100） | `60` | 心流偏好 |

## 6. 实施首日需实测确认的点

1. `.cm-content` 的上下 padding 是否影响 `coordsAtPos` 基准（差值法理论上不依赖，但需实测首行/末行锚定是否准确）；
2. `.cm-content` 设 `max-width` + `margin-inline: auto` 后，换行位置、光标绘制、选区内边距、行级滚动同步（`data-source-line` 坐标）是否全部正常；
3. 低位锚点在不同窗口高度下的观感（默认 0.8 是否合适，必要时微调到 0.75）；
4. 所见即所得模式下打字机与装饰刷新（Widget 重渲染）叠加时的滚动稳定性。

## 7. 分阶段实施计划

| 阶段 | 范围 | 依赖 | 可独立发版 |
| --- | --- | --- | --- |
| **P1 打字机** | FR-F1（含高/低位、规则表全部行为）+ 设置项 + 单测 | 无 | ✅ |
| **P2 心流预设** | FR-F2 / F3 / F5 + Alt+W + Esc + 栏宽 + 保存指示 | P1 | ✅ |
| **P3 音效** | FR-F4（合成器 + 设置项 + 限流） | P2（作用范围） | ✅ |
| P4 可选（未排期） | 环境音、写作统计、光标动效 | — | — |

每期完成后按仓库规范同步：CHANGELOG `[未发布]`、PRD 补记 FR 编号（打字机 → FR-2.4.14；心流 → FR-2.9.8；音效 → FR-2.9.9）、`requirements/index.md` 状态、用户手册。

## 8. 测试计划

**单元测试（vitest）**：

- `anchorScrollTop`：高位/低位、首行/末行、滚动位置无关性；
- 留白量计算：ratio 与视口高度 → padding 映射；
- 音效限流：`shouldPlay(now, lastPlayAt)` 边界（=119ms 不响 / =120ms 响）；
- 栏宽档位 → em 映射。

**手动验证清单（对应需求第 5 节验收标准）**：

- 中文输入法组词全程无抖动；组词确认后锚定正确；
- 拖选不连续滚动、长文（≥5000 行）连续输入无卡顿；
- 用户滚动查看前文不被弹回，输入后回到锚点；
- 心流进入/退出状态往返（含「心流内 Alt+B 唤出侧栏 → 退出后状态正确」）；
- 音效关闭后无残留音频上下文（`AudioContext.state === 'closed'`）；
- 关闭打字机后对比常规模式滚动行为完全一致。

## 9. 风险与对策

| 风险 | 对策 |
| --- | --- |
| padding 与坐标基准不符导致锚点偏移 | 差异法（D3）对基准不敏感；首日实测项 1 兜底 |
| 与所见即所得装饰刷新叠加产生滚动抖动 | 重锚走 rAF 合并；实测项 4 专项验证 |
| 心流内用户手动调整与退出还原产生「我的操作被撤销了」的困惑 | 快照语义写入用户手册 + 设置页说明；如真实反馈困扰，再评估改为「退出保留用户手调」 |
| 音效实现后音色不满意（合成器上限） | 参数可调（频率/衰减/滤波）；不满意时的退路是随包 CC0 素材（不改架构，只换 `playReturn` 实现） |
| 打字机模式下长按方向键连续滚动掉帧 | rAF 合并；必要时对「连续方向键」加 16ms 节流（实测决定） |

---

## 10. 实施记录

### 10.1 P1 打字机模式（2026-09-23 完成）

**交付**：`src/renderer/src/lib/typewriter.ts`（CM6 扩展）+ 设置项 `typewriterMode`（types / 主进程默认值 / 渲染端默认值 / 测试夹具 五处同步）+ 设置 → 编辑器 UI + `tests/typewriter.test.ts`（12 项）。

**实测发现（重要，实现修正了设计初稿的一处判断）**：

- **留白必须加在内容层（`.cm-content`），不能加在滚动层（`.cm-scroller`）**：`.cm-scroller` 的高度由内容撑开，给它加 padding 会把自身撑得超过父容器（实测 765px 容器被撑到 1764px），滚动几何错乱，且插件读取它的 `clientHeight` 会形成反馈放大（padding 越大 → clientHeight 越大 → padding 更大）。已确认正确做法：padding 加在 `.cm-content`，滚动层盒子保持稳定，行号 gutter 由 CM6 按内容坐标定位、自动跟随（实测「第 1 行」文本与行号 `1` 的 y 坐标均为 471，严格对齐）。
- **设计自洽性得到验证**：scrollTop = 0 时（刚打开笔记、未发生任何滚动），首行恰好落在锚点线上——因为 `paddingTop = ratio × 视口高`。切换笔记无需额外锚定动作，观感即正确。
- **锚点公式（差值法）实测精确**：高位模式下光标屏幕位置恒为 383（= 0.5 × 765），低位模式恒为 612（= 0.8 × 765）；连续输入时 `scrollTop` 递增而光标 Y 不变，即需求的「文字上移、光标不动」。
- **既有 `.cm-scroller` 的 `padding: 12px 0 40vh` 保留**：它是滚过末尾的既有福利，与打字机留白叠加只是多出一些可滚动空间，无副作用；关闭打字机时清零的是 `.cm-content` 的内联 padding，滚动行为与常规完全一致（实测 `padding: (none)`、光标到文末为常规滚动）。

**已验证验收项**（真实键事件驱动，非合成事件）：

| 验收标准 | 结果 |
| --- | --- |
| 高位 / 低位在源码模式生效，光标锚定精确 | ✅ 383 / 612（= 比例 × 视口高） |
| 所见即所得模式下同样生效且与装饰渲染无干扰 | ✅ Ctrl+E 切换后锚定不变，输入时文字流动 |
| 输入时「文字上移、光标不动」 | ✅ scrollTop 2057→2082→2108，光标 Y 恒 383 |
| 用户滚动查看前文不被弹回；下次输入回到锚点 | ✅ 上滚 300 后未被弹回，再输入回到 383 |
| 方向键移动光标触发重锚 | ✅ 上键后回到 383 |
| 拖选过程中不连续滚动，拖选结束补锚定 | ✅ 拖选中 scrollTop 不变，mouseup 后回锚点 |
| 关闭模式后留白清零、行为与常规一致 | ✅ `padding: (none)`，Ctrl+End 为常规滚动 |
| 窗口尺寸变化后留白重算 | ✅ 视口 765→598 后 padding 383→299 |

**待人工确认项**：中文输入法组词的实机表现（代码路径已按 `view.composing` 冻结 + `compositionend` 补锚实现，但 CDP 无法驱动真实 IME；建议在 P2 开发时一并实测）。

### 10.2 后续（未开始）

- **P2 心流预设**：Alt+W 进入 / Esc 退出、状态快照还原、写作栏宽、保存指示；
- **P3 回车音效**：Web Audio 合成器 `lib/caretSound.ts`、限流与音量。
