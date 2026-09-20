# trace-plugins — Trace（笔迹）插件市场索引

Trace 应用内插件市场的官方索引仓库。应用从这里获取插件清单，并下载、校验、安装插件。

- 插件安装包托管在各插件源码仓库的 **GitHub Release**（资产为 `.trace-plugin` 格式，即 zip 自包含包）
- 本仓库 `trace-plugins.json` 登记：插件信息、每个版本的资产名与 **sha256**、声明的权限
- 应用下载安装包后先比对 sha256，与索引登记不一致的一律拒绝安装

## 收录 / 更新 / 下架

全部通过 Pull Request，合并前需维护者审阅（权限与功能匹配、sha256 复算一致）。

- **收录**：提交 PR 在 `trace-plugins.json` 的 `plugins` 数组中登记插件
- **更新**：提交 PR 追加新版本条目并更新 `latest`
- **下架**：提交 PR 删除对应条目（已安装用户保留使用，仅停止更新推荐）

PR 请使用模板（`.github/PULL_REQUEST_TEMPLATE.md`）并逐项填写。

## 开发插件

参见 Trace 主仓库 `guides/plugin-development.md` 与类型包 `@trace/plugin-api`。
