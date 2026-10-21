# Windows 自定义标题栏 + 毛玻璃恢复技术设计

> 创建：2026-09-22 ｜ 状态：**已实施（随 v0.7.0 发布）** ｜ 需求见 [custom-titlebar.md](custom-titlebar.md) ｜ 实施记录见第 6 节
> 分支：`feature/custom-titlebar`

## 1. 总体方案

**一句话**：Windows 上把主窗口从「原生标题栏 + 不透明」切换为「WCO（titleBarStyle: hidden + titleBarOverlay）+ backgroundMaterial 玻璃材质」，渲染层新增全局标题栏条承担拖拽与应用名，玻璃开启时内容背景转半透明透出材质。macOS / Linux 代码路径零改动。

```
main/index.ts createWindow（win32 分支）
  ├─ titleBarStyle: 'hidden' + titleBarOverlay: { height: 36, color, symbolColor }
  ├─ backgroundColor: 玻璃开 ? '#00000000' : '#f5f6f8'   ← 不碰 transparent: true
  └─ windowEffect.applyWindowGlassEffect
       └─ win32: setBackgroundMaterial('mica'|'acrylic'|none)，不支持的环境 catch 降级

renderer
  ├─ App.vue：win32 时渲染 <div class="titlebar">（应用名 + drag 区 + 按钮占位）
  ├─ main.css：.titlebar（env(titlebar-area-*) 定位）、app-shell 顶部让位
  ├─ html.glass-on class：玻璃开启时 --bg-* 变量转半透明（材质透出、文字不透明）
  └─ 主题切换 → IPC window:setOverlayTheme → main.setTitleBarOverlay（跟随深浅色）
```

## 2. 决策记录

| # | 决策点 | 结论 | 理由 |
| --- | --- | --- | --- |
| D1 | 标题栏条定位方式 | `env(titlebar-area-*)` 环境变量定位（WCO 激活时浏览器注入），fallback 36px | 官方机制，按钮区宽度 / 缩放由系统给定，避免硬编码 |
| D2 | 玻璃开关的内容透明策略 | `html` 挂 `glass-on` 类，CSS 覆盖 `--bg-secondary` / `--bg-primary` / `--bg-card`（如有）为带 alpha 的 color-mix（约 78% 不透明度）；文字 / 边框变量保持不透明 | 材质透出需要内容半透明；只动背景层保可读性；切换即类开关，无 DOM 重建 |
| D3 | WCO 颜色同步 | 渲染层主题应用后经新 IPC `window:setOverlayTheme({ color, symbolColor })` 通知主进程 `setTitleBarOverlay`；初始值由 createWindow 按 settings.theme 计算 | 主题是应用级（非系统级），只有渲染层知道当前深浅；设置变更即调用 |
| D4 | Win10 / 不支持降级 | `setBackgroundMaterial` 包 try-catch；`process.getSystemVersion()` 以 '10.' 开头视为 Win10 直接跳过材质 | 官方仅 Win11 22H2+ 支持 Mica/Acrylic；降级形态 = 现状（不透明 + 透明度滑杆） |
| D5 | 透明度与材质并存 | `setOpacity` 照旧（<100 全窗半透明）；设置页注明「毛玻璃建议透明度 100%」 | 不新增组合逻辑；材质在半透明下本就不可见，属用户可理解行为 |

## 3. 关键实现点

### 3.1 主进程（main/index.ts + windowEffect.ts）

- createWindow 仅 `process.platform === 'win32'` 时追加：`titleBarStyle: 'hidden'`、`titleBarOverlay: { height: 36, color, symbolColor }`（color 取 settings.theme 对应的侧栏底色）、玻璃开时 `backgroundColor: '#00000000'` + `backgroundMaterial: settings.windowGlassEffect === 'acrylic' ? 'acrylic' : 'mica'`（'auto' 归一为 mica）；
- **不设置 `transparent: true`**（AGENTS.md 警告条目转硬约束）；`hasShadow` 恒 true（hidden title bar 保留 DWM 阴影）；
- windowEffect.ts：win32 分支改为调用 `win.setBackgroundMaterial(...)`（try-catch 降级）+ setOpacity；更新函数头注释（旧「Windows 仅透明度」说明标记为已过时并指向本设计）。

### 3.2 渲染层

- App.vue：`platform === 'win32'` 时渲染 `.titlebar`（高 `env(titlebar-area-height, 36px)`，左：应用名，整条 `-webkit-app-region: drag`；右侧 `right: env(titlebar-area-width)` 起为原生按钮区不可占用）；`.app-shell` 顶部 padding 让位；
- 玻璃开关（win32 + windowGlassEffect ≠ 'none'）时 `html.glass-on`：CSS 覆盖背景变量半透明 + 恢复内容圆角（`.window-opaque` 逻辑改为与玻璃开关联动——win32 玻璃开时窗口视觉透明，圆角恢复）；
- App.vue 现有 windowTransparent 判定（用于 window-opaque 类）扩展 win32 玻璃分支；
- 主题应用处（applyTheme）调用新 IPC 同步 overlay 颜色。

### 3.3 IPC

> **实施修正（2026-09-22）**：未新增独立 IPC——overlay 配色同步由两处既有机制承载：`settings:set`（patch.theme 变化时主进程直接调 `applyOverlayTheme`）+ `nativeTheme 'updated'` 监听（跟随系统主题）。windowEffect 新增导出 `applyOverlayTheme / overlayThemeFor`，`systemDark` 由调用方传 `nativeTheme.shouldUseDarkColors`（避免 windowEffect 引入 electron 运行时依赖破坏 vitest）。

- shared/api.ts + preload：~~新增 `setOverlayTheme(...)`~~（实施时取消，见上）；
- ~~registerIpc.ts：`window:set-overlay-theme` handler~~（实施时取消，见上）。

## 4. 分批实施

| 批次 | 内容 | 验收 |
| --- | --- | --- |
| B1 主进程 | createWindow WCO + backgroundMaterial + windowEffect 改造 + overlay IPC | Windows 窗口可拖动 / 关闭 / 调整大小 / 贴靠；材质可见；Win11 真机 |
| B2 渲染层 | 标题栏条 + 布局让位 + glass-on 半透明 + 主题联动 + 圆角联动 | 条区拖拽正常；深浅色按钮颜色正确；玻璃开 / 关切换干净 |
| B3 收尾 | 设置页文案 + 回归清单全项 + 文档（CHANGELOG / AGENTS 已知局限销账 / index.md / 设置页截图） | 回归清单逐项打勾 |

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| WCO 在部分 Win11 版本 / 缩放下的按钮区宽度异常 | 使用 env() 而非硬编码；真机 100% / 125% / 150% 缩放验证 |
| backgroundMaterial 与 setOpacity / hasShadow 组合的未定义行为 | B1 阶段矩阵实测（材质 × 透明度 50/100 × 深浅色）；异常组合在 windowEffect 内拦截 |
| 拖拽区吞掉顶栏交互（v0.3.5 tooltip 前科） | 标题栏条独立于卡片顶栏，无交互元素重叠；条内不放任何可点元素 |
| 主题切换竞态（overlay 颜色与 html.dark 不同步） | 同一调用点顺序执行；IPC 失败静默（颜色滞后一拍可接受） |
| v0.4.4 回归重演 | 硬约束：不碰 transparent: true；回归清单（需求 §5）逐项真机验收后才可发版 |

## 6. 实施记录（2026-09-22，分支 feature/custom-titlebar，已随 v0.7.0 发布）

已实施并验证（lint / 双 typecheck / 270 项测试含新增 5 项 windowEffect 材质用例；Win11 build 26200 真机：WCO visible、材质应用日志确认、标题栏条与布局正常）。实施中的三处修正 / 发现：

1. **§3.3 IPC 方案简化**：未新增独立 IPC，overlay 配色由 `settings:set` 主题分支 + `nativeTheme 'updated'` 监听承载（见 §3.3 修正注）。
2. **Win11 版本号陷阱**：Electron `getSystemVersion()` 在 Windows 11 仍返回 "10.0.x"（兼容性保留主版本号），材质支持须按 **build 号 ≥ 22000** 判定——按前缀 '10.' 判定会把 Win11 误降级（真机实测踩中并修复）。
3. **CDP 合成事件无法驱动系统级行为**：`-webkit-app-region` 拖拽与双击最大化走原生命中测试路径，CDP 注入的合成鼠标事件不触发——自动化验证只能覆盖 WCO visible / env 值 / DOM 结构，拖动与按钮需人工确认（已由用户真机验收）。

## 7. 玻璃三键区色差修复（2026-10-21，分支 `fix/glass-caption-theme-source`）

v0.21.0 UI 现代化改造后的已知残差（index 二节登记）：**玻璃（Mica / Acrylic）开启时三键区呈独立色块**，深色应用 + 浅色系统主题下反差最大（亮白色块）。

**根因确认**：`backgroundMaterial` 开启时 DWM **忽略 overlay 的 caption color**（v0.7.0 实施时已证实），三键区的深浅观感改由 **immersive dark mode** 窗口属性决定，而该属性跟随 **系统主题**而非应用主题——应用深色 + 系统浅色 → 系统按浅色绘制 caption 区，与深色页面割裂。非玻璃下无此问题（overlay 实色生效，v0.21.0 已对齐画布色）。

**修法（候选①，一行级）**：`windowEffect.syncNativeThemeSource(settings)` 把 `nativeTheme.themeSource` 与应用主题（`settings.theme`，`'light' | 'dark' | 'system'` 同构直赋）对齐——系统侧 caption 绘制随之跟随应用主题；调用点 = `createWindow` 初始化 + `settings:set` 主题分支（`applyOverlayTheme` 之前，随后的 `nativeTheme 'updated'` 触发 overlay 重设，候选①要求的「重设 overlay」由既有监听天然覆盖）。**仅 Windows 生效**（WCO 平台；macOS vibrancy 自按显式主题选型、Linux 无此绘制层）；渲染端 `prefers-color-scheme` 仅 `theme='system'` 时消费（`stores/app.ts`），`themeSource='system'` 行为不变，显式浅/深时与 App 主题一致属预期。

**验证**：单测 +3（win32 显式深/浅/系统/缺省写入与非 Windows 不触碰），全仓回归；三键区观感须真机确认（DWM 绘制层，CDP 无法截取）——深色 App × 浅色系统、浅色 App × 深色系统、跟随系统、玻璃开关切换四象限。

### 7.1 候选③落地：Windows 玻璃下标题条整条实色（2026-10-21 同日）

候选①上真机后用户确认：三键区已从「跟随系统的亮白块」变为跟随应用主题的深色带（色差方向问题解决），但**玻璃下三键区与标题条仍有拼接分界**——三键区是 DWM 实色绘制、无法透材质（系统层硬约束，Electron 无控制入口，候选②不可行），而标题条挖洞透出材质。用户拍板走**候选③（视觉收口）**：Windows 玻璃下标题条不再挖洞，`html.platform-win.glass-on .app-shell` 在标题条高度内铺实色 `--bg-secondary`（与三键区 overlay 色 / 非玻璃画布完全同值），标题条以下维持 55% 叠色透材质——整条观感统一（Win11 原生应用形态：记事本 / 资源管理器的标题栏即整条实色），材质感由内容区承担。非 Windows 玻璃（macOS vibrancy / Linux 合成器）无系统三键区，保持挖洞透材质不变。已知残差：DWM 自绘深色与 `--bg-secondary` 若存在肉眼可辨的色温差（系统侧定色，应用无法读取），需真机确认后再定是否微调条色。

**真机验证：2026-10-21 用户确认通过（「观感好不少」）**——深浅主题下标题条整条（含三键区）观感统一无拼接分界，玻璃开关与显式深浅切换即时生效；DWM 自绘深色与 `--bg-secondary` 未辨出可辨色温差，无需微调条色。玻璃标题栏问题线收口。

## 8. 竞品参考：语雀桌面端标题栏方案（2026-10-21 勘察，自绘路线的完整样本）

> 勘察方法：反解用户本机安装的语雀 4.2.2（`resources/app.asar`，构建信息显示 Electron 30.5.1 / 蚂蚁集团），比 2022 年的公开文章更贴近现状。价值：这是「frameless + 全自绘标题栏」在成熟中文生产力应用里的完整落地样本，若将来重开「三键透材质 / caption 完全融入玻璃」的需求（WCO 路线的天花板，见 §7），本文是实现路径的现成地图。

### 8.1 他们的实现（asar 反解实锤）

- **窗口形态**：全部窗口 `titleBarStyle: 'hiddenInset'`（Windows 上等价 `hidden`），**整个包无任何 `titleBarOverlay`**——Windows 即完全 frameless，系统三键不存在；偏好设置右上角的最小化 / 最大化 / 关闭是**渲染层自绘 HTML 按钮**。
- **按钮行为**：IPC 事件 `CURRENT_WINDOW.MINIMIZE` / `TOGGLE_MAXIMIZE` → 主进程 `win.minimize()` / `toggleMaximize()`；拖拽区靠 `-webkit-app-region`，类名 `__lark_drag_element__`（内部基建沿用 lark/飞书系命名）；macOS 用 `trafficLightPosition: {x:6, y:6}` 摆原生红绿灯。登录窗 `frame: isWin`（Windows 反而留框）。
- **深浅主题窗口层**（对应其「暗黑 / 浅色 / 跟随系统」下拉，`main/init/color-theme.js`）：
  1. `nativeTheme.themeSource = 用户主题` ——与本设计候选①完全同款；
  2. 每窗口 `getNativeWindowHandle()` 取 hwnd，调 npm 包 **`electron-windows-titlebar`** 的 `switchDarkMode(hwnd)` / `switchLightMode(hwnd)`——按窗口改 Win32 immersive dark mode 属性（DWMWA_USE_IMMERSIVE_DARK_MODE），保证边框等系统绘制位跟随主题。
- **公开资料**：《[语雀桌面端技术架构实践](https://developer.aliyun.com/article/1030667)》（阿里云 2022-09，架构总览）、[CSDN 转载可读版](https://blog.csdn.net/qq_32198115/article/details/126974352)、[electron-windows-titlebar（npm）](https://github.com/electron-modules/electron-windows-titlebar)。标题栏细节文章未展开，以 asar 反解为准。

### 8.2 为什么语雀没有「玻璃三键」问题，以及 Trace 的取舍

自绘方案下 DWM 根本不参与画 caption——按钮是 HTML 层，颜色随意、透材质随意，本设计 §7 的所有 DWM 硬约束对它不存在。代价是原生行为全要自补：hover / 按压态、Win11 贴靠布局面板（拖到最大化按钮弹出）、双击标题栏最大化、可访问性；且自绘按钮永远「长得像」而非「就是」系统按钮。**Trace 选 WCO 正是为保留这些原生行为**（§2 决策），玻璃 caption 的限制是这一决策的内生代价，已由候选①+③收口到当前系统条件下的最优形态。结论：路线不变；自绘是将来「caption 完全融入材质」的唯一路径，属于「整窗视觉 vs 原生行为」的根本取舍，非 bug 修复范畴——若立项按本文 §8.1 地图评估工时（拖拽 / 双击 / 贴靠替代 / 多窗口 DPI 适配 / 可达性，预估为人周级专项）。

### 8.3 平台矩阵：自绘路线在 macOS / Linux 的真实成本（2026-10-21 补充，防踩坑）

若将来立项自绘，按平台拆开看成本差异极大，**不能把 Windows 的结论外推到全平台**：

- **macOS——无自绘必要，近乎零成本**：`titleBarStyle: 'hidden'` 下系统**仍然绘制原生红绿灯**（Electron 官方文档明确），业界做法（VS Code / 语雀）都是保留原生灯 + `hiddenInset` 内缩 + `trafficLightPosition` 摆位，**没有人在 mac 上自绘按钮**。自绘反而更糟：红绿灯的焦点态（激活彩色 / 失焦灰）、全屏自动隐藏、系统偏好的双击行为全要自己模拟且达不到原生质感。实际要处理的只有小事：全屏进出时 HTML 布局给悬浮红绿灯让位、「双击标题栏缩放」系统偏好与拖拽区的配合实测、坚持 `hiddenInset` 路线不碰 `transparent`（保住系统圆角与阴影）。成熟度高，风险低。
- **Linux——自绘的主战场，坑集中地**：
  1. **WCO 官方其实也支持 Linux**（Electron 文档明确 `titleBarOverlay` 为 Windows + Linux）——Linux 上三键甚至可以不自绘，但实现走 GTK CSD，观感跟随 GTK 主题，社区有 `symbolColor` 不生效、不同 DE 表现不一的反馈，成熟度不如 Windows；
  2. **拖拽与边缘 resize 是硬坑**：`-webkit-app-region: drag` 在 X11 可用；**原生 Wayland** 下 frameless 的拖拽 / 边缘 resize 是 Electron 长期坑区——多数 Electron 应用默认跑 XWayland（Electron 默认 X11 后端）掩盖了问题，Ubuntu 24.04+ 默认 Wayland 的趋势下会逐渐暴露；
  3. **失去服务端装饰（SSD）**：窗口阴影没了、圆角要 CSS 模拟——Trace 在 Linux 已踩过合成器直角轮廓残留（AGENTS 已知局限），frameless 会放大这类合成器怪癖；
  4. **DE 偏好无法跟随**：GNOME / KDE 用户可把标题栏按钮放左边、换图标主题、自定义双击动作，自绘按钮永远是固定形态；
  5. **测试矩阵爆炸**：GNOME / KDE × X11 / Wayland × HiDPI 缩放，组合数远超另两平台。
- **Yuque 样本的局限**：语雀官方只有 Windows / macOS 包，没有 Linux 版——其自绘方案在 Linux 上从未被验证，**不能当作 Linux 可行性的证据**。
- **若立项的合理形态：平台分级**——只有 Windows 存在「自绘 vs WCO」的决策点（动机 = 三键透材质）；mac 永远保留原生灯（近乎白送）；Linux 先试 WCO 或维持现状原生标题栏。自绘的真实成本集中在 Windows 单平台 + Linux 验证面。符合既有纪律（[tech_electron-platform 教训 2](../../tech/tech_electron-platform.md)：平台分支是回归重灾区，平台改动必须带硬性回归清单）。
