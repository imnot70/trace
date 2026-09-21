# Trace 插件开发指引

> 面向插件作者。当前版本开放 **Tier 1 能力**：笔记读写、事件订阅、通知、日志、命令注册。
> 使用方法（启用/权限确认/运行命令）见 [user-guide.md](user-guide.md) 第 15 节。

## 1. 最小插件结构

插件是放在应用数据目录 `plugins/<插件id>/` 下的一个文件夹，**目录名与 manifest 的 `id` 保持一致**：

```
plugins/hello/
├── manifest.json    # 元信息与权限声明（必需）
└── main.js          # 入口（CommonJS）
```

`manifest.json`：

```json
{
  "id": "hello",
  "name": "Hello 插件",
  "version": "1.0.0",
  "description": "最小示例：激活时通知一声",
  "main": "main.js",
  "permissions": ["notifications"]
}
```

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 插件唯一标识，建议小写字母/数字/连字符；同时用作命令 id 前缀 |
| `name` | ✅ | 显示名（设置页插件列表） |
| `version` | ✅ | 语义化版本 |
| `description` |  | 一句话描述 |
| `main` |  | 入口文件（相对插件目录，CommonJS）；缺省表示纯清单插件（无可执行代码） |
| `permissions` |  | 权限声明，数组；见第 2 节 |

`main.js`：

```js
'use strict'

// Trace 会在插件启用时调用 activate(ctx)，传入能力对象 ctx。
// 返回的函数（可选）会在停用时调用。
exports.activate = function activate(ctx) {
  ctx.logger.info('Hello 插件已激活')
  ctx.notify('Hello from 插件！')

  return function deactivate() {
    ctx.logger.info('Hello 插件已停用')
  }
}
```

> 插件运行在**独立进程**中：激活失败、抛异常、崩溃都不会影响笔记与应用本体，宿主会自动重启插件（退避 1s/2s/4s/8s，连续崩溃 5 次自动停用）。

## 2. 权限

| 权限标识 | 开放的能力 |
| --- | --- |
| `notifications` | `ctx.notify(message)` |
| `notes:read` | `ctx.notes.vaults / list / tree / read` |
| `notes:write` | `ctx.notes.create / write` |
| `events` | `ctx.on(event, handler)` 订阅事件 |
| `settings:persist` | `ctx.storage.get / set / delete / keys` 私有 KV 存储 |
| `editor:toolbar` | manifest `contributions.toolbar` 编辑工具栏按钮（声明式） |
| `ui:status` | `ctx.status.set / clear` 侧栏底部状态区 |
| （无需声明） | `ctx.logger`、`ctx.registerCommand` |

规则：

- **用户是最后一道闸**：首次启用插件（或新版本声明了新权限）时，Trace 会弹出权限确认对话框，用户确认后插件才会激活；
- **未声明就调用会直接抛错**（Promise reject）。比如只声明了 `notifications` 却调用 `ctx.notes.read(...)`，会收到 `插件未声明权限「notes:read」，已拒绝调用 …`；
- 只声明实际用到的权限，审阅者与用户都会看权限清单。

## 3. ctx API 参考

### 3.1 笔记读写（`notes:read` / `notes:write`）

所有 `ctx.notes.*` 方法返回 Promise，**成功与业务失败都走 resolve**，统一形状：

```text
{ ok: true,  ...数据 }          // 成功
{ ok: false, error: '原因' }    // 业务失败（笔记不存在、重名、内容超限等）
```

用 `.ok` 判断，不要假设一定成功：

```js
const note = await ctx.notes.read('我的库', '日记/2026-09-20.md')
if (!note.ok) {
  ctx.notify('读取失败：' + note.error)
  return
}
ctx.logger.info('内容长度：' + note.content.length)
```

| 方法 | 返回（成功时） | 说明 |
| --- | --- | --- |
| `ctx.notes.vaults()` | `{ ok: true, vaults: string[] }` | 全部笔记库名 |
| `ctx.notes.list(vault)` | `{ ok: true, tree: TreeNode[] }` | 库内完整文件树 |
| `ctx.notes.tree(vault)` | 同 `list` | 别名 |
| `ctx.notes.read(vault, path)` | `{ ok: true, content, hash }` | 读取笔记全文；`hash` 可用于防覆盖写入 |
| `ctx.notes.write(vault, path, content, opts?)` | `{ ok: true, hash }` | 覆盖写入；`opts.expectedHash` 传读取时的 `hash` 可做防冲突（磁盘内容已变时返回 `{ ok: false, error }`） |
| `ctx.notes.create(vault, parentPath, name, content?)` | `{ ok: true, path }` | 新建笔记；`parentPath` 为 `''` 表示库根目录，**父文件夹必须已存在**（Tier 1 无创建文件夹的 API）；重名时返回 `{ ok: false, error }` |

路径约定：

- `path` / `parentPath` 均为**相对库根目录**的路径，如 `'日记/2026-09-20.md'`；
- 笔记路径**带 `.md` 后缀**；树节点（`tree` 返回项）的 `name` **不带**后缀；
- 树节点形状：`{ name, path, kind: 'dir' | 'note', children?: TreeNode[] }`。

### 3.2 通知与日志

```js
ctx.notify('保存成功')            // 右上角提示；内容上限 500 字符
ctx.logger.info('调试信息', 123)  // 写入应用日志，前缀「[插件 <id>]」
ctx.logger.warn(...) / ctx.logger.error(...)
```

### 3.3 私有存储（`settings:persist` 权限）

宿主托管的插件私有键值存储（按插件隔离，随插件卸载一并清除），适合保存配置、计数器、游标等状态：

```js
// 与 notes.* 一致：resolve { ok, ... } 形状
await ctx.storage.set('runs', 42)          // { ok: true }；值必须 JSON 可序列化
const r = await ctx.storage.get('runs')    // { ok: true, value: 42 }；未设置时 value 为 null
await ctx.storage.delete('runs')           // { ok: true }
const k = await ctx.storage.keys()         // { ok: true, keys: ['runs'] }
```

限制：键最长 200 字符；单值约 256KB；单插件总量约 1MB。需要持久化大量数据时请自建文件（放在插件目录内）。

### 3.4 事件（`events` 权限）

> 状态区：`ctx.status.set('字数 128')` / `ctx.status.clear()`——侧栏底部一行文字（≤120 字符），每插件一条，插件停止自动清除（`ui:status` 权限）。

### 3.4.1 编辑器工具栏按钮（`editor:toolbar` 权限，声明式）

在 manifest.json 声明即可，插件代码无需介入，按钮出现在编辑器工具栏，点击执行对应命令（命令必须已注册）：

```json
{
  "permissions": ["editor:toolbar"],
  "contributions": {
    "toolbar": [{ "icon": "∑", "title": "统计字数", "command": "stats" }]
  }
}
```

- `icon`：1-4 个字符的 emoji / 文本（缺省 ▸）；`title`：悬停提示
- `command`：插件内短 id（自动补全为 `<插件id>.<命令id>`）或完整 id
- 插件停止 / 崩溃 / 卸载时按钮自动消失

```js
const handler = (payload) => { ... }
ctx.on('note:saved', handler)
ctx.off('note:saved', handler)   // 停用回调里记得取消订阅
```

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `note:saved` | `{ vault, path }` | 用户在编辑器保存笔记后（**插件自己写入不会触发**，避免事件回环） |
| `note:opened` | `{ vault, path }` | 用户打开一篇笔记 |
| `vault:changed` | `{ vault, paths }` | 库内文件变化（含外部编辑、git 同步；高频事件已按插件合并节流） |
| `sync:done` | `{ vault }` | 该库 git 同步成功后（手动或自动同步） |

订阅了不存在的事件名或 handler 不是函数时，`ctx.on` 会直接抛错。

### 3.5 命令（内置，无需权限）

```js
ctx.registerCommand({
  id: 'stats',              // 插件内唯一；完整 id 为 <插件id>.<命令id>，如 'hello.stats'
  title: '统计字数',         // 按钮显示文字
  handler: async () => { ... }   // 执行超时 10 秒
})
```

命令在「设置 → 插件」对应插件行下显示为按钮，用户点击即执行。

## 4. 错误处理约定（重要）

两类失败，处理方式不同：

| 类型 | 例子 | 表现 |
| --- | --- | --- |
| **权限 / 用法错误** | 未声明权限就调用；调用不存在的方法 | Promise **reject**（`await` 时抛异常）——这是编程错误，应当修代码 |
| **业务失败** | 笔记不存在、重名、写入冲突、内容超限 | Promise resolve 为 `{ ok: false, error }`——运行时正常分支，用 `.ok` 判断 |

```js
try {
  const r = await ctx.notes.write('我的库', 'a.md', '内容', { expectedHash: '旧hash' })
  if (!r.ok) ctx.logger.warn('写入被拒：' + r.error)   // 业务失败（如外部修改冲突）
} catch (e) {
  ctx.logger.error('调用出错：' + e.message)            // 权限等编程错误
}
```

## 5. require 白名单与自包含政策

插件运行环境对 `require` 有白名单限制：

| 写法 | 结果 |
| --- | --- |
| `require('./lib/util')`、`require('../helper.js')` | ✅ 允许——插件目录内的文件 |
| `require('node:path')` / `'node:util'` / `'node:events'`（可省略 `node:` 前缀） | ✅ 允许的内置模块 |
| `require('node:fs')`、`'node:child_process'`、`'node:https'`、`'node:os'` 等其他内置 | ❌ 拒绝 |
| `require('lodash')` 等 npm 包 | ❌ 拒绝（自包含政策：插件目录外无任何依赖） |
| `require('../../../../外部文件')` 目录逃逸 | ❌ 拒绝 |

因此插件必须**自包含**：把需要的代码和资源全部放进插件目录。这是有意的安全设计——插件生态没有 `node_modules`，依赖投毒攻击面为零。

## 6. 限制与超时

| 项 | 值 |
| --- | --- |
| 单次 API 调用超时 | 5 秒（超时 Promise reject） |
| 命令 handler 超时 | 10 秒 |
| 单次读/写内容上限 | 4,000,000 字符（超出返回业务失败） |
| 通知长度上限 | 500 字符 |
| deactivate 宽限 | 5 秒（超时进程被强制终止） |
| 崩溃守护 | 退避重启 1s → 2s → 4s → 8s；连续 5 次崩溃自动停用 |

## 7. 本地调试

1. **放置插件**：把插件目录放进应用数据目录：
   - Windows：`%APPDATA%\Trace\plugins\<插件id>\`（即 `C:\Users\<用户名>\AppData\Roaming\Trace\plugins\`）
   - Linux：`~/.config/Trace/plugins/<插件id>/`
2. **启用**：重启应用（或打开 设置 → 插件 刷新列表）→ 打开插件开关 → 确认权限
3. **看日志**：`<应用数据目录>/logs/main.log`，插件 `ctx.logger.*` 输出带 `[插件 <id>]` 前缀；激活失败、崩溃、权限拒绝都有对应记录
4. **改代码后重载**：停用再启用插件开关即可（不会自动热重载）
5. **触发命令**：设置 → 插件 → 对应插件行的命令按钮

> 首次启动时 Trace 会自动放置一个「示例插件」（完整演示 Tier 1 全部能力），可直接以其为模板。

## 8. 完整示例：每日笔记插件

演示「命令创建带模板的今日笔记 + 事件统计保存字数」，覆盖全部 Tier 1 API：

`manifest.json`：

```json
{
  "id": "daily-note",
  "name": "每日笔记",
  "version": "1.0.0",
  "description": "命令创建今日笔记模板；保存笔记时统计字数",
  "main": "main.js",
  "permissions": ["notifications", "notes:read", "notes:write", "events"]
}
```

`main.js`：

```js
'use strict'

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

exports.activate = function activate(ctx) {
  // ---------- 事件：保存时统计字数（节流提示，避免打扰） ----------
  let lastNotify = 0
  const onSaved = (payload) => {
    ctx.notes.read(payload.vault, payload.path).then((r) => {
      if (!r.ok) return
      ctx.logger.info(`已保存 ${payload.path}（${r.content.length} 字）`)
      const now = Date.now()
      if (now - lastNotify > 60_000) {           // 至少间隔 1 分钟才提示一次
        lastNotify = now
        ctx.notify(`已保存，当前 ${r.content.length} 字`)
      }
    })
  }
  ctx.on('note:saved', onSaved)

  // ---------- 命令：在第一个库创建/打开今日笔记 ----------
  ctx.registerCommand({
    id: 'today',
    title: '打开今日笔记',
    handler: async () => {
      const v = await ctx.notes.vaults()
      if (!v.ok || !v.vaults.length) {
        await ctx.notify('还没有笔记库，请先创建一个')
        return
      }
      const vault = v.vaults[0]

      // 优先放进「日记」文件夹；该文件夹不存在时回退到库根目录
      // （create 的父文件夹必须已存在，Tier 1 没有创建文件夹的 API）
      const template = `# ${today()}\n\n- [ ] 待办一\n- [ ] 待办二\n\n## 随笔\n\n`
      let created = await ctx.notes.create(vault, '日记', `${today()}.md`, template)
      if (!created.ok && /父目录不存在/.test(created.error)) {
        created = await ctx.notes.create(vault, '', `${today()}.md`, template)
      }
      if (!created.ok && !/已存在|重名|同名/.test(created.error)) {
        await ctx.notify('创建失败：' + created.error)
        return
      }
      const path = created.ok ? created.path : `日记/${today()}.md`

      const note = await ctx.notes.read(vault, path)
      if (note.ok) await ctx.notify(`今日笔记共 ${note.content.length} 字`)
    }
  })

  return function deactivate() {
    ctx.off('note:saved', onSaved)
  }
}
```

## 9. 类型补全与打包分享

> 上架市场（Release + 索引 PR）的完整流程见 [plugin-release.md](plugin-release.md)。

### 类型补全（@trace/plugin-api）

```bash
npm install -D @trace/plugin-api
```

```js
// main.js
/** @param {import('@trace/plugin-api').PluginContext} ctx */
exports.activate = function activate(ctx) {
  // ctx. 全量补全与 JSDoc 提示
}
```

### 打包分享

插件目录可直接压缩为 zip（改名 `.trace-plugin` 后缀）分享，接收方通过「设置 → 插件 → 导入插件…」安装：

- 包内 `manifest.json` 位于根目录（或唯一顶层文件夹内）均可识别
- 包必须自包含：全部代码与资源都在包内（require 白名单本来就禁止目录外加载）
- 已安装的插件也可在「详情」中「导出…」生成 `.trace-plugin`

## 10. 常见问题

- **启用时提示需要确认权限**：正常流程——插件声明了权限，确认后即激活；插件新版本加了权限也会重新要求确认
- **调用 API 收到异常「插件未声明权限…」**：在 manifest.json 的 `permissions` 里补上对应权限（改完记得停用再启用重载）
- **写入返回 `{ ok: false, error: '外部修改冲突…' }`**：磁盘上的内容比你读取时新。重新 `read` 拿到新 `hash`，合并内容后再带新 `hash` 写入，或不带 `expectedHash` 直接覆盖（谨慎）
- **插件被自动停用**：日志里会有崩溃记录，先在本地排查入口代码（常见：顶层抛错、activate 未导出、require 了白名单外的模块）
- **command id 为什么带前缀**：完整命令 id = `<插件id>.<命令id>`，避免不同插件之间冲突；`ctx.registerCommand` 的返回值就是完整 id
- **创建笔记报「父目录不存在」**：`notes.create` 不会自动创建文件夹（Tier 1 无建夹 API），请使用已存在的文件夹，或回退到库根目录（`parentPath` 传 `''`）
