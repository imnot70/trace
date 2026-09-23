# Windows 自定义标题栏 + 毛玻璃恢复技术设计

> 创建：2026-09-22 ｜ 状态：**设计完成，待实施** ｜ 需求见 [custom-titlebar.md](custom-titlebar.md)
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
