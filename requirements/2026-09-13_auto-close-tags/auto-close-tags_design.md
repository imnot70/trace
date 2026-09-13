# 编辑器 HTML 标签自动闭合

## 问题

用户在 markdown 编辑器中写 HTML 时（如 `<div>`），不会自动生成闭合标签（`</div>`），需要手动输入。

## 方案

改动 1 个文件：`src/renderer/src/components/MarkdownEditor.vue`。

### 实现

在 `createView()` 的 extensions 中新增一个 `EditorView.inputHandler`：

1. 监听 `>` 输入
2. 向前扫描光标前文本，匹配 `<tagName` 模式（支持带属性，如 `<div class="x"`）
3. 提取标签名，检查是否是自闭合标签
4. 非自闭合 → 插入 `</tagName>`，光标留在 `>` 和 `</tagName>` 之间
5. 自闭合或匹配不到 → 不处理，放行默认行为

### 自闭合标签列表

`area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`, `param`, `source`, `track`, `wbr`

### 行为示例

| 输入 | 结果 | 光标位置 |
|------|------|----------|
| `<div>` | `<div></div>` | `<div>|</div>` |
| `<div class="x">` | `<div class="x"></div>` | `<div class="x">|</div>` |
| `<br>` | `<br>` | 不闭合 |
| 代码块内 `>` | 不触发 | markdown parser 区分 HTML 和代码块 |

## 不做的事

- 不安装 `@codemirror/lang-html`（`autoCloseTags` 内部检查 `htmlLanguage.isActiveAt()`，在 markdown 模式下不生效）
- 不处理 `</` 自动补全标签名（YAGNI）
- 不在代码块内触发
