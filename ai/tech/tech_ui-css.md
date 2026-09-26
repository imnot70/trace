# tech_ui-css — 渲染 / 预览 / CSS 踩坑

> 来源：由 `requirements/lessons.md`（2026-09-26 全仓教训梳理）拆分。全界面颜色走 CSS 变量、Element Plus 变量映射到同一套变量的约定见 [AGENTS.md](../../AGENTS.md)。

1. **滚动容器的 `background-clip: content-box` 绘制不可依赖**（padding 由计算值撑出 + 内容被程序化滚动定位的场景）：实测只涂出内容顶部一块。改涂滚动内容的**直接子元素**（行号槽 + 内容层），自然随文档伸缩。（[flow-mode 设计 10.10](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
2. **渐变过渡带的接缝**：滚动条补偿量若误算进渐变段，实心段会比真栏边晚 24px 达全浓度，栏边处出现浓度跳变分界——渐变应在栏边前约 8px（仅吸收滚动条宽度差）即达全浓度。（[flow-reference-enhance 设计 §5](../requirements/2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
3. **hover-reveal 的外扩感应区（`::after`，inset 负值）是定位元素，会挡住流内元素的点击**——hover 能显现、点击无响应。修法：被挡元素提升绘制层级（`position: relative; z-index: 1`）。（[index 第四节 v0.8.4](../requirements/index.md)）
4. **scoped 样式对挂在组件根元素上的 class 不生效**（根元素没有该组件的 scoped 属性，规则从未命中，如 el-dialog 的 body 高度）——此类改用非 scoped 全局样式。（[index 第四节 v0.8.5](../requirements/index.md)）
5. **CSS 变量名写错时 `var()` 静默失效**（如引用未定义的 `--accent-light`，高亮完全丢失且无报错）——新颜色先查 `themes.css` 是否已有变量。（[index 第四节 v0.8.5](../requirements/index.md)）
6. **`el-tooltip` 只允许包裹非交互元素**（图标 / 纯文本）：tooltip 嵌 tooltip、tooltip 包按钮 / 下拉触发器都会失效（v0.3.5 起为禁令）；「点击后移除下拉菜单锚点元素」的操作需延迟 ≥300ms 或保持锚点可见（menu-hold 模式），否则 popper 在左上角闪现残影。（[AGENTS.md](../../AGENTS.md)、[index 第一节 v0.3.5](../requirements/index.md)）
7. **Element Plus 的集成摩擦（tooltip 禁令 / popper 闪影 / 事件载荷）在持续产生隐性成本**——技术债评审结论：**停止加深依赖**，新 UI 优先自有样式 + CSS 变量，EP 只留对话框 / 下拉 / 消息类。（[tech_architecture](tech_architecture.md) §选型评估）
8. **打字机留白的生命周期问题域**（两个收尾缺陷待重新设计 + 常规预览错位暂不修）：留白在生命周期结束时疑似被「僵尸实例」写回；上次 destroyed 方案引入新问题已放弃——**动留白前先聊方案**。（[index 第二节](../requirements/index.md)）
