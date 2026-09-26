# tech_product-interaction — 产品与交互经验

> 来源：由 `requirements/lessons.md`（2026-09-26 全仓教训梳理）拆分。需求语义以 [PRD](../requirements/requirements.md) 的 FR 编号为准，本文件只记录交互设计背后的「为什么」。

1. **Esc 分级消费的分支顺序按用户意图排**：悬浮预览 → 补全面板 → 心流退出（两者同开时用户要的是先关预览；初版顺序反了）。应用级 Esc 回退逐级消费、消费即阻断下沉。（[flow-reference-enhance 设计 §5](../requirements/2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
2. **悬浮预览的「一瞥」语义**：点击编辑区 / 开始输入 / 切换笔记自动收回；固定需显式操作（磁铁按钮）。补全预览不切换、不插入、看完即收回——「看一眼就回来」与「跳转」是两类需求，前者不丢上下文。（[index 第一节 v0.3.6](../requirements/index.md)、[flow-mode 设计 10.3.1](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
3. **音效音色迭代的两个工程经验**：① 实录音复刻走「离线分析 → 参数化重建」口径（ffprobe → 帧包络 → 击打检测 → FFT 频段占比 → biquad 逐频段包络），不随包音频文件（版权 + 体积）；② 多层叠加音效的响度关系要**分层定标、构造保证**——按整段峰值归一化时，棘轮噪声尖峰会随机压制按键「咔」（4 个噪声种子里 3 个的全局峰值落在棘轮/铃上），不能靠噪声运气。（[flow-mode 设计 10.5–10.8](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
4. **枚举 / 结构类设置项的演进要照顾旧值**（持久化迁移 + 运行时兜底 + 未发布值不需要用户提示）；用户实测反馈驱动的观感参数（渐变宽度 / 音色配比 / 屏蔽窗口时长）调完后要在设计文档记录**可调项入口**，便于下次按需微调而不再全链排查。（[flow-mode 设计 10.8 / 10.7](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
5. **中文输入是主场景**：凡涉及输入行渲染 / 折行 / 光标定位的改动，先想 IME（组词锚点不可破坏、CDP 测不出、必须真机）；行尾拉丁字母整词折行与多数编辑器一致，属已知观感项不是 bug。（[AGENTS.md](../../AGENTS.md)、[index 第二节](../requirements/index.md)）
6. **「用户实测反馈」是最高优先级需求来源**：v0.8.x 几乎每个补丁版都来自真机使用反馈；反馈修复要做**真机场景的逐字复现**，复现不到时用「同类根因」的可复现证据替代并如实记录差异（打字机锚定修复案例：原现象未复现，以字号变化造出同类静默几何变化作为证据）。（[flow-mode 设计 10.9](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
