# 文件/文件夹移动设计（库内）

> 状态：**设计已确认（2026-09-12）**，已实施（基础移动）；引用改写待实施
> 关联：FR-2.3（文件夹与笔记管理）
> 涉及代码：`src/main/services/fsTree.ts`、`src/main/ipc/registerIpc.ts`、`src/shared/api.ts`、`src/shared/types.ts`、`src/preload/index.ts`、`src/renderer/src/composables/actions.ts`、`src/renderer/src/components/VaultNode.vue`、`src/renderer/src/views/NoteGridView.vue`、`src/renderer/src/components/MoveDialog.vue`（新增）
> 设计决策：仅库内移动；跨库移动不做（复杂度高、附件路径失效问题难解）；目标同名直接拒绝（与重命名行为一致）。

---

## 1. 需求

用户在侧栏树或网格卡片的 ⋮ 菜单中选择「移动到…」，弹出文件夹选择对话框，选择目标文件夹后将笔记或文件夹移动到该位置。

**范围**：

- 库内移动（笔记、文件夹均可）
- 不做跨库移动
- 移动后自动改写笔记内的相对路径引用（图片、链接），详见第 6 节

---

## 2. IPC 层

### 2.1 新增方法签名

`shared/api.ts` 新增：

```typescript
moveNode(
  vault: string,
  srcPath: string,
  kind: 'dir' | 'note',
  destParentPath: string
): Promise<OpResult & { newPath?: string }>
```

- `srcPath`：源文件/文件夹的库内相对路径
- `destParentPath`：目标文件夹的库内相对路径（空字符串 `''` = 库根）

`preload/index.ts` 暴露对应 IPC 调用。

### 2.2 IPC handler

`registerIpc.ts` 新增 `node:move` handler：

```typescript
handle('node:move', (vault, srcPath, kind, destParentPath) => {
  const result = deps.fsTree.moveNode(vault, srcPath, kind, destParentPath)
  if (result.ok && result.newPath) {
    deps.favorites.onRename(vault, srcPath, result.newPath, kind, path.basename(result.newPath))
    deps.recents.onRename(vault, srcPath, result.newPath, kind, path.basename(result.newPath))
  }
  return result
})
```

复用 `favorites.onRename` / `recents.onRename`——移动 = 路径变更，与重命名的引用更新逻辑完全相同。

---

## 3. 主进程 `FsTreeService.moveNode`

```typescript
moveNode(
  vault: string,
  srcPath: string,
  kind: 'dir' | 'note',
  destParentPath: string
): { ok: boolean; error?: string; newPath?: string }
```

### 校验链路

| 步骤 | 校验内容 | 复用函数 |
|------|---------|---------|
| 1 | 路径安全：srcPath 和 destParentPath 均通过 `resolveWithin` | `resolveWithin` |
| 2 | 源存在：`fs.existsSync(srcAbs)` | — |
| 3 | 目标文件夹存在：`fs.existsSync(destAbs)` | — |
| 4 | 不能移到自身内部：`destParentPath` 不能等于或以 `srcPath + '/'` 开头（仅文件夹） | — |
| 5 | 深度限制：`relDepth(destParentPath) + 子树最大深度 ≤ MAX_DIR_DEPTH`（仅文件夹移动时） | `relDepth` |
| 6 | 名称格式：`checkNameFormat(baseName, kind)` | `checkNameFormat` |
| 7 | 目标重名：`checkDuplicate(baseName, destDirEntries, kind)` | `checkDuplicate` |

### 执行

```typescript
fs.renameSync(srcAbs, path.join(destAbs, baseName))
return { ok: true, newPath: newRel }
```

`baseName` = 文件夹名或 `noteFileName(原名)`；`newRel` = `destParentPath/baseName`（destParentPath 为空时直接用 baseName）。

---

## 4. 渲染层

### 4.1 移动对话框 `MoveDialog.vue`（新增）

弹窗组件，接收 props：

- `vault: string` — 当前库名
- `srcPath: string` — 源路径
- `kind: 'dir' | 'note'` — 移动对象类型
- `name: string` — 显示名

内容：

- 显示当前库的文件夹树（从 `treeStore.trees[vault]` 获取，过滤 `kind === 'dir'` 节点）
- 库根作为顶层节点（标签 = 库名）
- 节点可展开/折叠，点击选中（高亮 + 底部路径更新）
- **灰显不可选**：源文件夹自身及其所有子目录（`path.startsWith(srcPath + '/')` 或 `path === srcPath`）
- 底部显示选中目标路径（如 `工作笔记/项目资料`）
- 「移动到此处」按钮 + 「取消」按钮
- 「移动到此处」点击后调用 `window.trace.moveNode(vault, srcPath, kind, destPath)`

### 4.2 菜单入口

**VaultNode.vue**：

- 文件夹菜单：在「重命名」之前加「移动到…」
- 笔记菜单：在「收藏笔记/取消收藏」之前加「移动到…」

**NoteGridView.vue**：

- 文件夹卡片菜单：在「重命名」之前加「移动到…」
- 库内容笔记卡片菜单：在「收藏笔记」之前加「移动到…」
- 常用/收藏区笔记卡片：**不加**移动入口（可能跨库，移动仅限库内）

### 4.3 `actions.ts` 新增 `moveNode`

```typescript
function moveNode(vault: string, srcPath: string, kind: 'dir' | 'note', name: string): void {
  // 打开 MoveDialog
  // 成功后：
  //   editor.handleNodeRenamed(vault, srcPath, result.newPath, kind, name)
  //   await refreshVault(vault)
  //   await tree.loadFavorites()
  //   await tree.loadRecents()
}
```

编辑器状态处理与 `renameNode` 完全相同——路径变更后调用 `editor.handleNodeRenamed` 更新编辑器内打开的笔记路径。

---

## 5. 校验规则汇总

| 场景 | 处理方式 |
|------|---------|
| 目标文件夹已存在同名文件/文件夹 | 拒绝，弹窗内显示错误提示「名称已存在，请更换」 |
| 文件夹移动后总深度 > 6 层 | 拒绝，弹窗内显示错误提示「移动后将超过最大层数限制」 |
| 文件夹移到自身或自身子目录 | 灰显不可选 |
| 源路径不存在 | 返回错误，toast 提示 |
| 目标路径不存在 | 返回错误，toast 提示 |

---

## 6. 移动后相对路径引用改写

### 6.1 问题

笔记中的相对路径引用（`![img](./attachments/xxx.png)` 或 `[link](./other.md)`）以笔记所在目录为基准解析。移动后基准变了，引用断裂。

### 6.2 需要改写的引用类型

| 引用格式 | 匹配正则 | 示例 |
|---------|---------|------|
| Markdown 图片 | `![...](相对路径)` | `![img](./attachments/123.png)` |
| Markdown 链接 | `[...](相对路径.md)` | `[笔记](./other.md)` |
| HTML 图片 | `<img src="相对路径">` | `<img src="../media/img.png">` |

不改写的：绝对 URL（`http://`、`https://`）、库根路径（`/` 开头）、锚点（`#` 开头）。

### 6.3 改写逻辑

在 `FsTreeService.moveNode` 中，`fs.renameSync` 成功后执行后处理：

1. **收集需改写的笔记**：
   - 移动笔记 → 仅该笔记
   - 移动文件夹 → 递归遍历所有 `.md` 文件

2. **对每个笔记**：
   - 读取笔记内容
   - 用正则 `!?\[.*?\]\(([^)]+)\)` 和 `<img[^>]*\ssrc="([^"]+)"` 匹配所有相对路径引用
   - 对每个引用：
     - 解析为库内绝对路径（基于笔记的**旧位置**）
     - 检查该目标文件是否也在移动范围内（`srcPath` 目录树内）→ **在范围内则跳过**（相对关系不变）
     - 不在范围内 → 从笔记**新位置**重新计算相对路径 → 替换
   - 写回笔记内容

3. **路径计算**：复用 `src/main/lib/paths.ts` 中的 `relReference(fromNoteRel, toFileRel)` 函数

### 6.4 边界情况

| 场景 | 处理 |
|------|------|
| 引用的目标文件也在被移动的目录内 | 跳过（相对关系不变） |
| 引用的目标文件不存在（断链） | 跳过（不改写已断的链接） |
| 笔记内容读取失败 | 跳过，不影响移动结果 |
| 文件夹移动，笔记数量多 | 逐个读写，不加额外优化（库内笔记量级有限） |

### 6.5 已知局限

- 仅改写被移动笔记内部的引用，不改写**其他笔记**中引用被移动文件的路径（这需要全局搜索，待双链功能解决）
- 移动正在编辑的笔记时，编辑器路径会更新但需重新从磁盘加载内容（`handleNodeRenamed` 后自动触发）

---

## 7. 测试

在 `tests/fsTree.test.ts` 中补充 `moveNode` 测试：

- 库内移动笔记到子文件夹
- 库内移动文件夹到子文件夹
- 移动到库根（destParentPath = ''）
- 目标重名 → 拒绝
- 深度超限 → 拒绝
- 文件夹移到自身 → 拒绝
- 文件夹移到自身子目录 → 拒绝
- 源不存在 → 错误
- 目标不存在 → 错误
- 移动笔记后改写图片相对路径（`./attachments/` → `../attachments/`）
- 移动笔记后改写链接相对路径（`./other.md` → `../other.md`）
- 移动笔记后不改写同目录树内引用（相对关系不变）
- 移动文件夹后批量改写内部笔记的引用
- 不改写绝对 URL 和锚点
