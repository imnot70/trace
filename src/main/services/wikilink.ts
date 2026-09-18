import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../lib/logger'
import { noteDisplayName } from '@shared/validate'
import type { BacklinkRef } from '@shared/types'

/** 单条双链引用 */
interface WikilinkEntry {
  targetName: string
  line: number
  /** 文件内出现序号（0 起）——同一行可能有多个引用，作为索引详情 key 防止互相覆盖 */
  idx: number
  raw: string
}

/**
 * 取双链目标的叶子名（`[[子目录/笔记C]]` → `笔记C`）。
 * 双链按笔记名在库内解析（先完整路径后叶子名，见 FsTreeService.resolveByName），
 * 反向索引 / 断链检测统一按叶子名归属，路径形式引用才不会漏配或误报。
 */
function leafName(target: string): string {
  const name = target.split('/').pop() ?? target
  return name.trim()
}

/** 双链索引服务：构建 [[笔记名]] 的正向/反向索引，支持反向链接查询和断链检测 */
export class WikilinkService {
  /** 正向索引：vault:path → 该笔记内的所有 [[...]] 引用 */
  private forwardIndex: Map<string, WikilinkEntry[]> = new Map()
  /** 反向索引：targetName → 引用该目标的所有来源集合 */
  private reverseIndex: Map<string, Set<string>> = new Map()
  /** 来源详情：vault:path:line → BacklinkRef（用于快速查找详细信息） */
  private refDetails: Map<string, BacklinkRef> = new Map()
  private isIndexing = false

  /** 匹配 [[name]] 或 [[path|display]] 的正则，捕获组 1 = 目标名 */
  private static WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g

  constructor(
    private getVaultPath: (vault: string) => string,
    private getVaults: () => string[]
  ) {}

  /** 构建全库双链索引 */
  async buildIndex(force = false): Promise<{ totalFiles: number; totalLinks: number }> {
    if (this.isIndexing) return { totalFiles: this.forwardIndex.size, totalLinks: this.totalLinks() }
    this.isIndexing = true

    if (force) {
      this.forwardIndex.clear()
      this.reverseIndex.clear()
      this.refDetails.clear()
    }

    const startTime = Date.now()
    let totalFiles = 0
    let totalLinks = 0

    try {
      const vaults = this.getVaults()
      for (const vault of vaults) {
        const vaultPath = this.getVaultPath(vault)
        if (!fs.existsSync(vaultPath)) continue
        const { files, links } = await this.indexVault(vault, vaultPath)
        totalFiles += files
        totalLinks += links
      }
      const duration = Date.now() - startTime
      logger.info(`双链索引构建完成：${totalFiles} 个文件，${totalLinks} 条引用，${duration}ms`)
    } catch (e) {
      logger.error('构建双链索引失败', e)
    } finally {
      this.isIndexing = false
    }

    return { totalFiles, totalLinks }
  }

  /** 为单个笔记库建立索引 */
  private async indexVault(vault: string, vaultPath: string): Promise<{ files: number; links: number }> {
    let fileCount = 0
    let linkCount = 0
    const files = await this.getMarkdownFiles(vaultPath)

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8')
        const relativePath = path.relative(vaultPath, file).replace(/\\/g, '/')
        const title = noteDisplayName(path.basename(file))
        const entries = this.extractWikilinks(content)
        const key = `${vault}:${relativePath}`

        // 清除旧的正向条目对应的反向引用
        this.clearReverseRefsForKey(key)

        this.forwardIndex.set(key, entries)
        linkCount += entries.length

        // 构建反向索引（按叶子名归属，路径形式引用 [[dir/name]] 也计入对 name 的引用）
        for (const entry of entries) {
          const detailKey = `${key}:${entry.idx}`
          const ref: BacklinkRef = {
            vault,
            path: relativePath,
            title,
            line: entry.line,
            snippet: entry.raw,
            targetName: entry.targetName
          }
          this.refDetails.set(detailKey, ref)

          const targetLeaf = leafName(entry.targetName)
          let set = this.reverseIndex.get(targetLeaf)
          if (!set) {
            set = new Set()
            this.reverseIndex.set(targetLeaf, set)
          }
          set.add(detailKey)
        }

        fileCount++
      } catch (e) {
        logger.warn(`双链索引文件失败: ${file}`, e)
      }
    }

    return { files: fileCount, links: linkCount }
  }

  /** 从笔记内容中提取所有 [[...]] 引用 */
  private extractWikilinks(content: string): WikilinkEntry[] {
    const entries: WikilinkEntry[] = []
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      WikilinkService.WIKILINK_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = WikilinkService.WIKILINK_RE.exec(line)) !== null) {
        entries.push({
          targetName: match[1].trim(),
          line: i + 1,
          idx: entries.length,
          raw: match[0]
        })
      }
    }
    return entries
  }

  /** 清除某个来源笔记在反向索引中的所有条目 */
  private clearReverseRefsForKey(key: string): void {
    const oldEntries = this.forwardIndex.get(key)
    if (!oldEntries) return
    for (const entry of oldEntries) {
      const detailKey = `${key}:${entry.idx}`
      const targetLeaf = leafName(entry.targetName)
      const set = this.reverseIndex.get(targetLeaf)
      if (set) {
        set.delete(detailKey)
        if (set.size === 0) this.reverseIndex.delete(targetLeaf)
      }
      this.refDetails.delete(detailKey)
    }
  }

  /** 递归获取目录下所有 .md 文件 */
  private async getMarkdownFiles(dirPath: string): Promise<string[]> {
    const results: string[] = []
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...await this.getMarkdownFiles(fullPath))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath)
      }
    }
    return results
  }

  /** 统计总链接数 */
  private totalLinks(): number {
    let count = 0
    for (const entries of this.forwardIndex.values()) count += entries.length
    return count
  }

  // ---- 公开查询接口 ----

  /**
   * 获取引用指定笔记的反向链接列表
   * @param vault 当前库名（双链只在库内解析，跨库同名引用不归属本笔记）
   * @param notePath 笔记相对路径（用于确定笔记显示名）
   */
  getBacklinks(vault: string, notePath: string): BacklinkRef[] {
    const title = noteDisplayName(path.basename(notePath))
    const detailKeys = this.reverseIndex.get(title)
    if (!detailKeys) return []

    const results: BacklinkRef[] = []
    for (const dk of detailKeys) {
      const ref = this.refDetails.get(dk)
      // 仅同库引用归属本笔记；排除自身引用
      if (ref && ref.vault === vault && !(ref.path === notePath)) {
        results.push(ref)
      }
    }
    // 按库名+路径排序保持稳定
    results.sort((a, b) => `${a.vault}:${a.path}`.localeCompare(`${b.vault}:${b.path}`))
    return results
  }

  /**
   * 获取所有未解析的 [[...]] 引用
   * @param vault 指定库名，不传则搜全部库
   */
  getUnresolvedRefs(vault?: string): BacklinkRef[] {
    // 构建已知笔记名集合
    const knownNames = new Set<string>()
    for (const key of this.forwardIndex.keys()) {
      const [v, ...rest] = key.split(':')
      const p = rest.join(':')
      if (vault && v !== vault) continue
      knownNames.add(noteDisplayName(path.basename(p)))
    }

    const results: BacklinkRef[] = []
    const seen = new Set<string>()
    for (const [detailKey, ref] of this.refDetails) {
      if (vault && ref.vault !== vault) continue
      // 路径形式引用 [[dir/name]] 按叶子名判断是否可解析
      if (!knownNames.has(leafName(ref.targetName)) && !seen.has(detailKey)) {
        seen.add(detailKey)
        results.push(ref)
      }
    }
    results.sort((a, b) => `${a.vault}:${a.path}`.localeCompare(`${b.vault}:${b.path}`))
    return results
  }

  /**
   * 增量更新单个文件的索引
   */
  async updateFileIndex(vault: string, filePath: string): Promise<void> {
    const vaultPath = this.getVaultPath(vault)
    const fullPath = path.join(vaultPath, filePath)

    try {
      if (!fs.existsSync(fullPath)) {
        this.removeFileIndex(vault, filePath)
        return
      }
      const content = await fs.promises.readFile(fullPath, 'utf-8')
      const title = noteDisplayName(path.basename(filePath))
      const entries = this.extractWikilinks(content)
      const key = `${vault}:${filePath}`

      this.clearReverseRefsForKey(key)
      this.forwardIndex.set(key, entries)

      for (const entry of entries) {
        const detailKey = `${key}:${entry.idx}`
        const ref: BacklinkRef = { vault, path: filePath, title, line: entry.line, snippet: entry.raw, targetName: entry.targetName }
        this.refDetails.set(detailKey, ref)
        const targetLeaf = leafName(entry.targetName)
        let set = this.reverseIndex.get(targetLeaf)
        if (!set) { set = new Set(); this.reverseIndex.set(targetLeaf, set) }
        set.add(detailKey)
      }
    } catch (e) {
      logger.warn(`更新双链索引失败: ${fullPath}`, e)
    }
  }

  /**
   * 删除单个文件的索引
   */
  removeFileIndex(vault: string, filePath: string): void {
    const key = `${vault}:${filePath}`
    this.clearReverseRefsForKey(key)
    this.forwardIndex.delete(key)
  }

  /**
   * 重命名笔记时批量改写反向索引
   * 注意：只改索引数据，不改磁盘文件内容（由 fsTree 负责改写文件）
   */
  renameNoteInIndex(vault: string, oldPath: string, newPath: string): void {
    const oldKey = `${vault}:${oldPath}`
    const newKey = `${vault}:${newPath}`
    const oldTitle = noteDisplayName(path.basename(oldPath))
    const newTitle = noteDisplayName(path.basename(newPath))

    // 搬移正向索引，并把引用详情 key 从旧路径重映射到新路径
    // （detailKey 形如 `${vault}:${path}:${idx}`，不重映射的话后续增量清理会漏删旧条目）
    const entries = this.forwardIndex.get(oldKey)
    if (entries) {
      this.forwardIndex.delete(oldKey)
      this.forwardIndex.set(newKey, entries)
      for (const entry of entries) {
        const oldDk = `${oldKey}:${entry.idx}`
        const newDk = `${newKey}:${entry.idx}`
        const ref = this.refDetails.get(oldDk)
        if (!ref) continue
        this.refDetails.delete(oldDk)
        ref.path = newPath
        this.refDetails.set(newDk, ref)
        const set = this.reverseIndex.get(leafName(entry.targetName))
        if (set) {
          set.delete(oldDk)
          set.add(newDk)
        }
      }
    }

    // 更新所有引用了旧名的反向索引条目
    const affectedKeys = this.reverseIndex.get(oldTitle)
    if (affectedKeys) {
      for (const dk of affectedKeys) {
        const ref = this.refDetails.get(dk)
        if (ref) {
          ref.targetName = newTitle
        }
      }
      this.reverseIndex.set(newTitle, affectedKeys)
      this.reverseIndex.delete(oldTitle)
    }
  }

  /** 获取索引状态 */
  getIndexStatus(): { totalFiles: number; totalLinks: number; isIndexing: boolean } {
    return {
      totalFiles: this.forwardIndex.size,
      totalLinks: this.totalLinks(),
      isIndexing: this.isIndexing
    }
  }

  /** 清空索引 */
  clearIndex(): void {
    this.forwardIndex.clear()
    this.reverseIndex.clear()
    this.refDetails.clear()
  }
}
