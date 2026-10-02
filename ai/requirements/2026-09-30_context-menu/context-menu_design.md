# 右键上下文菜单 — 技术设计

> 需求文档：[context-menu.md](context-menu.md)（FR-2.4.28 编辑器 / FR-2.4.29 表面镜像，D1–D5 拍板记录见该文档）。
> 建议存档（方案与轮盘结论）：[../../suggest/context-menu.md](../../suggest/context-menu.md)。

## 1. 总体结构

```
main: clipboard IPC（clipboard:cut/copy/paste，对 mainWindow.webContents）
                │
preload: trace.editorCut/Copy/Paste()
                │
渲染层 lib/contextMenu.ts ── 共享类型 + 定位翻转 + openContextMenu(事件总线)
        │                              │
        ├─ ContextMenu.vue（自绘浮层，Teleport body）   ← 唯一渲染组件
        ├─ 编辑器接线（MarkdownEditor domEventHandlers contextmenu）
        └─ 表面接线（SideBar / NoteGridView / TagRow / TrashView @contextmenu）
```

## 2. P1 — 剪贴板 IPC（D2）

主进程 `registerIpc.ts` 新增三个无参 handler（拿到 handler 时的 `BrowserWindow` 即调用方窗口；本应用单窗口，语义明确）：

```ts
handle('clipboard:cut', (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender)?.webContents.cut())
handle('clipboard:copy', ...)  // .copy()
handle('clipboard:paste', ...) // .paste() —— 原生路径：DOM paste 事件完整触发，FR-2.4.25 归一化自动生效
```

`shared/api.ts` + `preload/index.ts` 同步三行。**不做** buffer 参数 / 多窗口路由（YAGNI）。

## 3. P1 — 编辑器上下文判定

`lib/contextMenu.ts` 导出纯函数 `resolveEditorMenu(state, pos): MenuSection[]`（输入 CM state 与右键 pos，输出菜单模型——纯函数可单测）：

1. `doc.lineAt(pos)` + 行内文本切片 → **选区节**：`selection.main` 非空且在可视范围 → 剪切 / 复制 / 复制选中 + 格式节（加粗 / 斜体 / 删除线 / 行内码 / 转为双链）；
2. **位置节**（右键点所在元素上下文，按优先级取第一个命中）：
   - `pos` 处语法节点含 `Link`（`syntaxTree(state).resolveInner(pos, -1)` 向上找 Link）且 URL 非空 → 打开外部链接 / 复制链接地址（复用 `openExternal` 配置通道）；
   - 节点文本匹配 `/\[\[([^\][\n]+)\]\]/`（含 pos）→ 打开笔记 / 复制 `[[引用]]` 文本（openNote 配置通道）；
   - `Image` 节点（同法向上找）→ 在附件目录中显示 / 复制图片路径；
3. 位置节判定用 `resolveInner(pos, -1)` + 父链上溯，**不依赖** `posAtCoords` 的 ±1 容差问题（那影响点击落点；右键我们先 `dispatch(selection, pos)` 把光标挪过去，此后全部按 state 判定，规避该坑）。

「在附件目录中显示」需要主进程 `shell.showItemInFolder(绝对路径)`——新增 `attachment:reveal` IPC（入参 vault + notePath + 相对路径，主进程 `resolveAssetUrl` 同款逻辑解析到磁盘绝对路径，越界由既有 `resolveWithin` 守卫）。

## 4. 菜单浮层组件（D3）

`components/ContextMenu.vue`：全局单例（App.vue 挂载），store（`app.ts` 增 `contextMenu` 状态：`{ open, x, y, sections }`）驱动。

- **渲染**：Teleport body + `position: fixed`，分节分隔线；item = `{ label, hint?, danger?, disabled?, action }`；hint 列渲染快捷键文本（如「Ctrl+B」）——纯提示不绑定新键；
- **定位**：默认在指针右下 `+2px`，近右缘 / 下缘自动翻转到左侧 / 上方（视口内钳制）；
- **关闭**：执行任一动作 / `Esc` / 点击菜单外（window capture mousedown 判定 target 不在菜单内）/ `blur`；
- **与既有浮层的关系**：心流 / 专注下正常打开（D5）；若悬浮预览或快速引用面板开着，菜单 z-index 取 3100（高于 `above-search` 预览 3000，低于无——菜单是瞬态顶层交互）；不进 `hasModalOpen` 链（右键菜单非模态，Esc 只关菜单自己，不影响分级链——在 onEscape **之前**的 window capture keydown 里消费）；
- **过渡**：无进入动画（60ms 内可交互优先，右键要「跟手」）；`dd-instant-hide` 同款理念。

## 5. P2 — 菜单项定义抽取（D4）

现状盘点：同一对象在**侧栏树（VaultNode）与网格卡片（NoteGridView）**各有一份 `el-dropdown-item` 模板（动作落到 `actions` composable / 本地 handler），文案与分组大体一致但**入口标注有差异**（如卡片有「在侧栏中定位」）。抽取原则：

1. `composables/menuItems.ts` 新增定义导出，**以动作 (command, handler) 为单位**、按对象类型分组：

```ts
export interface MenuItemDef { command: string; label: string; danger?: boolean; divided?: boolean; hint?: string }
export function vaultMenuItems(): MenuItemDef[]        // 新建/重命名/删除/关联Git/…
export function dirMenuItems(): MenuItemDef[]
export function noteMenuItems(hasGist: boolean): MenuItemDef[]  // 导出/分享/移动/收藏/标签/信息/定位/删除
export function draftMenuItems(): MenuItemDef[]
export function tagMenuItems(): MenuItemDef[]
export function trashEntryItems(): MenuItemDef[]       // 还原 / 彻底删除
```

2. **dropdown 侧**：VaultNode / NoteGridView 的 `<el-dropdown-item>` 模板改为 `v-for="item in xxxMenuItems(...)"`（command 语义与现有 handleXxxCommand 完全不变，纯渲染层替换；`divided` / `danger` / 文案以**现有树菜单为准**逐项对齐）；
3. **contextmenu 侧**：`@contextmenu.prevent` → `openContextMenu(items 映射 + handler 表)`——handler 复用各组件既有的 `handleMenuCommand(command)` 函数，**零新动作逻辑**；
4. 树菜单与卡片菜单的入口差异项（如「在侧栏中定位」卡片有、树无）**合并为并集**（右键统一提供全量，hint 区分），除非动作在某表面无意义（回收站条目只有还原 / 删除）。

> 风险控制：第 2 步涉及 4 个组件的模板替换，逐组件替换 + typecheck + 冒烟（⋮ 菜单行为回归）；若某组件模板有强本地条件（如 vault 未关联时隐藏 Git 菜单），用 `visible?: (ctx) => boolean` 谓词保留在定义里，不散回模板。

## 6. 测试设计

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| 纯函数 | `tests/contextMenu.test.ts`（新） | resolveEditorMenu：无选中 / 有选中 / 双链上 / 链接上 / 图片上 / 组合（选区+位置）；菜单定位翻转（lib 内 `placeMenu` 纯函数：右缘 / 下缘翻转钳制） |
| IPC | 主进程 handler 冒烟 | cut/copy/paste 转发（mock webContents） |
| CDP | 隔离实例 | ① 编辑器右键原生菜单不出现、菜单显示；② 选中转双链落盘；③ 右键粘贴 NBSP 文本归一化落盘；④ 树笔记右键菜单项与 ⋮ 一致且「重命名」动作生效；⑤ Esc / 外点关闭；⑥ 近右缘翻转 |

## 7. 实施顺序与工时

1. IPC 三连 + `attachment:reveal`（0.25 天）；
2. `lib/contextMenu.ts`（类型 / resolveEditorMenu / placeMenu）+ 单测（0.25 天）；
3. `ContextMenu.vue` + store 接线（0.25 天）；
4. 编辑器接线（domEventHandlers + 选区动作落到既有 insertSnippet / insertReferenceAtPath）（0.25 天）；
5. P2 抽取与四表面接线（0.5 天）；
6. 冒烟 + 文档收口（0.25 天）。

合计 **约 1.5~2 天**（与建议存档口径一致）。

## 8. 风险与边界

- **原生菜单替换范围**：仅编辑器（CM contentDOM）+ P2 四表面；输入框 / 设置页保留原生（需求已定）；
- **posAtCoords 坑**：右键先把选区挪到指针位置再判定，全程 state 驱动（§3），不读坐标返回值做节点判定；
- **menu-hold 残影**：本菜单非 EP popper，自绘无锚点，天然无残影问题；但「菜单项动作导致 DOM 移除」（如删除后树重建）时菜单已先行关闭（执行动作即关），无竞态；
- **右键拖拽 / 选中**：右键按下不改变既有选区（先 mousedown 判定 button===2 时 preventDefault 不做光标挪动，contextmenu 事件里才挪）——避免「右键清空用户选区」的常见翻车；
- **Vim 模式**：右键剪切 / 粘贴走 webContents 原生路径，与 vim 键位体系无关；normal 模式下右键仍可用（菜单动作直接 dispatch / 原生剪贴板，不经 vim 键位表）。

## 9. 实施与验证记录（2026-09-30，分支 `feat/context-menu`）

### 9.1 交付清单

| 文件 | 内容 |
| --- | --- |
| `src/main/ipc/registerIpc.ts` | 剪贴板三连直挂 ipcMain（需 sender 定位窗口、无 ok/error 语义，不经通用包装，§2）+ `attachment:reveal`（resolveWithin 越界守卫 + existsSync + shell.showItemInFolder；草稿返回不支持） |
| `shared/api.ts` + `preload/index.ts` | clipboardCut/Copy/Paste + revealAttachment 四方法 |
| `src/renderer/src/lib/contextMenu.ts`（新） | §3 纯逻辑：MenuItemVM / EditorMenuItem 类型 + resolveEditorMenu（三节组装：剪贴板禁用态 / 选区格式 / 位置上下文——双链用 lib/wikiTarget 正则、Link 用 URL 非空守卫、Image 走语法树上溯）+ placeMenu 翻转钳制 |
| `src/renderer/src/components/ContextMenu.vue`（新） | §4 全局单例浮层：Teleport body、measure 后翻转、Esc（capture 层，不进模态链）/ 外点 / blur / 执行动作关闭；z 3100 高于置顶预览 |
| `src/renderer/src/stores/app.ts` | contextMenu 状态 + openContextMenu（新顶替旧）/ closeContextMenu |
| `src/renderer/src/components/MarkdownEditor.vue` | contextmenu domEventHandlers（D6：选区内保留选区 / 选区外挪光标；posAtCoords 只做挪动不做节点判定）+ editorMenuItemToVM / runEditorMenuAction（声明式 → 真实实现；剪贴板动作先 view.focus()——菜单按钮点击会移走焦点，webContents 剪贴板作用于聚焦元素） |
| `src/renderer/src/composables/menuItems.ts`（新） | §5 单一定义源：各表面 ⋮ 工厂（逐字复刻现状）+ context 并集工厂（D7）+ defsToVM |
| 四表面接线 | VaultNode / SideBar（库行 + 标签行）/ NoteGridView（四类卡片）/ TrashView：dropdown 模板 v-for 化 + @contextmenu 接线；缺失 handler 补齐（树 newDir / newNote / locate、卡片 rename、库卡片 sync / associate / disconnect——git store 薄调用） |

### 9.2 实施中发现与修正

1. **childText 的 resolveInner 重解析踩坑**：对 Link.from 用 side=1 重解析解到 LinkMark（无 URL 子节点）→ 链接 / 图片判定全空——改为 contextNodeAt 直接返回 SyntaxNode、在其上迭代子节点（探针实证节点链 `URL ← Link` 正确后定位）；
2. **IPC handle 包装丢弃 event**：包装函数签名 `(_event, ...args)` 不透传 sender——剪贴板三连改 `ipcMain.handle` 直挂；
3. **CDP 冒烟的遮挡坑（新教训，已入 tech_verification 14）**：窗口被桌面其他窗口完全遮挡时 `visibilityState=hidden`——CM 的 posAtCoords 类坐标处理器**静默失效**（右键菜单不弹、无报错；双击选词同样失效），`Page.bringToFront` 无效，须 OS 层 `SetWindowPos(TOPMOST)` 置顶。教训 10（rAF 节流）的姊妹坑：**后台窗口不只动画停，坐标命中判定也不可靠**——判别手段：页面内 capture 计数探针确认事件已到达、再读 store 区分「handler 未跑」与「跑了被关」。

### 9.3 验证结果

- 单测 +11（`tests/contextMenu.test.ts`：无选中 / 有选中 / 双链 / 链接 / 图片 / 选区+位置并存 / 无上下文 / placeMenu 四象限翻转），全仓 559 项（552 过 + gitService 7 项 Windows 环境超时，90s 口径另行验证 8/8 绿）；lint / 双 typecheck 绿；
- CDP 冒烟 9/9（真实右键事件）：编辑器右键菜单出现（剪切禁用态正确）→ 双击选词 + 选区内右键 → 格式节五项 + **转为双链落盘 `[[正文内容]]`** → 动作后菜单自动关闭 → 右键粘贴经原生管线（**NBSP→空格、零宽删除**，FR-2.4.25 归一化生效）→ 树文件夹右键并集菜单逐项正确（新建两项 / 导出三连 / 定位 / 移动 / 重命名 / 删除）→ Esc 关闭。
