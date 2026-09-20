# @trace/plugin-api

Trace（笔迹）插件 API 类型定义。为 Trace 插件开发提供 `ctx` 的完整 TypeScript 类型与 JSDoc 补全。

```bash
npm install -D @trace/plugin-api
```

```js
// main.js / main.ts
import type { PluginContext } from '@trace/plugin-api'

/** @param {import('@trace/plugin-api').PluginContext} ctx */
exports.activate = function activate(ctx) {
  ctx.registerCommand({
    id: 'hello',
    title: '打招呼',
    handler: () => ctx.notify('Hello!')
  })
}
```

详见仓库内开发指引 `guides/plugin-development.md`。

## 能力与权限对照

| manifest permissions | 开放能力 |
| --- | --- |
| `notifications` | `ctx.notify` |
| `notes:read` | `ctx.notes.vaults / list / tree / read` |
| `notes:write` | `ctx.notes.create / write` |
| `events` | `ctx.on / ctx.off` |
| `editor:toolbar` | manifest `contributions.toolbar`（声明式工具栏按钮） |
| `ui:status` | `ctx.status.set / clear` |
| `settings:persist` | `ctx.storage.get / set / delete / keys` |
| （无需声明） | `ctx.logger`、`ctx.registerCommand` |
