# 经验教训汇总（Lessons Learned）

> **定位**：把散落在各功能设计文档「实施记录 / 踩坑 / 排障」、index 〇.3、技术债评审、交接文档与本文件之前的口口相传里的**技术教训与踩坑**收拢为一页速查，按主题分类。每条末尾注明出处，规则细节以出处为准——本文件是导航与浓缩，不替代出处。
> **维护约定**：新教训先写入对应功能文档的实施记录（那里的上下文最完整），再在本文件登记摘要；失去指导意义的条目应删除而非堆积。AGENTS.md「开发规范」中的硬性禁令与本文重复的，以 AGENTS.md 为准（它是执行层的唯一权威）。
> 创建：2026-09-26（由 requirements 目录全量梳理提取）。

## 目录

一、CodeMirror 6 集成层 ｜ 二、渲染 / 预览 / CSS ｜ 三、Electron / 平台 / 打包 ｜ 四、主进程 / 数据 / Git ｜ 五、验证方法学（CDP 与测试）｜ 六、架构与流程 ｜ 七、产品与交互

---

## 一、CodeMirror 6 集成层

> 技术债评审的结论：**近年所有 P0 回归都出在 CM6 集成层**（键位、几何、锚定），这层的教训密度最高；CM6 本身是全项目最正确的选型，回归是 wysiwyg 形态的固有成本。

1. **键位 `preventDefault: true` 只在命令「未处理」时生效**（两次踩中，第二次是 v0.8.0 的 P0——编辑器打不出空格与数字）：声明了它的绑定若命令返回 `false`，既吞默认行为又把按键标记为已处理。规则：「按状态决定是否接管」的绑定一律不要声明；只有 `Mod-*` 且无条件返回 `true` 的绑定才安全。（[table-insert-enhance 设计 §9](2026-09-24_table-insert-enhance/table-insert-enhance_design.md)、AGENTS.md）
2. **块级 widget 的垂直间距禁止裸 `margin`**：CM 行高记账只取 widget 元素的 border-box，不含外边距，差额逐块累加导致行号整体漂移（实测公式块后 +15px、表格后 +27px）。间距一律用 `padding` 或 `display: flow-root` 包裹（D8 已成文硬约定）。（[live-preview-render-fix 设计 §2](2026-09-24_live-preview-render-fix/live-preview-render-fix_design.md)）
3. **带 `markdown-body` 类的 widget 必须显式归零该类附带的卡片 `padding` 与 `max-width`**（否则继承预览卡片的 20/48px 留白与 860px 限宽）；widget 内渲染产物要 `white-space: normal`（内容区是 `break-spaces`，标签间换行会变成真实换行）。（[live-preview-render-fix 设计 §8](2026-09-24_live-preview-render-fix/live-preview-render-fix_design.md)）
4. **CSS 变量驱动的布局变化，CM 与 ResizeObserver（只看滚动容器）都收不到**：改字号、块级 widget 尺寸变化都是浏览器静默重排——无事务、容器盒子不变。「必须随几何变化重算」的逻辑要**同时观察 `contentDOM`**；`geometryChanged` 不含滚动（可安全用于不干扰用户滚动）；`coordsAtPos` 对未渲染位置返回 **null**，只写 `if (!coords) return` 会让该逻辑永久失效。（AGENTS.md、[flow-mode 设计 10.9](2026-09-23_flow-mode/flow-mode_design.md)）
5. **语法树区间剪枝必须用「包含」而非「相交」**：按区间跳过节点（如 frontmatter）时写成交际会连 `Document` 根节点一起命中，整棵树被剪掉、一切语法树装饰全消失（带 frontmatter 的笔记 100% 复现）。（[live-preview-render-fix 设计 §8](2026-09-24_live-preview-render-fix/live-preview-render-fix_design.md)）
6. **块级装饰必须经 StateField 提供**（ViewPlugin 提供 block 装饰会被 CM 抛错）；**含 StateField 的扩展必须自首次挂载常驻**——Compartment 重配置不允许增删 StateField，且重配置不重建单例、不触发重算，切换开关必须显式比较 facet 引用。（[wysiwyg 设计 §10](2026-09-21_wysiwyg/wysiwyg_design.md)）
7. **不要用 CM 装饰介入输入法组词行的渲染**：会破坏 Chromium 的组词锚点、中文输入直接失效（两次修复尝试均撤除）；组词期用 `view.composing` 冻结装饰集 + `compositionend` 补锚。CDP 合成事件测不出这类问题，必须真实 IME。（AGENTS.md、[flow-mode 设计 10.4](2026-09-23_flow-mode/flow-mode_design.md)）
8. **打字机重锚的触发路径要覆盖「静默几何变化」**：插件新建时要先锚定一次；ResizeObserver 只观察滚动容器不够，要追加 `contentDOM`；`update()` 要有 `geometryChanged` 分支；`coordsAtPos` 为 null 时要补一次滚进视野重试；**留白要作为锚定前每次校验的不变量**（留白缺失时光标反被上拉）。（[flow-mode 设计 10.9](2026-09-23_flow-mode/flow-mode_design.md)）
9. **用户滚动绝不干预，但被动重锚要加冷却**：滚动进未测量区触发 CM 测量 → 内容层尺寸变化被动触发重锚，把用户「弹回」光标行。修法：用户滚动后 800ms 冷却窗口抑制被动触发；输入 / 点击定位的强制重锚不受限；锚定自身的程序化滚动经标记排除。（[flow-mode 设计 10.11](2026-09-23_flow-mode/flow-mode_design.md)）
10. **CM 内置模糊过滤（FuzzyMatcher）对中文不可靠**：补全源已过滤返回，CM 还会再滤一遍，输入中文时候选全光、补全直接关闭。自管过滤的补全分支一律 `filter: false`。（[flow-reference-enhance 设计 §5](2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
11. **CM 补全的 Enter 被 completionKeymap（Prec.highest）占用**：扩展键位一律用 Alt+Enter，且 Vue 侧要 `.enter.exact`（否则 Alt+Enter 连带触发 Enter 的绑定）；**补全候选项 label 不带 `.md` 扩展名**（是「路径/显示名」），落盘路径要自带 `notePath` 字段，否则子目录笔记预览报 ENOENT。（index 〇.3、[flow-reference-enhance 设计 §5](2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
12. **候选项落成引用的括号语义按路径区分，两路不可混用同一函数**：Enter 直接接受（替换范围在 `[[` 之后）保留 closeBrackets 的既有闭合、仅缺失时补；预览态插入（替换范围含 `[[`）插完整 `[[路径]]` 并吸收残留 `]]`。「统一吸收」两个方向各错一半，四轮实测才收敛；断言要以**磁盘文件内容**为准（渲染态 DOM 会隐藏括号）。（[flow-reference-enhance 设计 §5 四轮记录](2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
13. **程序化写入被监听的滚动容器前，必须先置防回环 guard**：写入本身会触发反向 scroll 事件，实测把编辑器从 87% 拖到 2%。事件处理过程中的写入有 guard 保护，「事件之外」的主动写入也要手动置位。（[preview-enhancement 设计 §6](2026-09-09_preview-enhancement/preview-enhancement-design.md)、index 〇.3）
14. **「打开笔记 + 切视图」的自动聚焦不能放在 onMounted 消费**：openNote（异步 IPC）晚于视图挂载完成，editorRef 尚未绑定、`?.focus()` 静默落空（Ctrl+N 草稿实测踩中）——改为观察 editorRef 绑定的 watcher 统一消费一次性聚焦标志。（[draft-notes 设计 §7](2026-09-26_draft-notes/draft-notes_design.md)）
15. **窗口级 keydown 兜底层必须复用组件层的语义分流**：编辑器内 CM keymap 发 save 事件走草稿分流，但事件照样冒泡到 window 层的无条件 `flushSave`——两层各干各的，草稿态 Ctrl+S 弹不出转正框反而常规保存。语义分流收敛到一处函数，两层都调它。（[draft-notes 设计 §7](2026-09-26_draft-notes/draft-notes_design.md)）

## 二、渲染 / 预览 / CSS

1. **滚动容器的 `background-clip: content-box` 绘制不可依赖**（padding 由计算值撑出 + 内容被程序化滚动定位的场景）：实测只涂出内容顶部一块。改涂滚动内容的**直接子元素**（行号槽 + 内容层），自然随文档伸缩。（[flow-mode 设计 10.10](2026-09-23_flow-mode/flow-mode_design.md)）
2. **渐变过渡带的接缝**：滚动条补偿量若误算进渐变段，实心段会比真栏边晚 24px 达全浓度，栏边处出现浓度跳变分界——渐变应在栏边前约 8px（仅吸收滚动条宽度差）即达全浓度。（[flow-reference-enhance 设计 §5](2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
3. **hover-reveal 的外扩感应区（`::after`，inset 负值）是定位元素，会挡住流内元素的点击**——hover 能显现、点击无响应。修法：被挡元素提升绘制层级（`position: relative; z-index: 1`）。（index 第四节 v0.8.4）
4. **scoped 样式对挂在组件根元素上的 class 不生效**（根元素没有该组件的 scoped 属性，规则从未命中，如 el-dialog 的 body 高度）——此类改用非 scoped 全局样式。（index 第四节 v0.8.5）
5. **CSS 变量名写错时 `var()` 静默失效**（如引用未定义的 `--accent-light`，高亮完全丢失且无报错）——新颜色先查 `themes.css` 是否已有变量。（index 第四节 v0.8.5）
6. **`el-tooltip` 只允许包裹非交互元素**（图标 / 纯文本）：tooltip 嵌 tooltip、tooltip 包按钮 / 下拉触发器都会失效（v0.3.5 起为禁令）；「点击后移除下拉菜单锚点元素」的操作需延迟 ≥300ms 或保持锚点可见（menu-hold 模式），否则 popper 在左上角闪现残影。（AGENTS.md、index 第一节 v0.3.5）
7. **Element Plus 的集成摩擦（tooltip 禁令 / popper 闪影 / 事件载荷）在持续产生隐性成本**——技术债评审结论：**停止加深依赖**，新 UI 优先自有样式 + CSS 变量，EP 只留对话框 / 下拉 / 消息类。（[tech-debt §一](tech-debt-2026-09-25.md)）
8. **打字机留白的生命周期问题域**（两个收尾缺陷待重新设计 + 常规预览错位暂不修）：留白在生命周期结束时疑似被「僵尸实例」写回；上次 destroyed 方案引入新问题已放弃——**动留白前先聊方案**。（index 第二节）

## 三、Electron / 平台 / 打包

1. **Windows 上禁止 `transparent: true` 创建窗口**（v0.4.4 严重回归：剥离原生标题栏与可调边框，窗口无法移动 / 关闭）：玻璃材质走 WCO（`titleBarStyle: 'hidden'` + `titleBarOverlay`）+ `backgroundMaterial` 实现。（[custom-titlebar 设计](2026-09-22_custom-titlebar/custom-titlebar_design.md)、AGENTS.md）
2. **平台分支是回归重灾区**：平台相关改动严格限定 `win32` 分支，macOS / Linux 行为零变化要写成**硬性回归验收清单**（v0.4.4 教训转验收）。（[custom-titlebar §5](2026-09-22_custom-titlebar/custom-titlebar.md)）
3. **Linux 系统合成器会在窗口边界外做方形绘制**：透明窗口底部圆角在浅色壁纸下残留直角轮廓，应用侧无法彻底消除——Linux 一律禁用内容区底部圆角规避（v0.5.1）。（index 第一节）
4. **Linux 重新 `npm install` 后 Electron 可能启动失败**（AppArmor 限制非特权用户命名空间 + chrome-sandbox 无 SUID）：`sudo chown root:root ... && sudo chmod 4755` 修复，每次重装依赖后需重做。（AGENTS.md）
5. **Windows 上 gitService 集成测试超时是环境慢不是 bug**（每次 git 子进程 1~1.7s）：用 `npx vitest run tests/gitService.test.ts --testTimeout=90000` 区分环境与真回归。（AGENTS.md）
6. **CI 细则**：多行 bash run 步骤在 Windows runner 必须显式 `shell: bash`（默认 pwsh 解析不了）；electron-builder 的 `${arch}` 在不同 target 渲染不一致，`artifactName` 架构位写死 `x64`（加 arm64 时需按 target 分别配置）；发版仅由 tag 驱动且 CI 校验 tag 与 package.json 一致。（AGENTS.md）
7. **GitHub Pages 首跑失败（configure-pages HttpError: Not Found）**：仓库 Pages 从未启用且 GITHUB_TOKEN 无管理员权限，`enablement: true` 自愈不了——需一次性到 Settings → Pages 把 Source 切换为「GitHub Actions」再 Re-run。（[suggest/github-pages-site.md](suggest/github-pages-site.md)）
8. **simple-git 对 `binary` 路径做字符白名单校验**（不允许空格与非 ASCII）：传自定义 Git 路径必须同时设 `unsafe: { allowUnsafeCustomBinary: true }`，否则安装在 `C:\Program Files\…` 或中文用户名目录下抛 GitPluginError。（AGENTS.md）

## 四、主进程 / 数据 / Git

1. **渲染端传参不可信，路径必须过 `resolveWithin`**：冲突解决接口曾因直接 `path.join` 渲染端传来的 filePath 存在**路径穿越安全洞**（可 `../` 越权写库外文件）。任何「vault + 相对路径」的 IPC 入口都要有库内守卫。（[tech-debt §二.1](tech-debt-2026-09-25.md)）
2. **跨服务级联（rename/delete → 双链改写、收藏、最近打开）必须下沉领域服务**：写在 IPC 层的话，未来任何新入口（插件 API、导入向导）都要记得复刻整套级联，漏一处就是静默数据不一致。（[tech-debt §三](tech-debt-2026-09-25.md)）
3. **索引必须有完整生命周期**：只在启动时构建一次的索引，运行期不更新会把「显示有 bug」逼成面板被隐藏（双链索引首版教训）；watcher 挂起期（git 同步中）丢弃的变更要在 resume 后补偿重建并重发 `fs:changed`；防抖要有 max-wait 兜底。**工作区外的文件（如草稿 scratch）watcher 看不到**——落盘后要手动调增量索引。（[wiki-link-anchor 设计 §7.2](2026-09-12_wiki-link-anchor/wiki-link-anchor_design.md)、[tech-debt §二.6](tech-debt-2026-09-25.md)、[draft-notes 设计 §3.5](2026-09-26_draft-notes/draft-notes_design.md)）
4. **JsonStore 是所有应用元数据的底座，必须版本化**：`schemaVersion` + `migrate()` 钩子 + 深合并（浅合并会在升级时丢嵌套默认键）+ 损坏时留 `.bak` + fsync。散落的 ad-hoc 迁移要收进去——趁数据文件还少赶紧做，越晚越难写。（[tech-debt §二.7](tech-debt-2026-09-25.md)）
5. **设置写入要按 schema 键集合白名单过滤**（`Object.assign` 直合会让幽灵键永远留在 settings.json）；**枚举类设置删除旧值时要启动迁移 + 播放兜底 + 类型收窄**三件套（音色枚举收敛案例——否则出现选择器空白 + 静默无声）。（[tech-debt §二.4](tech-debt-2026-09-25.md)、[flow-mode 设计 10.8](2026-09-23_flow-mode/flow-mode_design.md)）
6. **git 语义陷阱**：冲突里 ours / theirs 随操作类型**反转**（`pull --rebase` 中 HEAD 是远端上游、本地提交在被重放侧）——「接受本地版本」要按变基状态对调取值；`-c core.editor=true` 跳过变基编辑器需显式 `allowUnsafeEditor`；手动同步与 autoSync 可能并发撞 `.git/index.lock`，要按库串行互斥；变基逐提交重放可能连环冲突，要刷新列表重新进入解决流程。（index 第四节 v0.8.5）
7. **双链只在库内解析**：反向链接限同库、detailKey 按行内序号存取（按行号会让同行多引用互相覆盖）、索引按叶子名归属（路径形式双链不误报断链）；跨库搜索预览后插入引用会产出永远断链的 `[[引用]]`——插入前必须校验目标库与当前库一致。（[wiki-link-anchor 设计 §7.2](2026-09-12_wiki-link-anchor/wiki-link-anchor_design.md)、[draft-notes 设计 §3.5](2026-09-26_draft-notes/draft-notes_design.md)）
8. **插件 API 的错误语义要分层**：权限违规 / 未知能力 reject，业务失败 resolve 为 `{ ok: false, error }`——混在一起插件无法区分「没权限」和「没写进去」。（[plugin-design §10](2026-09-08_plugin-system/plugin-design.md)）
9. **日志统一脱敏，任何新日志不得输出令牌**；PAT 仅经 `http.extraheader` 每次调用注入，绝不写 `.git/config`。（AGENTS.md）

## 五、验证方法学（CDP 与测试）

1. **验证脚本自身要自证正确**：探针包装原生类（如 AudioContext）时子类方法必须透传参数（`(...a) => super.x(...a)`），漏传会让被测路径抛错、误判为产品 bug（音效验证踩中）；断言前先等旧态清场——屏上残留的上一条提示会被误读为新结果。（[flow-mode 设计 10.3](2026-09-23_flow-mode/flow-mode_design.md)、index 〇.3）
2. **CDP 原始字符按键在本环境不稳定**：文本输入改用 `execCommand('insertText')`（**focus 与输入必须放在同一 eval 里**）+ 磁盘真值断言；渲染态 DOM 对「源码层」断言不可靠（所见即所得会隐藏括号等标记）。（index 〇.3、[flow-reference-enhance 设计 §5](2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
3. **CDP 无法驱动真实输入法**：IME 相关（组词、候选框）只能真机验证（Windows 微软拼音 / Linux fcitx），自动化只能覆盖非 IME 路径。（[flow-mode 设计 10.4](2026-09-23_flow-mode/flow-mode_design.md)）
4. **探针读数要选可信来源**：打字机锚定验证读 `.cm-cursor` 元素会骗人（无焦点时高度为 0），改走 CM 自己的 `coordsAtPos`。（[flow-mode 设计 10.9](2026-09-23_flow-mode/flow-mode_design.md)）
5. **HMR 会重置 pinia 状态**——验证脚本要先确保前置状态（循环 ensure 而非假定）；**vite watcher 可能漏掉快速连续编辑的变更事件**（模块图停在中间态、同文件一半新一半旧，页面 reload 无效）——touch 文件强制重编译，验证前先核对服务的模块内容是否为最新。（HANDOFF、index 〇.3）
6. **新起实例前必须 `pkill -9 -f "[e]lectron"` 并确认无残留**（单实例锁让新实例静默退出）；隔离实例用 `TRACE_CDP=9222 TRACE_TEST_USERDATA=1 npm run dev`。（HANDOFF）
7. **CM6 集成层（视图 / 组件）是测试空洞也是 P0 回归集中地**——技术债评审建议正式搭 Playwright for Electron 冒烟，先覆盖三条最易回归链路（打字机锚定 / `[[` 补全与预览 / 预览同步）；「`playwright-core` 已在 devDependencies 闲置」。（[tech-debt §四](tech-debt-2026-09-25.md)）
8. **「绕过统一入口」的直接代价**：App.vue 从搜索结果打开笔记时绕过 actions 层裸调 `openNote` 并把整篇内容当显示名传入，污染常用列表——视图 / 组件只走 store 或 composables，store 是唯一 IPC 门面。（[tech-debt §二.2](tech-debt-2026-09-25.md)）

## 六、架构与流程

1. **「文件是唯一事实来源」与「应用元数据不进笔记库」是红线**；新增 IPC 能力走固定路径：shared 定类型 → 主进程 services 实现 → registerIpc 注册 → preload 暴露 → 渲染端经 window.trace 调用。（AGENTS.md）
2. **「不悄悄丢数据」**：保存有外部修改 hash 保护；删除一律先进回收站（草稿等「临时」语义例外且要红色确认）；危险操作红色警示 + 确认。（AGENTS.md）
3. **修复尝试引入新问题时果断放弃**：`fix/typewriter-cleanup`（destroyed 方案）验证中发现两个新问题，整分支删除未合入，缺陷回到待修状态并要求**先聊方案再动手**——沉没成本不该绑架决策。（index 第二节）
4. **CHANGELOG 条目必须与发布版本真实对应**：底色纹理在 v0.8.7 打标签后才合入 main，条目却写进了已发布的 `[0.8.7]` 段，会误导用户以为安装包含此功能——新变更一律写 `[未发布]` 段，随实际发布的版本归档。（CHANGELOG 维护约定、2026-09-26 案例）
5. **文档欠账视为改动未完成**：行为变更同步 CHANGELOG / PRD FR / 设计文档实施记录 / index 状态——commit message 记录「改了什么」，文档记录「产品现在是什么」。（AGENTS.md）
6. **技术选型结论（2026-09-25 评审快照，避免反复重议）**：CM6 全项目最正确选型；EP 停止加深依赖；simple-git 收口而非替换；自研搜索索引最薄弱待重构；**明确不做**——不换框架、不换编辑器内核、不上 Tauri、不引入 SQLite 或任何后端（「纯文件 + git」是产品差异化根基）、不搞专门重构季（随功能顺路）。（[tech-debt §一 / §五](tech-debt-2026-09-25.md)）
7. **架构改进随功能顺路做**：SettingsView 拆分、IPC 访问纪律收口、store 依赖理顺、级联下沉、registerIpc 拆分——清单见技术债评审 §三，不专门立项。（[tech-debt §三](tech-debt-2026-09-25.md)）

## 七、产品与交互

1. **Esc 分级消费的分支顺序按用户意图排**：悬浮预览 → 补全面板 → 心流退出（两者同开时用户要的是先关预览；初版顺序反了）。应用级 Esc 回退逐级消费、消费即阻断下沉。（[flow-reference-enhance 设计 §5](2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
2. **悬浮预览的「一瞥」语义**：点击编辑区 / 开始输入 / 切换笔记自动收回；固定需显式操作。补全预览不切换、不插入、看完全部收回。（index 第一节 v0.3.6、[flow-mode 设计 10.3.1](2026-09-23_flow-mode/flow-mode_design.md)）
3. **音效音色迭代的两个工程经验**：① 实录音复刻走「离线分析 → 参数化重建」口径（ffprobe → 帧包络 → 击打检测 → FFT 频段占比 → biquad 逐频段包络），不随包音频文件（版权 + 体积）；② 多层叠加音效的响度关系要**分层定标、构造保证**（按整段峰值归一化时，棘轮噪声尖峰会随机压制按键「咔」，不能靠噪声运气）。（[flow-mode 设计 10.5–10.8](2026-09-23_flow-mode/flow-mode_design.md)）
4. **枚举 / 结构类设置项的演进要照顾旧值**（持久化迁移 + 运行时兜底 + 未发布值不需要用户提示）；用户实测反馈驱动的观感参数（渐变宽度 / 音色配比 / 屏蔽窗口）调完后要在设计文档记录**可调项入口**，便于下次按需微调而不再全链排查。（[flow-mode 设计 10.8 / 10.7](2026-09-23_flow-mode/flow-mode_design.md)）
5. **中文输入是主场景**：凡涉及输入行渲染 / 折行 / 光标定位的改动，先想 IME（组词锚点不可破坏、CDP 测不出、必须真机）；行尾拉丁字母整词折行与多数编辑器一致，属已知观感项不是 bug。（AGENTS.md、index 第二节）
6. **「用户实测反馈」是最高优先级需求来源**：v0.8.x 几乎每个补丁版都来自真机使用反馈；反馈修复要做**真机场景的逐字复现**，复现不到时用「同类根因」的可复现证据替代并如实记录差异。（[flow-mode 设计 10.9](2026-09-23_flow-mode/flow-mode_design.md)）

---

## 出处导航

| 文档 | 主要教训内容 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 执行层硬性禁令（widget 几何 / 键位 / CSS 变量 / tooltip / IME / Windows 透明 / 内置 Git / CI 细则 / 发版流程） |
| [index.md](index.md) 〇.3 / 第二节 | 近期技术教训速记与已知问题全景 |
| [tech-debt-2026-09-25.md](tech-debt-2026-09-25.md) | 选型结论、缺陷证据与修法、架构改进清单、测试策略、明确不做的事 |
| [2026-09-23_flow-mode/](2026-09-23_flow-mode/flow-mode_design.md) §10 | 打字机锚定 / 滚动冷却 / 留白不变量 / 音效合成与分层定标 / 底色绘制 / IME 待验证 |
| [2026-09-25_flow-reference-enhance/](2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md) §5 | CM 中文模糊过滤 / Esc 分级 / 括号语义两路 / Alt+Enter 键位 / 渐变接缝 |
| [2026-09-24_live-preview-render-fix/](2026-09-24_live-preview-render-fix/live-preview-render-fix_design.md) §2 / §8 | 行高记账与外边距 / 样式作用域 / 装饰剪枝包含语义 / widget 归零项 |
| [2026-09-21_wysiwyg/](2026-09-21_wysiwyg/wysiwyg_design.md) §10 | StateField 与 Compartment 约束 / IME 冻结 / 净化三处共用 |
| [2026-09-09_preview-enhancement/](2026-09-09_preview-enhancement/preview-enhancement-design.md) §6 | 防回环 guard / 初始位置主动同步 / 尾块高度折算 |
| [2026-09-12_wiki-link-anchor/](2026-09-12_wiki-link-anchor/wiki-link-anchor_design.md) §7.2 | 索引活性 / 同行多引用 / 同库解析语义 |
| [2026-09-22_custom-titlebar/](2026-09-22_custom-titlebar/custom-titlebar.md) §5 | v0.4.4 教训转硬性回归清单 / WCO 路线 |
| [2026-09-08_plugin-system/](2026-09-08_plugin-system/plugin-design.md) §10–13 | 错误语义分层 / 崩溃守护 / 市场校验 |
| [2026-09-26_draft-notes/](2026-09-26_draft-notes/draft-notes_design.md) §7 | 伪库 / watcher 看不到 scratch / 聚焦时序 / 窗口层分流 / 验证矩阵 |
| [HANDOFF.md](../HANDOFF.md) | 隔离实例工作流 / 单实例锁 / CDP 脚本要点 / HMR 陷阱 |
| [suggest/](suggest/README.md) | Pages 启用踩坑、「手不离键盘」动线的设计约束汇总 |
