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
          ref="searchInputRef"
          v-model="searchQuery"
          placeholder="搜索笔记..."
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
          <div class="search-scope-row">
            <el-checkbox v-model="searchInTitle">标题</el-checkbox>
            <el-checkbox v-model="searchInContent">内容</el-checkbox>
          </div>
          <div class="search-vault-row">
            <span class="search-vault-label">搜索范围：</span>
            <el-checkbox
              :model-value="selectedVaults.length === 0"
              @update:model-value="(val: any) => { if (val) selectedVaults = [] }"
            >全部笔记库</el-checkbox>
            <el-checkbox
              v-for="v in availableVaults"
              :key="v"
              :model-value="selectedVaults.includes(v)"
              @update:model-value="(val: any) => toggleVault(v, !!val)"
            >{{ v }}</el-checkbox>
          </div>
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
            <div class="result-title-row">
              <span class="result-title">{{ result.title }}</span>
              <span v-if="result.lineNumber" class="result-line">{{ result.lineNumber }}</span>
            </div>
            <div
              v-if="result.snippet"
              class="result-snippet"
              v-html="highlightSnippet(result.snippet, result.keyword)"
            />
            <div class="result-location">
              <span class="result-vault">{{ result.vault }}</span>
              <span class="result-path">{{ result.path }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 无结果 -->
      <div v-else-if="searchQuery && !isSearching" class="search-empty">
        <el-icon size="36"><Search /></el-icon>
        <p>未找到匹配的结果</p>
      </div>

      <!-- 初始状态 -->
      <div v-else class="search-empty">
        <el-icon size="36"><Search /></el-icon>
        <p>输入关键词搜索笔记</p>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <span class="index-info" v-if="indexStatus.totalFiles">
          索引：{{ indexStatus.totalFiles }} 篇笔记
        </span>
        <span v-else />
        <div>
          <el-button size="small" @click="buildIndex" :loading="isBuildingIndex">
            重建索引
          </el-button>
          <el-button @click="handleClose">关闭</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
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
const selectedVaults = ref<string[]>([])
const indexStatus = ref({ totalFiles: 0, isIndexing: false })

const availableVaults = ref<string[]>([])

let searchTimeout: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadVaults()
      loadIndexStatus()
      setTimeout(() => {
        const el = document.querySelector('.search-dialog .el-input__inner') as HTMLInputElement
        el?.focus()
        el?.select()
      }, 100)
    }
  }
)

async function loadVaults() {
  try {
    const result = await window.trace.listVaults()
    if (result.ok && result.vaults) {
      availableVaults.value = result.vaults.map((v) => v.name)
    }
  } catch { /* ignore */ }
}

async function loadIndexStatus() {
  try {
    const result = await window.trace.getSearchIndexStatus()
    if (result.ok) {
      indexStatus.value = { totalFiles: result.totalFiles || 0, isIndexing: result.isIndexing || false }
    }
  } catch { /* ignore */ }
}

function toggleVault(vault: string, checked: boolean) {
  if (checked) {
    if (!selectedVaults.value.includes(vault)) {
      selectedVaults.value = [...selectedVaults.value, vault]
    }
  } else {
    selectedVaults.value = selectedVaults.value.filter((v) => v !== vault)
  }
}

function handleSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => performSearch(), 300)
}

async function performSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }

  if (!searchInTitle.value && !searchInContent.value) {
    searchResults.value = []
    return
  }

  isSearching.value = true
  try {
    // 展开 reactive Proxy 数组为普通数组，避免 IPC structured clone 出错
    const vaults = selectedVaults.value.length > 0 ? [...selectedVaults.value] : undefined
    const result = await window.trace.searchQuery(
      searchQuery.value.trim(),
      100,
      {
        searchInTitle: searchInTitle.value,
        searchInContent: searchInContent.value,
        vaults
      }
    )
    if (result.ok && result.results) {
      searchResults.value = result.results
      searchDurationMs.value = result.durationMs || 0
    } else {
      ElMessage.error(result.error || '搜索失败')
      searchResults.value = []
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '搜索失败')
    searchResults.value = []
  } finally {
    isSearching.value = false
  }
}

function highlightSnippet(snippet: string, keyword: string): string {
  if (!keyword) return snippet
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
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
      indexStatus.value = { totalFiles: result.totalFiles || 0, isIndexing: false }
    } else {
      ElMessage.error(result.error || '构建索引失败')
    }
  } catch {
    ElMessage.error('构建索引失败')
  } finally {
    isBuildingIndex.value = false
  }
}

function handleClose() {
  emit('close')
}
</script>

<style scoped>
.search-dialog {
  :deep(.el-dialog) {
    display: flex;
    flex-direction: column;
    max-height: 80vh;
  }
  :deep(.el-dialog__body) {
    padding: 0;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }
}

.search-container {
  display: flex;
  flex-direction: column;
  height: 60vh;
  padding: 16px;
  overflow: hidden;
}

.search-input-container {
  flex-shrink: 0;
  margin-bottom: 12px;
}

.search-options {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.search-scope-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.search-vault-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.search-vault-label {
  flex-shrink: 0;
}

.search-status {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  min-height: 0;
}

.search-results {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.results-header {
  flex-shrink: 0;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  color: var(--text-secondary);
}

.results-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.result-item {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background-color 0.1s;
}

.result-item:last-child {
  border-bottom: none;
}

.result-item:hover {
  background-color: var(--bg-hover);
}

.result-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
}

.result-title {
  font-weight: 500;
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.result-line {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
}

.result-snippet {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 2px;
  padding-left: 0;
}

.result-snippet :deep(mark) {
  background-color: var(--accent-light);
  color: var(--accent);
  padding: 0 1px;
  border-radius: 1px;
}

.result-location {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.6;
}

.result-vault {
  flex-shrink: 0;
}

.result-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  min-height: 0;
}

.search-empty p {
  font-size: 13px;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.index-info {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
