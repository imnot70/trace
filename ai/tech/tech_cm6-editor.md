# tech_cm6-editor — CodeMirror 6 集成层踩坑

> 来源：由 `requirements/lessons.md`（2026-09-26 全仓教训梳理）拆分。技术债评审的结论：**近年所有 P0 回归都出在 CM6 集成层**（键位、几何、锚定），这层的教训密度最高；CM6 本身是全项目最正确的选型，回归是 wysiwyg 形态的固有成本。执行层硬性禁令的权威版本在 [AGENTS.md](../../AGENTS.md)。

## 键位与输入

1. **键位 `preventDefault: true` 只在命令「未处理」时生效**（两次踩中，第二次是 v0.8.0 的 P0——编辑器打不出空格与数字）：声明了它的绑定若命令返回 `false`，既吞默认行为又把按键标记为已处理。规则：「按状态决定是否接管」的绑定一律不要声明；只有 `Mod-*` 且无条件返回 `true` 的绑定才安全。（[table-insert-enhance 设计 §9](../requirements/2026-09-24_table-insert-enhance/table-insert-enhance_design.md)）
2. **不要用 CM 装饰介入输入法组词行的渲染**：会破坏 Chromium 的组词锚点、中文输入直接失效（两次修复尝试均撤除）；组词期用 `view.composing` 冻结装饰集 + `compositionend` 补锚。CDP 合成事件测不出这类问题，必须真实 IME。（[AGENTS.md](../../AGENTS.md)、[flow-mode 设计 10.4](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
3. **CM 内置模糊过滤（FuzzyMatcher）对中文不可靠**：补全源已过滤返回，CM 还会再滤一遍，输入中文时候选全光、补全直接关闭。自管过滤的补全分支一律 `filter: false`。（[flow-reference-enhance 设计 §5](../requirements/2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
4. **CM 补全的 Enter 被 completionKeymap（Prec.highest）占用**：扩展键位一律用 Alt+Enter，且 Vue 侧要 `.enter.exact`（否则 Alt+Enter 连带触发 Enter 的绑定）；**补全候选项 label 不带 `.md` 扩展名**（是「路径/显示名」），落盘路径要自带 `notePath` 字段，否则子目录笔记预览报 ENOENT。（[index 〇.3](../requirements/index.md)、[flow-reference-enhance 设计 §5](../requirements/2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
5. **候选项落成引用的括号语义按路径区分，两路不可混用同一函数**：Enter 直接接受（替换范围在 `[[` 之后）保留 closeBrackets 的既有闭合、仅缺失时补；预览态插入（替换范围含 `[[`）插完整 `[[路径]]` 并吸收残留 `]]`。「统一吸收」两个方向各错一半，四轮实测才收敛；断言要以**磁盘文件内容**为准（渲染态 DOM 会隐藏括号）。（[flow-reference-enhance 设计 §5 四轮记录](../requirements/2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
6. **「打开笔记 + 切视图」的自动聚焦不能放在 onMounted 消费**：openNote（异步 IPC）晚于视图挂载完成，editorRef 尚未绑定、`?.focus()` 静默落空（Ctrl+N 草稿实测踩中）——改为观察 editorRef 绑定的 watcher 统一消费一次性聚焦标志。（[draft-notes 设计 §7](../requirements/2026-09-26_draft-notes/draft-notes_design.md)）
7. **窗口级 keydown 兜底层必须复用组件层的语义分流**：编辑器内 CM keymap 发 save 事件走草稿分流，但事件照样冒泡到 window 层的无条件 `flushSave`——两层各干各的，草稿态 Ctrl+S 弹不出转正框反而常规保存。语义分流收敛到一处函数，两层都调它。（[draft-notes 设计 §7](../requirements/2026-09-26_draft-notes/draft-notes_design.md)）**延伸实例（2026-09-28）**：收敛后两层仍会**各执行一次**——CM keymap 处理后 `preventDefault` 不阻止冒泡，事件照常到达窗口层再走一遍分流（Ctrl+S 双「已保存」toast）。兜底层须以 `e.defaultPrevented` 识别「CM 已处理」并让位，只兜底 CM 收不到按键的场景（焦点在编辑器外）。
8. **@codemirror/search 6.7+ 的查找面板类名是 `.cm-panel.cm-search`**（不是旧文档的 `.cm-searchPanel`）：按旧类名写的 Esc 让位判断与主题样式会静默失效——面板其实已打开，只是选择器没匹配上。面板文案经 `EditorState.phrases.of({...})` 中文化，无需自绘面板。（[search-redesign §6](../requirements/2026-09-26_search-redesign/search-redesign.md)）
9. **重排查找面板只能用 grid 逐元素定位，flex + `<br>` 的换行技巧在 Chromium 不成立**：CM 面板 DOM 是扁平的，Chromium 的 flex 布局不把 `<br>` 当换行盒（`display: block` + `flex-basis: 100%` 也无效），宽窗口下替换框会被挤上第一行；子元素都有稳定的 `name` 属性（search/next/prev/select/replace/replaceAll/close），grid + 显式行列最可靠。另：Windows 的 UA 给原生 `<button>` 画白→灰纵向渐变，`background-color` 压不住（画在其上层的 background-image），须用 `background` 简写 + `background-image: none`。（[search-redesign §6.1](../requirements/2026-09-26_search-redesign/search-redesign.md)）

10. **Compartment 换装一个 ViewPlugin 类扩展 = 插件实例与其持有的一切资源全部重建**：事件订阅挂在旧实例上会随换装整体失效（Vim 模式实测：模式事件监听挂在 CM5 适配层实例上，开关切换重建适配层后事件全部丢失，功能正常但 UI 状态永久停留在挂载初值）。跨实例的订阅必须在**每次挂载后重挂**（记录已挂实例避免重复）。另两条验证经验：CDP `Input.dispatchKeyEvent` 对后台窗口不可靠，页面内在 contentDOM 上合成 `KeyboardEvent`（bubbles）是可靠注入方式，编辑器键位与应用层 window 监听都能收到；心流 / 专注的顶栏隐藏是 CSS 隐藏而非 DOM 移除，验证脚本不能用「元素不存在」判定，应读 store 状态。（[vim-mode 设计 §6](../requirements/2026-09-26_vim-mode/vim-mode_design.md)）

## 几何与测量

8. **块级 widget 的垂直间距禁止裸 `margin`**：CM 行高记账只取 widget 元素的 border-box，不含外边距，差额逐块累加导致行号整体漂移（实测公式块后 +15px、表格后 +27px）。间距一律用 `padding` 或 `display: flow-root` 包裹（已成文硬约定）。（[live-preview-render-fix 设计 §2](../requirements/2026-09-24_live-preview-render-fix/live-preview-render-fix_design.md)）
9. **带 `markdown-body` 类的 widget 必须显式归零该类附带的卡片 `padding` 与 `max-width`**（否则继承预览卡片的 20/48px 留白与 860px 限宽）；widget 内渲染产物要 `white-space: normal`（内容区是 `break-spaces`，标签间换行会变成真实换行）。（[live-preview-render-fix 设计 §8](../requirements/2026-09-24_live-preview-render-fix/live-preview-render-fix_design.md)）
10. **CSS 变量驱动的布局变化，CM 与 ResizeObserver（只看滚动容器）都收不到**：改字号、块级 widget 尺寸变化都是浏览器静默重排——无事务、容器盒子不变。「必须随几何变化重算」的逻辑要**同时观察 `contentDOM`**；`geometryChanged` 不含滚动（可安全用于不干扰用户滚动）；`coordsAtPos` 对未渲染位置返回 **null**，只写 `if (!coords) return` 会让该逻辑永久失效。（[AGENTS.md](../../AGENTS.md)、[flow-mode 设计 10.9](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
11. **语法树区间剪枝必须用「包含」而非「相交」**：按区间跳过节点（如 frontmatter）时写成交际会连 `Document` 根节点一起命中，整棵树被剪掉、一切语法树装饰全消失（带 frontmatter 的笔记 100% 复现）。（[live-preview-render-fix 设计 §8](../requirements/2026-09-24_live-preview-render-fix/live-preview-render-fix_design.md)）

## 装饰体系

12. **块级装饰必须经 StateField 提供**（ViewPlugin 提供 block 装饰会被 CM 抛错）；**含 StateField 的扩展必须自首次挂载常驻**——Compartment 重配置不允许增删 StateField，且重配置不重建单例、不触发重算，切换开关必须显式比较 facet 引用。（[wysiwyg 设计 §10](../requirements/2026-09-21_wysiwyg/wysiwyg_design.md)）
13. **打字机重锚的触发路径要覆盖「静默几何变化」**：插件新建时要先锚定一次；ResizeObserver 只观察滚动容器不够，要追加 `contentDOM`；`update()` 要有 `geometryChanged` 分支；`coordsAtPos` 为 null 时要补一次滚进视野重试；**留白要作为锚定前每次校验的不变量**（留白缺失时光标反被上拉）。（[flow-mode 设计 10.9](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
14. **用户滚动绝不干预，但被动重锚要加冷却**：滚动进未测量区触发 CM 测量 → 内容层尺寸变化被动触发重锚，把用户「弹回」光标行。修法：用户滚动后 800ms 冷却窗口抑制被动触发；输入 / 点击定位的强制重锚不受限；锚定自身的程序化滚动经标记排除。（[flow-mode 设计 10.11](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
15. **程序化写入被监听的滚动容器前，必须先置防回环 guard**：写入本身会触发反向 scroll 事件，实测把编辑器从 87% 拖到 2%。事件处理过程中的写入有 guard 保护，「事件之外」的主动写入也要手动置位。（[preview-enhancement 设计 §6](../requirements/2026-09-09_preview-enhancement/preview-enhancement-design.md)、[index 〇.3](../requirements/index.md)）
16. **drawSelection 的选区画在滚动层下 `z-index` 负值的独立图层（`.cm-selectionLayer`），靠内容层透明才透出来**——任何给 `.cm-content` / `.cm-gutters` 涂不透明背景的功能（心流写作底色）都会把选区盖掉（实测：心流 + 底色下选中文字无高亮，常规模式正常）。修法：底色开启时把选区图层抬到内容层之上（`z-index: 0 !important` 覆盖 CM 内联写入的值；选区色 `--accent-soft` 为半透明，文字在选区下仍清晰）。同理注意：光标图层 `above` z 150 在最上，故「底色盖选区但光标可见」是本类缺陷的鉴别特征。（[flow-mode 设计 10.12](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
17. **绕过输入管线的第三方 dispatch 不带 `Transaction.userEvent`**：@replit/codemirror-vim 的 CM5 适配层直接 `view.dispatch`，移动类事务注解为 null（编辑类经其 `dispatchChange` 自带 `input.type.compose`、insert 打字走原生管线自带 `input.type`）。凡按 userEvent 分流的扩展（打字机锚定 `isAnchorEvent` / 回车音效 `isReturnInsertion` / 将来任何同类机制）集成此类组件会对其「移动」失明。修法 = 在集成侧包装 `view.dispatch`：仅当事务产生于该组件操作内（如 `curOp.isVimOp`）且 spec 未带注解时补归类注解（`input.trace-vim` / `select.trace-vim`），其余原样透传。（[vim-mode 设计 §8](../requirements/2026-09-26_vim-mode/vim-mode_design.md)）
