<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAppStore } from './stores/app'
import { useTreeStore } from './stores/tree'
import { useEditorStore } from './stores/editor'
import { useTrashStore } from './stores/trash'
import { useNameDialog } from './stores/nameDialog'
import { useNoteActions } from './composables/actions'
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

// ---------- 全局快捷键（速查表见 src/renderer/src/config/shortcuts.ts 与设置 → 通用） ----------
const nameDialog = useNameDialog()
const noteActions = useNoteActions()

/** 对话框 / 弹窗打开时跳过全局键，避免劫持输入与确认操作 */
function hasModalOpen(): boolean {
  return nameDialog.visible || !!document.querySelector('.el-message-box__wrapper, .el-overlay:not([style*="display: none"])')
}

function onGlobalKeydown(e: KeyboardEvent): void {
  // Esc 交给各视图自行分级处理（浮层侧栏 / 网格 / 悬浮预览），此处只管浮层侧栏与设置返回
  if (e.key === 'Escape') {
    onRailKeydown(e)
    if (app.view.name === 'settings') backFromSettings()
    return
  }
  if (hasModalOpen()) return

  // Alt 系：界面视图切换（与 Ctrl 系通用动作分层）
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const digit: Record<string, 'recents' | 'favorites' | 'vaults'> = {
      Digit1: 'recents',
      Digit2: 'favorites',
      Digit4: 'vaults'
    }
    if (e.code === 'Digit3') {
      e.preventDefault()
      app.view = { name: 'trash' }
    } else if (digit[e.code]) {
      e.preventDefault()
      app.toggleGridSection(digit[e.code])
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault()
      app.toggleZen()
    } else if (e.key.toLowerCase() === 'b') {
      e.preventDefault()
      app.toggleSidebar()
    } else if (e.key.toLowerCase() === 'v') {
      e.preventDefault()
      app.togglePreview()
    }
    return
  }

  // Ctrl 系：应用通用动作
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (e.key === ',') {
      e.preventDefault()
      // 开关语义：设置页再按一次返回（编辑笔记在握时回编辑，否则回欢迎页）
      if (app.view.name === 'settings') backFromSettings()
      else app.view = { name: 'settings', tab: 'general' }
      return
    }
    if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
      e.preventDefault()
      void newNoteFromContext()
    }
  }
}

/** 从设置返回：有正在编辑的笔记则回到编辑视图并聚焦，否则回欢迎页 */
function backFromSettings(): void {
  if (editor.current) {
    app.focusEditorOnce = true
    app.view = { name: 'editor' }
  } else {
    app.view = { name: 'welcome' }
  }
}

/** Ctrl+N：目标是「当前位置上下文」——最近打开的笔记 / 网格钻入 / 侧栏点击所在处；无上下文时兜底第一个库 */
async function newNoteFromContext(): Promise<void> {
  const loc = tree.lastLocation
  if (loc && tree.vaults.some((v) => v.name === loc.vault)) {
    noteActions.createNote(loc.vault, loc.dir)
    return
  }
  const vault = tree.vaults[0]?.name
  if (!vault) {
    ElMessage.warning('请先创建笔记库')
    app.view = { name: 'grid', section: 'vaults' }
    return
  }
  noteActions.createNote(vault, '')
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
  window.addEventListener('keydown', onGlobalKeydown)
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
