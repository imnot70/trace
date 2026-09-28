# Vim 模式（FR-2.4.23）

> 2026-09-26 立项（用户提案池 [#5](../../suggest/feature-proposals.md) 迁入）。设计文档：[vim-mode_design.md](vim-mode_design.md)。**2026-09-28 已实施**（键位冲突策略四项已拍板，见设计文档第 2 节；待真机 IME / 键位手感验证）。工时评估（建议阶段）★★★☆，2~4 天。
>
> **包选型修正（2026-09-28 实装时发现）**：本文件初稿所写的「官方 `@codemirror/vim`」在 npm 上不存在，CM6 生态的 vim 集成事实标准是 **`@replit/codemirror-vim`**（Replit 维护），已按此实现。

## 需求背景

vim 用户期望编辑器支持 vim 键位（normal / insert / visual 等模式化编辑）。提案阶段已得出关键结论：**插件方案在当前架构下不可行**——插件运行在独立进程，插件 API（命令 / 状态区 / 工具栏声明）没有「编辑器扩展」注入能力，跨进程传 CM extension 会破坏进程隔离设计且工程远大于收益；因此采用**内置实现**，基于 `@replit/codemirror-vim` 包集成而非自研。

## 需求

### FR-2.4.23 Vim 编辑模式

- 设置 → 编辑器新增「Vim 编辑模式」开关，**默认关闭**；开启后源码与所见即所得模式均生效（都在 CM 层），心流 / 专注模式下同样可用（vim 用户正是「手不离键盘」的极致用户）；
- 集成 `@replit/codemirror-vim`（normal / visual / insert / replace 完整实现），经既有 Compartment 机制挂载；
- **键位冲突策略（2026-09-28 已拍板，明细见[设计文档第 2 节](vim-mode_design.md)）**：
  - **Esc**：浮层优先、心流退出让位——浮层类（浮层侧栏 / 悬浮预览 / 各弹窗 / `[[` 补全 / 查找面板）Esc 仍归应用级分级链；无浮层且编辑器聚焦时 Esc 归 vim（返回 normal）；退出心流改用 Alt+W / 顶栏咖啡杯；
  - **Ctrl 系**：应用优先——Ctrl+F 查找、Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+E 编辑形态、Ctrl+N 新建、Ctrl+T 表格仍归应用（vim 对应六键经 `Vim.unmap` 卸载）；vim 保留应用未占用的 Ctrl+D/U/Y/O/R/V/W/A/X；
  - **Alt 系**：vim 不绑定 Alt 组合，无冲突；
- **模式指示**（2026-09-28 拍板）：工具栏右端等宽小徽标（NORMAL / INSERT / VISUAL，配色按模式区分）；心流 / 专注（顶栏隐藏）下靠光标形状（normal 方块 / insert 竖线，包自带）；
- **IME 组词**：normal 模式下 IME 禁用（vim 惯例，包内经 inputHandler 透传）；中文输入 + vim 的组合必须真机验证（CDP 测不出，见 [tech_cm6-editor](../../tech/tech_cm6-editor.md)）；
- 补全交互：insert 模式补全正常；normal 模式补全关闭（vim 包既有行为）；
- 设置页开关旁附**冲突速查说明**（开关开启时显示）；
- 相对行号（2026-09-28 拍板）：首发不做，按真机反馈再议。

## 验收标准

1. 开关默认关；开启后 normal / insert / visual 基本操作可用，源码与所见即所得两模式一致；
2. 冲突矩阵逐条实测并有结论记录（Esc / Ctrl 系 / Alt 系），应用级键位（保存 / 搜索 / 新建 / 心流）行为符合拍板结论；
3. IME：insert 模式组词正常，normal 模式不误触发输入法（真机验证）；
4. 关闭开关后完全恢复现状（无残留模式、键位无变化）。

## 备注

- 建议先做「最小可用」：开关默认关 + 编辑器内 vim 优先策略 + 冲突速查文档，后续按反馈迭代；
- 真机验证项（IME + 键位手感）依赖 Windows / Linux 真机，排期时预留。
