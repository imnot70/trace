# 双链 P1 + 页内锚点 + 锚点补全设计

> 状态：**已实施**——P1 随 v0.4.0 发布（双链渲染 / 锚点跳转 / 锚点补全）；编辑器 `[[` 笔记路径补全（原 P2）已随 P1 一并实现，v0.4.1 修复路径形式双链解析，wiki-link-p2 分支增强「选中补全自动闭合 `]]`」；**P3 已随 v0.4.4 发布**（反向链接 / 断链引用 / 重命名改写，见第 7 节）；**v0.4.5 追加**：反向链接点击定位到引用行、同名双链消歧。
> 关联：FR-2.4（笔记编辑器）；FR-2.4.8（链接跳转，扩展双链和锚点支持）；FR-2.4.11.1 / FR-2.4.11.2（双链反向链接与改写）
> 涉及代码：`src/renderer/src/lib/markdown.ts`、`src/renderer/src/components/MarkdownPreview.vue`、`src/renderer/src/components/MarkdownEditor.vue`、`src/main/services/fsTree.ts`、`src/main/services/wikilink.ts`（P3）、`src/main/ipc/registerIpc.ts`、`src/shared/api.ts`、`src/preload/index.ts`
> 设计决策：双链按名称在库内匹配（同名取第一个）；锚点复用 markdown 自动生成的标题 id；锚点补全从文档内容提取。

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
| `[[笔记名]]` 同名多笔记 | 点击弹候选列表消歧（标题 + 完整路径）；data-internal 默认取第一个匹配 |
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

- ~~同名笔记只取第一个匹配，不做消歧（P3 时加 UI 消歧）~~（已实现：点击同名双链弹候选列表选择跳转，唯一匹配直接打开）
- 仅改写 `[[双链]]` 语法，不处理其他笔记中引用被移动文件的路径（已由移动功能的引用改写覆盖部分场景）
- 标题 id 的 slug 规则由项目内 `slugify` 函数统一生成，markdown-it 渲染器和编辑器补全共用

---

## 7. 双链 P3：反向链接 / 断链引用 / 重命名改写（已实施待发版）

### 7.1 架构

```
chokidar 监听（含应用内保存 / 外部编辑 / 删除 / 还原）
  → WatcherService 防抖聚合（400ms）
    → WikilinkService.updateFileIndex（单文件增量，删除按文件不存在处理）
    → fs:changed → 渲染进程（反向链接弹层 / 侧栏断链计数延迟一拍刷新）
git 同步 / 自动同步挂起期间丢弃的事件 → resume 后 buildIndex(true) 全量重建
重命名 → fsTree.renameNode 改写库内 [[旧名]] + WikilinkService.renameNoteInIndex 迁移索引
```

`WikilinkService`（`src/main/services/wikilink.ts`）维护三张表：

- `forwardIndex: Map<vault:path, WikilinkEntry[]>`——每个笔记的引用列表；
- `reverseIndex: Map<叶子名, Set<detailKey>>`——被引用方的反向索引；
- `refDetails: Map<vault:path:idx, BacklinkRef>`——引用详情（snippet 高亮用）。

IPC：`wikilink:backlinks / unresolved / rebuildIndex / getIndexStatus`。

### 7.2 关键语义（首版实现缺陷的修正）

| 决策 | 内容 |
| --- | --- |
| 索引按叶子名归属 | `[[子目录/笔记C]]` 与 `[[笔记C]]` 同样计入对「笔记C」的引用，与预览解析（先完整路径后叶子名）一致；路径形式双链不误报断链 |
| 引用详情按行内序号存取 | detailKey 形如 `vault:path:idx`（原按行号，同一行多个引用互相覆盖） |
| 反向链接限同库 | 双链只在库内解析（`resolveByName`），跨库同名引用不计入 |
| 索引活性 | 文件监听驱动增量更新（首版只在启动时构建一次，运行期永不变更是面板「显示有 bug」被隐藏的根因）；git 同步挂起期丢弃的变更在 resume 后全量重建补偿 |
| 面板形态 | 编辑卡右下角悬浮胶囊入口 + 弹层（首版为占布局的底部折叠条，会把编辑区压得比左右卡片短，与三栏卡片布局冲突后改为悬浮式）；无引用时不渲染；`Esc` / 点击外部 / 切换笔记收起；弹层列表仅显示来源笔记标题（首版含引用片段，但点击跳转并不定位到引用点，片段失去上下文意义，已移除）；同一笔记的多次引用合并为一条（定位取首个引用行）；点击跳转并居中定位到引用行；受设置 → 通用 → 编辑器 →「显示反向链接」开关控制 |

### 7.3 测试

`tests/wikilink.test.ts` 12 项：索引构建统计、同名 / 路径形式 / 自身引用、同行多引用、断链检测（含按库过滤）、增量更新（新增 / 修改 / 删除 / 直接移除）、重命名迁移索引无幽灵条目。
