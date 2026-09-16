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
      <!-- 搜索输入框 + 选项 -->
      <div class="search-input-container">
        <div class="search-bar">
          <el-input
            v-model="searchQuery"
            placeholder="搜索笔记..."
            clearable
            @input="handleSearchInput"
            @keyup.enter="performSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-dropdown trigger="click" :hide-on-click="false" popper-class="search-vault-dropdown">
            <el-button class="vault-trigger" :class="{ 'vault-trigger--error': noVaultSelected }">
              <el-icon><Folder /></el-icon>
              <span class="vault-trigger-text">{{ vaultLabel }}</span>
              <el-icon class="vault-trigger-arrow"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="toggleAllVaults">
                  <el-checkbox
                    :model-value="allVaultsMode"
                    @click.stop
                    @update:model-value="() => toggleAllVaults()"
                  />
                  <span class="vault-item-label" :class="{ bold: allVaultsMode }">所有库</span>
                </el-dropdown-item>
                <el-dropdown-item divided v-for="v in availableVaults" :key="v" @click="toggleVault(v)">
                  <el-checkbox
                    :model-value="isVaultSelected(v)"
                    @click.stop
                    @update:model-value="() => toggleVault(v)"
                  />
                  <span class="vault-item-label">{{ v }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span v-if="noVaultSelected" class="vault-hint">请选择至少一个笔记库</span>
        </div>
        <div class="search-scope-row">
          <el-checkbox v-model="searchInTitle" @change="handleOptionChange">标题</el-checkbox>
          <el-checkbox v-model="searchInContent" @change="handleOptionChange">内容</el-checkbox>
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
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Loading, Folder, ArrowDown } from '@element-plus/icons-vue'
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
/** 是否处于"所有库"模式（默认 true；取消所有库后为 false） */
const allVaultsMode = ref(true)
const indexStatus = ref({ totalFiles: 0, isIndexing: false })

const availableVaults = ref<string[]>([])

let searchTimeout: ReturnType<typeof setTimeout> | null = null

/** 是否没有选择任何库（自定义模式下 selectedVaults 为空） */
const noVaultSelected = computed(() => !allVaultsMode.value && selectedVaults.value.length === 0)

const vaultLabel = computed(() => {
  if (allVaultsMode.value) return '所有库'
  if (selectedVaults.value.length === 0) return '未选择库'
  if (selectedVaults.value.length === 1) return selectedVaults.value[0]
  return `${selectedVaults.value.length} 个库`
})

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

function isVaultSelected(vault: string): boolean {
  if (allVaultsMode.value) return true
  return selectedVaults.value.includes(vault)
}

function toggleVault(vault: string) {
  if (allVaultsMode.value) {
    // 从"所有库"模式切换到自定义，选中除当前库外的所有库
    allVaultsMode.value = false
    selectedVaults.value = availableVaults.value.filter((v) => v !== vault)
  } else if (selectedVaults.value.includes(vault)) {
    selectedVaults.value = selectedVaults.value.filter((v) => v !== vault)
    // 全选时自动回到"所有库"模式
    if (selectedVaults.value.length === availableVaults.value.length) {
      allVaultsMode.value = true
      selectedVaults.value = []
    }
  } else {
    selectedVaults.value = [...selectedVaults.value, vault]
    if (selectedVaults.value.length === availableVaults.value.length) {
      allVaultsMode.value = true
      selectedVaults.value = []
    }
  }
  if (searchQuery.value.trim()) performSearch()
}

/** 切换"所有库"：已选中则取消全选，未选中则全选 */
function toggleAllVaults() {
  if (allVaultsMode.value) {
    // 取消全选
    allVaultsMode.value = false
    selectedVaults.value = []
  } else {
    // 全选
    allVaultsMode.value = true
    selectedVaults.value = []
  }
  if (searchQuery.value.trim()) performSearch()
}

function handleOptionChange() {
  if (!searchInTitle.value && !searchInContent.value) {
    searchInContent.value = true
  }
  if (searchQuery.value.trim()) performSearch()
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
    // allVaultsMode 或无选择时不传 vaults（后端搜全部），自定义模式传具体列表
    const vaults = allVaultsMode.value || selectedVaults.value.length === 0
      ? undefined
      : [...selectedVaults.value]
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

.search-bar {
  display: flex;
  gap: 8px;
}

.search-bar .el-input {
  flex: 1;
  min-width: 0;
}

.vault-trigger {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
}

.vault-trigger--error {
  border-color: var(--el-color-danger, #f56c6c) !important;
}

.vault-hint {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-color-danger, #f56c6c);
  margin-left: 4px;
}

.vault-trigger-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.vault-trigger-arrow {
  margin-left: 2px;
  font-size: 12px;
}

.search-scope-row {
  display: flex;
  align-items: center;
  gap: 12px;
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

<style>
/* 全局：搜索库下拉面板宽度自适应 */
.search-vault-dropdown .el-dropdown-menu {
  min-width: 160px;
  max-width: 280px;
}
.search-vault-dropdown .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
}
.search-vault-dropdown .vault-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-vault-dropdown .vault-item-label.bold {
  font-weight: 600;
}
</style>
