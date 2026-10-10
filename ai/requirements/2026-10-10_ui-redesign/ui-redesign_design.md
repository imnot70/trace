# UI 现代化改造（A+B 组合）技术设计

> 立项：2026-10-10 ｜ 状态：**P0 已实施（待真机验证），P1–P3 待排期** ｜ 需求见 [ui-redesign.md](ui-redesign.md)（FR-2.9.13 / FR-2.9.14 / FR-2.9.15）
> 视觉基准：[../../suggest/ui-redesign-2026-10/index.html](../../suggest/ui-redesign-2026-10/index.html)。§2.1 变量表已随 P0 定稿落地（2026-10-10），定稿值即表中所载。

## 1. 总体结构：三层改造

```
┌─ 结构层  main.css / markdown.css / 组件 scoped 样式
│         去描边（调淡默认值）、分组标签化侧栏、排版重做、空状态
├─ 适配层  themes.css 的 --el-* 映射扩充（EP 出厂形态 → 应用设计语言）
└─ token 层 themes.css :root / html.dark
          19 个既有变量改默认值 + 新增 shadow/radius/motion/content-bg/doc-ink
```

原则：**一切颜色 / 圆角 / 阴影 / 动效走 CSS 变量**（延续 AGENTS 既有规范）；描边机制保留、只调淡默认值——主题包与高对比度预设靠 `--border-color` 一个变量即可恢复强描边，零特判代码（D4）。

## 2. token 层变量表

### 2.1 既有 19 个变量改默认值（P0 已落地定稿，2026-10-10）

| 变量 | 现值（浅） | 新值（浅） | 新值（深） | 说明 |
| --- | --- | --- | --- | --- |
| `--bg-primary` | `#ffffff` | `#ffffff` | `#1b1b1f` | 卡面 |
| `--bg-secondary` | `#f5f6f8` | `#f2f1ed` | `#121214` | 画布（深一档，去描边后承担分区） |
| `--bg-tertiary` | `#eceef1` | `#e9e7e1` | `#232329` | 三级面 |
| `--bg-hover` | 蓝 6% | 暖黑 5% | 白 5% | 悬停 |
| `--bg-active` | 蓝 12% | 靛 11% | 靛 16% | 选中 |
| `--text-primary` | `#24292f` | `#211f1c` | `#eae9e6` | 暖墨 |
| `--text-secondary` | `#57606a` | `#6c6a63` | `#a5a39d` | |
| `--text-tertiary` | `#8b949e` | `#a19e96` | `#6e6c66` | |
| `--border-color` | `#e4e7ec` | `rgba(28,25,18,.07)` | `rgba(255,255,255,.07)` | **机制保留，值调淡** |
| `--accent` | `#4078d3` | `#4f5bd5` | `#7e89f2` | 靛蓝，只做交互色 |
| `--accent-soft` | 蓝 12% | 靛 10% | 靛 16% | |
| `--danger` | `#d34850` | 微调 | 微调 | 对比度复核 |
| `--code-bg` | `#f0f2f5` | `#f5f4f0` | `#232329` | 代码块去描边后的底 |
| `--hljs-*`（6 项） | One Dark 系 | 同系微调 | 同系微调 | 纸面/暗底上对比度复核 |

### 2.2 新增 token（不在主题包白名单内的部分）

| token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--shadow-card` | `0 1px 2px rgba(30,26,18,.04), 0 8px 28px rgba(30,26,18,.07)` | `0 1px 2px rgba(0,0,0,.35), 0 10px 30px rgba(0,0,0,.35)` | 卡片海拔（替换描边分区） |
| `--radius-ctl / -card / -pop` | `7 / 12 / 16px` | 同 | 圆角三档，替换 4–20px 混用 |
| `--motion-fast / -base` | `120 / 160ms` | 同 | 动效时长 |
| `--motion-ease` | `cubic-bezier(0.2,0,0,1)` | 同 | 动效缓动 |
| `--font-ui` | MiSans 栈 | 同 | 见 §3 |

### 2.3 新增并**进入主题包白名单**的变量（方案 a，FR-2.9.15）

| 变量 | 内置默认（浅 / 深） | 说明 |
| --- | --- | --- |
| `--content-bg` | `#f8f3e6` / `#2a271f` | 内容区纸面底色（与心流 `--flow-paper-cream` 系同源取值） |
| `--doc-ink` | `#43392b` / `#d9d1c1` | 正文墨色（暖墨，区别于 chrome 的 `--text-primary`） |

另增 `--font-head`（衬线标题栈，**不进白名单**——字体名含空格会撞 `VALUE_PATTERN` 校验的口径边界，且主题包换标题字体属低频需求，先行不开放；将来有诉求再评估放宽取值规则）。

## 3. 字体方案（D3）

- **UI + 正文**：**MiSans 经 `misans` npm 包（5.0.0）引入**——子集 woff2（约 90 片/字重，unicode-range 按需加载；**全集切分**，每个字符都落在唯一分片内，无静态子集的缺字风险，修正立项时「不做子集」的保守口径），`main.ts` 导入 Regular / Medium / Demibold 三字重 CSS；**二进制不入库、走 npm 依赖**（对齐内置 Git 的「大二进制不进仓库」先例），构建产物实测 **+5.8MB**（187 个 woff2，远优于 15–30MB 预算）；栈：`MiSans, 'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif`（已落 `--font-ui`）；
- **衬线标题**（FR-2.9.14）：打包 **LXGW 文楷**（OFL；备选思源宋体，体积更大但字重更全）。仅用于 `.doc h1–h3` 与文档标题，走 `--font-head`；设置 → 通用 → 外观「衬线标题」开关（默认开，D5）映射 `font-family` 切换；
- **等宽**：维持现状（JetBrains Mono / Cascadia / Consolas 系统栈），不打包；
- 体积预算：CJK 全量每字重 3–10MB，预计合计 +15–30MB（安装包现 ~145MB，含内置 Git +15.7% 先例）；实测增量记录进 CHANGELOG（验收 #6）；
- CM 编辑器内容字体与正文栈同步（编辑器 theme 的 content font-family 一并替换），保证所见即所得与预览字形一致。

## 4. Element Plus 适配层（P1，已实施 2026-10-10）

**实施记录**：变量层扩充落 `themes.css`（组件级精修落新文件 `src/renderer/src/styles/ep.css`，`main.ts` 在 themes.css 后导入）：

- **主色梯度**（关键缺口）：此前仅映射 `--el-color-primary`，EP 的 hover / active / 浅底 state 引用 `--el-color-primary-light-3/5/7/8/9` 与 `dark-2`，未定义时落 EP 出厂蓝梯度——悬浮态会跳出靛蓝色系。现用 `color-mix` 从 `--accent` 现算全套（浅色混白 / 深色向 `#141416` 混暗，EP 深色口径），换 accent 即全局跟随；
- **描边体系**：`--el-border-color-hover` → `--text-tertiary`；新增 `--el-input-border-color`（浅 18% 黑 / 深 16% 白，比卡片 hairline 强一档——交互控件需要可见边界），`.el-button` 描边跟随之；
- **阴影**：`--el-box-shadow / -light / -lighter` 对齐应用阴影体系（popper / select 浮层消费 `-light`）；
- **动效**：`--el-transition-duration(-fast)` → `--motion-base / --motion-fast`；
- **组件精修**（ep.css）：按钮按下 `scale(0.98)`（C 琉摘选）；`.el-dialog` 圆角 `--radius-pop`（经 `--el-dialog-border-radius`）、`.el-message-box` 同；下拉菜单 / 选择器条目圆角 `--radius-ctl` + 菜单内边距 5px；`el-message` 胶囊化（999px）；notification 圆角 `--radius-card`；深色浮层边界规则自 main.css 迁入（见 §5 前序修正）。
- CDP 验证：`--el-color-primary-light-3` 计算值 `color-mix(in srgb, #4f5bd5 70%, #ffffff)` ✓；按钮描边 / 阴影 token 计算值 ✓；下拉条目形态待真机确认。

原设计条目（保留备查）：themes.css 现有 `--el-*` 映射（主色 / 边框 / 填充 / 背景 / 文字）保留并扩充：
  - `--el-border-radius-base` → `var(--radius-ctl)`；`--el-font-family` → `var(--font-ui)`；
  - 弹层动效：EP transition duration 变量对齐 `--motion-base / --motion-ease`，dialog / message-box 入场补 scale 0.98→1（覆盖 EP 默认 fade-only）；
- **逐组件精修**（新增全局段落或 `styles/ep.scss`）：dialog（头部留白 / 圆角 `--radius-pop` / 阴影）、button（主按钮实底 accent、次按钮中性、按下 `scale(0.98)` 摘选自 C 琉）、input / select（无边框填充式或极淡描边，实施时二选一定稿）、dropdown / popper（圆角、阴影、menu-hold 语义不动）、message / notification；
- ⚠️ 约束不变：`el-tooltip` 只包非交互元素；「点击后移除锚点」的操作延迟 ≥300ms（menu-hold）——适配层只动皮肤，不动这些交互语义。

## 5. 主题系统方案 a 实现（FR-2.9.15，P2 已实施 2026-10-10）

**实施记录**：白名单 +2 已落 `themePackage.ts`（注释同步「白名单为预设变量集的超集」）；单测 +2（纸面变量合法保存 / 旧格式向后兼容，`tests/themePackage.test.ts`，共 21 项全绿）；`guides/theme-import.md` 变量表 19→21 并补内容面说明；高对比度预设补纸面极值（`--content-bg` 纯白/`#0a0a0a`、`--doc-ink` 纯黑/白）；warm / cool 经运行时核查**无需重调**（预设 19 变量全量自含，且 P1 的 EP 主色梯度随 accent 自动联动）——「重调」项按原判断收敛为「核查」。变量消费（`.doc` 与 CM 内容层）随 FR-2.9.14 于 P3。

原设计条目（保留备查）：

| 改动点 | 文件 | 内容 |
| --- | --- | --- |
| 白名单 +2 | `src/main/lib/themePackage.ts` | `THEME_VARIABLE_WHITELIST` 追加 `--content-bg` / `--doc-ink`（校验规则、`VALUE_PATTERN` 不动——hex/rgba 本就合法） |
| 变量消费 | `themes.css` / `main.css` | 两变量定义于 `:root` / `html.dark`；`.doc`（预览）与 CM 内容层（所见即所得）消费 |
| 内置预设重调 | `src/renderer/src/styles/presets.ts` | warm / cool 重调适配新体系；**高对比度**：`--border-color` 给高对比实色值（描边回归主分区手段），文字/背景对比比照 WCAG AA+ |
| 变量集一致性 | `presets.ts` | 白名单注释「与 presets.ts 变量集保持一致」——两处同步 +2 |
| 单测 | `tests/themePackage.test.ts` | 新增：两新变量合法值通过；未知变量仍拒绝；旧格式主题包（19 变量）导入不拒（向后兼容） |
| 测试 | `tests/themes.test.ts` | 预设重调后的变量集断言同步 |
| 指南 | `guides/theme-import.md` | 变量表 19 → 21、示例补纸面覆盖条目、注意事项补「纸面底色 / 正文墨色可覆盖」 |

**兼容语义**：老主题包 JSON（19 变量）导入照常通过（白名单只增不改）；其未覆盖的 `--content-bg` 落内置纸面值——若主题包主色调与暖纸冲突（如冷蓝主题 + 米黄正文），属部分覆盖的既有「可能不协调」范畴（theme-import 指南注意事项既有提示），验收矩阵中用样张确认下限。

## 6. 内容面与 CM6 约束（P3，风险最集中的一批）

- **两套同步**：`markdown.css`（预览 `.markdown-body`）与 CM 编辑器主题（`.cm-content` 侧的标题 / 表格 / 引用 / 代码装饰样式）必须同批改——历史上「复选框被作用域挡住」即两套不同步的教训（markdown.css 注释）；
- **块级 widget 几何铁律**（AGENTS 2026-09-24 教训）：排版数值改动（行高 1.85、表格内边距加大、代码块行高）落在**盒内 padding**，禁止裸 margin 做块间距；改完跑 live-preview-render-fix 的行号对齐断言口径（公式块 / 表格 / HTML 块后行号零漂移）；
- **静默重排**：字号 / 行高走 CSS 变量，CM 与只看滚动容器的 ResizeObserver 都收不到——打字机锚定已观察 `contentDOM`（v0.8.2 修复），回归时**必须实测**心流 + 打字机 + 纸面组合（验收 #3）；
- **心流纸面共存**：心流 `flow-paper-on` 把底色涂在 `.cm-scroller` 上，层级高于内容层——日常纸面（`--content-bg` 涂 `.ed-body` / `.cm-content`）在其下，心流开启即被覆盖，无需改代码；验收确认心流五色 + 纹理 + 渐隐与日常纸面的切换观感；
- **导出边界（验收 #5）**：导出 PDF / HTML 的模板底色来源排查——不得消费 `--content-bg`（保持印刷白底 / 阅读排版既有底色）；如模板复用 `markdown-body` 类，须显式覆写背景；
- **悬浮预览 / 搜索预览**：同为 `.markdown-body` 容器，随纸面染色——预期行为（内容面即纸），验收时观感确认；
- **玻璃模式**（`html.glass-on`）：卡片半透明叠加逻辑（`color-mix` 82%）在新画布 / 纸面上重验可读性；WCO / `no-bottom-radius` 平台规避行为不变（验收 #1）。

## 7. 结构层要点（P2，已实施 2026-10-10）

**实施记录**：侧栏分组标签化 = 最低风险实现——模板仅插入一个 `.grp-label` 组标签（「快捷入口」，条件与分隔线同口径），各区块标题行经 CSS 重皮为行式入口（`--radius-ctl` 圆角、weight 500、t1 文字、t2 图标、active 靛蓝浅底 + 靛蓝图标文字），**全部点击行为 / 折叠 / ＋ 与排序控件 / menu-hold 机制零改动**；空状态统一 = `.grid-empty-icon` 圆底化（56px 圆、tertiary 底）+ 文案升 t2；**审计结果**：硬编码边框色全仓清零（P0 token 化已覆盖）；圆角归一——浮层面板（BacklinkPanel / NoteSwitcher / QuickRefPicker / GitAssociateDialog / ContextMenu / TablePromptHud / export-progress / 悬浮预览 / 心流提示）→ `--radius-card`，设置导航项 → `--radius-ctl`，计数角标 / 胶囊入口 → 999px；徽章小件（vim-badge / trash-kind / swatch）保留字面值（决策：微小组件圆角不构成风格噪音）；markdown.css 2 处留给 P3 内容面重做时统一。

原设计条目（保留备查）：

- **侧栏分组标签化**：`SideBar.vue` 模板调整（区块标题行 → 分组标签 + 行），点击行为 / 折叠 / `menu-hold` / 行高守恒（`min-height`，2026-10-10 跳动修复）语义全部保留；
- **去描边清单**：`main.css` 卡片 / 页头 / 页脚 / 设置块 + 组件 scoped 样式（grep `border: 1px solid var(--border-color)` 审计，逐处决定「调淡保留 / 改阴影 / 删除」）；
- **圆角审计**：grep `border-radius` 全仓，归一到三档 token；
- **logo**：`SideBar.vue` / `WelcomeView.vue` 的渐变字标重绘（SVG 或纯 CSS 扁平）；
- **空状态**：`grid-empty` 系列统一「图形 + 主操作」组件化。

## 8. 批次与验收

| 批次 | 范围 | 主要验收 |
| --- | --- | --- |
| P0 token 周 | §2 变量表 + §3 字体打包 + 滚动条 overlay + logo | 全局观感切换；深浅两态 + 玻璃模式可读性；体积增量记录 |
| P1 EP 适配 | §4 | 全部弹窗 / 菜单 / 输入过一遍（含搜索 / 设置 / 冲突解决 / 快速引用面板）；menu-hold 与 tooltip 禁令零回归 |
| P2 chrome | §5 全部 + §7 | 验收 #2 主题矩阵；高对比度描边；单测全绿（themePackage / themes） |
| P3 内容面 | §6 | 验收 #3/#5；心流 + 打字机真机；导出 PDF/HTML 底色 |

每批独立分支、发体验包经用户真机验证后进下一批（验收 #7）；行为变更随批写 CHANGELOG `[未发布]`。

## 9. 风险清单

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| CM6 排版改动引发行号几何漂移 | 高 | 铁律入代码评审清单；live-preview-render-fix 断言口径回归 |
| CJK 字体包体积超预算 | 中 | 先打包 MiSans 两字重试水；衬线仅标题层可换 Noto Serif SC Subset（按需重启加载完整版）方案兜底 |
| 第三方主题包与暖纸底观感冲突 | 中 | 验收矩阵样张圈定下限；指南「建议同时调整背景与文字色」既有提示强化 |
| EP 适配层与 EP 版本升级冲突 | 中 | 适配层集中单文件、变量化，升级时只看一处 |
| 全仓 border-radius / border 审计遗漏 | 低 | grep 清单逐项销账进 P2 验收 |
