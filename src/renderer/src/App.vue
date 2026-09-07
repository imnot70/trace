<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAppStore } from './stores/app'
import { useTreeStore } from './stores/tree'
import { useEditorStore } from './stores/editor'
import SideBar from './components/SideBar.vue'
import NameDialog from './components/NameDialog.vue'
import GitAssociateDialog from './components/GitAssociateDialog.vue'
import WelcomeView from './views/WelcomeView.vue'
import EditorView from './views/EditorView.vue'
import TrashView from './views/TrashView.vue'
import SettingsView from './views/SettingsView.vue'
import NoteGridView from './views/NoteGridView.vue'
import { ElMessage } from 'element-plus'

const app = useAppStore()
const tree = useTreeStore()
const editor = useEditorStore()

// 编辑视图的卡片（编辑卡 + 预览卡）由 EditorView 以多根节点输出，
// 其余视图统一包进一张 page-card。
const mainView = computed(() => {
  switch (app.view.name) {
    case 'trash':
      return TrashView
    case 'settings':
      return SettingsView
    case 'grid':
      return NoteGridView
    default:
      return WelcomeView
  }
})

onMounted(async () => {
  await app.init()
  await tree.refreshAll()
  if (tree.vaults.length > 0) {
    await Promise.all(tree.vaults.map((v) => tree.refreshGitStatus(v.name)))
  }

  window.trace.onFsChanged((payload) => {
    void tree.handleFsChanged(payload.vault)
    editor.handleFsChanged(payload.vault, payload.paths)
  })
  window.trace.onGitEvent((payload) => {
    if (payload.phase === 'done') {
      void tree.refreshGitStatus(payload.vault)
    } else if (payload.phase === 'error' && payload.message) {
      ElMessage.error(`同步失败：${payload.message}`)
      void tree.refreshGitStatus(payload.vault)
    }
  })
  window.trace.onPluginNotify((message) => {
    ElMessage.info(message)
  })
})
</script>

<template>
  <div class="app-shell">
    <SideBar v-if="!app.zenMode" class="sidebar-card" />
    <div class="main-cards">
      <EditorView v-if="app.view.name === 'editor'" />
      <div v-else class="page-card">
        <component :is="mainView" />
      </div>
    </div>
  </div>
  <NameDialog />
  <GitAssociateDialog />
</template>
