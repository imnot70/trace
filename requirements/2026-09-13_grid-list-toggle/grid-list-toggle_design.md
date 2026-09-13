# 网格/列表切换视图

## 问题

常用、收藏、笔记库三个视图只有网格卡片布局，缺少紧凑的列表形态。回收站已有列表但不可切换。

## 方案

### 范围

常用、收藏、笔记库统一支持网格/列表切换。回收站保持纯列表不变。

### 1. 状态（`stores/app.ts`）

新增 `viewMode: 'grid' | 'list'`，默认 `'grid'`，持久化到 localStorage（`trace.viewMode`）。三个 section 共享同一模式。读取时机同 `previewVisible`（`_hydrate`）。

### 2. 切换 UI（`NoteGridView.vue` header）

section 标题右侧加两个图标按钮（`Grid` / `List`），当前模式高亮（`color: var(--accent)`），另一个灰色。点击切换 `app.viewMode`。

### 3. 列表布局（`NoteGridView.vue` 内）

不新建组件。`.grid-body` 根据 `viewMode` 切换：
- `'grid'`：保持现有 `display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`
- `'list'`：改为 `display: flex; flex-direction: column; gap: 8px`

列表行结构（`.note-card` 在 list 模式下的样式覆盖）：
```
┌──────┬──────────────────────────────┬──────────────┐
│ 📄   │ 标题 + 摘要（单行截断）        │ meta / 时间  │
└──────┴──────────────────────────────┴──────────────┘
```

- 水平 flex 布局，icon 固定宽，标题 flex:1，meta 右对齐
- 摘要从 3 行截断改为 1 行（`-webkit-line-clamp: 1`）
- vault-card 不再跨列，与普通行等宽

### 4. 笔记库 section

钻入文件夹内容后，笔记/文件夹卡片同样按当前 viewMode 渲染。

## 不做的事

- 不给回收站加切换（已是列表，网格形态无需求）
- 不做每个 section 独立记忆模式（全局共享够用）
- 不做快捷键绑定（按钮点击足够）
