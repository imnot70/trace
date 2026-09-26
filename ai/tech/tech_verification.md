# tech_verification — 验证方法学（CDP 与测试策略）

> 来源：由 `requirements/lessons.md` 与技术债评审 §四（2026-09-26 拆分归档）。隔离实例的启动方式、单实例锁、CDP 辅助脚本要点见 [HANDOFF.md](../requirements/changelog/handoff-2026-09-26.md)。

## CDP 验证纪律

1. **验证脚本自身要自证正确**：探针包装原生类（如 AudioContext）时子类方法必须透传参数（`(...a) => super.x(...a)`），漏传会让被测路径抛错、误判为产品 bug（音效验证踩中）；断言前先等旧态清场——屏上残留的上一条提示会被误读为新结果。（[flow-mode 设计 10.3](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
2. **CDP 原始字符按键在本环境不稳定**：文本输入改用 `execCommand('insertText')`（**focus 与输入必须放在同一 eval 里**）+ 磁盘真值断言；渲染态 DOM 对「源码层」断言不可靠（所见即所得会隐藏括号等标记）；CDP 直接 dispatch CM 事务不产生「用户输入」事件、不会触发补全，须经真实输入管线。（[index 〇.3](../requirements/index.md)、[flow-reference-enhance 设计 §5](../requirements/2026-09-25_flow-reference-enhance/flow-reference-enhance_design.md)）
3. **CDP 无法驱动真实输入法**：IME 相关（组词、候选框）只能真机验证（Windows 微软拼音 / Linux fcitx），自动化只能覆盖非 IME 路径。（[flow-mode 设计 10.4](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
4. **探针读数要选可信来源**：打字机锚定验证读 `.cm-cursor` 元素会骗人（无焦点时高度为 0），改走 CM 自己的 `coordsAtPos`；「听」音效改为包装 `AudioContext` 计数探测（振荡器 / 噪声源 / 上下文创建数）。（[flow-mode 设计 10.9 / 10.3](../requirements/2026-09-23_flow-mode/flow-mode_design.md)）
5. **HMR 会重置 pinia 状态**——验证脚本要先确保前置状态（循环 ensure 而非假定）；**vite watcher 可能漏掉快速连续编辑的变更事件**（模块图停在中间态、同文件一半新一半旧，页面 reload 无效）——touch 文件强制重编译，验证前先核对服务的模块内容是否为最新。（HANDOFF、[index 〇.3](../requirements/index.md)）
6. **新起实例前必须 `pkill -9 -f "[e]lectron"` 并确认无残留**（单实例锁让新实例静默退出）；测试工作区固定 `/tmp/site-ws`，userData 固定 `$TMPDIR/trace-test-userdata` 可预写 settings.json。（HANDOFF）
7. **冷启动需要等就绪**：tree store 与搜索索引就绪前断言会假红。

## 测试策略（2026-09-25 评审结论）

- **现状**：三百余项单测 + 主/渲染双 typecheck 覆盖全部主进程服务与渲染 lib 层（强项）；**CM6 集成层（视图/组件）零测试**——而近年所有 P0 回归（键位 preventDefault、行号几何、打字机锚定）都出在这层；每次验证靠手搓 CDP 探针，交接记录中两次被探针自身缺陷误导。`playwright-core` 已在 devDependencies 闲置未用。
- **建议**：正式搭 Playwright for Electron 冒烟，先覆盖三条最易回归链路：① 心流进入 + 打字机锚定（三种打字机配置 × 进出心流）；② `[[` 补全 + Alt+Enter 预览 + 普通 Enter 插入；③ 预览初始位置与双向同步。把「发版前手测清单」逐步固化为脚本。
- gitService 集成测试在 Windows 的超时问题有既定口径（`--testTimeout=90000`），见 [tech_electron-platform](tech_electron-platform.md)。
