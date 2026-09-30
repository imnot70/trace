/** 断链判定的纯逻辑（所见即所得装饰层注入用）：与主进程 FsTreeService.resolveByName
 *  的口径对齐。独立成零依赖模块——测试与 tsconfig.node（含 tests/）可直接引用，
 *  不经过带 window.trace 的 lib/wikilink.ts。 */
import type { TreeNode } from '@shared/types'

/**
 * 断链判定（2026-09-30 修复路径形式误报）：
 * ① 叶子名匹配（大小写不敏感）；
 * ② 路径形式匹配：target 含 `/` 时与「相对路径去 .md 后缀」比较（如 [[dir_02/笔记]]
 *    命中 dir_02/笔记.md）。此前装饰层只比叶子名，路径形式引用（搜索同名消歧插入 /
 *    `[[` 路径补全）一律误报断链，而点击跳转走主进程解析器是通的——显示与行为不一致。
 */
export function treeHasWikiTarget(nodes: TreeNode[], name: string): boolean {
  const target = name.toLowerCase()
  const walk = (list: TreeNode[]): boolean =>
    list.some((n) => {
      if (n.kind === 'note') {
        return (
          n.name.toLowerCase() === `${target}.md` ||
          n.name.toLowerCase() === target ||
          n.path.replace(/\.md$/i, '').toLowerCase() === target
        )
      }
      return n.kind === 'dir' && n.children ? walk(n.children) : false
    })
  return walk(nodes)
}
