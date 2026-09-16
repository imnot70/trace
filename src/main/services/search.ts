import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../lib/logger'
import type { SearchResult, SearchResultItem } from '@shared/types'

/** 搜索索引项 */
interface SearchIndexItem {
  vault: string
  path: string
  title: string
  content: string
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
          content: content,
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
   */
  search(query: string, maxResults = 50): SearchResult {
    const startTime = Date.now()

    if (!query || query.trim().length === 0) {
      return { ok: true, results: [], durationMs: 0, totalMatches: 0 }
    }

    const normalizedQuery = query.toLowerCase().trim()
    const results: SearchResultItem[] = []

    // 搜索索引
    for (const item of this.index.values()) {
      const matches = this.findMatches(item, normalizedQuery)
      results.push(...matches)

      if (results.length >= maxResults) {
        break
      }
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

  /**
   * 在单个文档中查找匹配项
   */
  private findMatches(item: SearchIndexItem, query: string): SearchResultItem[] {
    const matches: SearchResultItem[] = []
    const lines = item.content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineLower = line.toLowerCase()

      if (lineLower.includes(query)) {
        // 计算匹配分数
        const score = this.calculateScore(item, line, query, i)

        // 提取匹配片段
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

    return matches
  }

  /**
   * 计算匹配分数
   */
  private calculateScore(item: SearchIndexItem, line: string, query: string, lineNumber: number): number {
    let score = 0

    // 标题匹配权重最高
    if (item.title.toLowerCase().includes(query)) {
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
        content,
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
   * 清空索引
   */
  clearIndex(): void {
    this.index.clear()
  }
}
