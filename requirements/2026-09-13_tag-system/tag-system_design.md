# 标签系统

## 问题

笔记无法打标签分类，缺少按标签筛选笔记的能力。

## 方案

### 存储

应用元数据方式，存储在 `<userData>/tags.json`，遵循「元数据与笔记分离」原则。标签不随文件走（已知局限，后续通过 frontmatter 方案解决）。

数据模型：

```ts
interface TagItem {
  id: string          // uuid
  name: string        // 标签名（唯一，大小写不敏感）
  color: string       // hex 颜色，如 '#4078d3'
  createdAt: string   // ISO 时间戳
}

interface NoteTagEntry {
  vault: string
  path: string        // 笔记相对路径
  tagId: string
}
```

tags.json 结构：`{ tags: TagItem[], noteTags: NoteTagEntry[] }`。

### 服务层（`main/services/tags.ts`，新建）

| 方法 | 说明 |
|------|------|
| `listTags()` | 返回所有标签 |
| `createTag(name, color)` | 创建标签（重名校验，大小写不敏感） |
| `renameTag(id, newName)` | 重命名标签 |
| `deleteTag(id)` | 删除标签 + 清理所有关联 |
| `setTagColor(id, color)` | 修改标签颜色 |
| `noteTags(vault, path)` | 返回笔记的所有标签 |
| `addToNote(vault, path, tagId)` | 给笔记打标签（幂等） |
| `removeFromNote(vault, path, tagId)` | 移除笔记的标签 |
| `notesByTag(tagId)` | 返回某标签下的所有笔记 |
| `onRename(vault, oldPath, newPath, kind)` | 跟随笔记/文件夹重命名更新关联 |
| `onDelete(vault, relPath, kind)` | 跟随删除清理关联 |
| `onVaultRename(old, new)` | 跟随库重命名 |

### IPC 通道

`tag:list`, `tag:create`, `tag:rename`, `tag:delete`, `tag:setColor`, `tag:noteTags`, `tag:addToNote`, `tag:removeFromNote`, `tag:byTag`

preload 暴露到 `window.trace`。在 `registerIpc.ts` 中注册，笔记重命名/删除/移动时调用 `tags.onRename`/`tags.onDelete`。

### UI

#### 侧栏「标签」区

与「常用」「收藏」并列，位于回收站上方：

```
▼ 标签 (3)
  🔴 工作 (5)
  🔵 学习 (3)
  🟢 生活 (2)
```

- 点击标签 → 主区网格视图显示该标签下的笔记（NoteGridView 新增 `section: 'tags'` 模式）
- 标签行 ⋮ 菜单：重命名、修改颜色、删除（红色警示）
- 顶栏 `+` 按钮：新建标签

#### 笔记打标签

笔记 ⋮ 菜单（侧栏树 + 网格卡片）新增「标签」子菜单：
- 显示所有标签列表，已打的标签带 ✓
- 点击切换打标/取消
- 菜单底部「管理标签」→ 跳转设置页

#### 网格卡片标签显示

`.note-card-meta` 下方新增标签色块小圆点（8px），最多 3 个，超出 `+N`。

#### 设置页标签管理

设置 → 通用新增「标签」区块：
- 标签列表（名称 + 色块 + 关联笔记数 + ⋮ 菜单）
- 新建/重命名弹窗（名称输入 + 颜色选择器，预设 8 色）
- 删除确认弹窗

### 预设 8 色

`#e74c3c`（红）, `#e67e22`（橙）, `#f1c40f`（黄）, `#2ecc71`（绿）, `#3498db`（蓝）, `#9b59b6`（紫）, `#1abc9c`（青）, `#95a5a6`（灰）

## 已知局限

标签不随文件走——应用外移动/重命名文件会导致标签失效。后续通过 frontmatter 方案解决。

## 不做的事

- 不解析笔记 frontmatter（元数据方式）
- 不支持嵌套标签（`parent/child` 形式，YAGNI）
- 不做标签自动建议（基于内容推荐标签）
