# 双链引用 P3 实现计划

## 背景

P1（预览渲染/跳转/锚点）和 P2（编辑器 `[[` 补全）已随 v0.4.0 发布。当前代码存在两个关键缺口：
- `rewriteNoteRefs`（fsTree.ts:292-321）只处理 `[text](ref)` 和 `<img src>`，**不处理 `[[笔记名]]`**
- `renameNode`（fsTree.ts:84-112）**完全不调用 `rewriteRefs`**

## P3 三个子功能

### 1. 反向链接索引 — 新建 `WikilinkService`

新建 `src/main/services/wikilink.ts`，复用 SearchService 的索引模式：

- **索引构建**：启动后扫描所有库所有 .md 文件，用正则 `/\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g` 提取 `[[...]]` 引用
- **数据结构**：
  - `forwardIndex: Map<vault:path, WikilinkEntry[]>` — 每个笔记内的引用列表
  - `reverseIndex: Map<targetName, Set<BacklinkRef>>` — 被引用方的反向索引
- **增量更新**：笔记保存/删除时增量更新
- **查询**：`getBacklinks(vault, path)` / `getUnresolvedRefs(vault?)`

### 2. 移动/重命名改写 `[[...]]`

- **修改 `rewriteNoteRefs`**：在现有正则之后增加第二轮，匹配 `[[oldName]]` → `[[newName]]`，保留 `|display` 不变
- **修改 `renameNode`**：重命名后遍历同库所有笔记，将 `[[旧名]]` 改写为 `[[新名]]`
- 移动文件夹内笔记之间的 `[[...]]` 不改写（双链按名称解析，相对关系不变）

### 3. IPC + 前端 UI

**IPC 通道**：
- `wikilink:backlinks(vault, path)` → 反向链接列表
- `wikilink:unresolved(vault?)` → 未解析引用列表
- `wikilink:rebuildIndex()` → 重建索引

**UI**：
- 编辑卡底部新增「反向链接」折叠面板（显示引用当前笔记的笔记列表，点击跳转）
- 侧栏笔记库菜单新增「断链引用」入口，打开网格视图显示所有断链条目

## 实施步骤

1. 添加 `BacklinkRef` 类型到 `shared/types.ts`
2. 创建 `WikilinkService`
3. 修改 `fsTree.ts`：`rewriteNoteRefs` 增加 `[[...]]` 改写 + `renameNode` 调用 `rewriteRefs`
4. 注册 IPC 通道
5. 更新 preload + api.ts
6. 编辑器视图添加反向链接面板
7. 侧栏添加断链引用入口
8. 测试 + 文档