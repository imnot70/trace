import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../lib/logger'
import { getFrontmatterTags, maskFrontmatter } from '@shared/noteTags'
import type { SearchTagInfo, SearchResult, SearchResultItem } from '@shared/types'

/** 搜索索引项 */
interface SearchIndexItem {
  vault: string
  path: string
  title: string
  /** 正文（frontmatter 已掩码为等宽空白：行号与源文件对齐不变，但关键词不会再命中 frontmatter 行——
   *  结构化标签检索见 tags 字段，FR-2.9.11） */
  content: string
  /** frontmatter 的 tags 键（结构化标签，供标签维度过滤与 listTags 聚合） */
  tags: string[]
  lastModified: number
}

/** 搜索服务：提供跨笔记库的全局搜索功能 */
export class SearchService {
  private index: Map<string, SearchIndexItem> = new Map()
  private isIndexing = false

  constructor(
    private getVaultPath: (vault: string) => string,
    private getVaults: () => string[]
  ) {}

  /**
   * 构建搜索索引
   * @param force 是否强制重建索引
   */
  async buildIndex(force = false): Promise<void> {
    if (this.isIndexing) {
      logger.warn('索引构建中，跳过重复请求')
      return
    }

    this.isIndexing = true
    const startTime = Date.now()

    try {
      if (force) {
        this.index.clear()
      }

      const vaults = this.getVaults()
      let totalFiles = 0

      for (const vault of vaults) {
        const vaultPath = this.getVaultPath(vault)
        if (!fs.existsSync(vaultPath)) continue

        totalFiles += await this.indexVault(vault, vaultPath)
      }

      const duration = Date.now() - startTime
      logger.info(`搜索索引构建完成：${totalFiles} 个文件，${duration}ms`)
    } catch (e) {
      logger.error('构建搜索索引失败', e)
    } finally {
      this.isIndexing = false
    }
  }

  /**
   * 为单个笔记库建立索引
   */
  private async indexVault(vault: string, vaultPath: string): Promise<number> {
    let fileCount = 0
    const files = await this.getMarkdownFiles(vaultPath)

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8')
        const relativePath = path.relative(vaultPath, file).replace(/\\/g, '/')
        const title = path.basename(file, '.md')
        const stat = await fs.promises.stat(file)

        const indexKey = `${vault}:${relativePath}`
        this.index.set(indexKey, {
          vault,
          path: relativePath,
          title,
          content: maskFrontmatter(content),
          tags: getFrontmatterTags(content),
          lastModified: stat.mtimeMs
        })

        fileCount++
      } catch (e) {
        logger.warn(`索引文件失败: ${file}`, e)
      }
    }

    return fileCount
  }

  /**
   * 递归获取目录下的所有 Markdown 文件
   */
  private async getMarkdownFiles(dirPath: string): Promise<string[]> {
    const results: string[] = []
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subFiles = await this.getMarkdownFiles(fullPath)
        results.push(...subFiles)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath)
      }
    }

    return results
  }

  /**
   * 执行搜索查询
   * @param options.tags 标签维度过滤（OR 语义：命中任一选中标签即入围；FR-2.9.11）。
   *   关键词与标签同时给出时取交集；**仅给标签不给关键词** = 浏览模式，该标签下全部笔记各出一条
   * @param options.excludeDir 排除各库内的指定目录（库内相对路径前缀，如「跨库引用」副本目录；
   *   FR-2.9.11。只按 `<目录>/` 前缀过滤，不影响同名前缀的其他文件）
   */
  search(
    query: string,
    maxResults = 100,
    options?: { searchInTitle?: boolean; searchInContent?: boolean; vaults?: string[]; tags?: string[]; excludeDir?: string }
  ): SearchResult {
    const startTime = Date.now()

    const normalizedQuery = query.toLowerCase().trim()
    const tagFilter = options?.tags && options.tags.length > 0 ? options.tags : undefined

    // 关键词与标签都没有（或勾选项全关）时无事可做
    if (!normalizedQuery && !tagFilter) {
      return { ok: true, results: [], durationMs: 0, totalMatches: 0 }
    }

    const results: SearchResultItem[] = []
    const searchTitle = options?.searchInTitle !== false
    const searchContent = options?.searchInContent !== false
    const vaultFilter = options?.vaults
    const excludePrefix = options?.excludeDir ? `${options.excludeDir}/` : null

    // 库范围 + 目录排除（跨库引用副本，FR-2.9.11）
    const inScope = (item: SearchIndexItem): boolean => {
      if (vaultFilter && vaultFilter.length > 0 && !vaultFilter.includes(item.vault)) return false
      if (excludePrefix && item.path.startsWith(excludePrefix)) return false
      return true
    }

    if (!normalizedQuery) {
      // 浏览模式：仅按标签（+范围）筛笔记，每篇一条，按最近修改排序
      for (const item of this.index.values()) {
        if (!inScope(item)) continue
        if (!this.matchesTags(item, tagFilter)) continue
        results.push({
          vault: item.vault,
          path: item.path,
          title: item.title,
          snippet: '',
          score: item.lastModified,
          lineNumber: 0,
          keyword: ''
        })
      }
      results.sort((a, b) => b.score - a.score)
      const duration = Date.now() - startTime
      return {
        ok: true,
        results: results.slice(0, maxResults),
        durationMs: duration,
        totalMatches: results.length
      }
    }

    if (!searchTitle && !searchContent) {
      return { ok: true, results: [], durationMs: 0, totalMatches: 0 }
    }

    // 搜索索引
    for (const item of this.index.values()) {
      if (!inScope(item)) {
        continue
      }
      // 按标签筛选（OR 语义）
      if (!this.matchesTags(item, tagFilter)) {
        continue
      }

      const matches = this.findMatches(item, normalizedQuery, searchTitle, searchContent)
      results.push(...matches)

      if (results.length >= maxResults * 2) break
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score)

    const duration = Date.now() - startTime
    logger.info(`搜索 "${query}"：${results.length} 个结果，${duration}ms`)

    return {
      ok: true,
      results: results.slice(0, maxResults),
      durationMs: duration,
      totalMatches: results.length
    }
  }

  /** 标签过滤（OR 语义）：未给标签时恒真；给了则索引项需命中任一选中标签 */
  private matchesTags(item: SearchIndexItem, tagFilter?: string[]): boolean {
    if (!tagFilter || tagFilter.length === 0) return true
    return item.tags.some((t) => tagFilter.includes(t))
  }

  /**
   * 在单个文档中查找匹配项
   */
  private findMatches(
    item: SearchIndexItem,
    query: string,
    searchTitle: boolean,
    searchContent: boolean
  ): SearchResultItem[] {
    const matches: SearchResultItem[] = []
    const titleLower = item.title.toLowerCase()
    const titleMatch = titleLower.includes(query)

    // 标题匹配
    if (searchTitle && titleMatch) {
      matches.push({
        vault: item.vault,
        path: item.path,
        title: item.title,
        snippet: '',
        score: 200,
        lineNumber: 0,
        keyword: query
      })
    }

    // 内容匹配
    if (searchContent) {
      const lines = item.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineLower = line.toLowerCase()

        if (lineLower.includes(query)) {
          const score = this.calculateScore(item, line, query, i, titleMatch)
          const snippet = this.extractSnippet(line, query)

          matches.push({
            vault: item.vault,
            path: item.path,
            title: item.title,
            snippet,
            score,
            lineNumber: i + 1,
            keyword: query
          })
        }
      }
    }

    return matches
  }

  /**
   * 计算匹配分数
   */
  private calculateScore(item: SearchIndexItem, line: string, query: string, lineNumber: number, titleMatch = false): number {
    let score = 0

    // 标题匹配权重最高
    if (titleMatch) {
      score += 100
    }

    // 精确匹配加分
    if (line.toLowerCase().includes(query)) {
      score += 50
    }

    // 匹配位置越靠前分数越高
    const position = line.toLowerCase().indexOf(query)
    if (position >= 0) {
      score += Math.max(0, 20 - position)
    }

    // 匹配长度加分
    score += query.length * 2

    // 文档修改时间加分（最近修改的优先）
    const ageDays = (Date.now() - item.lastModified) / (1000 * 60 * 60 * 24)
    score += Math.max(0, 10 - ageDays)

    return score
  }

  /**
   * 提取匹配片段
   */
  private extractSnippet(line: string, query: string): string {
    const maxLength = 100
    const queryLower = query.toLowerCase()
    const lineLower = line.toLowerCase()
    const queryIndex = lineLower.indexOf(queryLower)

    if (queryIndex === -1) {
      return line.substring(0, maxLength)
    }

    // 计算片段开始和结束位置
    const snippetStart = Math.max(0, queryIndex - 20)
    const snippetEnd = Math.min(line.length, queryIndex + query.length + 20)

    let snippet = ''
    if (snippetStart > 0) {
      snippet += '...'
    }
    snippet += line.substring(snippetStart, snippetEnd)
    if (snippetEnd < line.length) {
      snippet += '...'
    }

    return snippet
  }

  /**
   * 更新单个文件的索引
   */
  async updateFileIndex(vault: string, filePath: string): Promise<void> {
    const vaultPath = this.getVaultPath(vault)
    const fullPath = path.join(vaultPath, filePath)

    try {
      if (!fs.existsSync(fullPath)) {
        // 文件已删除，从索引中移除
        const indexKey = `${vault}:${filePath}`
        this.index.delete(indexKey)
        return
      }

      const content = await fs.promises.readFile(fullPath, 'utf-8')
      const title = path.basename(filePath, '.md')
      const stat = await fs.promises.stat(fullPath)

      const indexKey = `${vault}:${filePath}`
      this.index.set(indexKey, {
        vault,
        path: filePath,
        title,
        content: maskFrontmatter(content),
        tags: getFrontmatterTags(content),
        lastModified: stat.mtimeMs
      })
    } catch (e) {
      logger.warn(`更新文件索引失败: ${fullPath}`, e)
    }
  }

  /**
   * 删除文件索引
   */
  removeFileIndex(vault: string, filePath: string): void {
    const indexKey = `${vault}:${filePath}`
    this.index.delete(indexKey)
  }

  /**
   * 获取索引状态
   */
  getIndexStatus(): { totalFiles: number; isIndexing: boolean } {
    return {
      totalFiles: this.index.size,
      isIndexing: this.isIndexing
    }
  }

  /**
   * 聚合索引中出现的全部标签（跨库去重，按篇数降序、同数按名称）——供搜索框标签筛选下拉（FR-2.9.11）
   */
  listTags(): SearchTagInfo[] {
    const counts = new Map<string, number>()
    for (const item of this.index.values()) {
      for (const tag of item.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
  }
}
