# 双链 P1 + 页内锚点 + 锚点补全设计

> 状态：**已实施**——P1 随 v0.4.0 发布（双链渲染 / 锚点跳转 / 锚点补全）；编辑器 `[[` 笔记路径补全（原 P2）已随 P1 一并实现，v0.4.1 修复路径形式双链解析，wiki-link-p2 分支增强「选中补全自动闭合 `]]`」。
> 关联：FR-2.4（笔记编辑器）；FR-2.4.8（链接跳转，扩展双链和锚点支持）
> 涉及代码：`src/renderer/src/lib/markdown.ts`、`src/renderer/src/components/MarkdownPreview.vue`、`src/renderer/src/components/MarkdownEditor.vue`、`src/main/services/fsTree.ts`、`src/main/ipc/registerIpc.ts`、`src/shared/api.ts`、`src/preload/index.ts`
> 设计决策：双链按名称全局匹配（同名取第一个）；锚点复用 markdown 自动生成的标题 id；锚点补全从文档内容提取。

---

## 1. 双链 P1：`[[笔记名]]` 预览可点击

### 1.1 渲染管道

```
markdown-it inline rule [[name]]
  → <a data-wikilink="name" href="name.md">name</a>
    → rewriteInternalLinks 识别 data-wikilink，调用 resolveByName 设置 data-internal
      → 断链校验 watcher 自动检测（复用已有管道）
```

### 1.2 markdown-it inline rule

在 `lib/markdown.ts` 新增 `md.inline.ruler.push('wikilink', ...)`：

- 匹配 `[[...]]` 语法（不含嵌套 `]]`）
- 提取显示名（允许 `[[path|显示名]]` 格式，Obsidian 惯例；无 `|` 时显示名 = 路径）
- 生成 `<a data-wikilink="name" href="name.md">显示名</a>`
- `href` 设为 `name.md` 供 `rewriteInternalLinks` 统一处理

### 1.3 `rewriteInternalLinks` 扩展

当前逻辑只处理 `.md` 结尾的相对路径链接。扩展后：

- 识别 `data-wikilink` 属性的链接
- 从 `data-wikilink` 值获取笔记名
- 调用新增 IPC `note:resolveByName(vault, name)` 解析为库内路径
- 设置 `data-internal` 属性（值为解析后的库内路径）
- 已有断链校验 watcher 自动接管

### 1.4 新增 IPC：`note:resolveByName`

```typescript
// shared/api.ts
resolveByName(vault: string, name: string): Promise<OpResult & { path?: string }>
```

主进程 `FsTreeService.resolveByName`：遍历 `scan()` 结果，递归查找 `noteDisplayName` 大小写不敏感匹配的笔记，返回第一个匹配的库内相对路径。~20 行。

---

## 2. 页内锚点跳转

### 2.1 `rewriteInternalLinks` 改动

移除 `decoded.startsWith('#')` 的跳过逻辑。纯锚点链接（`#anchor`）也打上 `data-internal` 属性，值为 `#anchor`。

### 2.2 `onPreviewClick` 改动

在 `data-internal` 处理分支中新增锚点判断：

```typescript
if (internal.startsWith('#')) {
  const anchorId = decodeURIComponent(internal.slice(1))
  const target = rootRef.value?.querySelector(`[id="${CSS.escape(anchorId)}"]`)
  if (target) target.scrollIntoView({ behavior: 'smooth' })
  else ElMessage.warning(`锚点不存在：${anchorId}`)
  return
}
```

### 2.3 标题 id 生成

markdown-it **不**默认为标题生成 `id`。需要自定义 heading 渲染器注入 `id` 属性。

在 `lib/markdown.ts` 新增 `md.renderer.rules.heading_open` 自定义渲染器：
- 从 heading token 的 children 中提取纯文本
- 通过 `slugify(text)` 生成 id
- 注入 `id` 属性到 `<h1>`~`<h6>` 标签
- 与现有 `trace_source_line` ruler 注入的 `data-source-line` 兼容

```typescript
const slugify = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '')
```

去重逻辑：同文档内同名标题追加 `-1`、`-2` 后缀（在渲染时维护 seen set）。

---

## 3. 锚点自动补全

### 3.1 CodeMirror CompletionSource

在 `MarkdownEditor.vue` 新增 `autocompletion` 扩展：

```typescript
autocompletion({
  override: [anchorCompletions]
})
```

`anchorCompletions(context)`：
1. 检查光标前是否为 `#`（且在链接上下文中 `[text](#` 或 `[[note#`）
2. 从编辑器文档提取所有锚点：
   - markdown 标题：正则 `/^(#{1,6})\s+(.+)$/gm` → 生成 `id`（与 markdown-it 一致的 slug 规则）
   - 自定义 id：正则 `/id="([^"]+)"/g`
3. 按输入前缀过滤，返回 `Completion[]`

### 3.2 slug 规则

`slugify(text)` 函数（与标题 id 生成共用）：
- 转小写
- 空格 → `-`
- 移除非字母数字字符（保留中文）
- 去重时追加 `-1`、`-2` 等后缀

实现：~10 行的 `slugify` 函数，~20 行的 heading 渲染器。

---

## 4. 校验规则汇总

| 场景 | 处理方式 |
|------|---------|
| `[[笔记名]]` 匹配到笔记 | 设置 `data-internal`，点击跳转 |
| `[[笔记名]]` 未匹配到 | 断链校验 watcher 标记 `data-broken`，删除线样式 |
| `[[笔记名]]` 同名多笔记 | 取第一个匹配，控制台 warn |
| `#anchor` 锚点存在 | `scrollIntoView` 平滑滚动 |
| `#anchor` 锚点不存在 | toast 提示「锚点不存在」 |
| 补全无匹配项 | 不显示补全列表 |

---

## 5. 测试

### markdown-it 双链渲染（`tests/markdownRender.test.ts`）

- `[[笔记名]]` 渲染为 `<a data-wikilink>` 标签
- `[[路径|显示名]]` 渲染正确
- `[[笔记名]]` 不被 DOMPurify 净化移除（`data-*` 属性默认保留）

### 锚点补全（手动验证）

- 输入 `#` 后触发补全，显示文档内标题 id
- 选中后正确插入

---

## 6. 已知局限

- 同名笔记只取第一个匹配，不做消歧（P3 时加 UI 消歧）
- 仅改写 `[[双链]]` 语法，不处理其他笔记中引用被移动文件的路径（已由移动功能的引用改写覆盖部分场景）
- 标题 id 的 slug 规则由项目内 `slugify` 函数统一生成，markdown-it 渲染器和编辑器补全共用
