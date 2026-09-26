# Windows 自定义标题栏 + 毛玻璃恢复需求

> 创建：2026-09-22 ｜ 状态：**已实施（随 v0.7.0 发布）**，实施记录见 [custom-titlebar_design.md](custom-titlebar_design.md) 第 6 节
> 背景：v0.4.4 毛玻璃功能在 Windows 上引发严重回归（transparent 窗口剥离原生标题栏，窗口无法移动 / 关闭），v0.4.6 降级处理——Windows 一律不透明原生窗口，毛玻璃退化为仅透明度。本功能恢复 Windows 的 Mica / Acrylic 体验，前置工程为自定义标题栏。

## 1. 目标

- Windows 上恢复 Mica / Acrylic 玻璃材质（`backgroundMaterial`），设置页的「窗口效果」在 Windows 恢复完整功能；
- 以 **Window Controls Overlay（WCO）** 替代被隐藏的系统标题栏内容区，保留原生窗口按钮与 Win11 贴靠布局；
- macOS / Linux 行为零变化（v0.4.4 教训：平台分支是回归重灾区，本次改动严格限定 win32 分支）。

## 2. 决策记录（2026-09-22，需求确认）

| # | 决策点 | 结论 | 理由 |
| --- | --- | --- | --- |
| D1 | 技术路线 | **WCO**（`titleBarStyle: 'hidden'` + `titleBarOverlay`），不做完全自绘 | 保留系统绘制三键（最小化/最大化/关闭）与 Win11 贴靠布局；VS Code 同款成熟方案；工作量约为完全自绘的一半；完全自绘需自补边缘调整大小、按钮命中区、双击行为等大量系统行为 |
| D2 | 平台范围 | **仅 Windows** 走 WCO + `backgroundMaterial`；macOS 原生标题栏 + vibrancy、Linux 原生标题栏 + 合成器路径完全不动 | 回归面最小化；两平台现有体验已完整 |
| D3 | 布局形态 | Windows 上新增**全局标题栏条**（约 36px 高，窗口最顶部）：左侧应用名「Trace 笔迹」，中段拖拽区（`-webkit-app-region: drag`），右侧预留 WCO 原生按钮区；内容卡片整体下移 | 独立条案比「卡片顶栏延伸进标题栏」实现简单、交互边界清晰（不与编辑器顶栏的 tooltip / 按钮纠缠），专注模式（隐藏编辑卡顶栏）不受影响 |
| D4 | 玻璃材质实现 | Windows 用 `backgroundMaterial`（'mica' / 'acrylic'）+ 带透明度的窗口背景色，**不再触碰 `transparent: true`**；渲染层玻璃模式下背景变量转半透明让材质透出 | v0.4.4 的教训条目（AGENTS.md「Windows 上不可使用 transparent: true」）转为硬性实施约束；`titleBarStyle: 'hidden'` 保留 WS_THICKFRAME（可调整大小、DWM 阴影），与 frame:false 有本质区别 |
| D5 | 降级矩阵 | Windows 10 / 不支持 backgroundMaterial 的环境：自动降级为现状（不透明 + 仅透明度），设置页提示；玻璃开关 `none` 恢复完全不透明 | 老系统用户不能被破坏 |

## 3. 功能需求

- FR-T1 Windows 标题栏条：应用名 + 全宽拖拽区（双击最大化 / 还原）+ 右侧原生按钮区预留（约 138px）；
- FR-T2 玻璃材质：设置「窗口效果」在 Windows 生效 Mica / Acrylic；`none` 时完全恢复现状；透明度滑杆继续可用（玻璃最佳效果在 100%）；
- FR-T3 主题联动：浅色 / 深色主题切换时 WCO 按钮颜色（symbolColor / color）动态跟随；
- FR-T4 玻璃模式下的内容半透明：侧栏 / 卡片背景转为带透明度，让材质透出；可读性不降级（文字层保持不透明）；
- FR-T5 设置页：Windows 上恢复完整效果说明；不支持材质的环境给出降级提示。

## 4. 非目标（首版不做）

- macOS / Linux 的自定义标题栏（现原生标题栏体验良好）；
- 完全自绘窗口按钮 / 自定义按钮动画；
- 多窗口（已作废）。

## 5. 回归清单（v0.4.4 教训转硬性验收）

1. Windows：窗口可拖动（标题栏条）、可关闭 / 最小化 / 最大化（WCO 按钮）、双击条区最大化还原、可边缘调整大小、Win11 贴靠布局可用；
2. Windows：玻璃开 → 关切换后窗口恢复完全不透明、内容圆角关闭（现状形态）；Win10 降级路径可用；
3. macOS / Linux：窗口行为与 0.6.1 完全一致（代码走查 + 平台构建确认无改动泄漏）；
4. 深浅主题切换 × 玻璃开关的组合矩阵下，WCO 按钮颜色与内容可读性正常；
5. 专注模式 / 顶栏热区 / el-tooltip 交互不受标题栏条影响。
