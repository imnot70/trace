# 双链 P1 + 页内锚点 + 锚点补全实施计划

> 基于 `wiki-link-anchor_design.md`，预计总工作量：~1 天。

---

## 任务拆分

### 任务 1：标题 id 生成

**文件**：`src/renderer/src/lib/markdown.ts`

1. 新增 `slugify(text)` 函数
2. 新增 `md.renderer.rules.heading_open` 自定义渲染器，注入 `id` 属性
3. 维护 `seen` set 处理同名标题去重（`-1`、`-2` 后缀）
4. 确保与现有 `data-source-line` 注入兼容

**验证**：手动在 dev 中检查标题渲染后是否带 `id` 属性。

---

### 任务 2：IPC `note:resolveByName`

**文件**：`src/main/services/fsTree.ts`、`src/shared/api.ts`、`src/preload/index.ts`、`src/main/ipc/registerIpc.ts`

1. `FsTreeService.resolveByName(vault, name)` — 递归遍历 `scan()` 结果，大小写不敏感匹配 `noteDisplayName`，返回第一个匹配的路径
2. `api.ts` 新增 `resolveByName` 方法签名
3. `preload/index.ts` 暴露 IPC
4. `registerIpc.ts` 注册 handler

**验证**：`npm run typecheck` 通过。

---

### 任务 3：markdown-it 双链 inline rule

**文件**：`src/renderer/src/lib/markdown.ts`

1. 新增 `md.inline.ruler.push('wikilink', ...)` 规则
2. 匹配 `[[...]]` 语法，提取路径和显示名（支持 `[[path|显示名]]`）
3. 渲染输出 `<a data-wikilink="name" href="name.md">显示名</a>`

**验证**：手动在 dev 中输入 `[[笔记名]]` 检查预览渲染。

---

### 任务 4：`rewriteInternalLinks` 扩展

**文件**：`src/renderer/src/components/MarkdownPreview.vue`

1. 移除 `decoded.startsWith('#')` 的跳过逻辑（支持锚点）
2. 新增 `data-wikilink` 链接处理：
   - 读取 `data-wikilink` 属性值（笔记名）
   - 调用 `window.trace.resolveByName(vault, name)` 解析路径
   - 设置 `data-internal` 属性
3. 锚点链接（`#anchor`）设置 `data-internal="#anchor"`

**验证**：`npm run typecheck` 通过。

---

### 任务 5：锚点跳转处理

**文件**：`src/renderer/src/components/MarkdownPreview.vue`

1. `onPreviewClick` 中新增锚点分支：
   - `data-internal` 以 `#` 开头 → 解码 anchor id → `querySelector` 查找目标 → `scrollIntoView`
   - 未找到 → toast 提示

**验证**：手动在 dev 中测试锚点跳转。

---

### 任务 6：锚点自动补全

**文件**：`src/renderer/src/components/MarkdownEditor.vue`

1. 新增 `slugify` 函数（与 markdown.ts 共用，提取到 `lib/slugify.ts` 或直接复制）
2. 新增 `anchorCompletions` CompletionSource：
   - 检查光标前是否为 `#`（在链接上下文中）
   - 正则提取文档内所有标题和 `id="..."` 属性
   - 按前缀过滤返回 Completion[]
3. 注册 `autocompletion({ override: [anchorCompletions] })` 扩展

**验证**：手动在 dev 中输入 `#` 检查补全列表。

---

### 任务 7：测试

**文件**：`tests/markdownRender.test.ts`

补充测试：
- `[[笔记名]]` 渲染为 `<a data-wikilink>` 标签
- `[[路径|显示名]]` 渲染正确
- 标题渲染带 `id` 属性
- `slugify` 函数正确性

**验证**：`npm test` 通过。

---

### 任务 8：文档同步

1. `CHANGELOG.md`：在 `[未发布]` 段新增双链和锚点功能
2. `requirements/index.md`：更新状态

---

## 执行顺序

任务 1 → 任务 2 → 任务 3 → 任务 4 → 任务 5 → 任务 6 → 任务 7 → 任务 8

任务 1 和 2 可并行（无依赖）。任务 3 依赖任务 1（共用 slugify）。任务 4 和 5 依赖任务 2 和 3。任务 6 依赖任务 1。

## 验证命令

```bash
npm run typecheck    # 每个任务完成后
npm test             # 任务 7 完成后
```
