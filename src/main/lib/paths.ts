import path from 'node:path'

/**
 * 把相对路径解析到 root 内部，防止 ../ 逃逸。
 * 统一使用 POSIX 风格相对路径（'a/b'），Windows 上也如此。
 */
export function resolveWithin(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  const rootAbs = path.resolve(root)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error('非法路径')
  }
  return abs
}

/** 把任意平台路径转成 POSIX 风格相对路径（'a/b/c'） */
export function toRelPath(root: string, absPath: string): string {
  return path.relative(path.resolve(root), absPath).split(path.sep).join('/')
}

/** 计算从笔记文件到目标库内文件的 POSIX 相对引用路径 */
export function relReference(fromNoteRel: string, toFileRel: string): string {
  const fromDir = path.posix.dirname(fromNoteRel.split(path.sep).join('/'))
  let rel = path.posix.relative(fromDir, toFileRel.split(path.sep).join('/'))
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}
