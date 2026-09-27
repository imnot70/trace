<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useEditorStore } from '../stores/editor'
import { getFrontmatterTags, setFrontmatterTags } from '@shared/noteTags'
import { pickTagColor } from '@shared/tagPalette'

/**
 * 笔记标签选择弹窗（侧栏树与网格卡片共用）。
 * 打开时加载全部标签并标记当前笔记的选中态，点击行切换打标/取消。
 * 支持按名称过滤；无匹配时行内直接新建（FR-2.6.12，自动配色可后改）。
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
const filter = ref('')

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

/** 过滤后的标签（按名称包含匹配，大小写不敏感；CM 模糊过滤对中文不可靠的教训同样适用于此处，用朴素 includes） */
const filteredTags = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return tags.value
  return tags.value.filter((t) => t.name.toLowerCase().includes(q))
})

/** 内联新建行：输入非空且没有与输入完全同名（忽略大小写）的标签时出现 */
const canCreate = computed(() => {
  const q = filter.value.trim()
  if (!q) return false
  return !tags.value.some((t) => t.name.toLowerCase() === q.toLowerCase())
})

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

/** 内联新建（FR-2.6.12）：名称校验与侧栏「+」一致（非空白），颜色自动取自共享色板，创建后直接勾选到当前笔记 */
async function createInline(): Promise<void> {
  if (!props.note) return
  const name = filter.value.trim()
  if (!name) return
  const result = await window.trace.createTag(name, pickTagColor(name))
  if (!result.ok || !result.tag) {
    // 竞态兜底（如多端同时创建）：提示并定位既有标签
    filter.value = ''
    ElMessage.warning(result.error ?? '创建失败')
    return
  }
  tags.value.push({ id: result.tag.id, name: result.tag.name, color: result.tag.color, checked: false })
  await toggle(result.tag.id)
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
    <el-input
      v-model="filter"
      placeholder="筛选标签，无匹配可直接新建…"
      clearable
      class="tag-dialog-filter"
    />
    <div v-if="tags.length === 0 && !canCreate" class="tag-dialog-empty">暂无标签，直接在上方输入名称即可新建</div>
    <div v-else-if="filteredTags.length === 0 && !canCreate" class="tag-dialog-empty">没有匹配的标签</div>
    <div v-else class="tag-dialog-content">
      <div v-for="tag in filteredTags" :key="tag.id" class="tag-dialog-item" @click="toggle(tag.id)">
        <el-checkbox :model-value="tag.checked" @click.stop="toggle(tag.id)" />
        <span class="tag-dot" :style="{ background: tag.color }" />
        <span>{{ tag.name }}</span>
      </div>
      <!-- 内联新建行（FR-2.6.12）：点击即创建（自动配色，可后改）并勾选到当前笔记 -->
      <div v-if="canCreate" class="tag-dialog-item tag-dialog-create" @click="createInline">
        <span class="create-plus">＋</span>
        <span>新建标签「{{ filter.trim() }}」</span>
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

.tag-dialog-filter {
  margin-bottom: 8px;
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

.tag-dialog-create {
  color: var(--accent);
}

.tag-dialog-create .create-plus {
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}
</style>
