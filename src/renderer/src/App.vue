<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAppStore } from './stores/app'
import { useTreeStore } from './stores/tree'
import { useEditorStore } from './stores/editor'
import { useTrashStore } from './stores/trash'
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
const trash = useTrashStore()

// 侧栏不可见（手动收起或专注模式）时显示迷你导航条
const railVisible = computed(() => app.zenMode || !app.sidebarVisible)
// 侧栏实际渲染：普通模式按偏好；专注模式仅以浮层临时显示
const sidebarShown = computed(() => (!app.zenMode && app.sidebarVisible) || app.zenSidebarOverlay)

/** 导航条图标对应的视图切换（与侧栏标题点击一致） */
function toggleGrid(section: 'recents' | 'favorites' | 'vaults'): void {
  if (app.view.name === 'grid' && app.view.section === section) app.view = { name: 'welcome' }
  else app.view = { name: 'grid', section }
}

function isGridOpen(section: 'recents' | 'favorites' | 'vaults'): boolean {
  return app.view.name === 'grid' && app.view.section === section
}

function onRailKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && app.zenSidebarOverlay) app.closeZenSidebar()
}

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
  void trash.load() // 侧栏回收站计数
  window.addEventListener('keydown', onRailKeydown)
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
    <SideBar
      v-if="sidebarShown"
      class="sidebar-card"
      :class="{ 'sidebar-overlay': app.zenSidebarOverlay }"
    />
    <!-- 专注模式浮层侧栏的点击关闭遮罩 -->
    <div v-if="app.zenSidebarOverlay" class="sidebar-backdrop" @click="app.closeZenSidebar()"></div>

    <!-- 迷你导航条：侧栏不可见（手动收起或专注模式）时提供视图切换与侧栏呼出 -->
    <div v-if="railVisible" class="sidebar-rail">
      <el-tooltip content="常用" placement="right" :show-after="400">
        <button class="rail-btn" :class="{ active: isGridOpen('recents') }" @click="toggleGrid('recents')">
          <el-icon><Clock /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="收藏" placement="right" :show-after="400">
        <button class="rail-btn" :class="{ active: isGridOpen('favorites') }" @click="toggleGrid('favorites')">
          <el-icon><Star /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="回收站" placement="right" :show-after="400">
        <button class="rail-btn" :class="{ active: app.view.name === 'trash' }" @click="app.view = { name: 'trash' }">
          <el-icon><Delete /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="笔记库" placement="right" :show-after="400">
        <button class="rail-btn" :class="{ active: isGridOpen('vaults') }" @click="toggleGrid('vaults')">
          <el-icon><Collection /></el-icon>
        </button>
      </el-tooltip>

      <span style="flex: 1"></span>
      <!-- 普通（收起）模式：切换侧栏显示；专注模式：临时浮层侧栏 -->
      <el-tooltip
        :content="app.zenMode ? '呼出侧栏' : '显示侧栏'"
        placement="right"
        :show-after="400"
      >
        <button class="rail-btn" @click="app.zenMode ? app.toggleZenSidebar() : app.toggleSidebar()">
          <el-icon><Expand v-if="!app.zenSidebarOverlay" /><Fold v-else /></el-icon>
        </button>
      </el-tooltip>
    </div>

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
