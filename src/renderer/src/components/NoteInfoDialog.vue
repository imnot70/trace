<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'
import { useAppStore } from '../stores/app'
import { useTreeStore } from '../stores/tree'
import type { GitStatus, NoteInfo, TagItem } from '@shared/types'

/**
 * 笔记「信息」弹窗（FR-2.6.6 扩展）：侧栏树行与网格卡片共用。
 * 分组信息卡：所属库 / 路径 / 时间 / 大小行数字符 / 标签胶囊 / 被引用数 / Git 关联状态。
 * 加载时序：noteGetInfo / noteTags / wikilinkBacklinks 三路并发即开即显；
 * Git 读侧栏缓存 gitStatuses（D2），该库从未刷新（undefined）时 refreshGitStatus 后台回填一次，
 * store 响应式更新原地补显——打开弹窗不为 git / 反向链接查询等待。
 */
const props = defineProps<{
  visible: boolean
  note: { vault: string; path: string; name: string } | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const app = useAppStore()
const tree = useTreeStore()

const info = ref<NoteInfo | null>(null)
const tags = ref<TagItem[]>([])
/** null = 加载中（被引用查询异步补入） */
const backlinkCount = ref<number | null>(null)

const vaultInfo = computed(() => tree.vaults.find((v) => v.name === props.note?.vault))
/** Record 索引类型不带 undefined，运行时「从未刷新」即 undefined（设计 §4.2） */
const gitState = computed<GitStatus | null | undefined>(() =>
  props.note ? tree.gitStatuses[props.note.vault] : undefined
)

watch(
  () => props.visible,
  (visible) => {
    if (!visible || !props.note) return
    const { vault, path } = props.note
    info.value = null
    tags.value = []
    backlinkCount.value = null
    // 竞态防护：请求落定后比对笔记快照（BacklinkPanel「请求期间可能已切换笔记」同手法）
    void window.trace.noteGetInfo(vault, path).then((r) => {
      if (props.note?.vault === vault && props.note?.path === path && r.ok && r.info) info.value = r.info
    })
    void window.trace.noteTags(vault, path).then((r) => {
      if (props.note?.vault === vault && props.note?.path === path && r.ok && r.tags) tags.value = r.tags
    })
    void window.trace.wikilinkBacklinks(vault, path).then((r) => {
      if (props.note?.vault !== vault || props.note?.path !== path) return
      // 与 BacklinkPanel 徽标同口径：同一来源笔记引用多次只计一篇（"N 篇笔记"按唯一来源计）
      const refs = r.ok && r.backlinks ? r.backlinks : []
      backlinkCount.value = new Set(refs.map((b) => `${b.vault}::${b.path}`)).size
    })
    if (tree.gitStatuses[vault] === undefined) void tree.refreshGitStatus(vault)
  },
  { immediate: true } // 侧栏树按需挂载，挂载时 visible 已为 true（与 TagPickerDialog 同因）
)

/** 标签胶囊点击 → 标签筛选（与 SideBar.toggleGrid('tags') 同逻辑，FR-2.6.13 多标签组合） */
function filterByTag(tagId: string): void {
  if (app.view.name === 'grid' && app.view.section === 'tags') {
    const next = app.view.tagIds?.includes(tagId)
      ? (app.view.tagIds ?? []).filter((id) => id !== tagId)
      : [...(app.view.tagIds ?? []), tagId]
    app.view = next.length ? { name: 'grid', section: 'tags', tagIds: next } : { name: 'welcome' }
  } else {
    app.view = { name: 'grid', section: 'tags', tagIds: [tagId] }
  }
  emit('update:visible', false)
}

async function copyAbsPath(): Promise<void> {
  if (!info.value) return
  try {
    await navigator.clipboard.writeText(info.value.absPath)
    ElMessage.success('已复制绝对路径')
  } catch {
    ElMessage.error('复制失败')
  }
}

function fmtTime(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleString('zh-CN') : '…'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const sizeText = computed(() => {
  if (!info.value) return '…'
  return `${formatSize(info.value.size)} · ${info.value.lines} 行 · ${info.value.chars} 字符`
})

/** 胶囊配色：定义色 16% 透明底 + 35% 描边 + 定义色文字（color-mix 为项目既有用法） */
function capsuleStyle(color: string): Record<string, string> {
  return {
    background: `color-mix(in srgb, ${color} 16%, transparent)`,
    color,
    border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`${note?.name ?? ''} 信息`"
    width="440px"
    :append-to-body="true"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="note-info">
      <div class="info-row">
        <span class="info-label">所属笔记库</span>
        <span class="info-value">
          {{ note?.vault }}
          <span v-if="vaultInfo?.external" class="external-badge">外部</span>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">路径</span>
        <span class="info-value info-path">
          <span class="path-text" :title="info?.absPath">{{ note?.path }}</span>
          <button v-if="info?.absPath" class="copy-btn" title="复制绝对路径" @click="copyAbsPath">
            <el-icon><CopyDocument /></el-icon>
          </button>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">创建时间</span>
        <span class="info-value">{{ fmtTime(info?.birthtime) }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">最后修改</span>
        <span class="info-value">{{ fmtTime(info?.mtime) }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">大小</span>
        <span class="info-value">{{ sizeText }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">标签</span>
        <span class="info-value info-tags">
          <template v-if="tags.length">
            <button
              v-for="t in tags"
              :key="t.id"
              class="tag-capsule"
              :style="capsuleStyle(t.color)"
              :title="`按标签「${t.name}」筛选`"
              @click="filterByTag(t.id)"
            >{{ t.name }}</button>
          </template>
          <span v-else-if="info" class="info-empty">—</span>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">被引用</span>
        <span class="info-value">
          <span v-if="backlinkCount === null">…</span>
          <span v-else-if="backlinkCount > 0">{{ backlinkCount }} 篇笔记</span>
          <span v-else class="info-empty">无</span>
        </span>
      </div>

      <!-- Git 关联状态（所属库维度）：仅已关联库显示（未关联 / 未刷新到时整区隐藏） -->
      <template v-if="gitState?.associated">
        <div class="info-divider" />
        <div class="info-row">
          <span class="info-label">Git 仓库</span>
          <span class="info-value">
            <span class="git-repo" :title="gitState.remoteUrl ?? undefined">{{ gitState.repoFullName ?? '已关联' }}</span>
            <span v-if="gitState.branch" class="git-branch">{{ gitState.branch }}</span>
            <span v-if="gitState.ahead > 0 || gitState.behind > 0" class="git-ab">↑{{ gitState.ahead }} ↓{{ gitState.behind }}</span>
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">同步状态</span>
          <span class="info-value">
            <span v-if="gitState.dirty" class="git-dirty">● 有未提交变更</span>
            <span v-else class="info-empty">干净</span>
          </span>
        </div>
      </template>
    </div>
    <template #footer>
      <el-button type="primary" @click="emit('update:visible', false)">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.note-info {
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-size: 13px;
}

.info-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.info-label {
  width: 76px;
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.info-value {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  word-break: break-all;
}

.info-empty {
  color: var(--text-tertiary);
}

/* 路径行：文本可截断省略，悬停 title 显绝对路径；复制按钮吸同行尾 */
.info-path {
  display: flex;
  align-items: center;
  gap: 4px;
}

.info-path .path-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  width: 22px;
  height: 22px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.copy-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 标签胶囊：可点击进标签筛选（颜色由内联 style 按标签定义色生成） */
.info-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-capsule {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  user-select: none;
}

.tag-capsule:hover {
  filter: brightness(1.1);
}

/* Git 区：分隔线 + 仓库 / 分支 / 领先落后 / 未提交变更 */
.info-divider {
  border-top: 1px solid var(--border-color);
  margin: 2px 0;
}

.git-repo {
  color: var(--text-primary);
  font-weight: 600;
}

.git-branch,
.git-ab {
  color: var(--text-secondary);
  margin-left: 8px;
}

.git-dirty {
  color: var(--accent);
}
</style>
