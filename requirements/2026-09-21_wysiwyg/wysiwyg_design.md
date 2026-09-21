# 所见即所得（Live Preview）技术设计

> 创建：2026-09-21 ｜ 状态：**设计完成，待实施** ｜ 需求见 [wysiwyg.md](wysiwyg.md)
> 分支：`feature/wysiwyg-editor`

## 1. 总体方案

**一句话**：基于 CodeMirror 6 现有 `@codemirror/lang-markdown` 的 Lezer 语法树，新增一个 ViewPlugin 计算装饰集（Decoration）——非光标区把语法标记隐藏/替换为渲染内容，光标落入的节点回落显示源码。**文档内容全程不变，磁盘始终是纯 markdown**。

```
MarkdownEditor.vue
  ├─ basicSetup + markdown()（现状不动）
  ├─ livePreview Compartment ←→ app store: editorWysiwyg（运行态开关）
  │    └─ ViewPlugin: buildDecorations(view)
  │         ├─ 语法树节点遍历（仅 view.visibleRanges）
  │         ├─ 行内样式类（lp-*，复用 markdown.css 设计语言）
  │         ├─ 标记隐藏（Decoration.replace，如 **、#、`）
  │         └─ 渲染 Widget（复用 md.render / DOMPurify / katex / 既有 CSS）
  └─ EditorView.vue：模式切换时分栏联动（收起/恢复预览）
```

## 2. 决策记录

| # | 决策点 | 结论 | 理由与备选 |
| --- | --- | --- | --- |
| D1 | 装饰实现路线 | **自研 ViewPlugin 遍历 Lezer 语法树**，不引入第三方 live-preview 库 | lang-markdown 的 `markdownLanguage` 已含 GFM 扩展（表格/删除线/任务标记/自动链接），语法树节点齐全；社区无维护良好的通用 live-preview 包，自研量可控（一个 decorations 模块 + 一组 Widget 类）。备选 TipTap/ProseMirror 已在需求阶段否决 |
| D2 | 渲染复用边界 | **块级替换类节点直接复用 markdown-it 管道**（表格/HTML 块经 `md.render` 出 HTML，与预览逐字节一致）；**行内类用 CSS 样式类**复用 `markdown.css` 设计语言；公式用 `katex.renderToString`（同预览参数，CSS 已全局引入）；**净化函数从 MarkdownPreview 抽到 `lib/markdown.ts` 三处共用** | 消灭「两套渲染」心智；顺手收敛现有 MarkdownPreview 与 noteExportHtml 的重复净化配置 |
| D3 | 光标回落规则 | selection 与节点区间**相交** → 该节点本次不装饰（源码显示）；Widget 区间注册 `EditorView.atomicRanges`（光标不可落入，点击即定位到区间边缘 → 触发回落） | 与 Obsidian 手感一致；实现上只需在遍历时做一次 `rangeoverlap` 判断 |
| D4 | 模式状态 | 持久层 `settings.defaultEditMode: 'source' \| 'wysiwyg'`（唯一新设置项）；运行态 `app store: editorWysiwyg: boolean`；CM 侧用 **Compartment** 挂/摘 livePreview 扩展（不重建 EditorView，滚动光标自然保持） | 打开笔记时按默认模式初始化运行态；切换零重建 |
| D5 | 分栏联动 | EditorView `watch(editorWysiwyg)`：进入时记忆 `previewVisible` 原值并置 false；退出恢复原值。联动期间：预览开关按钮置灰、Alt+V no-op（提示一次性 ElMessage 可选）；**悬浮预览、专注模式不受影响** | 需求 D2；复用现有 `app.previewVisible` 单一状态源，不新增第二套分栏状态 |
| D6 | 性能与 IME | 装饰只在 `view.visibleRanges` 内计算（随视口增量重建）；Widget HTML 按**源文本**做 LRU 缓存（上限 200 条）；`view.composing`（中文输入法组词中）期间**冻结装饰集**直接复用上一份 | 中文输入是主场景，组词中重排装饰会导致候选框错位/乱跳（Obsidian 早期著名 bug）；LRU 防 KaTeX 重复渲染 |

## 3. 节点 → 装饰映射表

> 节点名以 `@lezer/markdown` 实际输出为准，实施首日用 `syntaxTree(state).toString()` 对样例文档核对一次并修正本表。

| 语法树节点 | 装饰方式 | 渲染效果 |
| --- | --- | --- |
| `ATXHeading1..6` / `SetextHeading1..2` | 整行 `mark` 类 `lp-heading lp-h1..6`；光标不在行内时 `replace` 隐藏行首 `#+ ` 标记 | 预览同款字号/字重（CSS 变量） |
| `StrongEmphasis` | 两端标记符 `replace` + 内部 `mark` 类 `lp-strong` | **加粗** |
| `Emphasis` | 同上，`lp-em` | *斜体* |
| `Strikethrough` | 同上，`lp-strike` | ~~删除线~~ |
| `InlineCode` | 反引号 `replace` + 内部 `mark` 类 `lp-inline-code` | 行内代码底色 + 等宽 |
| `Link` | 隐藏 `[` 与 `](url)` 两段，文本 `mark` 类 `lp-link`；Ctrl+Click 打开（复用预览跳转逻辑，抽共享 helper） | 链接色文字，URL 隐藏 |
| `Image` | 光标不在行内时整节点 `replace` + Widget `<img>`（src 解析复用预览的 `trace-vault://` 改写，抽共享 helper）；失败回退显示 alt 文本 | 内联图片 |
| `Wikilink`（自定义正则定位 `[[...]]`，Lezer 无此节点） | 整节点 `replace` + Widget：可解析显示笔记名（链接色）/不可解析加断链删除线；Ctrl+Click 打开、同名多义走既有消歧弹层 | 双链胶囊 |
| `TaskMarker`（`[ ]` / `[x]`） | `replace` + 可交互 CheckboxWidget（复用 `.task-item-checkbox` 样式），点击 dispatch 文本替换 `[ ]`↔`[x]` → 走正常保存流程 | 可勾选复选框 |
| `BulletList` / `OrderedList` / `Blockquote` | **标记符保留可见**（`-`/`1.`/`>`），仅容器行加 `mark` 类（引用左边框+底色） | 结构样式化，v1 不藏标记（降实现风险） |
| `FencedCode` | **不替换**：`markdown({ codeLanguages })` 的嵌套解析已在编辑器内提供语法高亮（现状即有），仅加 `lp-fence` 背景类贴齐预览观感 | 源码 + 高亮 + 底色 |
| 行内 `$...$` / 块级 `$$...$$`（正则定位，Lezer 无公式节点） | `replace` + MathWidget：`katex.renderToString(src, { throwOnError: false, output: 'html' })`（同 texmath 参数），渲染失败回退源码 | KaTeX 公式 |
| `Table`（GFM） | 光标不在块内时整块 `replace({block: true})` + Widget：**取该块源文本经 `md.render`** 渲染（与预览同 HTML 同类名）；光标进入回落源码编辑 | 真表格 |
| `HTMLBlock` | 同表格：整块 `replace({block: true})` + Widget 经 `sanitizeHtml(md.render(src))`（与预览同一套收紧白名单） | 净化后 HTML 效果 |
| `HorizontalRule` | `replace` + `<hr>` Widget（预览同款样式） | 分隔线 |
| frontmatter（文档开头 `---...---`，Lezer 不解析，StateField 正则定位） | 整块 `replace({block: true})` + FrontmatterWidget：一行摘要（标签名取自 `shared/noteTags.ts` 的 `getFrontmatterTags`）；无闭合 `---` 时不装饰（容错） | 折叠一行 |

## 4. 模块与文件布局

```
src/renderer/src/
├─ lib/
│  ├─ markdown.ts              # +导出 sanitizeHtml(html)（DOMPurify 收紧配置从 MarkdownPreview 抽来，
│  │                           #   MarkdownPreview / noteExportHtml / Widget 三处共用——消重）
│  └─ livePreview/
│     ├─ decorations.ts        # buildDecorations(view): DecorationSet（纯逻辑，可单测）
│     ├─ widgets.ts            # Widget 类（Checkbox/Math/Image/HtmlBlock/Table/Hr/Wikilink/Frontmatter）
│     └─ index.ts              # livePreview() 扩展工厂（ViewPlugin + theme + atomicRanges + 样式）
├─ components/
│  ├─ MarkdownEditor.vue       # +prop wysiwyg:boolean；Compartment 挂载；导出 setMode
│  └─ MarkdownPreview.vue      # 改用共享 sanitizeHtml（行为不变）
├─ views/
│  ├─ EditorView.vue           # watch(editorWysiwyg) 分栏联动 + 顶栏切换按钮
│  └─ SettingsView.vue         # 设置 → 编辑器：默认编辑模式选择
├─ stores/app.ts               # +editorWysiwyg 运行态
└─ config/shortcuts.ts         # +Ctrl+E 登记
src/shared/types.ts            # +defaultEditMode 设置项（settingsService 同步补默认值）
src/main/services/settings.ts  # 默认值 'source'
tests/livePreview.test.ts      # 新增单测（jsdom）
```

## 5. 交互细节

- **Ctrl+E**：注册在 App.vue 全局 `onGlobalKeydown`（仅编辑视图生效）；CM keymap **不绑**，避免双触发；`shortcuts.ts` 速查表登记。
- **切换保持**：模式切换只变装饰、不变文档与 selection，光标/滚动天然保持（验收项 1）。
- **任务勾选**：CheckboxWidget 点击 → `view.dispatch` 替换源码两字符 → 既有 1s 防抖自动保存接管；撤销（Ctrl+Z）可直接回退。
- **打开链接/双链**：Ctrl+Click；普通点击落在 Widget（atomic）上时光标定位到区间边缘、节点回落源码——先编辑后跳转的语义。
- **frontmatter**：光标进入展开源码；标签增删仍走侧栏既有入口（不新增 frontmatter 编辑 UI）。
- **撤销/重做、Ctrl+S、格式化快捷键、插件工具栏按钮**：全部作用在源码层，无需感知模式（零适配）。

## 6. 性能与边界情况

| 项 | 策略 |
| --- | --- |
| 装饰重建时机 | `update.docChanged \|\| update.selectionSet \|\| update.viewportChanged` 三条件；仅遍历 `visibleRanges` |
| 长笔记 | 语法树由 Lezer 增量维护；5000 行样例验收切换/输入无可感知卡顿 |
| KaTeX / 表格 / HTML 重复渲染 | LRU 缓存按源文本键（200 条），文档变更靠文本失配自然失效 |
| **中文输入法组词** | `view.composing === true` 期间返回上一份 DecorationSet（冻结），组词结束（compositionend 后首个 update）再重建 |
| 嵌套结构 | 遍历时跳过「已被更外层装饰吞掉」的节点（表格/HTML 块内部不再处理行内节点） |
| 行内码/链接内光标 | 相交回落规则天然覆盖；0 宽区间（光标贴边）按相交处理，宁可多显示源码不丢字符 |
| 删除/退格 | atomicRanges 下 Backspace 一次吃掉整个隐藏标记段（与 Obsidian 一致，可接受） |
| 无效公式 / 非法 HTML | KaTeX `throwOnError: false` 出错红字回退源码；净化白名单与预览完全一致 |
| 图片加载失败 | Widget onerror 回退显示 `![alt]` 源码形态 |

## 7. 测试计划

- `tests/livePreview.test.ts`（jsdom，Vitest）：
  - 映射表逐节点：构造样例文档断言 DecorationSet（隐藏区间 / mark 类 / widget 存在）；
  - 光标相交回落：光标置于节点内 → 该节点无装饰；
  - 任务勾选写回：点击 → 文本 `[ ]`↔`[x]`；
  - frontmatter：有/无闭合 `---` 两分支；
  - `sanitizeHtml` 与 MarkdownPreview 净化一致（共用后单测合一）；
  - LRU 缓存命中（同源文本二次渲染不重复计算）。
- 回归：现有 247 项单测全绿；MarkdownPreview 净化重构后渲染/净化 8 项单测保持通过。

## 8. 实施拆分

| 批次 | 内容 | 验收 |
| --- | --- | --- |
| B1 骨架 | livePreview 模块 + Compartment 切换 + 基础行内装饰（标题/粗斜/删除线/行内码/链接）+ Ctrl+E + 分栏联动 | 需求验收 1/2/3 |
| B2 渲染增强 | 公式 / 表格 / HTML 块 / frontmatter / 图片 / 任务复选框 / 双链 Widget + sanitizeHtml 抽取 | 需求验收 4/7 |
| B3 收尾 | 设置页默认模式 + shortcuts 登记 + 性能验证（5000 行）+ 单测补齐 + 文档（CHANGELOG/PRD FR/guides/使用说明第 X 节）+ index.md 销账 | 需求验收 5/6/8/9 |

## 9. 风险与对策

| 风险 | 对策 |
| --- | --- |
| Lezer 节点名/边界与假设不符（如表格内部结构） | 实施首日语法树 dump 核对映射表（第 3 节），偏差只影响映射表不影响架构 |
| 装饰与 basicSetup 默认高亮样式叠加冲突 | lp-* 类选择器权重高于默认 HighlightStyle；source 模式完全不受影响 |
| `md.render` 在 Widget 中调用与预览全局状态冲突（headingSeen 等） | md 实例本就单例复用（预览同样多次调用）；heading id 生成对编辑器无影响，无需隔离 |
| block 级 replace 装饰在行折叠（fold gutter）下表现 | 首版验证折叠 + 渲染并存；异常则所见即所得模式下隐藏 fold gutter |
| Ctrl+E 与未来浏览器习惯冲突 | 登记在速查表；如反馈强烈再评估可配置（需求阶段已记录不在首版） |
