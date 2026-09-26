# 笔记「信息」菜单

## 问题

用户无法查看笔记的创建时间和最后修改时间。

## 方案

在笔记的 ⋮ 菜单中新增「信息」项，点击弹窗显示时间信息。仅对笔记生效，不给文件夹加。

### 1. IPC 通道（4 个文件）

- `shared/types.ts`：新增 `NoteInfo` 类型 `{ birthtime: string; mtime: string }`
- `shared/api.ts`：`TraceApi` 新增 `noteGetInfo(vault, path): Promise<OpResult & { info?: NoteInfo }>`
- `main/services/fsTree.ts`：新增 `noteGetInfo` 方法，`fs.stat` 读取后返回 ISO 字符串
- `main/ipc/registerIpc.ts` + `preload/index.ts`：注册 IPC 通道 `note:getInfo`

### 2. 菜单项（2 个文件，3 处菜单）

在以下笔记菜单的「删除」项前（加 `divided` 分隔线）插入「信息」：

| 文件 | 位置 | 当前菜单项 |
|------|------|-----------|
| `NoteGridView.vue` ~line 477 | 库内容区笔记卡片 | 定位 / 删除 |
| `NoteGridView.vue` ~line 526 | 常用/收藏区笔记卡片 | 定位 / 删除 |
| `VaultNode.vue` ~line 122 | 侧栏树笔记节点 | 重命名 / 删除 |

### 3. 信息弹窗

`ElMessageBox.alert`（复用项目已有的 Element Plus 弹窗模式），内容：

```
创建时间：2026年9月13日 10:30:00
最后修改：2026年9月13日 18:45:00
```

用 `new Date(iso).toLocaleString('zh-CN')` 格式化（与回收站 `formatTime` 一致）。

## 不做的事

- 不给文件夹加（mtime 不递归更新，信息会误导）
- 不用弹窗组件封装（`ElMessageBox.alert` 一行调用，够用）
- 不显示文件大小等额外信息（YAGNI）
