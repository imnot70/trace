# 常用网格卡片显示相对时间

## 问题

常用笔记网格卡片底部 meta 区只显示 vault 名和路径，不显示打开时间。用户无法快速判断「多久前编辑过」。

## 方案

改动 2 个文件，零新依赖。

### 1. 新建 `src/renderer/src/lib/relativeTime.ts`

用 `Intl.RelativeTimeFormat('zh-CN')`（浏览器内置）实现 `formatRelativeTime(isoString): string`：

| 时间差 | 输出 |
|--------|------|
| < 1 分钟 | 刚刚 |
| < 1 小时 | X 分钟前 |
| < 24 小时 | X 小时前 |
| < 30 天 | X 天前 |
| < 12 个月 | X 个月前 |
| ≥ 12 个月 | X 年前 |

### 2. 修改 `src/renderer/src/views/NoteGridView.vue`

`.note-card-meta` 区改为：
- `props.kind === 'recent'` → 调用 `formatRelativeTime(item.openedAt)`
- 其他视图（收藏、库网格）→ 保持原样显示 vault/路径

## 不做的事

- 不引入 dayjs/date-fns 等第三方库
- 不给收藏卡片加时间（收藏无 `addedAt` 的展示需求）
- 不做自动刷新（切换视图时更新即可，不需要定时器）
