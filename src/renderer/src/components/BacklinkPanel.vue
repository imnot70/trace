<template>
  <div class="backlink-panel" v-if="visible">
    <div class="backlink-header" @click="collapsed = !collapsed">
      <span class="backlink-title">反向链接</span>
      <span v-if="backlinks.length" class="backlink-count">{{ backlinks.length }}</span>
      <el-icon class="backlink-arrow" :class="{ 'is-collapsed': collapsed }"><ArrowDown /></el-icon>
    </div>
    <div v-if="!collapsed" class="backlink-list">
      <div v-if="loading" class="backlink-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>
      <div v-else-if="backlinks.length === 0" class="backlink-empty">
        暂无引用
      </div>
      <div
        v-for="item in backlinks"
        :key="`${item.vault}-${item.path}-${item.line}`"
        class="backlink-item"
        @click="openNote(item)"
      >
        <div class="backlink-item-title">{{ item.title }}</div>
        <div class="backlink-item-snippet" v-html="highlightTarget(item.snippet, item.targetName)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArrowDown, Loading } from '@element-plus/icons-vue'
import type { BacklinkRef } from '@shared/types'

const props = defineProps<{
  visible: boolean
  vault: string
  notePath: string
}>()

const emit = defineEmits<{
  (e: 'open-note', vault: string, path: string): void
}>()

const backlinks = ref<BacklinkRef[]>([])
const loading = ref(false)
const collapsed = ref(false)

watch(
  () => [props.visible, props.vault, props.notePath],
  async () => {
    if (!props.visible || !props.vault || !props.notePath) {
      backlinks.value = []
      return
    }
    loading.value = true
    try {
      const result = await window.trace.wikilinkBacklinks(props.vault, props.notePath)
      if (result.ok && result.backlinks) {
        backlinks.value = result.backlinks
      } else {
        backlinks.value = []
      }
    } catch {
      backlinks.value = []
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

function openNote(item: BacklinkRef) {
  emit('open-note', item.vault, item.path)
}

function highlightTarget(snippet: string, targetName: string): string {
  if (!targetName) return escapeHtml(snippet)
  const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(\\[\\[${escaped}(?:\\|[^\\]]*?)?\\]\\])`, 'gi')
  return escapeHtml(snippet).replace(regex, '<mark>$1</mark>')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
</script>

<style scoped>
.backlink-panel {
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
  max-height: 200px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.backlink-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.backlink-header:hover {
  background: var(--bg-hover);
}

.backlink-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.backlink-count {
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-hover);
  padding: 0 5px;
  border-radius: 8px;
  line-height: 16px;
}

.backlink-arrow {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-tertiary);
  transition: transform 0.2s;
}

.backlink-arrow.is-collapsed {
  transform: rotate(-90deg);
}

.backlink-list {
  overflow-y: auto;
  padding: 0 8px 6px;
}

.backlink-loading,
.backlink-empty {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 8px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.backlink-item {
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.1s;
  margin-bottom: 2px;
}

.backlink-item:hover {
  background: var(--bg-hover);
}

.backlink-item-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 1px;
}

.backlink-item-snippet {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}

.backlink-item-snippet :deep(mark) {
  background-color: var(--accent-light);
  color: var(--accent);
  padding: 0 1px;
  border-radius: 1px;
}
</style>
