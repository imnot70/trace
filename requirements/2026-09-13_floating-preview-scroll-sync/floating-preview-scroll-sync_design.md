# 悬浮预览滚动同步设计

## 问题

悬浮预览（长按预览按钮呼出）是独立的 `MarkdownPreview` 实例，未被纳入编辑器↔预览的滚动同步。编辑器滚动时悬浮预览不跟随。

## 根因

`EditorView.vue` 的 `rebindScrollSync()` 只绑定 `previewRef`（固定预览面板），悬浮预览的 `MarkdownPreview` 没有 ref，也没有被监听。

## 方案

改动全在 `src/renderer/src/views/EditorView.vue`：

1. 新增 `floatPreviewRef` 引用悬浮预览的 `MarkdownPreview`
2. 模板中给悬浮预览的 `<MarkdownPreview>` 加 `ref="floatPreviewRef"`
3. 修改 `rebindScrollSync()`：目标优先取 `floatPreviewRef`，否则取 `previewRef`
4. 新增 watcher 监听 `app.floatingPreview`，变化时调用 `rebindScrollSync()`

## 行为

| 场景 | 预期 |
|------|------|
| 悬浮预览打开 + 滚动编辑器 | 悬浮预览跟随滚动 |
| 悬浮预览打开 + 滚动悬浮预览 | 编辑器跟随滚动 |
| 悬浮预览关闭 | 重新绑定回固定预览面板 |
| 打字/点击编辑器 | 悬浮预览仍自动关闭（不变） |
