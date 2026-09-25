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
      <!-- 合并视图（可编辑）：高亮层按行着色（本地 / 远端 / 冲突标记）垫在透明 textarea 之下 -->
      <div v-if="activeTab === 'merge'" class="merge-view">
        <div class="editor-container">
          <div class="editor-header">
            <span>编辑解决后的内容</span>
            <el-button size="small" @click="resetToOriginal">重置为原始内容</el-button>
          </div>
          <div class="editor-stack">
            <pre class="highlight-layer" ref="highlightRef" aria-hidden="true"><span
              v-for="(ln, i) in contentLines"
              :key="i"
              :class="ln.cls"
            >{{ ln.text + '\n' }}</span></pre>
            <textarea
              ref="textareaRef"
              v-model="editedContent"
              class="diff-editor"
              @input="handleContentChange"
              @scroll="syncScroll"
              spellcheck="false"
            ></textarea>
          </div>
        </div>
      </div>

      <!-- 单独版本视图（只读） -->
      <div v-else class="version-view">
        <div class="version-header">
          <span>{{ versionLabel }}</span>
          <el-button size="small" title="以此版本解决该文件的冲突" @click="useThisVersion">使用此版本</el-button>
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
import { ref, computed, watch, nextTick } from 'vue'
import type { ConflictContent } from '@shared/types'

const props = defineProps<{
  content: ConflictContent
}>()

const emit = defineEmits<{
  (e: 'update:content', content: string): void
  /** 「使用此版本」= 以该版本（本地 / 远端）真正解决此文件冲突（与顶部按钮同效） */
  (e: 'use-version', side: 'ours' | 'theirs'): void
}>()

const activeTab = ref<'merge' | 'ours' | 'theirs' | 'base'>('merge')
const editedContent = ref(props.content.current)
const highlightRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// 监听内容变化
watch(
  () => props.content,
  (newContent) => {
    editedContent.value = newContent.current
  },
  { deep: true }
)

/** 逐行分类着色。关键：冲突块内两个区段谁是谁不能按标记猜——变基冲突里 HEAD 段是远端、
 *  merge 冲突里 HEAD 段才是本地（语义随操作反转，2026-09-25 实测踩过）。这里用内容自证：
 *  拿第一个冲突块的两个区段与 props.content.ours 比对，命中哪段哪段就是本地（蓝），
 *  merge / 变基通吃，无需外部传入模式。 */
const contentLines = computed(() => {
  const lines = editedContent.value.split('\n')
  // 找第一个冲突块的两个区段，判定 ours 在前还是在后
  let oursFirst = true
  const s1Start = lines.findIndex((l) => /^<<<<<<< ?/.test(l))
  const s1End = lines.findIndex((l, i) => i > s1Start && /^(======+)\s*$/.test(l))
  const s2End = lines.findIndex((l, i) => i > s1End && /^>>>>>>> ?/.test(l))
  if (s1Start >= 0 && s1End > s1Start && s2End > s1End) {
    const sec1 = lines.slice(s1Start + 1, s1End).join('\n').trim()
    const sec2 = lines.slice(s1End + 1, s2End).join('\n').trim()
    const ours = props.content.ours.trim()
    oursFirst = !(sec1 && sec1 === ours) && sec2 === ours ? false : sec1 === ours
  }

  let state: 'normal' | 'sec1' | 'sec2' = 'normal'
  return lines.map((text) => {
    let cls = ''
    if (/^<<<<<<< ?/.test(text)) {
      cls = 'marker'
      state = 'sec1'
    } else if (/^(======+)\s*$/.test(text) && state === 'sec1') {
      cls = 'marker'
      state = 'sec2'
    } else if (/^>>>>>>> ?/.test(text) && state === 'sec2') {
      cls = 'marker'
      state = 'normal'
    } else if (state === 'sec1') {
      cls = oursFirst ? 'ours' : 'theirs'
    } else if (state === 'sec2') {
      cls = oursFirst ? 'theirs' : 'ours'
    }
    return { text, cls }
  })
})

/** 高亮层与 textarea 滚动同步（两层必须始终对齐） */
function syncScroll(): void {
  if (highlightRef.value && textareaRef.value) {
    highlightRef.value.scrollTop = textareaRef.value.scrollTop
    highlightRef.value.scrollLeft = textareaRef.value.scrollLeft
  }
}

// 内容变化后布局可能改变（行数增减），下一帧校正一次滚动与对齐
watch(editedContent, () => {
  void nextTick(syncScroll)
})

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

// 使用当前版本：直接以此版本解决冲突（此前只改编辑缓冲、不触发解决，
// 用户以为点了就算解决、实际「已解决」计数与「继续同步」毫无反应——2026-09-25 实测反馈）
function useThisVersion() {
  if (activeTab.value === 'ours' || activeTab.value === 'theirs') {
    emit('use-version', activeTab.value)
  }
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
  min-height: 0;
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

.editor-stack {
  position: relative;
  flex: 1;
  min-height: 0;
}

/* 高亮层与 textarea 逐像素叠放：同字体 / 同内边距 / 同换行规则，textarea 透明置顶 */
.highlight-layer,
.diff-editor {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 16px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: auto;
}

.highlight-layer {
  margin: 0;
  z-index: 0;
  pointer-events: none;
  color: var(--text-primary);
  background: var(--bg-primary);
}

.highlight-layer span {
  display: block;
  min-height: 1.5em;
}

.highlight-layer .ours {
  background: var(--merge-ours);
}

.highlight-layer .theirs {
  background: var(--merge-theirs);
}

.highlight-layer .marker {
  background: var(--merge-marker);
  font-weight: 600;
}

.diff-editor {
  z-index: 1;
  border: none;
  resize: none;
  background: transparent;
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
  background-color: var(--merge-ours-solid);
  border: 1px solid var(--accent);
}

.legend-color.theirs {
  background-color: var(--merge-theirs-solid);
  border: 1px solid var(--success-line);
}

.legend-color.conflict {
  background-color: var(--merge-marker-solid);
  border: 1px solid var(--danger);
}
</style>
