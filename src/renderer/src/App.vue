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
import { ElMessage } from 'element-plus'

const app = useAppStore()
const tree = useTreeStore()
const editor = useEditorStore()

const mainView = computed(() => {
  switch (app.view.name) {
    case 'editor':
      return EditorView
    case 'trash':
      return TrashView
    case 'settings':
      return SettingsView
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
  <el-container class="app-shell">
    <el-aside width="272px" class="app-aside">
      <SideBar />
    </el-aside>
    <el-main class="app-main">
      <component :is="mainView" />
    </el-main>
  </el-container>
  <NameDialog />
  <GitAssociateDialog />
</template>

<style scoped>
.app-aside {
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}
</style>
