# Trace 会话交接文档（2026-09-26 第二批）

> 生成方式：ZCode handoff。给下一个会话的接手者：先读仓库里的 `requirements/index.md`（尤其「〇、当前工作快照」节），本文件补充快照之外的会话细节。**两者冲突时以仓库文档为准。**

## 当前状态一览

- **分支**：`feat/draft-notes`（基于 main v0.8.7+），已推送，待真机验证后合并发 v0.8.8；
- **main** = v0.8.7（a59e096 tag，当日已发 v0.8.3–v0.8.7 六个版本），工作区停在该分支；
- **测试基线**：364 项全绿（`npm test`）；typecheck / lint 0 错误。

## 本会话完成的工作（细节见 git log 与仓库文档）

### 已发布

1. **v0.8.3**：预览初始位置修复 + 心流 / 专注右下角状态区 + 心流快速查阅（补全面板 Alt+Enter 预览）+ Esc 分级（关预览留补全，后续微调）+ 反向链接胶囊点击修复；
2. **v0.8.4**：侧栏区块标题布局（+ 紧贴菜单名、角标统一最右）；
3. **v0.8.5**：加固批次（冲突流程四处修复 + 路径穿越安全洞 + 搜索索引增量 + 常用列表污染 + settings 白名单 + git 同步互斥 + watcher 补偿 + JsonStore 版本化）+ 心流写作底色（5 色 + 过渡开关）；
4. **v0.8.6**：FR-2.9.10 心流引用与速览增强（Esc 分级 / `[[` 扁平模糊匹配 / 搜索键盘导航与 Alt+Enter 预览 / 跨库插入校验）+ 行插入快捷键（Ctrl+Enter / Ctrl+Shift+Enter）+ 官方静态站点 + Pages 部署。

### 待发版（分支 `feat/draft-notes`，基于 main v0.8.7）

5. **v0.8.8 候选**：草稿笔记（FR-2.3.9）——Ctrl+N 写入 userData/scratch 伪库，侧栏「草稿」菜单，Ctrl+S 转正选库 / 目录（图片随迁），ScratchService + promoteDraft 编排 + 9 项新单测（364 全绿）。分支上另有：打字机滚动冷却（滚轮不回跳）+ Alt+W 进心流回焦 + Alt+T 打字机开关与状态图标（字母 T）+ 设置页说明文字下移。

### 技术债评审（已落盘）

- [tech-debt-2026-09-25.md](requirements/tech-debt-2026-09-25.md)：冲突流程 / 路径穿越 / 搜索索引 / 常用列表污染 / settings 白名单 / git 互斥 / watcher 补偿 / JsonStore 版本化——全部已修复（v0.8.5–v0.8.7）。

### suggest/ 建议存档目录（新建）

- [github-pages-site.md](requirements/suggest/github-pages-site.md)：Pages 架站指南（已上线 https://imnot70.github.io/trace/）；
- [flow-keyboard-workflow.md](requirements/suggest/flow-keyboard-workflow.md)：「手不离键盘」心流动线设计思路（P1/P2 已实现，P3 拖曳暂缓）；
- [feature-proposals.md](requirements/suggest/feature-proposals.md)：功能提案池 ×7（标签优化 / 内联新建 / 临时笔记→已立项 / 斜杠命令 / Vim 模式 / 分享 / 快速引入图片），含难度与工时评估。

## 待办清单（按建议顺序，详见 index 〇节）

| # | 事项 | 难度 | 工时 |
|---|------|------|------|
| 1 | 真机验证 feat/draft-notes（草稿创建 / 自动保存 / 菜单 / 转正含图片 / 搜索范围） | — | — |
| 2 | 合并 feat/draft-notes → main → 发 v0.8.8 | ★ | 0.5h |
| 3 | 心流引用 P3：三源拖曳生成引用 | ★★★ | 1~1.5 天 |
| 4 | 打字机留白两缺陷重新设计 | ★★★★ | 1~2 天 |
| 5 | 搜索支持标签维度 + 索引重构 | ★★★ | 2~3 天 |
| 6 | 行尾连续字母折行观感 | ★ | ~1h |
| 7 | 表格默认行列值设置 | ★ | 1~2h |
| 8 | 底色纹理观感调优（羊皮纸颗粒放大 / 书页去网格） | ★ | 0.5~1h |
| 9 | 音色打磨（外部阻塞：等新参考音频） | ★★ | — |
| 10 | IME 组词实机验证（外部阻塞：需真机） | — | — |

## 近期技术教训（防再踩，完整版见 index 〇.3）

- **CM 内置模糊过滤对中文不可靠**：wikilink 补全分支已 `filter: false`（源已过滤为准）；
- **滚动容器的 `background-clip: content-box`** 在打字机滚动场景下绘制脱节——底色纹理用子元素涂色（行号槽 + 内容层）替代；
- **候选项落成引用的括号语义按路径区分**：Enter 接受保留既有闭合；预览态插入整段替换并吸收残留 `]]`——两路不可混用同一函数；
- **CDP 原始字符按键在本环境不稳定**：验证时改用 execCommand / 磁盘真值断言代替；
- **草稿文件变更 watcher 看不到**（scratch 不在工作区）：自动保存后手动调 `search.updateFileIndex`；
- **验证脚本要自证正确**（探针残留 / 时序污染会误导排查——断言前先等旧态清场）。

## 本环境的开发工作流（实操要点）

- **隔离实例**：`TRACE_CDP=9222 TRACE_TEST_USERDATA=1 npm run dev`（后台跑），CDP 驱动验证；userData 固定在 `$TMPDIR/trace-test-userdata`，可预写 `settings.json` 指向 `/tmp` 下自建测试工作区；
- **⚠️ 单实例锁**：新起实例前必须 `pkill -9 -f "[e]lectron"` 并确认无残留（`ps aux | grep -c "[e]lectron"` 为 0），否则新实例静默退出；
- **CDP 辅助脚本**：WebSocket 连 `http://127.0.0.1:9222/json` 的 page target，`Runtime.evaluate`（`returnByValue` + `awaitPromise`）与 `Page.captureScreenshot`；
- **HMR 陷阱**：改渲染端代码后 HMR 会重置 pinia 状态——验证脚本要先确保前置状态（循环 ensure 而非假定）；
- **验证草稿笔记 / 底色纹理时**：测试工作区在 `/tmp/site-ws`（笔记库「笔记」，含 首页.md / 笔记B.md / 子目录/ 等）；
- **探针写法**：包装 AudioContext 等原生类时子类方法必须 `(...a) => super.x(...a)` 透传参数（漏传会让被测路径抛错，误判为产品 bug）。
