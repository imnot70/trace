# 主题包导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户从本地 JSON 文件导入自定义配色主题（浅/深两套 CSS 变量覆盖），在设置页与内置预设并列显示并管理（导入/删除）。

**Architecture:** 主进程新增纯校验函数 `validateThemePackage` 与文件型 `ThemeService`（存 `userData/themes/<id>.json`），经 `theme:*` IPC 暴露给渲染进程；渲染层把自定义主题并入预设查找源，用现有 `<style id="trace-theme-preset">` 注入机制应用。导入拆两步（`theme:import` 选文件并校验 → `theme:save` 落盘），使覆盖确认留在渲染层。

**Tech Stack:** TypeScript、Electron IPC、Pinia、Vue 3、Element Plus、Vitest。

## Global Constraints

- 注释、文档、UI 文案、commit message 一律使用**中文**。
- IPC 通道沿用「域:动作」命名（`theme:list` / `theme:import` / `theme:save` / `theme:delete`）。
- 全部界面颜色走 CSS 变量（`--bg-*` / `--text-*` / `--accent` / `--danger` 等），不得写死颜色。
- 不新增任何 npm 依赖。
- 每个任务结束前运行 `npm run lint` 与 `npm run typecheck`（或该任务指定的更窄命令）并确保通过。
- 主题变量白名单固定 19 项（见 Task 1）；主题 id 仅允许 `^[a-z0-9][a-z0-9-]{0,63}$`。
- 校验函数与 service 的错误信息为中文，直接呈现给用户。

---

## File Structure

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/shared/types.ts` | 改 | 新增 `ThemePackage` 接口 |
| `src/main/lib/themePackage.ts` | 新 | 变量白名单 + `validateThemePackage` / `isValidThemeId` 纯函数 |
| `src/main/services/themes.ts` | 新 | `ThemeService`：文件读/写/删 |
| `src/main/services/index.ts` | 改 | 导出 `ThemeService` |
| `src/main/index.ts` | 改 | 实例化 `ThemeService`，注入 IPC |
| `src/main/ipc/registerIpc.ts` | 改 | `IpcDeps.themes` + `theme:*` 通道 |
| `src/shared/api.ts` | 改 | `TraceApi` 增加 4 个方法 |
| `src/preload/index.ts` | 改 | 暴露 4 个方法 |
| `src/renderer/src/styles/presets.ts` | 改 | `ThemePreset` 改为 `ThemePackage` 别名 |
| `src/renderer/src/stores/app.ts` | 改 | `customThemes` 状态 + 导入/删除 action + `applyTheme` 查找源 |
| `src/renderer/src/views/SettingsView.vue` | 改 | 导入卡片、自定义主题卡片、删除、覆盖确认 |
| `tests/themePackage.test.ts` | 新 | 校验函数单测 |
| `tests/themes.test.ts` | 新 | ThemeService 单测 |
| `requirements/2026-09-14_theme-import/`（CHANGELOG / requirements.md / index.md） | 改 | 文档同步 |

---

### Task 1: 主题类型与校验纯函数

**Files:**
- Modify: `src/shared/types.ts`（在 `AppSettings` 接口之后追加）
- Create: `src/main/lib/themePackage.ts`
- Test: `tests/themePackage.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `ThemePackage { id: string; name: string; light: Record<string,string>; dark: Record<string,string> }`（`@shared/types`）
  - `THEME_VARIABLE_WHITELIST: readonly string[]`
  - `isValidThemeId(id: string): boolean`
  - `validateThemePackage(raw: unknown): { ok: boolean; theme?: ThemePackage; error?: string }`

- [ ] **Step 1: 写失败测试**

创建 `tests/themePackage.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { isValidThemeId, validateThemePackage } from '../src/main/lib/themePackage'

const valid = { id: 'sakura', name: '樱花', light: { '--accent': '#e07a9b' }, dark: {} }

describe('isValidThemeId', () => {
  it('接受小写字母数字连字符', () => {
    expect(isValidThemeId('sakura')).toBe(true)
    expect(isValidThemeId('my-theme-2')).toBe(true)
  })
  it('拒绝大写、斜杠、空与超长', () => {
    expect(isValidThemeId('Sakura')).toBe(false)
    expect(isValidThemeId('../x')).toBe(false)
    expect(isValidThemeId('')).toBe(false)
    expect(isValidThemeId('a'.repeat(65))).toBe(false)
  })
})

describe('validateThemePackage', () => {
  it('接受合法主题（允许部分覆盖与空对象）并规范化', () => {
    const r = validateThemePackage(valid)
    expect(r.ok).toBe(true)
    expect(r.theme).toEqual({ id: 'sakura', name: '樱花', light: { '--accent': '#e07a9b' }, dark: {} })
  })

  it('拒绝非对象输入', () => {
    expect(validateThemePackage('x').ok).toBe(false)
    expect(validateThemePackage(null).ok).toBe(false)
    expect(validateThemePackage([]).ok).toBe(false)
  })

  it('拒绝非法 id 与内置保留 id', () => {
    expect(validateThemePackage({ ...valid, id: 'Bad Id' }).error).toContain('id')
    expect(validateThemePackage({ ...valid, id: 'warm' }).error).toContain('保留')
  })

  it('拒绝空或超长的 name', () => {
    expect(validateThemePackage({ ...valid, name: '  ' }).error).toContain('name')
    expect(validateThemePackage({ ...valid, name: 'x'.repeat(31) }).error).toContain('name')
  })

  it('拒绝缺少 light 或 dark', () => {
    expect(validateThemePackage({ id: 'a', name: 'A', dark: {} }).error).toContain('缺少')
    expect(validateThemePackage({ id: 'a', name: 'A', light: {} }).error).toContain('缺少')
  })

  it('拒绝未知变量', () => {
    const r = validateThemePackage({ ...valid, light: { '--accent-hover': '#fff' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知变量 --accent-hover')
  })

  it('拒绝非法值（含声明逃逸字符）', () => {
    expect(validateThemePackage({ ...valid, light: { '--accent': '#fff; background: red' } }).error).toContain('值非法')
    expect(validateThemePackage({ ...valid, light: { '--accent': '' } }).error).toContain('值非法')
    expect(validateThemePackage({ ...valid, light: { '--accent': '#'.repeat(65) } }).error).toContain('值非法')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/themePackage.test.ts`
Expected: FAIL —— `Failed to resolve import "../src/main/lib/themePackage"`。

- [ ] **Step 3: 加类型**

在 `src/shared/types.ts` 的 `AppSettings` 接口（约第 111 行，闭合 `}`）之后追加：

```ts
/** 自定义主题包：一组 CSS 变量覆盖（light/dark 两套），存 userData/themes/<id>.json */
export interface ThemePackage {
  id: string
  name: string
  light: Record<string, string>
  dark: Record<string, string>
}
```

- [ ] **Step 4: 实现校验器**

创建 `src/main/lib/themePackage.ts`：

```ts
import type { ThemePackage } from '@shared/types'

/** 主题可覆盖的 CSS 变量白名单（与 presets.ts 中的变量集保持一致） */
export const THEME_VARIABLE_WHITELIST: readonly string[] = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-hover',
  '--bg-active',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--border-color',
  '--accent',
  '--accent-soft',
  '--danger',
  '--code-bg',
  '--hljs-base',
  '--hljs-comment',
  '--hljs-keyword',
  '--hljs-string',
  '--hljs-number',
  '--hljs-title'
]

const RESERVED_IDS = new Set(['default', 'warm', 'cool', 'high-contrast'])
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
// 禁用 ; : { } < > " ' \ 等结构字符，阻断 CSS 声明逃逸与 url() 外链
const VALUE_PATTERN = /^[#a-zA-Z0-9(),.%\s/-]+$/
const MAX_VALUE_LEN = 64
const MAX_NAME_LEN = 30

export function isValidThemeId(id: string): boolean {
  return ID_PATTERN.test(id)
}

function normalizeVars(
  input: unknown,
  label: string
): { ok: boolean; vars?: Record<string, string>; error?: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `${label} 必须是对象` }
  }
  const vars: Record<string, string> = {}
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!THEME_VARIABLE_WHITELIST.includes(key)) {
      return { ok: false, error: `未知变量 ${key}` }
    }
    if (
      typeof raw !== 'string' ||
      raw.length === 0 ||
      raw.length > MAX_VALUE_LEN ||
      !VALUE_PATTERN.test(raw)
    ) {
      return { ok: false, error: `变量 ${key} 的值非法` }
    }
    vars[key] = raw
  }
  return { ok: true, vars }
}

/** 校验并规范化主题包；仅保留 id/name/light/dark，杜绝脏字段回灌 */
export function validateThemePackage(
  raw: unknown
): { ok: boolean; theme?: ThemePackage; error?: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '主题文件必须是 JSON 对象' }
  }
  const obj = raw as Record<string, unknown>
  const id = typeof obj.id === 'string' ? obj.id : ''
  if (!isValidThemeId(id)) {
    return { ok: false, error: 'id 需为小写字母、数字或连字符，且以字母或数字开头' }
  }
  if (RESERVED_IDS.has(id)) return { ok: false, error: `id「${id}」为内置保留主题` }
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  if (!name || name.length > MAX_NAME_LEN) {
    return { ok: false, error: `name 需为 1–${MAX_NAME_LEN} 个字符` }
  }
  if (!('light' in obj) || !('dark' in obj)) return { ok: false, error: '缺少 light 或 dark' }
  const light = normalizeVars(obj.light, 'light')
  if (!light.ok) return { ok: false, error: light.error }
  const dark = normalizeVars(obj.dark, 'dark')
  if (!dark.ok) return { ok: false, error: dark.error }
  return { ok: true, theme: { id, name, light: light.vars!, dark: dark.vars! } }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/themePackage.test.ts`
Expected: PASS（全部用例通过）。

- [ ] **Step 6: 提交**

```bash
git add src/shared/types.ts src/main/lib/themePackage.ts tests/themePackage.test.ts
git commit -m "feat: 主题包校验与类型"
```

---

### Task 2: ThemeService（文件读写）

**Files:**
- Create: `src/main/services/themes.ts`
- Test: `tests/themes.test.ts`

**Interfaces:**
- Consumes: `ThemePackage`、`validateThemePackage`、`isValidThemeId`（Task 1）
- Produces: `ThemeService` 类，构造参数 `dir: string`，方法：
  - `list(): ThemePackage[]`
  - `importFile(srcPath: string): { ok: boolean; theme?: ThemePackage; error?: string }`
  - `save(theme: ThemePackage): { ok: boolean; error?: string }`
  - `remove(id: string): { ok: boolean; error?: string }`

- [ ] **Step 1: 写失败测试**

创建 `tests/themes.test.ts`：

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeService } from '../src/main/services/themes'

const sakura = { id: 'sakura', name: '樱花', light: { '--accent': '#e07a9b' }, dark: {} }

let dir: string
let svc: ThemeService

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'trace-themes-'))
  svc = new ThemeService(dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ThemeService', () => {
  it('save → list 往返', () => {
    expect(svc.save(sakura).ok).toBe(true)
    expect(svc.list()).toEqual([sakura])
  })

  it('目录不存在时 list 返回空数组', () => {
    expect(new ThemeService(path.join(dir, 'nope')).list()).toEqual([])
  })

  it('list 跳过损坏文件', () => {
    writeFileSync(path.join(dir, 'bad.json'), '{ not json')
    expect(svc.list()).toEqual([])
  })

  it('remove 删除文件并拒绝非法 id', () => {
    svc.save(sakura)
    expect(svc.remove('sakura').ok).toBe(true)
    expect(svc.list()).toEqual([])
    expect(svc.remove('../../etc').ok).toBe(false)
  })

  it('save 拒绝非法主题', () => {
    const r = svc.save({ id: 'warm', name: 'x', light: {}, dark: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('保留')
  })

  it('importFile 读取合法文件、拒绝非法主题', () => {
    const p = path.join(dir, 'in.json')
    writeFileSync(p, JSON.stringify(sakura), 'utf-8')
    expect(svc.importFile(p)).toEqual({ ok: true, theme: sakura })
    writeFileSync(p, '{ broken', 'utf-8')
    expect(svc.importFile(p).ok).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/themes.test.ts`
Expected: FAIL —— 无法解析 `../src/main/services/themes`。

- [ ] **Step 3: 实现 ThemeService**

创建 `src/main/services/themes.ts`：

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { ThemePackage } from '@shared/types'
import { isValidThemeId, validateThemePackage } from '../lib/themePackage'

/**
 * 自定义主题包：每个主题存 userData/themes/<id>.json。
 * - importFile 只读取并校验，不写盘（供渲染层先做覆盖确认）；
 * - save 落盘前再次校验（防御）；
 * - list 中损坏的单个文件静默跳过，不影响其余主题。
 */
export class ThemeService {
  constructor(private dir: string) {}

  list(): ThemePackage[] {
    let files: string[]
    try {
      files = fs.readdirSync(this.dir)
    } catch {
      return []
    }
    const themes: ThemePackage[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf-8'))
        const result = validateThemePackage(raw)
        if (result.ok && result.theme) themes.push(result.theme)
      } catch {
        /* 损坏文件：跳过 */
      }
    }
    return themes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  importFile(srcPath: string): { ok: boolean; theme?: ThemePackage; error?: string } {
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(srcPath, 'utf-8'))
    } catch {
      return { ok: false, error: '无法读取或解析该文件（需为合法 JSON）' }
    }
    return validateThemePackage(raw)
  }

  save(theme: ThemePackage): { ok: boolean; error?: string } {
    const result = validateThemePackage(theme)
    if (!result.ok || !result.theme) return { ok: false, error: result.error }
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      const target = path.join(this.dir, `${result.theme.id}.json`)
      const tmp = `${target}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(result.theme, null, 2), 'utf-8')
      fs.renameSync(tmp, target)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '写入失败' }
    }
  }

  remove(id: string): { ok: boolean; error?: string } {
    if (!isValidThemeId(id)) return { ok: false, error: '非法 id' }
    try {
      fs.rmSync(path.join(this.dir, `${id}.json`), { force: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '删除失败' }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/themes.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/themes.ts tests/themes.test.ts
git commit -m "feat: ThemeService 主题文件读写"
```

---

### Task 3: 主进程接线（导出、实例化、IPC、preload）

**Files:**
- Modify: `src/main/services/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/registerIpc.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `ThemeService`（Task 2）
- Produces: 渲染层可调用 `window.trace.listThemes() / importTheme() / saveTheme(theme) / deleteTheme(id)`，返回 `OpResult` 形态。

- [ ] **Step 1: 导出 ThemeService**

在 `src/main/services/index.ts` 的 `TagsService` 一行之后追加：

```ts
export { ThemeService } from './themes'
```

- [ ] **Step 2: 实例化并注入**

在 `src/main/index.ts` 的 `const tags = new TagsService(...)` 块（约 157–161 行）之后追加：

```ts
  const themes = new ThemeService(path.join(userData, 'themes'))
```

在文件顶部的 `import { ... } from './services'` 导入列表中加入 `ThemeService`。

在 `registerIpc({ ... })` 调用（约 205 行）的 `tags,` 之后加入：

```ts
    themes,
```

- [ ] **Step 3: 注册 IPC 通道**

在 `src/main/ipc/registerIpc.ts`：

1. 扩展类型导入：把 `import type { AppSettings } from '@shared/types'`（第 5 行）改为
   `import type { AppSettings, ThemePackage } from '@shared/types'`。
2. 在 `../services` 的类型导入列表中加入 `ThemeService,`。
3. `IpcDeps` 接口（第 23–39 行）在 `tags: TagsService` 之后加入：

```ts
  themes: ThemeService
```

4. 在「设置」块（第 287 行 `}))` 结束）之后、「插件」块之前插入：

```ts
  // ---------- 主题包 ----------
  handle('theme:list', () => ({ ok: true, themes: deps.themes.list() }))
  handle('theme:import', async () => {
    const win = deps.getWindow()
    if (!win) return { ok: false, canceled: true }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '导入主题包',
      filters: [{ name: '主题包', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return { ok: false, canceled: true }
    return deps.themes.importFile(filePaths[0])
  })
  handle('theme:save', (theme: ThemePackage) => deps.themes.save(theme))
  handle('theme:delete', (id: string) => deps.themes.remove(id))
```

- [ ] **Step 4: 扩展 TraceApi**

在 `src/shared/api.ts`：

1. 类型导入列表加入 `ThemePackage,`（按字母序放在 `TagItem` 附近）。
2. 在「标签」块（第 97 行 `notesByTag`）之后、「事件订阅」之前插入：

```ts
  // ---- 主题包 ----
  listThemes(): Promise<OpResult & { themes?: ThemePackage[] }>
  importTheme(): Promise<OpResult & { theme?: ThemePackage; canceled?: boolean }>
  saveTheme(theme: ThemePackage): Promise<OpResult>
  deleteTheme(id: string): Promise<OpResult>
```

- [ ] **Step 5: 暴露 preload API**

在 `src/preload/index.ts` 的 `setSettings`（第 64 行）之后追加：

```ts
  listThemes: () => ipcRenderer.invoke('theme:list'),
  importTheme: () => ipcRenderer.invoke('theme:import'),
  saveTheme: (theme) => ipcRenderer.invoke('theme:save', theme),
  deleteTheme: (id) => ipcRenderer.invoke('theme:delete', id),
```

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`
Expected: 主进程与渲染进程均无类型错误（退出码 0）。

- [ ] **Step 7: 提交**

```bash
git add src/main/services/index.ts src/main/index.ts src/main/ipc/registerIpc.ts src/shared/api.ts src/preload/index.ts
git commit -m "feat: 主题包 IPC 通道与接线"
```

---

### Task 4: 渲染层 store（加载、应用、导入/删除 action）

**Files:**
- Modify: `src/renderer/src/styles/presets.ts`
- Modify: `src/renderer/src/stores/app.ts`

**Interfaces:**
- Consumes: `ThemePackage`（Task 1）、`window.trace.listThemes/importTheme/saveTheme/deleteTheme`（Task 3）
- Produces（供 Task 5）：store getter `allPresets: ThemePackage[]`；state `customThemes: ThemePackage[]`；actions `importThemeFile()` / `saveTheme(theme)` / `deleteTheme(id)` / `reloadCustomThemes()`。

- [ ] **Step 1: 复用类型**

在 `src/renderer/src/styles/presets.ts` 顶部把 `export interface ThemePreset { ... }`（第 1–6 行）替换为：

```ts
import type { ThemePackage } from '@shared/types'

export type ThemePreset = ThemePackage
```

- [ ] **Step 2: 扩展 store**

在 `src/renderer/src/stores/app.ts`：

1. 顶部类型导入改为 `import type { AppSettings, ThemePackage } from '@shared/types'`。
2. state（第 39–61 行）在 `viewMode` 之后追加：

```ts
    /** 已导入的自定义主题（userData/themes），与内置预设在 UI 中并列 */
    customThemes: [] as ThemePackage[]
```

3. getters（第 62–66 行）在 `isDark` 之后追加：

```ts
    allPresets(state): ThemePackage[] {
      return [...THEME_PRESETS, ...state.customThemes]
    }
```

4. `init()`（第 162 行起）改为同时拉取主题列表：

```ts
    async init(): Promise<void> {
      this.loadUiPrefs()
      const [ws, settings, version, themes] = await Promise.all([
        window.trace.getWorkspace(),
        window.trace.getSettings(),
        window.trace.getAppVersion(),
        window.trace.listThemes()
      ])
      this.workspaceRoot = ws.root ?? ''
      this.defaultRoot = ws.defaultRoot ?? ''
      if (settings.ok && settings.settings) this.settings = settings.settings
      if (themes.ok && themes.themes) this.customThemes = themes.themes
      this.version = version.version ?? ''
      this.applyTheme()
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.settings.theme === 'system') this.applyTheme()
      })
    },
```

5. `applyTheme()` 中把查找源改为合并列表。将

```ts
      const preset = THEME_PRESETS.find((p) => p.id === presetId)
```

改为：

```ts
      const preset = this.allPresets.find((p) => p.id === presetId)
```

6. 在 `updateSettings` action 之后追加：

```ts
    async reloadCustomThemes(): Promise<void> {
      const result = await window.trace.listThemes()
      if (result.ok && result.themes) this.customThemes = result.themes
    },
    /** 选择文件并校验；不写盘（覆盖确认由视图层完成后调用 saveTheme） */
    async importThemeFile(): Promise<{ theme?: ThemePackage; canceled?: boolean; error?: string }> {
      const result = await window.trace.importTheme()
      return { theme: result.theme, canceled: result.canceled, error: result.error }
    },
    /** 落盘并立即应用新主题；失败返回错误信息 */
    async saveTheme(theme: ThemePackage): Promise<string | null> {
      const result = await window.trace.saveTheme(theme)
      if (!result.ok) return result.error ?? '保存失败'
      await this.reloadCustomThemes()
      await this.updateSettings({ themePreset: theme.id })
      return null
    },
    /** 删除主题；若删除的是当前主题则回退默认 */
    async deleteTheme(id: string): Promise<string | null> {
      const result = await window.trace.deleteTheme(id)
      if (!result.ok) return result.error ?? '删除失败'
      await this.reloadCustomThemes()
      if (this.settings.themePreset === id) await this.updateSettings({ themePreset: 'default' })
      return null
    },
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck:web`
Expected: 无类型错误（退出码 0）。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/styles/presets.ts src/renderer/src/stores/app.ts
git commit -m "feat: 渲染层加载并应用自定义主题"
```

---

### Task 5: 设置页 UI（导入卡片、自定义主题卡片、删除）

**Files:**
- Modify: `src/renderer/src/views/SettingsView.vue`

**Interfaces:**
- Consumes: `app.customThemes`、`app.saveTheme/importThemeFile/deleteTheme`（Task 4）
- Produces: 用户可见的导入/删除入口。

- [ ] **Step 1: 导入弹窗依赖**

把 `src/renderer/src/views/SettingsView.vue` 第 3 行改为：

```ts
import { ElMessage, ElMessageBox } from 'element-plus'
```

（`Plus` / `Close` 图标已在 `main.ts` 全局注册，无需 import。）

- [ ] **Step 2: 增加导入/删除处理函数**

在 `<script setup>` 中 `applyAttachmentsDir` 函数附近追加：

```ts
// ---------- 主题包 ----------
async function importTheme(): Promise<void> {
  const result = await app.importThemeFile()
  if (result.canceled) return
  if (result.error || !result.theme) {
    ElMessage.error(result.error ?? '导入失败')
    return
  }
  const theme = result.theme
  if (app.customThemes.some((t) => t.id === theme.id)) {
    try {
      await ElMessageBox.confirm(`已存在主题「${theme.name}」，覆盖更新？`, '导入主题', {
        type: 'warning',
        confirmButtonText: '覆盖'
      })
    } catch {
      return
    }
  }
  const error = await app.saveTheme(theme)
  if (error) ElMessage.error(error)
  else ElMessage.success(`主题「${theme.name}」已导入`)
}

async function removeTheme(id: string, name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除主题「${name}」吗？`, '删除主题', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  const error = await app.deleteTheme(id)
  if (error) ElMessage.error(error)
  else ElMessage.success('主题已删除')
}
```

- [ ] **Step 3: 模板增加卡片**

在 `SettingsView.vue` 的 `theme-preset-grid` 容器内、内置预设 `v-for`（约第 359–372 行）之后、`</div>` 闭合网格之前插入：

```html
              <div
                v-for="custom in app.customThemes"
                :key="custom.id"
                class="theme-preset-card"
                :class="{ active: app.settings.themePreset === custom.id }"
                @click="app.updateSettings({ themePreset: custom.id })"
              >
                <div class="preset-swatches">
                  <span
                    class="swatch"
                    :style="{
                      background: app.isDark ? custom.dark['--bg-primary'] : custom.light['--bg-primary'],
                      border: '1px solid ' + (app.isDark ? custom.dark['--border-color'] : custom.light['--border-color'])
                    }"
                  />
                  <span class="swatch" :style="{ background: app.isDark ? custom.dark['--accent'] : custom.light['--accent'] }" />
                  <span class="swatch" :style="{ background: app.isDark ? custom.dark['--danger'] : custom.light['--danger'] }" />
                </div>
                <span class="preset-name">{{ custom.name }}</span>
                <button class="preset-remove" title="删除主题" @click.stop="removeTheme(custom.id, custom.name)">
                  <el-icon><Close /></el-icon>
                </button>
              </div>
              <div class="theme-preset-card theme-import-card" title="导入主题包（JSON）" @click="importTheme">
                <el-icon><Plus /></el-icon>
                <span class="preset-name">导入主题</span>
              </div>
```

> 注意：自定义主题若未覆盖 `--bg-primary` 等变量，色块取到 `undefined`，会显示为透明/继承样式，属预期（该主题继承默认配色）。若希望色块始终可见，可在 `custom.light['--bg-primary'] ?? '#ffffff'` 兜底 —— 但当前保持最小实现，不兜底。

- [ ] **Step 4: 样式补充**

在 `<style scoped>` 已有的 `.theme-preset-card` 规则（约第 611 行）内加入 `position: relative;`（其余声明保持不动）；然后在末尾（`.preset-name` 规则之后）追加：

```css
.preset-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.theme-preset-card:hover .preset-remove {
  display: flex;
}

.preset-remove:hover {
  color: var(--danger);
}

.theme-import-card {
  justify-content: center;
  gap: 6px;
  border-style: dashed;
  color: var(--text-secondary);
}

.theme-import-card:hover {
  color: var(--accent);
}
```

- [ ] **Step 5: 类型检查与 lint**

Run: `npm run typecheck:web; npm run lint`
Expected: 均无错误（退出码 0）。

- [ ] **Step 6: 手动冒烟验证**

Run: `npm run dev`
依次确认：
1. 设置 → 通用 → 外观 → 配色，末尾出现虚线「导入主题」卡片；
2. 准备一个合法 `sakura.json`（见设计文档示例），点击导入 → 出现「樱花」卡片并自动选中，界面配色即时变化；
3. 再次导入同一文件 → 弹「覆盖更新？」确认；取消则不变，覆盖则成功提示；
4. 悬停自定义主题卡片 → 右上角出现删除图标；删除后卡片消失，若删除的是当前主题界面回退默认配色；
5. 导入一个非法文件（如缺 `dark`）→ 红色提示具体原因。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/views/SettingsView.vue
git commit -m "feat: 设置页主题包导入与删除"
```

---

### Task 6: 文档同步

**Files:**
- Modify: `CHANGELOG.md`（顶部 `[未发布]` 段，无则新建）
- Modify: `requirements/requirements.md`（FR-2.9.7）
- Modify: `requirements/index.md`（文档导读 + 待发版清单）

**Interfaces:**
- Consumes: 已完成的实现
- Produces: 与代码一致的权威文档

- [ ] **Step 1: 更新 CHANGELOG**

在 `CHANGELOG.md` 顶部 `[未发布]` 段（若无则新建）的「新增」列表中追加一行：

```markdown
- **主题包导入**：设置 → 通用 → 外观 → 配色支持从 JSON 文件导入自定义主题（浅/深两套 CSS 变量覆盖，19 项变量白名单校验），可删除；自定义主题与内置预设并列显示。
```

- [ ] **Step 2: 更新 PRD**

把 `requirements/requirements.md` 中 FR-2.9.7 末句「预留自定义主题包导入（一组变量覆盖文件）」改为：

```markdown
主题包导入：支持从 JSON 文件导入自定义主题（一组 CSS 变量覆盖文件，含浅/深两套）；导入时按 19 项变量白名单与取值规则校验，非法即拒绝并提示；自定义主题存应用数据目录 `themes/`，在设置页与内置预设并列，可删除，删除当前主题自动回退默认。详见 [theme-import_design.md](2026-09-14_theme-import/theme-import_design.md)。
```

- [ ] **Step 3: 更新索引**

在 `requirements/index.md`：

1. 「文档导读」表格中 `theme-presets_design.md` 行之后追加：

   ```markdown
   | [theme-import_design.md](2026-09-14_theme-import/theme-import_design.md) | 主题包导入：JSON 变量覆盖 + 白名单校验 + 应用数据目录存储 | ✅ **已实施**（main，随下版本发布） |
   ```

2. 「待发版（v0.4.0 之后）」清单末尾追加：

   ```markdown
   - **主题包导入**：设置页支持导入/删除 JSON 自定义主题（浅/深两套变量覆盖，19 项白名单校验）。详见 [theme-import_design.md](2026-09-14_theme-import/theme-import_design.md)。
   ```

3. 「四、规划中、未开始」→ 二期 Backlog 中若含「自定义主题包」，移动到「已从 Backlog 毕业并实施」列表。

- [ ] **Step 4: 提交**

```bash
git add CHANGELOG.md requirements/requirements.md requirements/index.md
git commit -m "docs: 主题包导入进度同步"
```

---

## 验收清单（实现完成后逐项核对）

- [ ] `npx vitest run tests/themePackage.test.ts tests/themes.test.ts` 全绿；
- [ ] `npm run typecheck` 无错误；
- [ ] `npm run lint` 无错误；
- [ ] 设置页可导入合法 JSON 主题、即时生效、自动选中；
- [ ] 同 id 重复导入有覆盖确认；
- [ ] 可删除自定义主题，删除当前主题回退默认；
- [ ] 非法文件给出中文错误提示且不写盘；
- [ ] 重启应用后已导入主题仍在、选中态保持；
- [ ] CHANGELOG / PRD / index 三处文档已同步。
