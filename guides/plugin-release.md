# 插件发布指南（上架 Trace 市场）

> 将插件发布到应用内「插件市场」，需要：① 打包 `.trace-plugin`；② 在源码仓库打 Release 上传资产；③ 向索引仓库提 PR 登记。三步都完成后，用户即可在 设置 → 插件 → 插件市场 中看到并安装。

## 前提

- 插件符合开发规范（自包含、manifest 正确），参见 [plugin-development.md](plugin-development.md)
- 拥有一个公开的 GitHub 源码仓库

## 第一步：打包 .trace-plugin

`.trace-plugin` 就是 zip 压缩包，内容为插件目录的全部文件（manifest.json 必须在包根目录）：

```bash
# 在插件目录的上一级执行
cd my-plugin
zip -r ../my-plugin-1.0.0.trace-plugin .
```

也可从已安装插件导出：设置 → 插件 → 对应插件「详情」→「导出…」。

## 第二步：源码仓库打 Release

1. 提交并推送插件代码，打版本标签：
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```
2. 在 GitHub 仓库页面 → Releases → **Draft a new release** → 选择刚推的 tag
3. 上传 `my-plugin-1.0.0.trace-plugin` 作为附件（Asset）→ Publish

## 第三步：计算校验和

```bash
# macOS / Linux
shasum -a 256 my-plugin-1.0.0.trace-plugin

# Windows（PowerShell）
Get-FileHash my-plugin-1.0.0.trace-plugin -Algorithm SHA256
```

## 第四步：向索引仓库提 PR

1. Fork（或直接克隆）`imnot70/trace-plugins`，编辑 `trace-plugins.json`，在 `plugins` 数组登记：

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "description": "一句话描述",
  "author": "your-github-id",
  "repo": "your-github-id/my-plugin",
  "latest": "1.0.0",
  "versions": {
    "1.0.0": {
      "releaseTag": "v1.0.0",
      "asset": "my-plugin-1.0.0.trace-plugin",
      "sha256": "上一步计算的校验和",
      "permissions": ["notifications"],
      "releasedAt": "2026-09-21"
    }
  }
}
```

2. 提交 PR（仓库有 PR 模板，按模板填写插件信息与权限理由）
3. 等待维护者审阅：核对源码与权限声明、复算 sha256

## 合并之后

PR 合并即上架。用户在应用内点「安装」时：

- 应用从你仓库的 Release 下载资产
- **比对 sha256 与索引登记值**，一致才安装（所以发布后不要改动 Release 资产文件内容；有变更请新开版本）
- 展示权限清单供用户确认

## 更新版本

重复第二~四步：打新 tag → 上传新资产 → 提 PR 追加新版本条目并把 `latest` 改为新版本号。已安装用户会在应用内看到更新提示；若新版本新增了权限，用户需重新确认。

## 下架

提交 PR 删除索引中的条目。已安装用户保留使用，但应用内标记「已下架」且不再提示更新。
