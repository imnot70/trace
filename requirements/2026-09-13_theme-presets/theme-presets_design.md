# 预设主题包

## 问题

当前主题只有浅色/深色两套配色，无法满足个性化需求。FR-2.9.7 预留了「自定义主题包（一组变量覆盖文件）」接口。

## 方案

新增 3 套预设配色（暖色、冷色、高对比度），每套含浅色/深色变体。原有默认主题保留为「Trace」。

### 范围

改动 6 个文件，新建 1 个文件。

### 1. 主题数据（`renderer/src/styles/presets.ts`，新建）

每套主题 = 21 个 CSS 变量的 light/dark 覆盖值：

```ts
export interface ThemePreset {
  id: string        // 'default' | 'warm' | 'cool' | 'high-contrast'
  name: string      // 'Trace' | '暖色' | '冷色' | '高对比度'
  light: Record<string, string>
  dark: Record<string, string>
}
```

`default` 主题不在此数组中（它就是 `main.css` 的 `:root` / `html.dark`，无需覆盖）。

预设配色方案：

| 主题 | 特征 | accent（浅/深） |
|------|------|----------------|
| 暖色 | 橙棕调，温暖柔和 | `#d97706` / `#f59e0b` |
| 冷色 | 蓝紫调，清新冷静 | `#6366f1` / `#818cf8` |
| 高对比度 | 纯黑白底 + 高饱和强调色 | `#0066cc` / `#3399ff` |

每套还需覆盖 `--bg-*`、`--text-*`、`--border-color`、`--code-bg`、`--hljs-*` 等全部 21 个变量。

### 2. 类型扩展（`shared/types.ts`）

`AppSettings` 新增 `themePreset: string`（默认 `'default'`）。

### 3. 主题应用（`stores/app.ts`）

- `DEFAULT_SETTINGS` 新增 `themePreset: 'default'`
- `applyTheme()` 中：切换 `html.dark` 后，根据 `themePreset` 注入 CSS 变量覆盖
- 注入方式：维护一个 `<style id="trace-theme-preset">` 标签，切换时替换其内容
- `themePreset === 'default'` 时清空覆盖标签（使用 `main.css` 的默认值）

### 4. 设置页 UI（`SettingsView.vue`）

主题选择区改为 2 列网格卡片，每个卡片：
- 左侧 3 个色块预览（`--bg-primary`、`--accent`、`--danger`）
- 右侧主题名称
- 选中项高亮边框（`--accent`）

明暗切换（浅色/深色/跟随系统）保持现有 radio 不变，与主题包选择独立。

### 5. 持久化

`themePreset` 通过现有 `settings.json` 持久化（`updateSettings` → IPC → 磁盘），不新增文件。

## 不做的事

- 不支持导入用户自定义 CSS 文件（YAGNI，后续可扩展）
- 不提供颜色选择器 UI（太复杂）
- 不做主题预览弹窗（卡片色块够用）
- 不改 `main.css` 的默认变量值
