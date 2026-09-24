# 编辑位置与文首 / 文尾跳转技术设计

> 创建：2026-09-24 ｜ 状态：**已实施（已随 v0.8.0 发布）** ｜ 需求见 [edit-position.md](edit-position.md) ｜ 实施记录见第 7 节
> 分支：`feature/flow-mode`

## 1. 总体方案

**一句话**：新增一个设置项 `editPosition`（`'start'` 默认 / `'end'`），**在打开笔记的那一刻**由 store 记下一个「待落位」意图，编辑器组件消费它并把光标放到文首 / 文末；文首 / 文尾跳转只是把 CM 内建命令 `cursorDocStart` / `cursorDocEnd` 绑到主键盘区键位。

不动磁盘产物、不改既有滚动同步与打字机逻辑。

## 2. 关键背景（现状与约束）

| 项 | 现状 | 影响 |
| --- | --- | --- |
| 打开笔记 | `editor.openNote()` 先置 `current`，再置 `content`；视图经 `props.modelValue` 的 watcher 整体替换文档 | 整体替换时 CM 会把旧选区**映射**到新文档（可能落在任意位置）——这就是「光标位置不稳定 / 停在头部」的来源 |
| 笔记身份 | `openNote` **新建** `current` 对象；重命名是**原地修改** `current.path` | 「打开」与「重命名」需要区分：前者要落位，后者绝不能动光标 |
| 外部修改重载 | `reloadFromDisk` / `handleFsChanged` 只改 `content` | 同样不能触发落位（用户正在编辑） |
| 定位类能力 | 搜索结果 / 反向链接等只调 `scrollToLine`（只滚动、不设光标） | 落位只发生在打开瞬间，二者不冲突 |
| 既有键位 | CM `defaultKeymap` 已绑 `Mod-Home` / `Mod-End`（`cursorDocStart` / `cursorDocEnd`），但位于编辑键区（笔记本上常需 Fn） | 新键位是「主键盘区」的替代入口，不替换既有键位 |
| 全局 `Ctrl+E` | `App.vue` 的窗口级处理器只判断 `key==='e'` 且未判断 `shiftKey` | 新键位 `Ctrl+Shift+E` 会**顺带**触发「切换编辑模式」——必须收紧（D4） |

## 3. 决策记录

| # | 决策点 | 结论 | 理由 |
| --- | --- | --- | --- |
| D1 | 设置项的归属与生效范围 | 放在 **设置 → 通用 → 编辑器**（紧邻「默认编辑模式」），**全局生效**（含心流模式内打开的笔记） | 「打开笔记后的光标位置」与「打开笔记时使用的编辑模式」是同类语义，都应归于编辑器设置；心流模式分组只放「仅心流内生效」的项（栏宽 / 音效）。⚠️ 需求方原话提到「心流模式加入设置」，如希望它只在心流模式内生效或改挂到心流分组，改动面很小（一处 UI 位置 + 一处判断） |
| D2 | 设置键名与取值 | `editPosition: 'start' \| 'end'`，默认 `'start'` | 默认＝现状行为，升级无感；键名与 UI 用语「编辑位置」对齐 |
| D3 | 落位的实现路径 | store 在 `openNote` 里记 `pendingPlacement`（一次性意图），`MarkdownEditor` 消费后清空 | 用「打开」这一事件驱动，天然区分重命名（原地改 `path`）与外部重载（只改 `content`）——不会误触发；也避免用 `notePath` 变化做判据（重命名会误伤） |
| D4 | 键位与冲突 | `Ctrl+Shift+H`（文首）/ `Ctrl+Shift+E`（文尾）；并把 `App.vue` 全局 `Ctrl+E` 的判定收紧为「按住 Ctrl、**未按 Shift**、未按 Alt」 | H = Head / E = End，落在主键盘区单手可及；两键在编辑器默认键位与应用全局键中均未占用；收紧 `Ctrl+E` 后 `Ctrl+Shift+E` 不再误切编辑模式（该判定过宽本就是缺陷） |
| D5 | 落位时是否滚动 | 落位时同时请求滚动（`scrollIntoView`）到文首 / 文末；随后若有定位类滚动（搜索 / 反向链接）覆盖它 | 与既有 `Ctrl+Home` / `Ctrl+End` 的观感一致；定位优先于落位 |
| D6 | 「从头开始」是否也显式设置 | **是**：显式把光标设到位置 0 并滚到文首 | 消除「整体替换后选区被映射到未知位置」的不确定性，让 FR-2.4.18 的行为可预期（当前"停在头部"只是映射的巧合结果） |

## 4. 实现要点

### 4.1 设置项接线（沿用仓库的「五处同步」约定）

| 位置 | 改动 |
| --- | --- |
| `src/shared/types.ts` | `AppSettings.editPosition: 'start' \| 'end'` |
| `src/main/index.ts` | 主进程默认值 `editPosition: 'start'` |
| `src/renderer/src/stores/app.ts` | 渲染端 `DEFAULT_SETTINGS.editPosition = 'start'` |
| `tests/services.test.ts` / `tests/pluginHost.test.ts` | 设置夹具补 `editPosition: 'start'` |
| `src/renderer/src/views/SettingsView.vue` | 编辑器分组新增「编辑位置」下拉（默认编辑模式之后） |

### 4.2 落位（`stores/editor.ts` + `components/MarkdownEditor.vue`）

```ts
// stores/editor.ts —— 一次性意图
pendingPlacement: null as 'start' | 'end' | null,
async openNote(...) {
  ...
  this.current = { vault, path, name }
  this.content = result.content
  this.pendingPlacement = useAppStore().settings.editPosition   // ← 打开瞬间记下意图
  ...
}
```

```ts
// MarkdownEditor.vue —— 消费意图（同一次 flush 内，props.modelValue 的 watcher 先跑，文档已就位）
watch(() => editorStore.pendingPlacement, (place) => {
  if (!place || !view) return
  editorStore.pendingPlacement = null
  const pos = place === 'end' ? view.state.doc.length : 0
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: place === 'end' ? 'end' : 'start' }) })
})
```

- watcher 注册在 `props.modelValue` 的 watcher **之后**（同一组件的 pre-flush watcher 按创建顺序执行）→ 消费时文档已是新笔记内容；
- 不监听 `notePath`：重命名只原地改 `current.path`，不会触发落位（D3）。

### 4.3 键位（`components/MarkdownEditor.vue` 的 `Prec.high` 键位块）

```ts
{ key: 'Mod-Shift-h', preventDefault: true, run: (target) => (cursorDocStart(target), true) },
{ key: 'Mod-Shift-e', preventDefault: true, run: (target) => (cursorDocEnd(target), true) }
```

`cursorDocStart` / `cursorDocEnd` 来自 `@codemirror/commands`（既有依赖），自带 `scrollIntoView: true`。

### 4.4 收紧全局 `Ctrl+E`（`App.vue`）

```ts
if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) { ... }   // 新增 !e.shiftKey
```

## 5. 测试计划

**单元测试**：设置项默认值与夹具（`tests/services.test.ts`、`tests/pluginHost.test.ts` 随设置对象结构同步）；落位与键位属视图行为，由实测覆盖。

**实测（隔离实例，CDP）矩阵**：

| 场景 | 期望 |
| --- | --- |
| `editPosition = 'start'` 打开笔记 | 光标在位置 0、视图在文首 |
| `editPosition = 'end'` 打开笔记（从树 / 网格 / 搜索各入口） | 光标在文末、视图在文末，直接输入即续写 |
| 在笔记 A 中间停留后打开笔记 B | B 的位置只由设置决定 |
| 重命名当前笔记 | 光标不跳、内容不动 |
| 外部修改（模拟 git 拉取后的重载） | 光标不跳 |
| `Ctrl+Shift+H` / `Ctrl+Shift+E`（源码与所见即所得） | 光标与视图到文首 / 文尾 |
| `Ctrl+E` / `Ctrl+Shift+E` | 前者仍切编辑模式；后者只跳文尾、不切模式 |
| 心流模式内打开笔记 | 按设置落位，打字机锚定照常 |

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 落位与「定位类滚动」时序打架 | 落位在打开瞬间同一次 flush 内完成（早于调用方的 `scrollToLine`）；定位滚动后覆盖视图位置 ✓ |
| `pendingPlacement` 未被消费（组件未挂载 / 无笔记） | 消费即清空；无笔记时不置位（`openNote` 失败提前 return） |
| 未来新增「打开笔记」入口忘记落位 | 落位发生在 store 的 `openNote`（唯一打开入口），新入口自动生效 |
| 「从尾部开始」在超长文档上耗时 | 仅一次 `doc.length` 取值与一次滚动，无遍历 |

## 7. 实施记录（2026-09-24 完成，分支 `feature/flow-mode`）

**交付**：

| 文件 | 改动 |
| --- | --- |
| `src/shared/types.ts` | `editPosition: 'start' \| 'end'` |
| `src/main/index.ts` | 主进程默认值 `editPosition: 'start'` |
| `src/renderer/src/stores/app.ts` | 渲染端默认值 |
| `tests/services.test.ts`、`tests/pluginHost.test.ts` | 设置夹具同步 |
| `src/renderer/src/stores/editor.ts` | `pendingPlacement` 状态 + `openNote` 置位 |
| `src/renderer/src/components/MarkdownEditor.vue` | `applyPendingPlacement()`（文档替换处 + 挂载时消费）、`Mod-Shift-h` / `Mod-Shift-e` 键位 |
| `src/renderer/src/views/SettingsView.vue` | 编辑器分组「编辑位置」下拉 |
| `src/renderer/src/config/shortcuts.ts` | 速查表登记两条 |
| `src/renderer/src/App.vue` | 全局 Ctrl 系处理器加 `!e.shiftKey`（避免 `Ctrl+Shift+E` 误切编辑模式） |

**实现中发现并修掉的两处问题（原设计稿未覆盖）**：

1. **首次打开笔记时落位会漏掉**：`openNote` 可能在**编辑器组件挂载之前**执行（从欢迎页打开笔记、或视图切换导致组件重建），此时 store 已置位、但「监听 `pendingPlacement` 变化」的 watcher 不会触发（值在组件创建前就变了）。改为**两处消费**：文档被整体替换时 + 组件 `onMounted` 创建视图后；意图消费即清空，避免残留导致后续外部重载误跳。
2. **重新打开同一篇笔记时残留意图**：内容未变时 `props.modelValue` 的 watcher 会提前返回，意图不会被消费（既不能落位，又会在下一次外部重载时错误触发）。已在早退分支一并消费。

**实测（隔离实例，CDP）**：

| 场景 | 结果 |
| --- | --- |
| `start` → 打开笔记（**含「编辑器未挂载时打开」的时序**：先回欢迎页 → 打开 → 切编辑视图） | ✅ 光标在第 1 行、视图在文首 |
| `end` → 打开笔记 | ✅ 光标在最后一行（末尾空行）、视图在文末 |
| 手动移到第 3 行后重新打开 | ✅ 仍落在末行——与上次位置无关 |
| 重命名当前笔记 | ✅ 光标不动（仍在首行） |
| 外部修改重载（模拟 git 拉取后重载） | ✅ 光标不动（仍在首行） |
| `Ctrl+Shift+H` / `Ctrl+Shift+E` | ✅ 文首 / 文末跳转，源码与所见即所得模式均生效 |
| `Ctrl+E` | ✅ 仍切换编辑模式（收紧 `shiftKey` 判定未回归） |

**验证方法学（重要，避免误判）**：**合成的 `KeyboardEvent` 无法验证修饰键组合**——CM 的键名匹配依赖 `event.keyCode`（`w3c-keyname` + CM 的 `base[event.keyCode]` 回退分支），而 `new KeyboardEvent(...)` 无法携带 keyCode（恒为 0），带 Ctrl 的字符键会落进 CM 的 `isChar && ctrlKey` 分支后匹配失败。**必须用 CDP 的 `Input.dispatchKeyEvent`（带 `windowsVirtualKeyCode`）注入**，否则会出现「实现是对的、测试却全挂」的假象（本轮实测中先踩到过一次）。

**验收**：

| 验收标准（需求第 4 节） | 结果 |
| --- | --- |
| 1 / 2. 两种取值下的光标与滚动位置 | ✅ |
| 3. 各入口一致 | ✅ 落位在 store 的 `openNote`（唯一打开入口）内触发，所有入口（树 / 网格 / 收藏 / 常用 / 搜索 / 双链 / 重启恢复）自动生效 |
| 4. 与上次光标位置无关 | ✅ |
| 5. 重命名 / 外部重载不触发跳转 | ✅ |
| 6. 两个快捷键在两种编辑模式下生效 | ✅ |
| 7. 既有快捷键不回归（`Ctrl+E`、`Ctrl+Home/End`） | ✅ |
| 8. 设置持久化、既有测试不回归 | ✅ 设置随 settings 存盘；`typecheck` / `lint` / 相关单测通过 |
