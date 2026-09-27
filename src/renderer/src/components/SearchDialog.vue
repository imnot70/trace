<template>
  <el-dialog
    :model-value="visible"
    title="全局搜索"
    width="52%"
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
            @keydown.down.prevent="moveActive(1)"
            @keydown.up.prevent="moveActive(-1)"
            @keydown.enter.exact="onEnterKey"
            @keydown.alt.enter.prevent="onPreviewKey"
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
                  <span class="vault-item-label">{{ scratchVaultLabel(v) }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <!-- 标签维度筛选（FR-2.9.11）：多选 OR 命中，可与关键词叠加；只选标签不输关键词 = 浏览模式 -->
          <el-dropdown trigger="click" :hide-on-click="false" popper-class="search-vault-dropdown search-tag-dropdown">
            <el-button class="vault-trigger" :class="{ 'vault-trigger--active': selectedTags.length > 0 }">
              <el-icon><PriceTag /></el-icon>
              <span class="vault-trigger-text">{{ tagLabel }}</span>
              <el-icon class="vault-trigger-arrow"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="availableTags.length === 0">
                  <span class="vault-item-label">暂无标签</span>
                </el-dropdown-item>
                <el-dropdown-item v-for="t in availableTags" :key="t.tag" @click="toggleTag(t.tag)">
                  <el-checkbox
                    :model-value="selectedTags.includes(t.tag)"
                    @click.stop
                    @update:model-value="() => toggleTag(t.tag)"
                  />
                  <span class="vault-item-label">{{ t.tag }}（{{ t.count }}）</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="search-scope-row">
          <el-checkbox v-model="searchInTitle" @change="handleOptionChange">标题</el-checkbox>
          <el-checkbox v-model="searchInContent" @change="handleOptionChange">内容</el-checkbox>
          <!-- 勾选 = 把「跨库引用目录」的副本纳入搜索（默认不勾 = 排除副本，FR-2.9.11）；localStorage 记忆 -->
          <el-checkbox v-model="includeCopies" @change="handleOptionChange">跨库引用</el-checkbox>
          <span v-if="noVaultSelected" class="vault-hint">请选择至少一个笔记库</span>
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
            v-for="(result, idx) in searchResults"
            :key="`${result.vault}-${result.path}-${result.lineNumber}`"
            class="result-item"
            :class="{ active: idx === activeIndex }"
            @mousemove="activeIndex = idx"
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
              <span class="result-vault">{{ scratchVaultLabel(result.vault) }}</span>
              <span class="result-path">{{ result.path }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 无结果 -->
      <div v-else-if="(searchQuery || selectedTags.length > 0) && !isSearching" class="search-empty">
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
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Loading, Folder, ArrowDown, PriceTag } from '@element-plus/icons-vue'
import { SCRATCH_VAULT } from '@shared/types'
import type { SearchTagInfo, SearchResultItem } from '@shared/types'
import { scratchVaultLabel } from '../stores/draft'
import { useAppStore } from '../stores/app'

const app = useAppStore()

const props = defineProps<{
  visible: boolean
  /** Double-Shift 预置的搜索范围（当前库名；FR-2.9.11）。打开时应用，用户仍可在下拉里改 */
  presetVault?: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-note', vault: string, path: string): void
  /** Alt+Enter：关闭搜索框并请求以悬浮预览查看该结果（FR-2.9.10） */
  (e: 'preview-note', vault: string, path: string, title: string): void
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
/** 标签维度筛选（FR-2.9.11）：多选，OR 语义 */
const selectedTags = ref<string[]>([])
const availableTags = ref<SearchTagInfo[]>([])
const indexStatus = ref({ totalFiles: 0, isIndexing: false })
/** 「跨库引用」开关：勾选 = 把副本目录纳入搜索；默认不勾（副本不参与搜索）。localStorage 记忆 */
const INCLUDE_COPIES_KEY = 'trace.searchIncludeCopies'
const includeCopies = ref(localStorage.getItem(INCLUDE_COPIES_KEY) === '1')
watch(includeCopies, (v) => localStorage.setItem(INCLUDE_COPIES_KEY, v ? '1' : '0'))

/** 副本目录名（设置「跨库引用目录」，留空回默认） */
const copiesDir = computed(() => app.settings.crossVaultCopyDir?.trim() || '跨库引用')

// ---------- 键盘导航（FR-2.9.10）：↑ / ↓ 移动高亮，Enter 打开，Alt+Enter 悬浮预览 ----------
const activeIndex = ref(-1)

watch(searchResults, (list) => {
  activeIndex.value = list.length > 0 ? 0 : -1
})

function moveActive(delta: number): void {
  const len = searchResults.value.length
  if (len === 0) return
  activeIndex.value = (activeIndex.value + delta + len) % len
  void nextTick(() => {
    document.querySelector('.result-item.active')?.scrollIntoView({ block: 'nearest' })
  })
}

function onEnterKey(): void {
  // 无结果时 Enter 仍是「执行搜索」；有结果时打开高亮项（默认第一项）
  if (searchResults.value.length > 0) {
    const target = searchResults.value[activeIndex.value] ?? searchResults.value[0]
    if (target) openResult(target)
  } else {
    void performSearch()
  }
}

function onPreviewKey(): void {
  const target = searchResults.value[activeIndex.value] ?? searchResults.value[0]
  if (!target) return
  // 决策 D3：搜索框是模态对话框（遮罩压悬浮预览的 z 序），预览前先关闭；Ctrl+F 可立即重开
  emit('close')
  emit('preview-note', target.vault, target.path, target.title)
}

const availableVaults = ref<string[]>([])

let searchTimeout: ReturnType<typeof setTimeout> | null = null
/** 请求序号：只接受最新一次搜索的响应——勾选项快速连点时，慢速的旧请求若晚到
 *  会把新状态下的清空 / 新结果覆盖回旧值（实测：关内容后闪回「仅标题」的旧结果） */
let searchSeq = 0

/** 是否没有选择任何库（自定义模式下 selectedVaults 为空） */
const noVaultSelected = computed(() => !allVaultsMode.value && selectedVaults.value.length === 0)

const vaultLabel = computed(() => {
  if (allVaultsMode.value) return '所有库'
  if (selectedVaults.value.length === 0) return '未选择库'
  if (selectedVaults.value.length === 1) return scratchVaultLabel(selectedVaults.value[0])
  return `${selectedVaults.value.length} 个库`
})

/** 标签筛选触发钮文案：未选 = 功能名；选中后回显范围（FR-2.9.11） */
const tagLabel = computed(() => {
  if (selectedTags.value.length === 0) return '标签'
  if (selectedTags.value.length === 1) return selectedTags.value[0]
  return `${selectedTags.value.length} 个标签`
})

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      // 上一次的关键词与结果不保留（对话框常驻挂载、ref 跨开合存活，残留结果会与本次
      // 预置的范围不符——用户实测：第二次打开显示的是上次所有库的结果）；范围 / 标签等
      // 筛选偏好保留
      searchQuery.value = ''
      searchResults.value = []
      searchDurationMs.value = 0
      activeIndex.value = -1
      loadVaults()
      loadTags()
      loadIndexStatus()
      // Double-Shift 预置范围（FR-2.9.11）：限定为当前库，用户仍可在下拉里改
      if (props.presetVault) {
        allVaultsMode.value = false
        selectedVaults.value = [props.presetVault]
      }
      setTimeout(() => {
        const el = document.querySelector('.search-dialog .el-input__inner') as HTMLInputElement
        el?.focus()
        el?.select()
      }, 100)
    }
  }
)

async function loadTags() {
  try {
    const result = await window.trace.searchListTags()
    if (result.ok && result.tags) availableTags.value = result.tags
  } catch { /* ignore */ }
}

/** 切换标签筛选（多选 OR）：变化即重搜——只选标签不输关键词 = 浏览该标签下全部笔记 */
function toggleTag(tag: string) {
  selectedTags.value = selectedTags.value.includes(tag)
    ? selectedTags.value.filter((t) => t !== tag)
    : [...selectedTags.value, tag]
  performSearch()
}

async function loadVaults() {
  try {
    const result = await window.trace.listVaults()
    if (result.ok && result.vaults) {
      availableVaults.value = result.vaults.map((v) => v.name)
      // 草稿（FR-2.3.9）：作为独立可勾选项进入搜索范围（「所有库」语义已包含草稿，
      // 此处让用户可在自定义范围里单独勾选 / 取消；显示名经 scratchVaultLabel 映射为「草稿」）
      const scratch = await window.trace.scratchStatus()
      if (scratch.ok && scratch.count > 0) availableVaults.value.push(SCRATCH_VAULT)
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
  // 标题 / 内容允许同时不勾（此时关键词搜索为空、仅标签筛选有效），不自动勾回
  if (searchQuery.value.trim() || selectedTags.value.length > 0) performSearch()
}

function handleSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => performSearch(), 300)
}

async function performSearch() {
  const query = searchQuery.value.trim()
  // 关键词与标签都没有：清空（只选标签不给关键词 = 浏览模式，FR-2.9.11）
  if (!query && selectedTags.value.length === 0) {
    searchResults.value = []
    return
  }

  // 标题 / 内容都未勾时关键词搜索无匹配字段（空结果）；仅标签筛选的浏览模式不受限
  if (query && !searchInTitle.value && !searchInContent.value) {
    searchResults.value = []
    return
  }

  isSearching.value = true
  const seq = ++searchSeq
  try {
    // allVaultsMode 或无选择时不传 vaults（后端搜全部），自定义模式传具体列表
    const vaults = allVaultsMode.value || selectedVaults.value.length === 0
      ? undefined
      : [...selectedVaults.value]
    const result = await window.trace.searchQuery(
      query,
      100,
      {
        searchInTitle: searchInTitle.value,
        searchInContent: searchInContent.value,
        vaults,
        tags: selectedTags.value.length > 0 ? [...selectedTags.value] : undefined,
        excludeDir: includeCopies.value ? undefined : copiesDir.value
      }
    )
    if (seq !== searchSeq) return // 过期响应：已有更新的搜索发出
    if (result.ok && result.results) {
      searchResults.value = result.results
      searchDurationMs.value = result.durationMs || 0
    } else {
      ElMessage.error(result.error || '搜索失败')
      searchResults.value = []
    }
  } catch (e: any) {
    if (seq !== searchSeq) return
    ElMessage.error(e?.message || '搜索失败')
    searchResults.value = []
  } finally {
    if (seq === searchSeq) isSearching.value = false
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

/* 标签筛选激活态：与「范围」触发钮区分，提示当前处于标签过滤（FR-2.9.11） */
.vault-trigger--active {
  color: var(--accent);
  border-color: var(--accent);
}

.vault-hint {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-color-danger, #f56c6c);
  margin-left: auto;
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

.result-item:hover,
.result-item.active {
  background-color: var(--bg-hover);
}

.result-item.active {
  box-shadow: inset 2px 0 0 var(--accent);
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
  background-color: var(--accent-soft);
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
/* 标签下拉可能很长：限高滚动（FR-2.9.11） */
.search-tag-dropdown .el-dropdown-menu {
  max-height: 300px;
  overflow-y: auto;
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
