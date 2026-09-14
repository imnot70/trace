<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useEditorStore } from '../stores/editor'
import { getFrontmatterTags, setFrontmatterTags } from '@shared/noteTags'

/**
 * 笔记标签选择弹窗（侧栏树与网格卡片共用）。
 * 打开时加载全部标签并标记当前笔记的选中态，点击行切换打标/取消。
 *
 * 写入路径二选一：
 * - 笔记正打开在编辑器 → 直接改编辑器缓冲区的 frontmatter（走自动保存，避免与磁盘 hash 冲突）；
 * - 未打开 → 走主进程服务读盘改盘。
 */
const props = defineProps<{
  visible: boolean
  note: { vault: string; path: string; name: string } | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'changed'): void
}>()

const editor = useEditorStore()

const tags = ref<{ id: string; name: string; color: string; checked: boolean }[]>([])

function isNoteOpen(): boolean {
  return !!props.note && !!editor.current && editor.current.vault === props.note.vault && editor.current.path === props.note.path
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible || !props.note) return
    const all = await window.trace.listTags()
    const checkedIds = new Set<string>()
    if (isNoteOpen()) {
      // 编辑中：以缓冲区内容为准（磁盘可能落后于未保存的输入）
      for (const name of getFrontmatterTags(editor.content)) {
        const def = (all.ok && all.tags ? all.tags : []).find((t) => t.name.toLowerCase() === name.toLowerCase())
        if (def) checkedIds.add(def.id)
      }
    } else {
      const res = await window.trace.noteTags(props.note.vault, props.note.path)
      for (const t of res.ok && res.tags ? res.tags : []) checkedIds.add(t.id)
    }
    tags.value = (all.ok && all.tags ? all.tags : []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      checked: checkedIds.has(t.id)
    }))
  },
  { immediate: true } // 侧栏树以 v-if 按需挂载，挂载时 visible 已为 true，必须立即执行
)

async function toggle(tagId: string): Promise<void> {
  if (!props.note) return
  const entry = tags.value.find((t) => t.id === tagId)
  if (!entry) return
  const tagName = entry.name
  entry.checked = !entry.checked
  const nextNames = (): string[] => {
    const names = isNoteOpen()
      ? getFrontmatterTags(editor.content)
      : []
    return entry.checked
      ? [...names.filter((n) => n.toLowerCase() !== tagName.toLowerCase()), tagName]
      : names.filter((n) => n.toLowerCase() !== tagName.toLowerCase())
  }

  if (isNoteOpen()) {
    // 编辑中：改缓冲区，自动保存落盘
    const updated = setFrontmatterTags(editor.content, nextNames())
    if (updated === null) {
      entry.checked = !entry.checked
      ElMessage.error('frontmatter 格式无法解析，已放弃写入')
      return
    }
    editor.setContent(updated)
    emit('changed')
    return
  }

  const result = entry.checked
    ? await window.trace.addTagToNote(props.note.vault, props.note.path, tagId)
    : await window.trace.removeTagFromNote(props.note.vault, props.note.path, tagId)
  if (!result.ok) {
    entry.checked = !entry.checked
    ElMessage.error(result.error ?? '操作失败')
    return
  }
  emit('changed')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`管理标签 — ${note?.name ?? ''}`"
    width="320px"
    :append-to-body="true"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <div v-if="tags.length === 0" class="tag-dialog-empty">暂无标签，请先在左侧「标签」区创建</div>
    <div v-else class="tag-dialog-content">
      <div v-for="tag in tags" :key="tag.id" class="tag-dialog-item" @click="toggle(tag.id)">
        <el-checkbox :model-value="tag.checked" @click.stop="toggle(tag.id)" />
        <span class="tag-dot" :style="{ background: tag.color }" />
        <span>{{ tag.name }}</span>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
/* user-select:none：清单行点击只做勾选切换，避免连点选中文字出现蓝色底 */
.tag-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  user-select: none;
}

.tag-dialog-empty {
  color: var(--text-tertiary);
  font-size: 13px;
  text-align: center;
  padding: 12px 0;
}

.tag-dialog-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.tag-dialog-item:hover {
  background: var(--bg-hover);
}

.tag-dialog-item .tag-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
