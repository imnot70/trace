/**
 * 窗口标题（FR-2.10.7）：跟随当前笔记——常规「笔记名」（2026-09-30 用户修订：去掉
 * 「- Trace 笔迹」后缀，避免与内容区面包屑相邻造成误解），心流「库名 / 笔记名」（顶栏
 * 隐藏后标题让给路径，与编辑卡面包屑同风格，均不带 .md）；无笔记恢复默认应用名。
 * 零依赖纯函数，便于单测。
 */
export function buildWindowTitle(
  cur: { vault: string; name: string } | null,
  flowMode: boolean,
  defaultTitle = 'Trace 笔迹'
): string {
  if (!cur) return defaultTitle
  return flowMode ? `${cur.vault} / ${cur.name}` : cur.name
}
