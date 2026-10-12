# 正文内联 #标签 — 技术设计（FR-2.6.18）

> 2026-10-12 立项当日设计并实施。需求见 [inline-body-tags.md](inline-body-tags.md)；实施与验证记录见第 5 节。

## 1. 决策记录

### D1 核心模型：只读识别（用户拍板 2026-10-12）

三选一：**A 只读识别**（正文标签参与渲染 / 计数 / 筛选，增删仍走 frontmatter 管理入口）｜B 双真源（正文编辑即增删，估 5–8 天，删除语义模糊）｜C 点击认领（胶囊点击才写入 frontmatter，交互多一步且两态不一致）。拍板 **A**——零数据风险，「正文是用，frontmatter 是管」。

### D2 聚合口径：全部包含（用户拍板 2026-10-12)

侧栏计数 / AND·OR 筛选 / 搜索标签维度 = frontmatter ∪ 正文并集。「仅渲染不计数」被否——闭环不完整易困惑。

### D3 本期范围：完整闭环（用户拍板 2026-10-12）

预览 + 所见即所得两路高亮、点击跳筛选、聚合并集。「闭环 + 改名扫正文」的加项**以必要化方式并入**（见 D4）。

### D4 改名 / 合并 / 删除必须扫正文（实施中发现的正确性硬约束）

聚合层对未见过的标签会**自动注册定义**（`ensureDefinition`，「外部工具写的标签可见可用」哲学延伸到正文标签——否则正文标签无定义、侧栏根本不显示，D2 落空）。由此推出：改名 / 合并 / 删除若只改 frontmatter，正文残留的 `#旧名` 会在下一次聚合扫描时把旧标签**自动注册回定义表**（僵尸标签复活）。故正文扫写不是可选项，而是并集模型的闭环正确性要求——原「+0.5 天可选项」按必要项并入本期（实现挂在既有 `rewriteNotes` / `mergeTags` 的同一趟全库扫描上，边际成本小）。

### D5 渲染介入层：markdown-it core 规则（非 inline 规则）

`#` 不是 markdown-it text 规则的终止符，text 会把 `#标签` 连同前后文字吞进一个 text token——仿 `wikilink` 的 `inline.ruler.push` 方案**收不到**（`[[` 能工作是因为 `[` 是终止符）。改走 core 规则（`trace_task_lists` 先例）：遍历 inline token 的 children，只处理 `text` 型 child——`code_inline` / `fence` / `html_block` 是独立 token 类型天然被排除；按识别正则切分 text child，注入 `html_inline`（`<span class="md-inline-tag">`）。DOMPurify 默认放行 span / class / data-*（任务复选框同路径），净化层零改动。

### D6 所见即所得：mark 装饰而非 replace widget（IME 安全）

双链用 replace widget（`WikilinkWidget`），但正文标签在**组词期**会被正则渐进匹配（拼音 `#lv`you 即命中）——replace widget 会替换 DOM 结构，正是「不要用 CM 装饰介入组词行渲染」教训的高危形态。改用 **mark 装饰**（`Decoration.mark`，只加样式 span、不动文本节点），与强调加粗同机制；点击走 `clickHandler` 的 `findTarget` 模式（新增 `kind: 'tag'` 的 ClickTarget），不建 widget。真机 IME 验证仍列入清单。

## 2. 架构

```
shared/noteTags.ts            ← 单一定义源：BODY_TAG_RE / getBodyTags / rewriteBodyTag
  │
  ├─ main: TagsService        ← tagStats / notesByTag(s) 换并集口径（同一趟 walkNotes 多一个正则）
  │                            ← renameTag / deleteTag / mergeTags 扫写正文（D4）
  ├─ main: SearchService      ← 索引项 tags = fm ∪ 正文（matchesTags / listTags 自动跟随）
  │
  └─ renderer:
      ├─ lib/markdown.ts      ← core 规则 trace_inline_tags（D5）→ <span class="md-inline-tag">
      ├─ MarkdownPreview.vue  ← onPreviewClick 加 .md-inline-tag 委托分支 → jumpToTagFilter
      ├─ lib/tagFilter.ts     ← 新：按名跳筛选（定义缺失时 tag:create 自动注册）+ 多选 toggle
      │                          （NoteInfoDialog.filterByTag 同款逻辑收敛到此，两处共用）
      └─ lib/livePreview/     ← decorations.ts：正文行正则扫描（排除 frontmatter / codeRanges / mathRanges）
                               → mark 装饰 + ClickTarget{kind:'tag'}
                               index.ts：clickHandler 加 tag 分支；lpTheme 加 .lp-inline-tag 样式
                               MarkdownEditor.vue：LivePreviewConfig 注入 filterByTag
```

**零新增 IPC**——聚合走既有 `tag:stats` / `tag:byTag` / `tag:byTags` / `search:*`，跳转是纯渲染端动作（`app.view` 赋值）。

## 3. 关键实现口径

### 3.1 识别正则（单一定义源）

```ts
// shared/noteTags.ts
export const BODY_TAG_RE = /(?<![\p{L}\p{N}_#&/-])#([\p{L}\p{N}_-]{1,64})/gu
```

- lookbehind 排除：字母数字下划线（`C#5`、`abc#d`）、`#`（`##标题` 与连续标签）、`&`（`&#123;` 实体）、`/`（URL 片段 `x.com/#a`、路径 `a/b#c`）；
- 名称截尾：`[-_]+$` 截除后为空则跳过；归一：`toLowerCase()`（与 tagStats / findByName 既有口径一致）；
- 行级扫描前置：stripFrontmatter → 围栏状态机（``` / ~~~，含闭合行）→ 行内码 `` `…` `` 掩码（识别用；重写时另算行内码区间避开，不动代码内容）。

### 3.2 聚合并集（tags.ts）

- `tagStats()` / `notesByTag()` / `notesByTags()`：每篇笔记 `noteTagUnion = fm ∪ body`（篇内大小写不敏感去重），其余口径（计数 = 篇数、lastUsed = mtime、AND/OR 判定）不变；
- **正文标签自动注册定义**：`tagStats()` 聚合时对无定义的正文标签 `ensureDefinition`（`noteTags()` 对 frontmatter 标签的既有做法）。放在 tagStats（侧栏计数的同一数据源）而非各处——一次注册、处处可见。

### 3.3 正文扫写（rewriteNotes / mergeTags）

- `renameTag` / `deleteTag` → `rewriteNotes(old, new|null)`：在既有 frontmatter 改写之外，同趟调 `rewriteBodyTag(content, oldLower, new|null)`；
- `mergeTags`：同趟加 `rewriteBodyTag(content, srcLower, target.name)`（与 frontmatter 补写目标名同语义）；
- 删除 = `newName: null` → 正文 `#旧名` 整体移除（含前导 `#`，标签名按识别正则的完整匹配范围）；确认弹窗文案不改（既有「从所有笔记中移除」语义已覆盖）。

### 3.4 预览渲染（markdown.ts）

core 规则 `trace_inline_tags`（D5）注入 `<span class="md-inline-tag">#旅行</span>`；样式落 `markdown.css`（与 frontmatter 胶囊同款视觉语言：标签定义色圆点 + 胶囊底）。**点击**：`onPreviewClick` 委托加 `.md-inline-tag` 分支（置于 `<a>` 判断之前）→ `jumpToTagFilter(name)`。悬浮预览（FloatingPreview / lpTheme 渲染）共用 markdown 管道，自动同款。

### 3.5 所见即所得（livePreview）

- `decorations.ts`：新增正文标签扫描段（与双链 / 行内公式同区），排除 frontmatter 区间 / `codeRanges` / `mathRanges` / 双链区间，产出 `Decoration.mark({ class: 'lp-inline-tag' })` + `targets.push({ kind: 'tag', from, to, name })`；
- `index.ts`：`ClickTarget` 联合加 `kind: 'tag'`；clickHandler 加分支 `cfg.filterByTag(target.name)`（Ctrl/Cmd 触发，Alt 预览不适用——标签无预览语义）；lpTheme 加 `.lp-inline-tag`（胶囊样式，颜色从 cfg.tagColors 取定义色，无定义走中性色）；
- `LivePreviewConfig` 加 `filterByTag: (name: string) => void`，MarkdownEditor.vue 注入（实现即 `jumpToTagFilter`）。

### 3.6 跳转（lib/tagFilter.ts，新）

```ts
export async function jumpToTagFilter(name: string): Promise<void>
```

按名找定义（大小写不敏感）→ 缺失时 `window.trace.createTag(name, pickTagColor(name))` + `tree.loadTags()` → 多选 toggle 语义进标签网格（`NoteInfoDialog.filterByTag` 原逻辑收敛至此，该弹窗改为调用本函数）。

## 4. 测试口径

- 单测（`tests/noteTags.test.ts` 扩 + `tests/services.test.ts` 或新文件）：识别正则边界（中英文 / 截尾 / 排除六类 / 围栏 / 行内码 / frontmatter）、getBodyTags 去重归一、rewriteBodyTag（改名 / 删除 / 代码不动 / YAML 区不动）、tagStats / notesByTags 并集、改名后正文同步且无僵尸复活；
- CDP 冒烟：预览胶囊渲染与点击跳转、所见即所得高亮与 Ctrl+Click、组词场景留真机。

## 5. 实施与验证记录

（2026-10-12 立项当日实施，分支 `feat/inline-body-tags`）

**实施**：按 §2 架构落地——`shared/noteTags.ts` 新增 `BODY_TAG_RE`（前 lookbehind + 后 lookahead 边界，上限 64）/ `getBodyTags` / `getNoteTags` / `rewriteBodyTag`（单一定义源）；`tags.ts` 聚合三方法换并集口径 + `tagStats` 扫描后对正文来源未登记标签 `ensureDefinition` + `rewriteNotes` / `mergeTags` 同趟正文扫写（D4）；`search.ts` 索引项 tags 换 `getNoteTags`（matchesTags / listTags 自动跟随，零接口变化）；`markdown.ts` core 规则 `trace_inline_tags`（D5，相邻 text child 带前一字符提供 lookbehind 上下文）+ `rewriteInlineTagColors` 净化后着色；`markdown.css` `.md-inline-tag`（`--tag-c` 变量，未登记中性回退）；`lib/tagFilter.ts` 新建 `jumpToTagFilter`（多选 toggle 语义，NoteInfoDialog 胶囊点击收敛至此）；livePreview mark 装饰 + `ClickTarget{kind:'tag'}` + clickHandler 分支 + `lpTheme` + `LivePreviewConfig.filterByTag`。

**实施中的两个决策修正与附带修复**（冒烟发现）：

1. **`TagsService.collectNoteRefs` 鲁棒性**（既有缺陷，冒烟暴露）：注册表含指向已删除目录的陈旧库时（外部库被移除 / U 盘拔出同场景，FR-2.1.4 遗留风险），`listTree` ENOENT 令 `tagStats` 整体挂掉返回空——标签系统全灭。修为逐库 try/catch 跳过 + logger.warn，补单测。此前 search / wikilink 索引各用容错的文件遍历所以未暴露。
2. **`jumpToTagFilter` 快照滞后恢复**：渲染端 `tree.tags` 快照滞后于主进程（正文标签聚合扫描自动注册的定义不在快照里）时，`createTag` 返回「标签名已存在」会导致直接放弃不导航。修为失败路径刷新快照重查。

**门禁**：单测 +28（noteTags 13 识别/重写边界、services 5 聚合与扫写含不可读库跳过、markdownRender 6 渲染与净化、livePreview 2 装饰与排除；修正测试中 2 处用例错误 + 1 处实现缺陷——64 上限需后向 lookahead 否则 65 字符串截出假标签）；全仓 613 项（607 过 + gitService 6 项 Windows 超时假红，90s 口径 8/8 全绿）；typecheck / lint 干净。

**CDP 冒烟（隔离实例，10 项全过）**：建库建笔记 → 聚合并集（tagStats 含「旅行：1」）→ 定义自动注册 → 搜索标签下拉含正文标签 → 侧栏开笔记 → Ctrl+E 所见即所得 mark 装饰（`#旅行` `#未登记`）→ Alt+P 悬浮预览胶囊 + data-tag → 点击胶囊跳标签筛选（`.tag-row.active` 高亮验证导航）→ 快照刷新（侧栏标签行出现正文标签）→ 重载后胶囊定义色注入（`--tag-c`）。

**遗留（真机验证清单，待办 #23）**：① 真实输入法组词期输入 `#标签`（mark 装饰组词安全，微软拼音 / 五笔）；② 深浅色 × 四预设下胶囊观感；③ 标签改名 / 合并 / 删除对含正文标签笔记的实际改写效果（git diff 检查）；④ Ctrl+Click 手感。
