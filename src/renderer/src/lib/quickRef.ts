/**
 * 快速引用面板（FR-2.9.12）的纯逻辑：两态括号一致性插入、树扁平化（键盘光标序列）、
 * 呼出落位展开。不依赖 Vue / CM 运行时——CM 接线在 MarkdownEditor.insertReferenceAtPath，
 * 组件接线在 QuickRefPicker.vue，本模块便于单测。
 */
import type { NoteTreeNode } from './noteCompletion'

/**
 * 两态括号一致性插入（tech 教训 5 的两路语义收敛）：
 * - 态 A：光标前有**未闭合**的 `[[`（行内 `/\[\[[^\]]*$/` 命中，与 `[[` 补全 matchBefore
 *   同口径——上一行的 `[[` 不算）→ 从 `[[` 起替换为完整引用，并吸收光标后紧邻的至多两
 *   个 `]`（既有补全落引用的实测收敛行为：替换范围含 `[[`，若只插裸路径会双括号）；
 * - 态 B：无 `[[` 上下文 → 光标处直接插入完整引用。
 *
 * @param before 光标所在行、光标之前的文本
 * @param after  光标所在行、光标之后的文本
 * @param path   引用路径（无 .md 扩展名）
 * @returns start/end 为**行内偏移**（相对行首，end 恒 ≥ start）；调用方加 line.from
 */
export function referenceInsertSpec(
  before: string,
  after: string,
  path: string
): { start: number; end: number; insert: string } {
  const reference = `[[${path}]]`
  const m = /\[\[[^\]]*$/.exec(before)
  if (!m) {
    return { start: before.length, end: before.length, insert: reference }
  }
  // 吸收光标后紧邻的 `]]`（自动闭合残留；只吸 `]` 字符，至多两个）
  let absorbed = 0
  while (absorbed < 2 && after[absorbed] === ']') absorbed++
  return { start: m.index, end: before.length + absorbed, insert: reference }
}

/** 面板光标序列的条目（树形态 = 展开后的可见节点投影；过滤形态 = 扁平命中列表） */
export interface PickerItem {
  /** dir = 文件夹（→/← 展开 / 收起）；note = 笔记（可引入）；draft = 草稿（可引入，跨库语义）；
   *  header = 分组标题（不进光标序列，渲染用） */
  kind: 'dir' | 'note' | 'draft' | 'header'
  /** 显示名（笔记 / 草稿无 .md） */
  name: string
  /** 笔记 / 草稿：完整相对路径（无 .md，引用插入用）；文件夹：目录相对路径 */
  rel: string
  /** 树形态的缩进层级（库根为 0；过滤形态恒 0） */
  depth: number
  /** 草稿的修改时间（相对时间展示用） */
  mtime?: number
}

/**
 * 树扁平化：按「深度优先 + 仅展开的文件夹可见」投影成一维光标序列。
 * 隐藏文件（`.` 开头）跳过（与 collectNotes 同口径）。
 * @param expanded 已展开的目录相对路径集合
 */
export function flattenVisibleTree(
  nodes: NoteTreeNode[],
  expanded: ReadonlySet<string>,
  dir = '',
  depth = 0
): PickerItem[] {
  const out: PickerItem[] = []
  for (const node of nodes) {
    if (node.name.startsWith('.')) continue
    if (node.kind === 'dir') {
      const childDir = dir ? `${dir}/${node.name}` : node.name
      out.push({ kind: 'dir', name: node.name, rel: childDir, depth })
      if (expanded.has(childDir) && node.children) {
        out.push(...flattenVisibleTree(node.children, expanded, childDir, depth + 1))
      }
    } else {
      out.push({ kind: 'note', name: node.name, rel: dir ? `${dir}/${node.name}` : node.name, depth })
    }
  }
  return out
}

/**
 * 呼出落位（D5）：计算让 targetRel（当前笔记）可见所需展开的**祖先目录集合**，
 * 并返回它在完整展开态下的位置。找不到（如目标不可见 / 树未加载）返回 null。
 */
export function locateNote(
  nodes: NoteTreeNode[],
  targetRel: string
): { expand: Set<string>; index: number } | null {
  const segs = targetRel.split('/')
  const dirs = segs.slice(0, -1)
  // 逐层确认祖先目录存在
  let children = nodes
  for (let i = 0; i < dirs.length; i++) {
    const hit = children.find((n) => n.kind === 'dir' && !n.name.startsWith('.') && n.name === dirs[i])
    if (!hit) return null
    children = hit.children ?? []
  }
  const leaf = dirs.length ? segs[dirs.length] : targetRel
  if (!children.some((n) => n.kind === 'note' && n.name === leaf)) return null
  return { expand: new Set(dirs), index: -1 } // index 由调用方在完整展开态下重算
}

/** 草稿过滤（过滤形态）：名字包含查询（大小写不敏感），空查询 = 全部 */
export function filterDrafts(
  drafts: { name: string; mtime: number }[],
  query: string
): { name: string; mtime: number }[] {
  const q = query.trim().toLowerCase()
  if (!q) return drafts
  return drafts.filter((d) => d.name.toLowerCase().includes(q))
}
