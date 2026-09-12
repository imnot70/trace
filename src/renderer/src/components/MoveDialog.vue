<script setup lang="ts">
import { computed } from 'vue'
import { useMoveDialog } from '../stores/moveDialog'
import MoveTreeLevel from './MoveTreeLevel.vue'

const dialog = useMoveDialog()

const displayPath = computed(() => {
  if (!dialog.selectedPath) return dialog.vault
  return `${dialog.vault} / ${dialog.selectedPath.replace(/\//g, ' / ')}`
})

function isDisabled(nodePath: string): boolean {
  if (dialog.kind === 'note') return false
  return nodePath === dialog.srcPath || nodePath.startsWith(dialog.srcPath + '/')
}

function onSelect(path: string): void {
  if (isDisabled(path)) return
  dialog.select(path)
}
</script>

<template>
  <el-dialog
    v-model="dialog.visible"
    :title="`移动「${dialog.name}」到…`"
    width="420px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div class="move-tree">
      <div
        class="move-node root-node"
        :class="{ selected: dialog.selectedPath === '', disabled: isDisabled('') }"
        @click="onSelect('')"
      >
        <span class="node-icon">📁</span>
        <span class="node-name">{{ dialog.vault }}</span>
      </div>
      <MoveTreeLevel
        :nodes="dialog.folderTree"
        :vault="dialog.vault"
        :src-path="dialog.srcPath"
        :src-kind="dialog.kind"
        :selected-path="dialog.selectedPath"
        :depth="0"
        @select="onSelect"
      />
    </div>
    <div class="move-dest">目标位置：{{ displayPath }}</div>
    <div v-if="dialog.error" class="dialog-error">{{ dialog.error }}</div>
    <template #footer>
      <el-button @click="dialog.visible = false">取消</el-button>
      <el-button type="primary" :loading="dialog.busy" :disabled="isDisabled(dialog.selectedPath)" @click="dialog.confirm()">
        移动到此处
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.move-tree {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border-color, #dcdfe6);
  border-radius: 6px;
  padding: 4px 0;
}

.move-tree :deep(.move-node) {
  display: flex;
  align-items: center;
  height: 32px;
  padding-right: 8px;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 4px;
}

.move-tree :deep(.move-node:hover:not(.disabled)) {
  background: var(--bg-hover, #f5f7fa);
}

.move-tree :deep(.move-node.selected) {
  background: var(--accent-bg, #ecf5ff);
  color: var(--accent, #409eff);
}

.move-tree :deep(.move-node.disabled) {
  opacity: 0.4;
  cursor: not-allowed;
}

.move-tree :deep(.expand-arrow) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 10px;
  color: var(--text-secondary, #909399);
  cursor: pointer;
  flex-shrink: 0;
}

.move-tree :deep(.expand-arrow.placeholder) {
  visibility: hidden;
}

.node-icon {
  margin: 0 4px;
  font-size: 14px;
  flex-shrink: 0;
}

.node-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-dest {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary, #909399);
}

.dialog-error {
  color: var(--danger, #f56c6c);
  font-size: 12px;
  margin-top: 8px;
}
</style>
