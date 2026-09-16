<template>
  <div class="diff-viewer">
    <div class="diff-tabs">
      <el-radio-group v-model="activeTab" size="small">
        <el-radio-button label="merge">合并视图</el-radio-button>
        <el-radio-button label="ours">本地版本</el-radio-button>
        <el-radio-button label="theirs">远端版本</el-radio-button>
        <el-radio-button label="base">共同祖先</el-radio-button>
      </el-radio-group>
    </div>

    <div class="diff-content">
      <!-- 合并视图（可编辑） -->
      <div v-if="activeTab === 'merge'" class="merge-view">
        <div class="editor-container">
          <div class="editor-header">
            <span>编辑解决后的内容</span>
            <el-button size="small" @click="resetToOriginal">重置为原始内容</el-button>
          </div>
          <textarea
            v-model="editedContent"
            class="diff-editor"
            @input="handleContentChange"
            spellcheck="false"
          ></textarea>
        </div>
      </div>

      <!-- 单独版本视图（只读） -->
      <div v-else class="version-view">
        <div class="version-header">
          <span>{{ versionLabel }}</span>
          <el-button size="small" @click="useThisVersion">使用此版本</el-button>
        </div>
        <pre class="diff-content-pre">{{ versionContent }}</pre>
      </div>
    </div>

    <!-- 冲突标记高亮说明 -->
    <div class="diff-legend">
      <div class="legend-item">
        <span class="legend-color ours"></span>
        <span>本地版本 (ours)</span>
      </div>
      <div class="legend-item">
        <span class="legend-color theirs"></span>
        <span>远端版本 (theirs)</span>
      </div>
      <div class="legend-item">
        <span class="legend-color conflict"></span>
        <span>冲突标记</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ConflictContent } from '@shared/types'

const props = defineProps<{
  content: ConflictContent
}>()

const emit = defineEmits<{
  (e: 'update:content', content: string): void
}>()

const activeTab = ref<'merge' | 'ours' | 'theirs' | 'base'>('merge')
const editedContent = ref(props.content.current)

// 监听内容变化
watch(
  () => props.content,
  (newContent) => {
    editedContent.value = newContent.current
  },
  { deep: true }
)

// 版本标签
const versionLabel = computed(() => {
  switch (activeTab.value) {
    case 'ours':
      return '本地版本 (ours)'
    case 'theirs':
      return '远端版本 (theirs)'
    case 'base':
      return '共同祖先 (base)'
    default:
      return ''
  }
})

// 版本内容
const versionContent = computed(() => {
  switch (activeTab.value) {
    case 'ours':
      return props.content.ours
    case 'theirs':
      return props.content.theirs
    case 'base':
      return props.content.base
    default:
      return ''
  }
})

// 内容变化处理
function handleContentChange() {
  emit('update:content', editedContent.value)
}

// 重置为原始内容
function resetToOriginal() {
  editedContent.value = props.content.current
  emit('update:content', editedContent.value)
}

// 使用当前版本
function useThisVersion() {
  editedContent.value = versionContent.value
  activeTab.value = 'merge'
  emit('update:content', editedContent.value)
}
</script>

<style scoped>
.diff-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.diff-tabs {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.diff-content {
  flex: 1;
  overflow: hidden;
}

.merge-view,
.version-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.editor-header {
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.diff-editor {
  flex: 1;
  width: 100%;
  padding: 16px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  border: none;
  resize: none;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}

.version-header {
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.diff-content-pre {
  flex: 1;
  padding: 16px;
  margin: 0;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  overflow: auto;
  background: var(--bg-primary);
  color: var(--text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
}

.diff-legend {
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: 24px;
  font-size: 12px;
  color: var(--text-secondary);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.legend-color.ours {
  background-color: #e6f7ff;
  border: 1px solid #91d5ff;
}

.legend-color.theirs {
  background-color: #f6ffed;
  border: 1px solid #b7eb8f;
}

.legend-color.conflict {
  background-color: #fff2f0;
  border: 1px solid #ffccc7;
}
</style>
