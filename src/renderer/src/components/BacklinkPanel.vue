<template>
  <!-- 悬浮入口：不占布局空间，编辑区保持满高；无引用时不渲染 -->
  <div ref="rootRef" class="backlink-root" v-if="visible && backlinks.length > 0">
    <Transition name="backlink-pop">
      <div class="backlink-pop" v-if="open">
        <div class="backlink-header">
          <span class="backlink-title">反向链接</span>
          <span class="backlink-count">{{ uniqueBacklinks.length }}</span>
          <button class="backlink-close" title="收起" @click="open = false">
            <el-icon><Close /></el-icon>
          </button>
        </div>
        <div class="backlink-list">
          <div
            v-for="(item, i) in uniqueBacklinks"
            :key="`${item.vault}-${item.path}-${item.targetName}-${i}`"
            class="backlink-item"
            @click="openNote(item)"
          >
            <div class="backlink-item-title">{{ item.title }}</div>
            <div class="backlink-item-snippet" v-html="highlightTarget(item.snippet, item.targetName)" />
          </div>
        </div>
      </div>
    </Transition>
    <button
      class="backlink-pill"
      :class="{ active: open }"
      title="反向链接：引用当前笔记的笔记"
      @click="open = !open"
    >
      <el-icon><Link /></el-icon>
      <span>反向链接</span>
      <span class="backlink-pill-count">{{ uniqueBacklinks.length }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Close, Link } from '@element-plus/icons-vue'
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
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

/** 同一笔记引用当前笔记多次只显示一条 */
const uniqueBacklinks = computed(() => {
  const seen = new Set<string>()
  const out: BacklinkRef[] = []
  for (const b of backlinks.value) {
    const k = `${b.vault}::${b.path}::${b.targetName}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(b)
  }
  return out
})

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
    open.value = false // 切换笔记收起弹层
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

function onDocMousedown(e: MouseEvent): void {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    open.value = false
  }
}

onMounted(() => {
  // 面板随 EditorView 反复挂载，退订防止监听器泄漏
  unsubscribeFsChanged = window.trace.onFsChanged(onFsChanged)
  document.addEventListener('mousedown', onDocMousedown)
  window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  unsubscribeFsChanged?.()
  document.removeEventListener('mousedown', onDocMousedown)
  window.removeEventListener('keydown', onKeydown, true)
})

function openNote(item: BacklinkRef) {
  open.value = false
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
.backlink-root {
  position: absolute;
  bottom: 14px;
  right: 16px;
  z-index: 40;
}

/* 胶囊入口：与整体卡片风格一致（圆角 + 边框 + 轻阴影） */
.backlink-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border-radius: 999px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background-color 0.15s;
}

.backlink-pill:hover,
.backlink-pill.active {
  color: var(--accent);
  border-color: var(--accent-light);
}

.backlink-pill.active {
  background: var(--accent-light);
}

.backlink-pill-count {
  font-size: 11px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text-tertiary);
}

.backlink-pill.active .backlink-pill-count {
  background: var(--bg-primary);
  color: var(--accent);
}

/* 弹层：与悬浮预览同一设计语言（圆角卡片 + 大阴影），锚定在胶囊上方 */
.backlink-pop {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 380px;
  max-width: min(70vw, 480px);
  max-height: min(320px, 40vh);
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.18),
    0 2px 10px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.backlink-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
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
  padding: 0 6px;
  border-radius: 8px;
  line-height: 16px;
}

.backlink-close {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  padding: 2px;
  border-radius: 4px;
  color: var(--text-tertiary);
  font-size: 13px;
  cursor: pointer;
}

.backlink-close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.backlink-list {
  overflow-y: auto;
  padding: 6px 8px;
}

.backlink-item {
  padding: 6px 8px;
  border-radius: 6px;
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
  margin-bottom: 2px;
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

/* 弹层出现 / 消失：自胶囊上方轻轻浮出 */
.backlink-pop-enter-active,
.backlink-pop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.backlink-pop-enter-from,
.backlink-pop-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
