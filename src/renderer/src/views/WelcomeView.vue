<script setup lang="ts">
import { useAppStore } from '../stores/app'
import { useTreeStore } from '../stores/tree'
import { useNoteActions } from '../composables/actions'

const app = useAppStore()
const tree = useTreeStore()
const actions = useNoteActions()
</script>

<template>
  <div class="welcome">
    <div class="welcome-logo">迹</div>
    <h1>Trace 笔迹</h1>
    <p v-if="tree.vaults.length === 0">创建一个笔记库，开始记录你的想法</p>
    <p v-else>从左侧选择或创建笔记</p>
    <div style="display: flex; gap: 12px">
      <el-button type="primary" @click="actions.createVault()">创建笔记库</el-button>
      <el-button @click="app.view = { name: 'settings', tab: 'general' }">打开设置</el-button>
    </div>
    <div class="workspace-hint">工作区目录：{{ app.workspaceRoot || '未设置' }}</div>
  </div>
</template>
