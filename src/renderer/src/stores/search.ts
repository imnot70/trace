import { defineStore } from 'pinia'
import type { SearchResultItem } from '@shared/types'

export const useSearchStore = defineStore('search', {
  state: () => ({
    /** 是否显示搜索对话框 */
    visible: false,
    /** 搜索查询 */
    query: '',
    /** 搜索结果 */
    results: [] as SearchResultItem[],
    /** 搜索耗时 */
    durationMs: 0,
    /** 是否正在搜索 */
    isSearching: false,
    /** 是否正在构建索引 */
    isBuildingIndex: false,
    /** 搜索索引状态 */
    indexStatus: {
      totalFiles: 0,
      isIndexing: false
    }
  }),

  actions: {
    /** 打开搜索对话框 */
    openSearch(): void {
      this.visible = true
    },

    /** 关闭搜索对话框 */
    closeSearch(): void {
      this.visible = false
    },

    /** 执行搜索 */
    async search(query: string, maxResults = 50): Promise<void> {
      if (!query.trim()) {
        this.results = []
        return
      }

      this.isSearching = true
      this.query = query

      try {
        const result = await window.trace.searchQuery(query.trim(), maxResults)
        if (result.ok && result.results) {
          this.results = result.results
          this.durationMs = result.durationMs || 0
        } else {
          console.error('搜索失败:', result.error)
          this.results = []
        }
      } catch (e) {
        console.error('搜索失败:', e)
        this.results = []
      } finally {
        this.isSearching = false
      }
    },

    /** 构建搜索索引 */
    async buildIndex(force = false): Promise<void> {
      this.isBuildingIndex = true
      try {
        const result = await window.trace.searchBuildIndex(force)
        if (result.ok) {
          this.indexStatus = {
            totalFiles: result.totalFiles || 0,
            isIndexing: false
          }
        }
      } catch (e) {
        console.error('构建索引失败:', e)
      } finally {
        this.isBuildingIndex = false
      }
    },

    /** 获取索引状态 */
    async getIndexStatus(): Promise<void> {
      try {
        const result = await window.trace.getSearchIndexStatus()
        if (result.ok) {
          this.indexStatus = {
            totalFiles: result.totalFiles || 0,
            isIndexing: result.isIndexing || false
          }
        }
      } catch (e) {
        console.error('获取索引状态失败:', e)
      }
    },

    /** 更新单个文件的索引 */
    async updateFileIndex(vault: string, filePath: string): Promise<void> {
      try {
        await window.trace.updateSearchIndex(vault, filePath)
      } catch (e) {
        console.error('更新文件索引失败:', e)
      }
    },

    /** 删除单个文件的索引 */
    async removeFileIndex(vault: string, filePath: string): Promise<void> {
      try {
        await window.trace.removeSearchIndex(vault, filePath)
      } catch (e) {
        console.error('删除文件索引失败:', e)
      }
    },

    /** 清空搜索索引 */
    async clearIndex(): Promise<void> {
      try {
        await window.trace.clearSearchIndex()
        this.indexStatus = {
          totalFiles: 0,
          isIndexing: false
        }
      } catch (e) {
        console.error('清空索引失败:', e)
      }
    },

    /** 清除搜索结果 */
    clearResults(): void {
      this.results = []
      this.durationMs = 0
    }
  }
})
