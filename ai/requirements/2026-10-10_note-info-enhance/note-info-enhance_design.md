# 笔记「信息」弹窗内容增强 — 技术设计

> FR-2.6.6 扩展（2026-10-10）。需求见同目录 [note-info-enhance.md](note-info-enhance.md)；建议存档与数据源盘点见 [suggest/note-info-enhance.md](../../suggest/note-info-enhance.md)。

## 1. 决策记录（用户 2026-10-10 拍板）

| 决策点 | 结论 |
| --- | --- |
| D1 载体 | **专用 `NoteInfoDialog.vue` 组件**（`ElMessageBox` 纯文本到头：胶囊 / 复制按钮 / 分组做不了） |
| D2 Git 数据口径 | **只读侧栏缓存 `gitStatuses`**；该库从未刷新（`undefined`）时后台 `refreshGitStatus` 回填一次，store 响应式补显。不在打开弹窗时强制跑 git 子进程 |
| D3 标签胶囊 | **可点击** → 应用标签筛选并关弹窗（与侧栏标签行同管线，FR-2.6.13 多标签组合） |
| D4 被引用数 | **进本期**（`wikilinkBacklinks` IPC 现成，异步补入） |

## 2. 数据源（全部现成，唯一新增 = `NoteInfo` 扩展统计字段）

| 数据 | 来源 |
| --- | --- |
| 创建 / 修改时间 · 大小 · 行数 · 字符数 · 绝对路径 | `noteGetInfo`（`fs.statSync` + 读文件统计，本次扩展） |
| 标签（含颜色） | `noteTags(vault, path)` → `TagItem[]`（既有 IPC） |
| 所属库 / 外部标记 | `tree.vaults.find(v => v.name === vault)?.external` |
| Git 关联状态 | `tree.gitStatuses[vault]` → `GitStatus { associated, repoFullName, remoteUrl, branch, ahead, behind, dirty }` |
| 被引用数 | `wikilinkBacklinks(vault, path).backlinks.length`（既有 IPC） |

## 3. 类型与主进程改动

### 3.1 `shared/types.ts` — `NoteInfo` 扩展

```ts
export interface NoteInfo {
  birthtime: string
  mtime: string
  size: number      // 文件字节大小
  lines: number     // 总行数（按 \n 计，含 frontmatter，与编辑器行号同口径）
  chars: number     // 非空白字符数（客观口径：不含空格 / 换行 / 制表）
  absPath: string   // 磁盘绝对路径（供「复制路径」）
}
```

口径说明：行数 / 字符数是**客观统计**（整文件含 frontmatter），不做「写作字数」式的词数口径（见需求「不做的事」）。

### 3.2 `src/main/services/fsTree.ts` — `noteGetInfo`

`statSync` 之外追加一次 `readFileSync(abs, 'utf8')`（笔记均为小文件，同步读可接受；与既有该服务的同步风格一致）。返回体由内联类型改为 `NoteInfo`。`absPath` 即 `resolveWithin` 的返回值（已做库根越界防护）。

`shared/api.ts` 签名不变（`info?: NoteInfo` 类型原地扩展）；preload 透传无改动。

## 4. `NoteInfoDialog.vue`（新组件，`src/renderer/src/components/`）

参照 `TagPickerDialog` 的弹窗模式：`el-dialog` + `append-to-body` + `destroy-on-close`，`watch(visible, …, { immediate: true })` 加载（侧栏树按需挂载时 visible 已为 true）。

### 4.1 布局（标签区以上同步即显，异步项原地补入）

```
所属笔记库   测试用01 [外部]
路径         正反就是测试一下/test03.md ⧉   ← 悬停显绝对路径，⧉ 复制
创建时间     2026/9/7 15:04:53
最后修改     2026/10/10 10:52:56
大小         1.2 KB · 8 行 · 356 字符
标签         (测试1) (tag_1) (tag_2) ｜ —
被引用       3 篇笔记 ｜ 无 ｜ …（加载中）
─────────────────────────────
Git 仓库     owner/repo · main  ↑1 ↓0     ← 仅 gitStatuses.associated 时
同步状态     ● 有未提交变更 ｜ 干净
                                    [确定]
```

- 标签胶囊：`color-mix(in srgb, ${color} 16%, transparent)` 底 + 定义色文字（项目已有 color-mix 先例），圆角胶囊 12px 字号；点击走筛选管线；无标签「—」。
- 复制路径：`navigator.clipboard.writeText(absPath)` + `ElMessage.success`；按钮用原生 `title`（tooltip 约定）。
- 「外部」标记复用全局 `.external-badge` 类。

### 4.2 加载时序

1. 打开瞬间置空全部状态 → 三路既有 IPC 并发（`noteGetInfo` / `noteTags` / `wikilinkBacklinks`），前两路落定即渲染；
2. Git：`computed` 读 `tree.gitStatuses[vault]`；为 `undefined`（从未刷新）时调一次 `tree.refreshGitStatus(vault)`（既有 action，写回 store 响应式更新）；为 `null`（已刷新、未关联）则不显示 Git 区；
3. 竞态防护：弹窗单例随 `destroy-on-close` 重建，`watch` 内以局部 `note` 快照比对（与 BacklinkPanel「请求期间可能已切换笔记」同手法）。

### 4.3 标签筛选管线（D3）

与 `SideBar.toggleGrid('tags', tagId)` 同逻辑（FR-2.6.13）：当前主区域已在标签筛选网格 → 胶囊点击把标签并入 / 移出集合（清空则回欢迎页）；否则置单标签筛选 `app.view = { name: 'grid', section: 'tags', tagIds: [tagId] }`。随后关闭弹窗。

## 5. 入口接线（两处，替换 `ElMessageBox.alert`）

| 入口 | 改动 |
| --- | --- |
| `VaultNode.vue`（侧栏树 ⋮ / 右键） | `cmd === 'info'` 改为置 `infoDialogVisible`；模板在 `ShareGistDialog` 旁挂载（同款 `v-if` + `:visible` 模式） |
| `NoteGridView.vue`（库内容区 / 常用 / 收藏 / 分享卡片） | 同上，`infoDialogNote` 持 `GridItem`，模板 `v-model:visible` 挂载 |

菜单定义（`composables/menuItems.ts` 单一数据源）无需改动——「信息」项已在四处菜单中。

## 6. 边界情况

- **未关联库**：`gitStatuses[vault]` 为 `null` → Git 区整体隐藏（P0 需求）；
- **外部库**：自动识别远程（FR-2.1.4），`associated` 为 true，正常显示 Git 区；
- **关联但无远程识别**（理论边角）：`repoFullName` 为空时仓座行退化为「已关联」，仅显示分支与同步状态；
- **被引用查询失败**：按 0 处理（与 BacklinkPanel 的 catch 口径一致）；
- **草稿**：草稿卡片现状无「信息」入口，不涉及（见需求文档）。

## 7. 测试计划

- 单测 `tests/noteInfo.test.ts`：临时目录构建 `FsTreeService`（与 services.test.ts 同手法）——行数 / 非空白字符数 / 字节数 / 绝对路径断言 + 文件不存在返回 `ok: false`；
- CDP 冒烟（真机验证阶段）：树行与卡片开弹窗、标签胶囊点击筛选、复制路径、未关联库隐藏 Git 区。

## 8. 实施记录

2026-10-10 立项当日实施完成：

- `shared/types.ts`：`NoteInfo` 扩展 `size / lines / chars / absPath`（口径注释随类型）；
- `src/main/services/fsTree.ts`：`noteGetInfo` 返回体升级为 `NoteInfo`（`statSync` + `readFileSync` 统计，越界防护沿用 `resolveWithin`）；
- 新增 `NoteInfoDialog.vue`：分组信息卡；三路既有 IPC 并发即开即显；Git 走 `gitStatuses` 缓存 + `refreshGitStatus` 回填；胶囊点击走 FR-2.6.13 筛选管线；`navigator.clipboard` 复制绝对路径；
- `VaultNode.vue` / `NoteGridView.vue`：两入口替换 `ElMessageBox.alert`（VaultNode 的 ElMessageBox import 随之移除；NoteGridView 保留——草稿删除确认仍在用）；
- 单测 `tests/noteInfo.test.ts` +3（统计口径 / frontmatter 整文件口径 / 文件缺失）；`services` + `noteCopy` 相关 65 项通过，typecheck（node + web）与 lint 通过；
- 待真机验证（待办 #20）：已关联 / 外部 / 未关联三态 Git 区、胶囊点击筛选、复制路径。

### 8.1 真机反馈修正（2026-10-10，外部库 note_repo 首验）

1. **「大小」行显示 `NaN MB · undefined 行 · undefined 字符`**：非产品代码缺陷——dev 脚本是裸 `electron-vite dev`（无 `--watch`），**主进程改动不热更**，用户实例的主进程仍是旧 `noteGetInfo`（只返回 birthtime/mtime），渲染层经 Vite HMR 已换新弹窗 → 新字段 undefined。代码链路三段验证均干净：fsTree 单测断言全字段、`registerIpc.ts` `note:getInfo` 与 preload 均纯透传。**处置 = 重启 dev 即恢复**，不加防御性兜底（类型契约下字段必在，兜底反而掩盖契约破坏）。
2. **被引用数 4 vs 反向链接徽标 3**：BacklinkPanel 按唯一来源笔记去重显示（`${vault}::${path}`），弹窗初版用了原始条目数 `backlinks.length`（同一笔记多次引用重复计）。修正 = 同口径去重后计数，「N 篇笔记」语义与徽标一致；需求文档 P1-6 口径已同步。
