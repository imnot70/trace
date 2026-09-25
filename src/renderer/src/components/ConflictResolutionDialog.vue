<template>
  <el-dialog
    v-model="visible"
    title="解决冲突"
    width="90%"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    class="conflict-resolution-dialog"
    @close="handleClose"
  >
    <div class="conflict-container">
      <!-- 冲突文件列表 -->
      <div class="conflict-sidebar">
        <div class="sidebar-header">
          <h3>冲突文件 ({{ conflictFiles.length }})</h3>
          <el-button size="small" @click="refreshConflictFiles" :loading="loading">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </div>
        <div class="file-list">
          <div
            v-for="file in conflictFiles"
            :key="file"
            class="file-item"
            :class="{ active: selectedFile === file }"
            @click="selectFile(file)"
          >
            <el-icon><Document /></el-icon>
            <span class="file-name" :title="file">{{ file }}</span>
            <el-tag size="small" type="warning">冲突</el-tag>
          </div>
        </div>
        <div class="sidebar-footer">
          <el-button type="danger" plain @click="abortRebase" :loading="aborting">
            放弃所有更改
          </el-button>
        </div>
      </div>

      <!-- 差异对比区域 -->
      <div class="conflict-main">
        <template v-if="selectedFile">
          <div class="diff-header">
            <h3>{{ selectedFile }}</h3>
            <div class="diff-actions">
              <el-button-group>
                <el-button plain @click="resolveWithOurs" :disabled="resolving">
                  接受本地版本
                </el-button>
                <el-button plain @click="resolveWithTheirs" :disabled="resolving">
                  接受远端版本
                </el-button>
              </el-button-group>
              <el-button
                plain
                @click="resolveWithManual"
                :disabled="resolving || !editedContent"
              >
                使用编辑内容
              </el-button>
            </div>
          </div>
          <ConflictDiffViewer
            v-if="conflictContent"
            :content="conflictContent"
            @update:content="editedContent = $event"
          />
          <div v-else-if="loadError" class="loading-content">
            <el-icon size="40"><WarningFilled /></el-icon>
            <span>冲突内容加载失败</span>
            <el-button size="small" @click="selectedFile && loadConflictContent(selectedFile)">重试</el-button>
          </div>
          <div v-else class="loading-content">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>加载冲突内容中...</span>
          </div>
        </template>
        <div v-else class="no-selection">
          <el-icon size="48"><WarningFilled /></el-icon>
          <p>请从左侧选择一个冲突文件</p>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <div class="progress-info">
          <span>已解决: {{ resolvedCount }} / {{ conflictFiles.length }}</span>
        </div>
        <div class="footer-actions">
          <el-button @click="handleClose">取消</el-button>
          <el-button
            type="primary"
            @click="continueRebase"
            :disabled="resolvedCount < conflictFiles.length || continuing"
            :loading="continuing"
          >
            继续同步
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Document, Loading, WarningFilled } from '@element-plus/icons-vue'
import type { ConflictContent, ConflictResolution } from '@shared/types'
import ConflictDiffViewer from './ConflictDiffViewer.vue'

const props = defineProps<{
  vault: string
  initialFiles?: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'resolved'): void
}>()

const visible = ref(true)
const loading = ref(false)
const loadError = ref(false)
const resolving = ref(false)
const aborting = ref(false)
const continuing = ref(false)
const conflictFiles = ref<string[]>(props.initialFiles || [])
const selectedFile = ref<string | null>(null)
const conflictContent = ref<ConflictContent | null>(null)
const editedContent = ref<string | null>(null)
const resolvedFiles = ref<Set<string>>(new Set())

const resolvedCount = computed(() => resolvedFiles.value.size)

// 选择文件时加载内容（失败给出重试入口，不再永远转圈）
watch(selectedFile, (file) => {
  if (!file) {
    conflictContent.value = null
    editedContent.value = null
    loadError.value = false
    return
  }
  void loadConflictContent(file)
})

async function loadConflictContent(file: string) {
  loading.value = true
  loadError.value = false
  try {
    const result = await window.trace.getConflictContent(props.vault, file)
    if (result.ok && result.content) {
      conflictContent.value = result.content
      editedContent.value = result.content.current
    } else {
      loadError.value = true
      ElMessage.error(result.error || '加载冲突内容失败')
    }
  } catch {
    loadError.value = true
    ElMessage.error('加载冲突内容失败')
  } finally {
    loading.value = false
  }
}

// 刷新冲突文件列表
async function refreshConflictFiles() {
  loading.value = true
  try {
    const result = await window.trace.getConflictFiles(props.vault)
    if (result.ok && result.files) {
      conflictFiles.value = result.files
      // 清除已解决但仍在列表中的文件
      for (const file of resolvedFiles.value) {
        if (!result.files.includes(file)) {
          resolvedFiles.value.delete(file)
        }
      }
    }
  } finally {
    loading.value = false
  }
}

// 选择文件
function selectFile(file: string) {
  selectedFile.value = file
}

// 解决冲突（使用本地版本）
async function resolveWithOurs() {
  if (!selectedFile.value) return
  await resolveFile(selectedFile.value, { type: 'ours' })
}

// 解决冲突（使用远端版本）
async function resolveWithTheirs() {
  if (!selectedFile.value) return
  await resolveFile(selectedFile.value, { type: 'theirs' })
}

// 解决冲突（使用编辑内容）
async function resolveWithManual() {
  if (!selectedFile.value || !editedContent.value) return
  await resolveFile(selectedFile.value, { type: 'manual', content: editedContent.value })
}

// 解决单个文件
async function resolveFile(file: string, resolution: ConflictResolution) {
  resolving.value = true
  try {
    const result = await window.trace.resolveConflict(props.vault, file, resolution)
    if (result.ok) {
      resolvedFiles.value.add(file)
      ElMessage.success(`已解决 ${file}`)
      // 如果还有其他文件，自动选择下一个
      const nextFile = conflictFiles.value.find(f => !resolvedFiles.value.has(f))
      if (nextFile) {
        selectedFile.value = nextFile
      }
    } else {
      ElMessage.error(result.error || '解决冲突失败')
    }
  } finally {
    resolving.value = false
  }
}

// 继续rebase
async function continueRebase() {
  if (resolvedCount.value < conflictFiles.value.length) {
    ElMessage.warning('请先解决所有冲突')
    return
  }
  continuing.value = true
  try {
    const result = await window.trace.continueRebase(props.vault)
    if (result.ok) {
      ElMessage.success('冲突已解决，同步继续')
      emit('resolved')
      visible.value = false
    } else {
      ElMessage.error(result.error || '继续同步失败')
    }
  } finally {
    continuing.value = false
  }
}

// 中止rebase
async function abortRebase() {
  try {
    await ElMessageBox.confirm(
      '确定要放弃所有更改吗？这将中止当前的同步操作，所有未解决的冲突将被丢弃。',
      '确认放弃',
      { type: 'warning', confirmButtonText: '确定放弃', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  aborting.value = true
  try {
    const result = await window.trace.abortRebase(props.vault)
    if (result.ok) {
      ElMessage.success('已中止同步')
      emit('close')
      visible.value = false
    } else {
      ElMessage.error(result.error || '中止失败')
    }
  } finally {
    aborting.value = false
  }
}

// 关闭对话框
function handleClose() {
  visible.value = false
  emit('close')
}

// 初始化
onMounted(() => {
  if (conflictFiles.value.length > 0 && !selectedFile.value) {
    selectedFile.value = conflictFiles.value[0]
  }
})
</script>

<style scoped>
.conflict-resolution-dialog {
  :deep(.el-dialog__body) {
    padding: 0;
    height: 70vh;
    min-height: 500px;
  }
}

.conflict-container {
  display: flex;
  height: 100%;
}

.conflict-sidebar {
  width: 300px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 14px;
}

.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.file-item:hover {
  background-color: var(--bg-hover);
}

.file-item.active {
  background-color: var(--accent-light);
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid var(--border-color);
}

.conflict-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.diff-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.diff-header h3 {
  margin: 0;
  font-size: 14px;
  color: var(--text-primary);
}

.diff-actions {
  display: flex;
  gap: 8px;
}

.loading-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}

.no-selection {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
}

.progress-info {
  color: var(--text-secondary);
  font-size: 14px;
}

.footer-actions {
  display: flex;
  gap: 8px;
}
</style>
