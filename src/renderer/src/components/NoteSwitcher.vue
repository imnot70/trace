<template>
  <!-- MRU 快切面板（FR-2.4.26 D6）：VS Code Ctrl+Tab 模型——按住期间列出最近打开的
       笔记（新→旧），Tab / Shift+Tab 翻动（App.vue 全局键驱动 store），松开 Ctrl 提交，
       Esc 取消。点击条目同样提交（鼠标友好） -->
  <Teleport to="body">
    <div v-if="editor.mruActive" class="mru-overlay" @click.self="editor.mruCancel()">
      <div class="mru-panel">
        <div class="mru-header">最近打开（Tab 切换，松开 Ctrl 跳转，Esc 取消）</div>
        <div class="mru-list">
          <div
            v-for="(item, i) in editor.mruList"
            :key="`${item.vault}::${item.path}`"
            class="mru-item"
            :class="{ active: i === editor.mruIndex, current: isCurrent(item) }"
            @click="commitTo(i)"
            @mousemove="editor.mruIndex = i"
          >
            <el-icon class="mru-icon"><Document /></el-icon>
            <span class="mru-title">{{ item.name }}</span>
            <span v-if="item.vault !== editor.current?.vault" class="mru-vault">{{ item.vault }}</span>
            <span class="mru-path">{{ item.path }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { FileText as Document } from 'lucide-vue-next'
import type { OpenNote } from '../stores/editor'
import { useEditorStore } from '../stores/editor'

const editor = useEditorStore()

function isCurrent(item: OpenNote): boolean {
  const cur = editor.current
  return !!cur && cur.vault === item.vault && cur.path === item.path
}

async function commitTo(index: number): Promise<void> {
  editor.mruIndex = index
  await editor.mruCommit()
}
</script>

<style scoped>
.mru-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}
.mru-panel {
  width: 520px;
  max-width: 80vw;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}
.mru-header {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-color);
}
.mru-list {
  max-height: 55vh;
  overflow-y: auto;
  padding: 4px 0;
}
.mru-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}
.mru-item.active {
  background: var(--accent-soft, var(--bg-hover, rgba(0, 0, 0, 0.06)));
}
.mru-item.current .mru-title {
  color: var(--text-tertiary);
}
.mru-icon {
  flex: none;
  color: var(--text-tertiary);
}
.mru-title {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mru-vault {
  flex: none;
  font-size: 11px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 0 4px;
}
.mru-path {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-tertiary);
  direction: rtl;
  text-align: left;
}
</style>
