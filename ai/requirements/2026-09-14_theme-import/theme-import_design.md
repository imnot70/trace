# 主题包导入（自定义主题）

## 问题

现有主题只有内置浅色/深色两套 + 3 套预设（暖色/冷色/高对比度），用户无法使用自选配色。FR-2.9.7 预留了「自定义主题包（一组变量覆盖文件）」接口，本次落地该接口。

## 目标与范围

- 从本地 JSON 文件导入自定义主题（一组 CSS 变量，含浅/深两套）；
- 设置页「外观 → 配色」中管理与使用：导入、删除；
- 导入后与内置预设并列显示、可即时切换。

**不做**：导出/分享、重命名、拖拽导入、在线主题市场、任意 CSS 规则（字体/背景图/动画）。

## 数据格式

主题包为单个 `*.json` 文件，结构与现有 `ThemePreset` 对齐：

```json
{
  "id": "sakura",
  "name": "樱花",
  "light": { "--accent": "#e07a9b", "--bg-primary": "#fff7f9" },
  "dark": { "--accent": "#f2a3bd", "--bg-primary": "#1e1519" }
}
```

### 字段规则

| 字段 | 规则 |
| --- | --- |
| `id` | 必填；`^[a-z0-9][a-z0-9-]{0,63}$`；不得与保留 id（`default`/`warm`/`cool`/`high-contrast`）冲突 |
| `name` | 必填；trim 后长度 1–30 |
| `light` / `dark` | **必须同时存在且为对象**；对象可为空（空 = 全部继承默认 Trace 配色） |
| 变量键 | 必须属于 19 项白名单（见文末） |
| 变量值 | 非空字符串、≤64 字符、匹配 `^[#a-zA-Z0-9(),.%\s/-]+$` 且不含 `url(`（显式拦截）；禁止 `; : { } < > " ' \` 等结构字符，阻断 CSS 声明逃逸与 `url()` 外链 |

未知字段 / 未知变量 **拒绝导入** 并给出具体错误（如「未知变量 `--accent-hover`」）。

## 存储与生命周期

- 落盘 `userData/themes/<id>.json`，内容为**规范化后的** `{ id, name, light, dark }`（仅保留白名单键，杜绝脏字段回灌）。
- 设置中的 `themePreset` 仍只存 id 字符串，不新增设置字段。
- 同 id 重复导入 = **覆盖更新**（导入前由渲染层弹确认）。
- 删除当前正在使用的主题、或 id 失效（文件被外部删除）→ 自动回退 `default`。

## 主进程

### 新增/改动文件

| 文件 | 作用 |
| --- | --- |
| `src/shared/types.ts` | 新增 `ThemePackage` 接口（`id` / `name` / `light` / `dark`） |
| `src/shared/api.ts` | `TraceApi` 增加 `listThemes` / `importTheme` / `saveTheme` / `deleteTheme` |
| `src/main/lib/themePackage.ts`（新） | 白名单常量 + 纯函数 `validateThemePackage(raw)`（返回规范化 `ThemePackage` 或错误） |
| `src/main/services/themes.ts`（新） | `ThemeService`：`list()` / `importFile(srcPath)` / `save(theme)` / `remove(id)` |
| `src/main/ipc/registerIpc.ts` | 注册 `theme:*` 通道 |
| `src/preload/index.ts` | 暴露对应 API |

### ThemeService 行为

- 目录：`path.join(app.getPath('userData'), 'themes')`，首次访问时 `mkdir -p`。
- `importFile(srcPath)`：读文件 → `JSON.parse` → `validateThemePackage` → 返回 `{ ok, theme }`，**不写盘**（供渲染层先做覆盖确认）。
- `save(theme)`：**再次校验**（防御）→ 原子写入 `themes/<id>.json`（规范化内容，UTF-8；tmp + rename）。
- `list()`：读取目录下 `*.json`（扩展名大小写不敏感），逐个解析；文件名须与主题 `id` 一致，否则跳过（防文件名与内容 id 不一致时 `remove` 删错文件产生「幽灵主题」）；**无效文件静默跳过**，按 `name` 排序。
- `remove(id)`：先校验 `id` 合法性（防路径逃逸），再删除对应文件；文件不存在也算成功。

### IPC 通道

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `theme:list` | — | `{ ok, themes }` |
| `theme:import` | — | `{ ok, theme }` / `{ ok:false, canceled?:true, error? }`（弹 `showOpenDialog`，`filters: [{ name: '主题包', extensions: ['json'] }]`） |
| `theme:save` | `theme` | `{ ok }` / `{ ok:false, error }` |
| `theme:delete` | `id` | `{ ok }` / `{ ok:false, error }` |

拆分 `import` + `save` 两步，使「同 id 覆盖确认」留在渲染层的确认弹窗，一次文件对话框即可完成。

## 渲染层

### 类型复用

`shared/types.ts` 定义 `ThemePackage`；`styles/presets.ts` 的 `ThemePreset` 改为它的别名（结构完全相同，避免重复定义）。

### `stores/app.ts`

- state 新增 `customThemes: ThemePackage[]`。
- `init()` 的 `Promise.all` 增加 `window.trace.listThemes()`，填充 `customThemes`，再 `applyTheme()`。
- `applyTheme()` 的查找源由 `THEME_PRESETS` 改为 `[...THEME_PRESETS, ...customThemes]`；找不到（含 id 失效）时清空覆盖 = 回退默认。
- 新增 action（只做数据，弹窗/toast 留在视图层）：
  - `importThemeFile()` → 调 `importTheme`，返回 `{ theme?, canceled?, error? }`；
  - `saveTheme(theme)` / `deleteTheme(id)` → 调 IPC 后重载 `customThemes`；
  - `reloadCustomThemes()` → `listThemes`。

### `views/SettingsView.vue`（外观 → 配色）

- 现有网格末尾追加虚线「＋ 导入主题」卡片，点击触发导入。
- `customThemes` 渲染为与内置预设同样的色块卡片，悬停时右上角显示删除图标。
- 卡片点击 → `updateSettings({ themePreset: preset.id })`。
- 导入流程：`importThemeFile()` → 取消则静默；`error` 红色提示具体校验错误；成功且 id 已存在 → `ElMessageBox.confirm('已存在同名主题，覆盖？')` → `saveTheme()` → 刷新并自动选中新主题。
- 删除当前主题后，若 `themePreset === id` 则 `updateSettings({ themePreset: 'default' })`。

**不改动**：明暗 radio、`main.css` 默认值、注入机制（`buildThemeCss` 原样复用）。

## 错误处理

- 读文件失败 / JSON 解析失败 / 校验失败 → `theme:import` 返回 `{ ok:false, error }`，渲染层红色提示具体原因（如「不是合法 JSON」「缺少 light/dark」「未知变量 --x」「id 格式非法」）。
- 目录不存在 → `list()` / `save()` 自动创建。
- `list()` 中损坏的单个文件静默跳过，不影响其它主题。
- 外部删除当前主题文件 → 重载后 `applyTheme` 找不到，回退默认；重启必定回退。
- 路径安全：仅用受正则约束的 `id` 拼接文件名，无路径逃逸风险。

## 测试

- `tests/themePackage.test.ts`：校验纯函数正/反用例——合法（含部分覆盖）、缺 `light`/`dark`、未知变量、非法值（含 `;`/`}`）、非法 id、保留 id、name 超长/空。
- `tests/themes.test.ts`（轻量）：临时目录验证 `save → list → remove` 闭环与损坏文件跳过。
- 现有测试不受影响，不新增 e2e。

## 附：白名单变量（19）

`--bg-primary`、`--bg-secondary`、`--bg-tertiary`、`--bg-hover`、`--bg-active`、`--text-primary`、`--text-secondary`、`--text-tertiary`、`--border-color`、`--accent`、`--accent-soft`、`--danger`、`--code-bg`、`--hljs-base`、`--hljs-comment`、`--hljs-keyword`、`--hljs-string`、`--hljs-number`、`--hljs-title`。

> 现有设计文档曾写「21 个变量」，实际预设使用 19 个，以本文白名单为准。
