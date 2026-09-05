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

function kindLabel(row: Record<string, unknown>): string {
  const kind = (row as unknown as TrashEntry).kind
  if (kind === 'vault') return '笔记库'
  if (kind === 'dir') return '子目录'
  return '笔记'
}

function originLabel(row: Record<string, unknown>): string {
  const entry = row as unknown as TrashEntry
  if (entry.kind === 'vault') return '笔记库'
  return `${entry.vault} / ${entry.path}`
}

function formatTime(row: Record<string, unknown>): string {
  return new Date((row as unknown as TrashEntry).deletedAt).toLocaleString('zh-CN')
}

async function restore(row: Record<string, unknown>): Promise<void> {
  const entry = row as unknown as TrashEntry
  if (await trash.restore(entry.id)) {
    ElMessage.success(`已还原「${entry.name}」`)
    await tree.refreshAll()
  } else {
    ElMessage.error('还原失败')
  }
}

async function purge(row: Record<string, unknown>): Promise<void> {
  const entry = row as unknown as TrashEntry
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
  <div class="page">
    <div class="page-header">
      <h2>回收站</h2>
      <el-button v-if="trash.entries.length" type="danger" plain @click="empty()">
        清空回收站
      </el-button>
    </div>

    <el-empty v-if="trash.entries.length === 0" description="回收站是空的" />

    <el-table v-else :data="trash.entries" style="width: 100%">
      <el-table-column label="名称" min-width="180">
        <template #default="{ row }">
          <el-icon style="vertical-align: -2px; margin-right: 6px">
            <Folder v-if="row.kind !== 'note'" />
            <Document v-else />
          </el-icon>
          {{ row.name }}
        </template>
      </el-table-column>
      <el-table-column label="类型" width="90">
        <template #default="{ row }">{{ kindLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="原位置" min-width="220">
        <template #default="{ row }">{{ originLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="删除时间" width="180">
        <template #default="{ row }">{{ formatTime(row) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" plain @click="restore(row)">还原</el-button>
          <el-button size="small" type="danger" plain @click="purge(row)">彻底删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
