# market-index/ — 插件市场索引仓库脚手架

本目录存放 **`imnot70/trace-plugins`**（Trace 插件市场索引仓库）的初始化文件。

## 用途

Trace 应用内的插件市场（M4）从该仓库拉取 `trace-plugins.json` 获取插件清单；
插件的 `.trace-plugin` 安装包托管在各源码仓库的 GitHub Release 中，
索引文件登记每个版本的 sha256，应用下载后先比对校验和再安装。

## 初始化 / 同步方法

**前提：以下命令在 Trace 主仓库根目录执行**（即本 README 所在仓库的根目录，`market-index/` 的上一级）：

```bash
git clone git@github.com:imnot70/trace-plugins.git
cp -r market-index/repo/. trace-plugins/
cd trace-plugins && git add -A && git commit -m "init: 市场索引" && git push
```

说明：`cp -r market-index/repo/. ` 的「/.」写法会复制目录内**全部**内容（含 `.github` 隐藏目录）到 clone 出来的 `trace-plugins/` 文件夹。

之后索引的修改以 trace-plugins 仓库为准，本目录仅作种子备份。

## 治理规则（重要）

1. `trace-plugins.json` 的任何增改（收录 / 更新版本 / 下架）**必须走 Pull Request**，禁止直推 main
2. main 分支保护：要求至少 1 名维护者 review 后方可合并
3. 审阅要点：核对源码仓库与声明一致、权限声明与功能匹配、复算 sha256 与登记一致
4. PR 合并即上架 / 生效；删除条目即全网下架（已安装实例保留但停止更新推荐）
