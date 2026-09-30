/**
 * 窗口标题（FR-2.10.7）：跟随当前笔记——常规「笔记名 - Trace 笔迹」（桌面应用惯例，
 * 任务栏 / Alt+Tab 直接可辨当前笔记），心流「库名 / 笔记名」（顶栏隐藏后标题让给路径，
 * 与编辑卡面包屑同风格，均不带 .md）；无笔记恢复默认。零依赖纯函数，便于单测。
 */
export function buildWindowTitle(
  cur: { vault: string; name: string } | null,
  flowMode: boolean,
  defaultTitle = 'Trace 笔迹'
): string {
  if (!cur) return defaultTitle
  return flowMode ? `${cur.vault} / ${cur.name}` : `${cur.name} - ${defaultTitle}`
}
