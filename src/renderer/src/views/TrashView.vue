<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTrashStore } from '../stores/trash'
import { useTreeStore } from '../stores/tree'
import type { TrashEntry } from '@shared/types'

const trash = useTrashStore()
const tree = useTreeStore()

onMounted(() => {
  void trash.load()
})

function kindLabel(entry: TrashEntry): string {
  if (entry.kind === 'vault') return '笔记库'
  if (entry.kind === 'dir') return '文件夹'
  return '笔记'
}

function originLabel(entry: TrashEntry): string {
  if (entry.kind === 'vault') return '笔记库'
  return `${entry.vault} / ${entry.path}`
}

function formatTime(entry: TrashEntry): string {
  return new Date(entry.deletedAt).toLocaleString('zh-CN')
}

async function restore(entry: TrashEntry): Promise<void> {
  if (await trash.restore(entry.id)) {
    ElMessage.success(`已还原「${entry.name}」`)
    await tree.refreshAll()
  } else {
    ElMessage.error('还原失败')
  }
}

async function purge(entry: TrashEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `彻底删除「${entry.name}」后无法恢复，确定继续吗？`,
      '彻底删除',
      { type: 'warning', confirmButtonText: '彻底删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  if (await trash.purge(entry.id)) ElMessage.success('已彻底删除')
  else ElMessage.error('删除失败')
}

async function empty(): Promise<void> {
  try {
    await ElMessageBox.confirm('清空回收站后所有条目将无法恢复，确定继续吗？', '清空回收站', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  if (await trash.empty()) ElMessage.success('回收站已清空')
  else ElMessage.error('清空失败')
}
</script>

<template>
  <!-- 列表形态；「网格 / 列表切换」为规划功能（与常用 / 收藏一致） -->
  <div class="page">
    <div class="page-header">
      <div class="trash-title">
        <h2>回收站</h2>
        <span v-if="trash.entries.length" class="trash-count">{{ trash.entries.length }}</span>
      </div>
      <el-button v-if="trash.entries.length" type="danger" plain @click="empty()">
        清空回收站
      </el-button>
    </div>

    <div v-if="trash.entries.length === 0" class="trash-empty">
      <el-icon class="trash-empty-icon"><Delete /></el-icon>
      <p>回收站是空的</p>
    </div>

    <div v-else class="trash-list">
      <div v-for="entry in trash.entries" :key="entry.id" class="trash-card">
        <el-icon class="trash-icon">
          <Folder v-if="entry.kind !== 'note'" />
          <Document v-else />
        </el-icon>
        <div class="trash-main">
          <div class="trash-name" :title="entry.name">{{ entry.name }}</div>
          <div class="trash-meta">
            <span class="trash-kind">{{ kindLabel(entry) }}</span>
            <span class="trash-origin" :title="originLabel(entry)">{{ originLabel(entry) }}</span>
          </div>
        </div>
        <span class="trash-time">{{ formatTime(entry) }}</span>
        <div class="trash-actions">
          <el-button size="small" type="primary" plain @click="restore(entry)">还原</el-button>
          <el-button size="small" type="danger" plain @click="purge(entry)">彻底删除</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.trash-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.trash-count {
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 0 6px;
  min-width: 18px;
  text-align: center;
}

.trash-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.trash-empty-icon {
  font-size: 36px;
  opacity: 0.5;
}

.trash-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 卡片风格与常用 / 收藏网格的 note-card 保持一致 */
.trash-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.trash-card:hover {
  border-color: var(--accent);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}

.trash-icon {
  flex-shrink: 0;
  font-size: 18px;
  color: var(--text-tertiary);
}

.trash-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trash-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  min-width: 0;
}

.trash-kind {
  flex-shrink: 0;
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 0 6px;
}

.trash-origin {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
}

.trash-actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
}
</style>
