<template>
  <!-- 无引用时不渲染：不占编辑区空间 -->
  <div class="backlink-panel" v-if="visible && backlinks.length > 0">
    <div class="backlink-header" @click="collapsed = !collapsed">
      <span class="backlink-title">反向链接</span>
      <span v-if="backlinks.length" class="backlink-count">{{ backlinks.length }}</span>
      <el-icon class="backlink-arrow" :class="{ 'is-collapsed': collapsed }"><ArrowDown /></el-icon>
    </div>
    <div v-if="!collapsed" class="backlink-list">
      <div
        v-for="(item, i) in backlinks"
        :key="`${item.vault}-${item.path}-${item.line}-${i}`"
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
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import type { BacklinkRef, FsChangedPayload } from '@shared/types'

const props = defineProps<{
  visible: boolean
  vault: string
  notePath: string
}>()

const emit = defineEmits<{
  (e: 'open-note', vault: string, path: string): void
}>()

const backlinks = ref<BacklinkRef[]>([])
const collapsed = ref(false)

async function fetchBacklinks(): Promise<void> {
  if (!props.visible || !props.vault || !props.notePath) {
    backlinks.value = []
    return
  }
  try {
    const result = await window.trace.wikilinkBacklinks(props.vault, props.notePath)
    // 请求期间可能已切换笔记
    if (!props.visible || !props.vault || !props.notePath) return
    backlinks.value = result.ok && result.backlinks ? result.backlinks : []
  } catch {
    backlinks.value = []
  }
}

watch(
  () => [props.visible, props.vault, props.notePath],
  () => {
    collapsed.value = false // 切换笔记重置为展开
    void fetchBacklinks()
  },
  { immediate: true }
)

// 保存 / 外部编辑 / 同步都会经 fs:changed 到达；主进程索引异步更新，稍等再查询。
// 自身保存的回声事件无害——数据以磁盘内容为准，重查一遍即可
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeFsChanged: (() => void) | null = null
function onFsChanged(payload: FsChangedPayload): void {
  if (!props.visible || payload.vault !== props.vault) return
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void fetchBacklinks(), 500)
}
onMounted(() => {
  // 面板随 EditorView 反复挂载，退订防止监听器泄漏
  unsubscribeFsChanged = window.trace.onFsChanged(onFsChanged)
})
onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  unsubscribeFsChanged?.()
})

function openNote(item: BacklinkRef) {
  emit('open-note', item.vault, item.path)
}

function highlightTarget(snippet: string, targetName: string): string {
  if (!targetName) return escapeHtml(snippet)
  // 目标名同样经过 HTML 转义后再参与匹配，含 & < > " 的笔记名才能命中转义后的片段
  const escaped = escapeHtml(targetName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
