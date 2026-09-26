# tech_electron-platform — Electron / 平台 / 打包与 CI 踩坑

> 来源：由 `requirements/lessons.md`（2026-09-26 全仓教训梳理）拆分。发版流程与 CI 的完整约定见 [AGENTS.md](../../AGENTS.md)。

1. **Windows 上禁止 `transparent: true` 创建窗口**（v0.4.4 严重回归：剥离原生标题栏与可调边框，窗口无法移动 / 关闭）：玻璃材质走 WCO（`titleBarStyle: 'hidden'` + `titleBarOverlay`）+ `backgroundMaterial` 实现。（[custom-titlebar 设计](../requirements/2026-09-22_custom-titlebar/custom-titlebar_design.md)、[AGENTS.md](../../AGENTS.md)）
2. **平台分支是回归重灾区**：平台相关改动严格限定 `win32` 分支，macOS / Linux 行为零变化要写成**硬性回归验收清单**（v0.4.4 教训转验收）。（[custom-titlebar §5](../requirements/2026-09-22_custom-titlebar/custom-titlebar.md)）
3. **Linux 系统合成器会在窗口边界外做方形绘制**：透明窗口底部圆角在浅色壁纸下残留直角轮廓，应用侧无法彻底消除——Linux 一律禁用内容区底部圆角规避（v0.5.1）。（[index 第一节](../requirements/index.md)）
4. **Linux 重新 `npm install` 后 Electron 可能启动失败**（AppArmor 限制非特权用户命名空间 + chrome-sandbox 无 SUID）：`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox` 修复，每次重装依赖后需重做。（[AGENTS.md](../../AGENTS.md)）
5. **Windows 上 gitService 集成测试超时是环境慢不是 bug**（每次 git 子进程 1~1.7s，本机实测整文件 148s）：用 `npx vitest run tests/gitService.test.ts --testTimeout=90000` 区分环境与真回归。（[AGENTS.md](../../AGENTS.md)）
6. **CI 细则**：多行 bash run 步骤在 Windows runner 必须显式 `shell: bash`（默认 pwsh 解析不了）；electron-builder 的 `${arch}` 在不同 target 渲染不一致（deb→amd64、AppImage→x86_64、exe→x64），`artifactName` 架构位写死 `x64`（加 arm64 时需按 target 分别配置）；发版仅由 tag 驱动且 CI 校验 tag 与 package.json 一致；CI 中 electron-builder 前必须先 `npm run build` 与 `npm run fetch:git`。（[AGENTS.md](../../AGENTS.md)）
7. **GitHub Pages 首跑失败（configure-pages HttpError: Not Found）**：仓库 Pages 从未启用且 GITHUB_TOKEN 无管理员权限，`enablement: true` 自愈不了——需一次性到仓库 Settings → Pages 把 Source 切换为「GitHub Actions」再 Re-run。（[suggest/github-pages-site.md](../suggest/github-pages-site.md)）
8. **simple-git 对 `binary` 路径做字符白名单校验**（不允许空格与非 ASCII）：传自定义 Git 路径必须同时设 `unsafe: { allowUnsafeCustomBinary: true }`，否则安装在 `C:\Program Files\…` 或中文用户名目录下抛 GitPluginError。（[AGENTS.md](../../AGENTS.md)）
