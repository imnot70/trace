/**
 * `[[` 双链补全的扁平模糊匹配（FR-2.9.10 P2）。
 * 查询不含 `/` 时不做逐级目录导航，直接全库匹配笔记名——
 * 解决「必须知道完整路径」的痛点；含 `/` 仍走 MarkdownEditor 里的原逐级行为。
 */

/** 侧栏树节点（结构化最小类型，避免引入 store 依赖） */
export interface NoteTreeNode {
  name: string
  kind: 'dir' | 'note'
  children?: NoteTreeNode[]
}

/** 扁平化后的笔记条目 */
export interface FlatNote {
  /** 叶子名（无 .md 扩展名） */
  name: string
  /** 所在目录（POSIX 相对路径，库根为 ''） */
  dir: string
  /** 完整相对路径（无 .md 扩展名） */
  rel: string
}

/** 递归收集树中的全部笔记 */
export function collectNotes(nodes: NoteTreeNode[], dir = ''): FlatNote[] {
  const out: FlatNote[] = []
  for (const node of nodes) {
    if (node.name.startsWith('.')) continue
    if (node.kind === 'dir') {
      const childDir = dir ? `${dir}/${node.name}` : node.name
      if (node.children) out.push(...collectNotes(node.children, childDir))
    } else {
      out.push({ name: node.name, dir, rel: dir ? `${dir}/${node.name}` : node.name })
    }
  }
  return out
}

/** 补全结果上限：全库笔记可能很多，列表过长反而难选 */
export const FLAT_NOTE_LIMIT = 30

export interface FlatNoteOption {
  /** 插入文本：无重名 = 叶子名（双链按名解析）；库内重名 = 完整相对路径（保证解析唯一） */
  label: string
  /** 所在目录（消歧提示） */
  detail: string
}

/**
 * 扁平模糊匹配：
 * - 评分：叶子名前缀命中(0) < 叶子名包含(1) < 完整路径包含(2)；同分按路径字典序；
 * - 排除当前笔记（自引用）；
 * - 重名消歧：库内同名（大小写不敏感）>1 篇时 label 用完整相对路径；
 * - 空前缀 = 全库笔记列表（按路径排序），上限 FLAT_NOTE_LIMIT。
 */
export function flatNoteOptions(
  notes: FlatNote[],
  prefix: string,
  currentRel: string
): FlatNoteOption[] {
  const q = prefix.toLowerCase()
  const others = notes.filter((n) => n.rel.toLowerCase() !== currentRel.toLowerCase())

  // 库内同名计数（大小写不敏感，与双链解析的消歧口径一致）。
  // 必须含自身：重名是「名字在库内是否唯一」的属性——即使另一篇同名是当前笔记，
  // 从别处插入裸名字产生的双链仍然有歧义
  const nameCount = new Map<string, number>()
  for (const n of notes) {
    const key = n.name.toLowerCase()
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1)
  }

  const scored: { note: FlatNote; score: number }[] = []
  for (const n of others) {
    const leaf = n.name.toLowerCase()
    let score = -1
    if (!q || leaf.startsWith(q)) score = 0
    else if (leaf.includes(q)) score = 1
    else if (n.rel.toLowerCase().includes(q)) score = 2
    if (score >= 0) scored.push({ note: n, score })
  }

  scored.sort((a, b) => a.score - b.score || a.note.rel.localeCompare(b.note.rel))

  return scored.slice(0, FLAT_NOTE_LIMIT).map(({ note }) => {
    const ambiguous = (nameCount.get(note.name.toLowerCase()) ?? 0) > 1
    return {
      label: ambiguous ? note.rel : note.name,
      detail: note.dir || '库根目录'
    }
  })
}
