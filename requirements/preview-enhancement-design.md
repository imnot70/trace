# 预览增强设计：HTML 内嵌、a 标签跳转、行级同步滚动

> 状态：**设计已确认（2026-09-09，随评估结论一并拍板），实施中** ｜ 起草：2026-09-09（Linux 机）
> 关联：FR-2.4.1（预览形态）；与已排期的「笔记双链 `[[引用]]`」共享内部跳转管道。
> 实施顺序：① HTML 内嵌（含净化）→ ② a 标签跳转 → ③ 同步滚动升级。总计约 2~2.5 人日。

## 1. HTML 内嵌支持（含净化）

### 1.1 需求

笔记中的内嵌 HTML（`<div>`、`<table>`、`<details>` 等）在预览中按 HTML 渲染，而非转义为源码文本。

### 1.2 威胁模型

笔记经 git 同步传播，**他人投毒的笔记会到达用户设备**（克隆库 / 同步被篡改的远端是真实路径），预览即触发渲染，因此必须净化。当前 CSP（`script-src 'self'` + `img-src` 白名单）已拦截：脚本执行（`<script>`、内联事件、`javascript:` 链接）、数据外泄（外部图片探测）、外部 iframe / 媒体。**CSP 拦不住的三个向量**由净化器补位：

| 向量 | 危害 |
| --- | --- |
| `<style>` 注入 | `style-src 'unsafe-inline'`（KaTeX 所需）——恶意 CSS 重排版整个应用窗口做视觉钓鱼 |
| `<base href>` | 劫持全部相对 URL 解析基点 |
| `<form>` | `form-action` 未设置且不回退 default-src——伪造表单提交可导航到钓鱼页 |

### 1.3 方案

1. markdown-it 开启 `html: true`；
2. 渲染输出经 **DOMPurify** 净化后进入 `v-html`：默认配置（白名单模式，剥 `script/style/base/form/事件属性`，保留 `div/span/table/details/summary/img/a/video` 等安全子集与 `style` 属性）；
3. CSP 追加 `form-action 'none'`（双保险）；
4. 现有后处理管道顺序：**KaTeX/高亮渲染（markdown-it）→ DOMPurify 净化 → 图片路径改写（`trace-vault://`）**。改写用正则、在净化后执行，不受净化影响；
5. KaTeX 兼容性：已配 `output: 'html'`（纯 HTML span，无 MathML），DOMPurify 默认保留 class / style 属性，实测验证。

### 1.4 边界

- 净化在渲染进程做（预览的唯一消费方），编辑器源码视图不受影响；
- 悬浮预览（编辑器 + 网格卡片）复用同一 MarkdownPreview 组件，自动获得相同行为；
- `<video>` 等媒体的外部源仍被 CSP 拦截（本地相对路径走 `trace-vault://` 改写，与图片同管道）。

## 2. a 标签跳转

### 2.1 需求

预览中的链接（markdown 语法与原始 HTML 两种来源）可点击：外部链接用系统浏览器打开；指向库内笔记的相对链接直接在 Trace 内打开。

### 2.2 方案

统一在预览容器上做**事件委托**（一个捕获阶段的 click 监听），按 `href` 分类处理：

| href 形态 | 行为 |
| --- | --- |
| `http(s)://…` | `window.open(url, '_blank')` → 主进程 `setWindowOpenHandler` → `shell.openExternal`（现有链路）；补 `rel="noreferrer noopener"` |
| 相对路径 `./xx.md`、`../xx.md`、`xx.md`（含中文与空格的 URL 编码形态） | `resolveRelRef(当前笔记路径, href)` 解析为库内路径 → `window.trace.readNote` 校验存在 → `openNote(vault, path)`；**不存在 = 断链**，阻止默认行为并轻提示，链接渲染为删除线样式（`data-broken` 属性 + CSS） |
| `#锚点`、其他协议 | 本期不处理（页内锚点与双链/大纲一起做），交给浏览器默认（无害） |

- **与 wiki 双链的共享地基**：`解析相对引用 → 校验存在 → openNote` 这套管道即双链 `[[笔记名]]` P1 的落点，本期产出直接复用；
- markdown 语法链接同样被委托覆盖（`link_open` 规则保留，行为一致）；
- 悬浮预览中的内部链接同样可跳转（跳转即关闭悬浮、打开笔记）。

## 3. 同步滚动升级（行级映射，双向）

### 3.1 现状与问题

当前为**单向（编辑器→预览）百分比联动**：监听 CodeMirror 滚动容器，按滚动比例设置预览 scrollTop。缺陷：源码长度 ≠ 渲染高度（图片 / 代码块 / 公式撑开），长文档上下段明显错位；反向（预览→编辑器）不同步。

### 3.2 方案（Typora/VSCode 式行号映射）

**渲染侧**：markdown-it 自定义核心规则（`md.core.ruler.push`），渲染前遍历 token 流，为**顶层块级 token**（heading/paragraph/list/table/fence/blockquote 等，`token.map` 存在且 `hidden` 为假）在 `token.attrSet` 写入 `data-source-line = token.map[0]`（0 基源码行号）。行内 token 与嵌套列表内层不加（查找时取"最近的前驱块"即可）。

**编辑器→预览**：CodeMirror `scroll` 事件中，`view.lineBlockAtHeight(scroller.scrollTop)` 取可视首行行号与像素偏移 → 预览容器内 `querySelectorAll('[data-source-line]')` 缓存为有序数组 → 二分/线性查找 ≤ 该行号的最近块 → `preview.scrollTop = 块.offsetTop - 头部高度 + 块内比例折算`（块内比例 = 行像素偏移 / 行高，处理"一个源行对应超高块"如长代码块）。

**预览→编辑器**：预览 `scroll` 事件中，从 `scrollTop` 找顶部可见的最近块 → 取其 `data-source-line` → `view.dispatch({ effects: EditorView.scrollIntoView(line, { y: 'start' }) })`。

**防回环**：程序化设置对侧滚动会再触发对侧 scroll 事件（A→B→A 死循环）。守卫：时间戳 + 来源标志——程序化滚动前记录 `lastSyncAt = Date.now()` 与方向，对侧 scroll 事件若在 **100ms 内且方向相反**则跳过。用户滚轮 / 拖拽滚动条不受影响（超出守卫窗口）。

**高度异步变化**：图片加载完成（`load` 事件，委托监听）与 KaTeX 排版后触发一次重新对齐（按当前编辑侧行号重设预览位置）；预览内容区挂 `ResizeObserver` 兜底。

### 3.3 边界与已知取舍

- CM6 虚拟渲染下 `lineBlockAtHeight` 只对可视行有效——恰好够用（同步只关心可视首行）；
- `token.map` 对 fence 代码块 / 表格 / 列表整块的行范围覆盖良好；引用块内嵌套列表等复杂结构映射到最近前驱块，误差可接受（±1 块）；
- 拖拽分栏分隔条、切换笔记时重置到顶部（现状保留）；
- 编辑过程中行号持续变化——每次 scroll 事件实时计算，不做缓存失效管理（块级元素随渲染重建）。

## 4. 实施拆分与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| ① HTML 内嵌（~0.5 天） | DOMPurify 依赖 + 净化接线 + CSP `form-action 'none'` | 笔记内 `<div>`/`<table>`/`<details>` 正常渲染；`<script>`/`<style>`/`<base>`/`<form>`/事件属性被剥除（净化单测覆盖恶意样本）；KaTeX / 代码高亮 / 图片不回归 |
| ② a 标签跳转（~0.5 天） | 事件委托 + 外部/内部分流 + 断链样式 | 外部链接走系统浏览器；`<a href="./b.md">` 与 markdown `[x](./b.md)` 都能在应用内打开；断链点击有提示且样式删除线 |
| ③ 同步滚动（~1 天） | source-line 注入 + 双向映射 + 防回环 + 图片加载重对齐 | 长文档（含多图 / 长代码块 / 公式）双向滚动对齐误差 ≤ 1 块；快速交替滚动双向无抖动回环；切换笔记重置顶部 |

测试基线：净化规则单测（恶意样本矩阵）；source-line 注入单测（典型 token 流）；GUI 隔离实例验证全部验收项。
