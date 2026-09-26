# 标签系统

## 问题

笔记无法打标签分类，缺少按标签筛选笔记的能力。

## 方案

### 存储

~~应用元数据方式，存储在 `<userData>/tags.json`~~ → **已迁移到 frontmatter 方案（2026-09-14，方案 A 落地）**：

- 笔记 ↔ 标签关联存储在笔记 YAML frontmatter 的 `tags` 键（字符串数组，Obsidian 兼容），随文件移动 / 重命名 / 外部编辑天然跟随——读写纯函数在 `src/shared/noteTags.ts`（js-yaml，解析失败放弃写入保护原文，其余键保留）；
- 标签定义（名称 → 颜色）仍在 `<userData>/tags.json`（`{ tags: TagItem[] }`）；未登记的 frontmatter 标签在读取时自动注册定义（配色按名称哈希取自调色板）；
- 重命名 / 删除标签定义时全库扫描改写受影响笔记；`notesByTag` 筛选为全库 frontmatter 扫描；
- 旧版 `noteTags`（库+路径+tagId）关联在启动时自动迁移到各笔记 frontmatter，完成后清空；
- 编辑中笔记的打标签走编辑器缓冲区（`setContent` + 自动保存），避免与磁盘 hash 防覆盖冲突。

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

### 服务层（`main/services/tags.ts`，frontmatter 方案后重写，方法均为实际实现）

| 方法 | 说明 |
|------|------|
| `listTags()` | 返回标签定义 |
| `createTag(name, color)` | 创建标签定义（重名校验，大小写不敏感） |
| `renameTag(id, newName)` **async** | 重命名标签定义 + 全库扫描改写关联笔记 frontmatter |
| `deleteTag(id)` **async** | 删除标签定义 + 全库扫描从关联笔记移除 |
| `setTagColor(id, color)` | 修改标签颜色（仅定义，无文件写入） |
| `noteTags(vault, path)` **async** | 读笔记 frontmatter tags 并联定义（未登记标签自动注册） |
| `addTagToNote(vault, path, tagId)` **async** | 读盘 → frontmatter 增加标签名 → 带 hash 防覆盖写回（幂等） |
| `removeFromNote(vault, path, tagId)` **async** | 同上，移除标签名 |
| `notesByTag(tagId)` **async** | 全库扫描 frontmatter，返回打该标签的笔记（库+路径） |
| `migrateFromNoteTags()` **async** | 旧版元数据关联迁移到 frontmatter，完成后清空旧记录（启动时调用） |

- frontmatter 读写纯函数在共享层 `shared/noteTags.ts`（`getFrontmatterTags` / `setFrontmatterTags` / `maskFrontmatter` / `stripFrontmatter`），渲染端与主进程共用；
- ~~`onRename` / `onDelete` / `onVaultRename` 跟随钩子~~ 已随 frontmatter 方案移除（标签随文件走，注册表不再需要跟随）；
- 注册表 `tags.json` 结构简化为 `{ tags: TagItem[] }`（`noteTags` 仅在旧数据迁移前存在）。

### IPC 通道

`tag:list`, `tag:create`, `tag:rename`, `tag:delete`, `tag:setColor`, `tag:noteTags`, `tag:addToNote`, `tag:removeFromNote`, `tag:byTag`

preload 暴露到 `window.trace`，在 `registerIpc.ts` 中注册（异步 handler）。frontmatter 方案下注册表不再参与笔记重命名/删除/移动的跟随。

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
- **区块可折叠（FR-2.6.11，2026-09-24 追加）**：标题左侧箭头展开 / 收起标签列表，与「笔记库」区同款交互与视觉（箭头列与各标题文字列均与相邻区块对齐）。标签多时收起可为下方区块腾出空间（实测 8 个标签收起后腾出 260px）；收起态保留数量角标与 `+` 新建按钮，**收起时新建标签自动展开**；展开状态持久化（localStorage，键 `trace.tagSectionOpen`）。区块标题点击行为不变（仍是打开标签网格）。设计稿下图中的 `▼` 箭头自始存在，本次补齐实现。
- **标题「+」按钮对齐（同上，2026-09-24）**：标签区的 `+` 原先独用 `.side-section-add`（实测 17.3px 宽 + 额外 4px 左边距），笔记库区用 `.row-btn`（固定 22px），于是两处加号错开 4.7px、角标差 0.7px。现统一为 `.row-btn`（`.side-section-add` 已删除），两区的计数角标与 `+` 逐像素对齐。（当时与「常用」等**只有角标、无 `+`** 的区块相比角标仍相差 28px，见下条的后续调整。）
- **标题布局调整（2026-09-25 追加）**：用户反馈有角标时**数字被挤离右缘**（`+` 依赖角标的 `margin-left: auto` 被推到行尾，与「常用」等无 `+` 区块的角标不在同一列），且 0 计数时 `+` 跳到标题旁（index 第二节登记的既有问题）。现改为 **`+` 固定紧贴标题文字（间距 6px）、计数角标统一吸到行尾最右**——上段遗留的 28px 角标列差随之消失，所有区块角标同列（实测常用 / 标签 / 笔记库三行角标右缘同为 x=266，0 计数区块不受影响）。

#### 笔记打标签

笔记 ⋮ 菜单（侧栏树 + 网格卡片）新增「标签…」入口，打开「管理标签」弹窗（共享组件 `TagPickerDialog.vue`）：
- 显示所有标签定义（色点 + 名称），已打的标签勾选
- 点击行切换打标/取消（即时生效）
- 笔记正打开在编辑器时直接改编辑器缓冲区的 frontmatter（走自动保存），未打开时由主进程读盘改盘

#### 网格卡片标签显示

未实现（设计预留）：卡片展示标签色块小圆点。

#### 网格卡片标签显示

`.note-card-meta` 下方新增标签色块小圆点（8px），最多 3 个，超出 `+N`。

#### 侧栏标签管理（实现形态）

标签的创建/重命名/改色/删除集中在侧栏「标签」区完成（未做设置页区块）：
- 标签行 ⋮ 菜单：重命名（弹窗）、更改颜色（弹窗：8 色预设色板 + 自定义拾色器）、删除（红色警示确认）
- 顶栏 `+` 按钮：新建标签（自动轮换预设色）

### 预设 8 色

`#e74c3c`（红）, `#e67e22`（橙）, `#f1c40f`（黄）, `#2ecc71`（绿）, `#3498db`（蓝）, `#9b59b6`（紫）, `#1abc9c`（青）, `#95a5a6`（灰）

## 已知局限

~~标签不随文件走~~ → **已通过 frontmatter 方案解决**（应用内外的移动 / 重命名均天然跟随）。残余局限：

- frontmatter 写入经 YAML round-trip，frontmatter 内的**注释会丢失**、格式会规范化（数据不丢）；
- frontmatter YAML 非法的笔记打标签会失败并提示（保护原文不写入）；
- 标签筛选 / 重命名 / 删除为全库扫描，笔记量极大时（万级）有性能空间。

### 演进方案（2026-09-14 讨论 → 已采纳 A）

| 方案 | 说明 | 复杂度 | 取舍 |
| --- | --- | --- | --- |
| **A. frontmatter 内嵌** | 标签写入笔记 YAML frontmatter（`tags: [...]`），随文件走，移动/重命名/外部编辑天然跟随；Obsidian 等工具可识别 | 中高（1–2 天）：frontmatter 解析/序列化 + 存量迁移 + 与「元数据不进库」原则的豁免论证 | **治本。已采纳并实施**（frontmatter 属于笔记内容而非应用私有元数据） |
| B. 元数据 + 孤儿治理 | 维持旧元数据方案；失效条目标注「缺失」并提供一键清理 | 低 | 治标，未采纳 |
| C. 混合 | 标签定义留元数据，笔记↔标签关联写 frontmatter | 中 | 与 A 相比无额外收益，未采纳 |

## 不做的事

- 不解析笔记 frontmatter（元数据方式）
- 不支持嵌套标签（`parent/child` 形式，YAGNI）
- 不做标签自动建议（基于内容推荐标签）
