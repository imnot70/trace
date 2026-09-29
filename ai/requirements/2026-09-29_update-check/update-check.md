# 新版本检测（FR-2.10.6）

> 2026-09-29 立项并实施（用户提案 [index 待办 #9] 转正式需求）。设计决策三项已于当日拍板（见 §2）。

## 1. 背景

Trace 已有 Release（GitHub）、官网下载页，但应用自身不知道有新版本——用户需要主动到 GitHub / 官网查看。补上版本检测后，发布链路闭环：发版 → 用户端启动检查 → 轻提示 → 自行决定更新时机。

## 2. 需求与拍板决策（FR-2.10.6）

- **触发时机（拍板：每日节流 + 手动按钮）**：应用启动时静默检查（渲染端 localStorage 记上次检查时间，**24 小时内不重复请求**）；设置 → 关于提供「立即检查」按钮（绕过节流）。
- **提示形态（拍板：顶栏轻量入口）**：发现新版本时——编辑卡顶栏面包屑行出现常驻文字链「**有更新 v{版本}**」（accent 色、小胶囊，不弹窗不打断），点击打开 GitHub Release 页（更新说明 + 安装包下载）；设置 → 关于同步显示新版本号与链接。
- **更新边界（拍板：只提示 + 跳转）**：不自动下载安装包——本地优先理念，安装时机由用户自定。「忽略此版本」不做（节流 + 常驻轻入口的组合下必要性低）。
- **静默失败**：GitHub 不可达（无代理环境网络受限是常态）时检查静默失败，UI 显示「检查失败」仅出现在用户主动触发的场景，启动静默路径零打扰。

## 3. 设计

- **数据源**：`GET https://api.github.com/repos/imnot70/trace/releases/latest`（匿名，无需 PAT；单机每日 1–2 次远低于 60 次/时/IP 限速）。取 `tag_name`（剥 v 前缀 + 形态校验，远端数据不可信）与 `html_url`。
- **版本比较**：`isNewerVersion(current, latest)` 逐段数字比较（`0.10.0 > 0.9.0` 的字符串序陷阱规避），纯函数在 [shared/updateCheck.ts](../../../src/shared/updateCheck.ts)。
- **网络**：主进程复用插件市场的 `createMarketHttpClient`（UA / 30s 超时 / **跟随用户代理设置**——无直连环境配代理后检查同样可用）；渲染进程不碰网络（架构约束），经 IPC `update:check` 调用。
- **节流**：渲染端 localStorage `trace.updateCheckAt`；`shouldCheckUpdate(last, now)` 纯函数（24h 窗口）。
- **状态**：app store `updateInfo`（结果）+ `updateChecking`（防重入）；启动时 fire-and-forget 调用不阻塞首屏。

## 4. 实施记录（2026-09-29）

| 文件 | 内容 |
| --- | --- |
| `src/shared/updateCheck.ts` | 新增：`UPDATE_REPO` / `UPDATE_API_URL` / `UPDATE_CHECK_INTERVAL_MS` 常量、`UpdateCheckResult` 类型、`parseLatestVersion` / `isNewerVersion` / `shouldCheckUpdate` 纯函数 |
| `src/main/services/updateCheck.ts` | 新增：`checkForUpdate(client, currentVersion)`——注入 `MarketHttpClient` 形状的客户端（getText），200 → 解析比较；非 200 / 缺字段 / 网络异常一律 `{ ok: false }` 静默 |
| `src/main/index.ts` | 复用市场 HTTP 适配器构造闭包 `checkForUpdate`，注入 registerIpc |
| `src/main/ipc/registerIpc.ts` | `IpcDeps.checkForUpdate` + `handle('update:check')` |
| `src/preload/index.ts` / `src/shared/api.ts` | `checkForUpdate()` 类型化暴露 |
| `src/renderer/src/stores/app.ts` | `updateInfo` / `updateChecking` 状态 + `runUpdateCheck(force)` action（节流 + localStorage） |
| `src/renderer/src/App.vue` | 启动 `void app.runUpdateCheck()`（fire-and-forget，不阻塞首屏） |
| `src/renderer/src/views/EditorView.vue` | 顶栏「有更新 vX.Y.Z」轻量入口（面包屑行内，`.update-entry` 样式） |
| `src/renderer/src/views/SettingsView.vue` | 关于区块「立即检查」按钮 + 四态状态行（检查中 / 有更新 / 已最新 / 失败） |
| `tests/updateCheck.test.ts` | 15 项：版本比较 5（含 0.10 vs 0.9 数字序陷阱）/ tag 解析 2 / 节流 3 / service 桩 5（200 新旧版本 / 非 200 / 网络异常 / 缺字段） |

## 5. 验收与验证

1. 启动静默检查节流：24h 内重启不重复请求（localStorage 断言）；✅ 单测
2. 「立即检查」绕过节流真实请求：当前 v0.13.0 = latest → 显示「已是最新版本」；✅ CDP 实测
3. 有更新场景：顶栏「有更新 vX」入口出现且链接指向 Release 页；✅ 单测（比较）+ CDP（store 注入后入口渲染与链接）
4. 检查失败静默：✅ 单测（网络异常 / 非 200）
5. 无代理直连 GitHub 失败的环境：检查失败不弹任何错误（仅设置页状态行提示）——真机验证项

## 6. 已知边界

- API 请求跟随用户代理设置（复用市场适配器）；无代理且 GitHub 不可达的环境下功能不可用（静默）——已在长期观察清单登记（#4）；
- 不做自动下载（本地优先）；不做「忽略此版本」（轻入口常驻 + 节流的组合下无打扰问题）；
- 预发布 / beta channel 不识别（仓库无 beta 发布惯例）。
