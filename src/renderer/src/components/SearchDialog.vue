<template>
  <el-dialog
    :model-value="visible"
    title="全局搜索"
    width="80%"
    :close-on-click-modal="false"
    :close-on-press-escape="true"
    class="search-dialog"
    @update:model-value="(v: boolean) => !v && handleClose()"
    @close="handleClose"
  >
    <div class="search-container">
      <!-- 搜索输入框 -->
      <div class="search-input-container">
        <el-input
          v-model="searchQuery"
          placeholder="搜索所有笔记..."
          size="large"
          clearable
          @input="handleSearchInput"
          @keyup.enter="performSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
          <template #append>
            <el-button @click="performSearch" :loading="isSearching">
              搜索
            </el-button>
          </template>
        </el-input>
        <div class="search-options">
          <el-checkbox v-model="searchInTitle">标题</el-checkbox>
          <el-checkbox v-model="searchInContent">内容</el-checkbox>
          <el-select v-model="searchScope" size="small" style="width: 120px">
            <el-option label="所有库" value="all" />
            <el-option label="当前库" value="current" />
          </el-select>
        </div>
      </div>

      <!-- 搜索状态 -->
      <div v-if="isSearching" class="search-status">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>搜索中...</span>
      </div>

      <!-- 搜索结果 -->
      <div v-else-if="searchResults.length > 0" class="search-results">
        <div class="results-header">
          <span>找到 {{ searchResults.length }} 个结果</span>
          <span v-if="searchDurationMs">（{{ searchDurationMs }}ms）</span>
        </div>
        <div class="results-list">
          <div
            v-for="result in searchResults"
            :key="`${result.vault}-${result.path}-${result.lineNumber}`"
            class="result-item"
            @click="openResult(result)"
          >
            <div class="result-header">
              <span class="result-vault">{{ result.vault }}</span>
              <span class="result-path">{{ result.path }}</span>
            </div>
            <div class="result-title">{{ result.title }}</div>
            <div class="result-snippet" v-html="highlightSnippet(result.snippet, result.keyword)" />
            <div class="result-meta">
              <span class="result-line">行 {{ result.lineNumber }}</span>
              <span class="result-score">相关度: {{ Math.round(result.score) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 无结果 -->
      <div v-else-if="searchQuery && !isSearching" class="no-results">
        <el-icon size="48"><Search /></el-icon>
        <p>未找到匹配的结果</p>
        <p class="no-results-hint">尝试使用不同的关键词或检查搜索范围</p>
      </div>

      <!-- 初始状态 -->
      <div v-else class="search-initial">
        <el-icon size="48"><Search /></el-icon>
        <p>输入关键词搜索所有笔记</p>
        <p class="search-hint">支持标题和内容搜索</p>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">关闭</el-button>
        <el-button type="primary" @click="buildIndex" :loading="isBuildingIndex">
          重建索引
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Loading } from '@element-plus/icons-vue'
import type { SearchResultItem } from '@shared/types'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-note', vault: string, path: string): void
}>()

const searchQuery = ref('')
const searchResults = ref<SearchResultItem[]>([])
const searchDurationMs = ref(0)
const isSearching = ref(false)
const isBuildingIndex = ref(false)
const searchInTitle = ref(true)
const searchInContent = ref(true)
const searchScope = ref<'all' | 'current'>('all')

// 搜索防抖
let searchTimeout: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      // 打开对话框时聚焦搜索框
      setTimeout(() => {
        const input = document.querySelector('.search-dialog .el-input__inner') as HTMLInputElement
        input?.focus()
      }, 100)
    }
  }
)

function handleSearchInput() {
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
  searchTimeout = setTimeout(() => {
    performSearch()
  }, 300)
}

async function performSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }

  isSearching.value = true
  try {
    const result = await window.trace.searchQuery(searchQuery.value.trim(), 50)
    if (result.ok && result.results) {
      searchResults.value = result.results
      searchDurationMs.value = result.durationMs || 0
    } else {
      ElMessage.error(result.error || '搜索失败')
      searchResults.value = []
    }
  } catch (e) {
    ElMessage.error('搜索失败')
    searchResults.value = []
  } finally {
    isSearching.value = false
  }
}

function highlightSnippet(snippet: string, keyword: string): string {
  if (!keyword) return snippet
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return snippet.replace(regex, '<mark>$1</mark>')
}

function openResult(result: SearchResultItem) {
  emit('open-note', result.vault, result.path)
  emit('close')
}

async function buildIndex() {
  isBuildingIndex.value = true
  try {
    const result = await window.trace.searchBuildIndex(true)
    if (result.ok) {
      ElMessage.success(`索引构建完成：${result.totalFiles} 个文件`)
    } else {
      ElMessage.error(result.error || '构建索引失败')
    }
  } catch (e) {
    ElMessage.error('构建索引失败')
  } finally {
    isBuildingIndex.value = false
  }
}

function handleClose() {
  emit('close')
}

onMounted(() => {
  // 可以在这里初始化搜索索引状态
})
</script>

<style scoped>
.search-dialog {
  :deep(.el-dialog__body) {
    padding: 0;
    height: 70vh;
    min-height: 500px;
  }
}

.search-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
}

.search-input-container {
  margin-bottom: 16px;
}

.search-options {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.search-status {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}

.search-results {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.results-header {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  color: var(--text-secondary);
}

.results-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.result-item {
  padding: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-bottom: 4px;
}

.result-item:hover {
  background-color: var(--bg-hover);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.result-vault {
  background-color: var(--accent-light);
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 11px;
}

.result-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-title {
  font-weight: 500;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.result-snippet {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 4px;
}

.result-snippet :deep(mark) {
  background-color: var(--accent-light);
  color: var(--accent);
  padding: 1px 2px;
  border-radius: 2px;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 11px;
  color: var(--text-secondary);
}

.no-results,
.search-initial {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}

.no-results-hint,
.search-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
