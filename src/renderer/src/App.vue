<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useAppStore } from './stores/app'
import { exportState } from './composables/exportPdf'
import { useTreeStore } from './stores/tree'
import { useEditorStore } from './stores/editor'
import { useTrashStore } from './stores/trash'
import { useNameDialog } from './stores/nameDialog'
import { useMoveDialog } from './stores/moveDialog'
import { useGitStore } from './stores/git'
import { useSearchStore } from './stores/search'
import { useNoteActions } from './composables/actions'
import SideBar from './components/SideBar.vue'
import NameDialog from './components/NameDialog.vue'
import MoveDialog from './components/MoveDialog.vue'
import GitAssociateDialog from './components/GitAssociateDialog.vue'
import ConflictResolutionDialog from './components/ConflictResolutionDialog.vue'
import SearchDialog from './components/SearchDialog.vue'
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
const git = useGitStore()
const search = useSearchStore()

/** 从搜索结果打开笔记 */
async function handleOpenNoteFromSearch(vault: string, path: string) {
  try {
    // 先加载笔记内容
    const result = await window.trace.readNote(vault, path)
    if (result.ok && result.content !== undefined) {
      // 切换到编辑器视图
      app.view = { name: 'editor' }
      // 打开笔记
      editor.openNote(vault, path, result.content)
    } else {
      ElMessage.error(result.error || '打开笔记失败')
    }
  } catch {
    ElMessage.error('打开笔记失败')
  }
}

// 侧栏不可见（手动收起或专注模式）时显示迷你导航条；心流模式下整体隐去（沉浸语义）
const railVisible = computed(() => !app.flowMode && (app.zenMode || !app.sidebarVisible))
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

/**
 * Esc 分级回退（唯一处置点），由「层次浅 → 深」依次消费：
 * 浮层侧栏 → 悬浮预览 → 设置返回编辑（视图级）→ 退出心流模式（模式级）。
 * 集中在一处的原因：若拆到多个 window 监听器各自判断，同一次 Esc 会因执行顺序
 * 相互看到被对方改过的状态，导致一次按键退两级（实测：关浮层同时退了心流）。
 * 视图级优先于模式级：心流中打开设置后按 Esc 先回编辑（仍在心流），再按才退出心流。
 */
function onEscape(): void {
  // 有模态（搜索 / 命名 / 移动 / 消息框）时 Esc 归它：Element Plus 对话框内建 Esc 关闭，
  // 此处若继续往下处理会出现「关对话框的同时把心流也退了」
  if (hasModalOpen()) return
  if (app.zenSidebarOverlay) {
    app.closeZenSidebar()
    return
  }
  if (app.floatingPreview) {
    app.closeFloatingPreview()
    return
  }
  if (app.view.name === 'settings') {
    backFromSettings()
    return
  }
  if (app.flowMode) {
    app.exitFlow()
  }
}

// ---------- 全局快捷键（速查表见 src/renderer/src/config/shortcuts.ts 与设置 → 通用） ----------
const nameDialog = useNameDialog()
const moveDialog = useMoveDialog()
const noteActions = useNoteActions()

/** 对话框 / 弹窗打开时跳过全局键，避免劫持输入与确认操作 */
function hasModalOpen(): boolean {
  return nameDialog.visible || moveDialog.visible || !!document.querySelector('.el-message-box__wrapper, .el-overlay:not([style*="display: none"])')
}

/** Esc 捕获阶段入口：网格内的「返回上级 / 关闭网格」仍由 NoteGridView 自行处理（模式未命中时不消费） */
function onEscapeCapture(e: KeyboardEvent): void {
  if (e.key === 'Escape') onEscape()
}

function onGlobalKeydown(e: KeyboardEvent): void {
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
    } else if (e.key.toLowerCase() === 'w') {
      // 心流模式：一键进入 / 退出（沉浸创作预设）
      e.preventDefault()
      app.toggleFlow()
    } else if (e.key.toLowerCase() === 'b') {
      e.preventDefault()
      // 沉浸态（专注 / 心流）下侧栏以浮层呼出；普通态直接切换显示
      if (app.zenMode || app.flowMode) app.toggleZenSidebar()
      else app.toggleSidebar()
    } else if (e.key.toLowerCase() === 'v') {
      e.preventDefault()
      app.togglePreview()
    }
    return
  }

  // Ctrl 系：应用通用动作。
  // 注意：这里必须排除 Shift——Ctrl+Shift+E（跳到文件末尾，FR-2.4.19）等编辑器键位由编辑器处理，
  // 若只按字母匹配会顺带触发本处的动作（历史缺陷：Ctrl+Shift+E 会误切编辑模式）
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
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
    if (e.key.toLowerCase() === 'f') {
      e.preventDefault()
      search.openSearch()
    }
    // Ctrl+E：源码 ↔ 所见即所得编辑模式切换（仅编辑视图，FR-W1）
    if (e.key.toLowerCase() === 'e' && app.view.name === 'editor' && editor.current) {
      e.preventDefault()
      app.toggleEditorMode()
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

const isWindows = window.trace.platform === 'win32'
/** Windows 玻璃开关：WCO + backgroundMaterial 模式下窗口背景带透明度，材质透出 */
const isWinGlass = () => isWindows && !!app.settings.windowGlassEffect && app.settings.windowGlassEffect !== 'none'
/** 窗口视觉透明（内容圆角开启）：macOS/Linux 透明玻璃路径 + Windows 玻璃路径 */
const isWindowTransparent = () =>
  isWinGlass() ||
  (app.settings.windowGlassEffect !== 'none' &&
    app.settings.windowGlassEffect !== undefined &&
    !isWindows)

function syncWindowClasses(): void {
  const el = document.documentElement
  el.classList.toggle('platform-win', isWindows)
  el.classList.toggle('window-opaque', !isWindowTransparent())
  el.classList.toggle('glass-on', isWinGlass())
}

onMounted(async () => {
  await app.init()
  // 窗口视觉形态类（macOS/Linux 透明玻璃路径见 createWindow 注释；Windows 走 WCO 玻璃，
  // 亦不碰 transparent: true——v0.4.4 回归教训，见 AGENTS.md 已知局限）
  syncWindowClasses()
  // 设置里切换玻璃效果 / 主题时同步类（无需重载窗口）
  watch(
    () => [app.settings.windowGlassEffect, app.settings.theme],
    () => syncWindowClasses()
  )
  // Linux 浅色壁纸下底部圆角缺口仍会露出系统合成器的方形轮廓（深色壁纸正常，疑似系统侧
  // 限制、应用侧无法彻底消除，排查记录见 AGENTS.md 已知局限）——Linux 一律去掉底部圆角规避
  if (window.trace.platform === 'linux')
    document.documentElement.classList.add('no-bottom-radius')
  await tree.refreshAll()
  void trash.load() // 侧栏回收站计数
  window.addEventListener('keydown', onGlobalKeydown)
  // Esc 用捕获阶段：必须早于 Element Plus 对话框自身的 Esc 处理，否则等冒泡到窗口时
  // 对话框已经关闭、「有模态则让位」的判断失效（实测：关对话框的同一次按键把心流也退了）
  window.addEventListener('keydown', onEscapeCapture, true)
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
  // 插件状态区文字与工具栏按钮（M3，主进程广播全量条目）
  window.trace.onPluginStatus((entries) => {
    app.pluginStatuses = entries
  })
  window.trace.onPluginToolbar((items) => {
    app.pluginToolbars = items
  })
})
</script>

<template>
  <!-- Windows WCO 标题栏条：应用名 + 拖拽区（双击最大化）；右侧为系统原生按钮区 -->
  <div v-if="isWindows" class="win-titlebar">
    <span class="win-titlebar-title">Trace 笔迹</span>
  </div>
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
  <MoveDialog />
  <GitAssociateDialog />
  <ConflictResolutionDialog
    v-if="git.conflictResolution.visible && git.conflictResolution.vault"
    :vault="git.conflictResolution.vault"
    :initial-files="git.conflictResolution.files"
    @close="git.closeConflictResolution()"
    @resolved="git.onConflictResolved()"
  />
  <SearchDialog
    :visible="search.visible"
    @close="search.closeSearch()"
    @open-note="handleOpenNoteFromSearch"
  />

  <!-- 批量导出进度（悬浮条，完成即消失） -->
  <Transition name="float-preview">
    <div v-if="exportState.visible" class="export-progress">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在导出 {{ exportState.done }}/{{ exportState.total }}：{{ exportState.current }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.export-progress {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  color: var(--text-primary);
  font-size: 13px;
}
</style>
