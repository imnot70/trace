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
import { useDraftStore } from './stores/draft'
import SideBar from './components/SideBar.vue'
import NameDialog from './components/NameDialog.vue'
import MoveDialog from './components/MoveDialog.vue'
import GitAssociateDialog from './components/GitAssociateDialog.vue'
import ConflictResolutionDialog from './components/ConflictResolutionDialog.vue'
import DraftPromoteDialog from './components/DraftPromoteDialog.vue'
import SearchDialog from './components/SearchDialog.vue'
import ContextMenu from './components/ContextMenu.vue'
import NoteSwitcher from './components/NoteSwitcher.vue'
import { buildWindowTitle } from './lib/windowTitle'
import WelcomeView from './views/WelcomeView.vue'
import EditorView from './views/EditorView.vue'
import TrashView from './views/TrashView.vue'
import SettingsView from './views/SettingsView.vue'
import NoteGridView from './views/NoteGridView.vue'
import { ElMessage } from 'element-plus'
import { noteDisplayName } from '@shared/validate'
import { createDoubleShiftDetector } from './lib/doubleShift'
import { shouldYieldEscapeToVim } from './lib/vimMode'

const app = useAppStore()
const tree = useTreeStore()
const editor = useEditorStore()
const trash = useTrashStore()
const git = useGitStore()
const search = useSearchStore()
const draft = useDraftStore()

/** 从搜索结果打开笔记 */
async function handleOpenNoteFromSearch(vault: string, path: string) {
  try {
    // 预读只为错误提示（读不到给出明确报错）；实际打开由 openNote 内部完成，
    // 此前把整篇内容误当显示名传参、污染「常用」列表的 bug 已修（加固批次）
    const result = await window.trace.readNote(vault, path)
    if (!result.ok) {
      ElMessage.error(result.error || '打开笔记失败')
      return
    }
    // 切换到编辑器视图并打开笔记（显示名 = 去扩展名的文件名，与树节点 / 反向链接一致）
    app.view = { name: 'editor' }
    await editor.openNote(vault, path, noteDisplayName(path.split('/').pop() ?? path))
  } catch {
    ElMessage.error('打开笔记失败')
  }
}

// 侧栏不可见（手动收起或专注模式）时显示迷你导航条；心流模式下整体隐去（沉浸语义）
const railVisible = computed(() => !app.flowMode && (app.zenMode || !app.sidebarVisible))
// 侧栏实际渲染：普通模式按偏好；专注模式仅以浮层临时显示
const sidebarShown = computed(() => (!app.zenMode && app.sidebarVisible) || app.zenSidebarOverlay)

/** 导航条图标对应的视图切换（与侧栏标题点击一致） */
function toggleGrid(section: 'recents' | 'favorites' | 'drafts' | 'vaults'): void {
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
function onEscape(): boolean {
  // 有模态（搜索 / 命名 / 移动 / 消息框）时 Esc 归它：Element Plus 对话框内建 Esc 关闭，
  // 此处若继续往下处理会出现「关对话框的同时把心流也退了」。不消费，事件照常传播
  if (hasModalOpen()) return false
  if (app.zenSidebarOverlay) {
    app.closeZenSidebar()
    return true
  }
  // 悬浮预览分支必须在补全让位分支**之前**：预览 + 补全同时开时（心流快速查阅），
  // 用户期望 Esc 先关预览、补全保留（FR-2.9.10）；预览关掉后下一次 Esc 才轮到补全
  if (app.floatingPreview) {
    app.closeFloatingPreview()
    return true
  }
  // `[[` 补全面板打开时 Esc 归 CodeMirror（收起补全），应用级回退不参与——
  // 否则补全还开着时按 Esc 会连心流一起退掉
  if (document.querySelector('.cm-tooltip-autocomplete')) return false
  // 内置查找/替换面板打开时同理（FR-2.9.11）：Esc 先收面板，下一次 Esc 才逐级回退
  // （@codemirror/search 6.7+ 的面板类名是 cm-search，非旧文档的 cm-searchPanel）
  if (document.querySelector('.cm-panel.cm-search')) return false
  if (app.view.name === 'settings') {
    backFromSettings()
    return true
  }
  if (app.flowMode) {
    // Vim 让位（FR-2.4.23 拍板：浮层优先、心流退出让位）——vim 开启且编辑器聚焦时，
    // Esc 归 vim 返回 normal；退出心流改走 Alt+W / 顶栏咖啡杯。焦点不在编辑器
    // （悬浮预览 / 工具栏按钮等）或 vim 未开启时维持现状：Esc 退出心流
    if (shouldYieldEscapeToVim(app.settings.vimEnabled, isEditorFocused())) {
      return false
    }
    app.exitFlow()
    return true
  }
  return false
}

/** 编辑器是否持有焦点（含心流 / 专注形态）：activeElement 落在 CM 编辑区内 */
function isEditorFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el?.closest?.('.cm-editor')
}

// ---------- 全局快捷键（速查表见 src/renderer/src/config/shortcuts.ts 与设置 → 通用） ----------
const nameDialog = useNameDialog()
const moveDialog = useMoveDialog()

/** 对话框 / 弹窗打开时跳过全局键，避免劫持输入与确认操作。
 *  EP 的 .el-overlay 在对话框关闭后仍驻留 DOM（v-show 打上 display: none），因此不能用
 *  「节点存在」或内联样式子串判定，必须看**实际渲染可见性**：内联样式在 EP 重写 zIndex /
 *  过渡中途被打断等情况下可能不含 "display: none" 字样，误判会让全局快捷键被静默吞掉
 *  （用户实测：心流中 Ctrl+, 往返设置后几乎全部快捷键失效，只能重启——按可见性判定后，
 *  未真正显示的遗留节点不再吞键） */
function hasModalOpen(): boolean {
  if (nameDialog.visible || moveDialog.visible) return true
  const overlays = document.querySelectorAll<HTMLElement>('.el-message-box__wrapper, .el-overlay')
  for (const el of overlays) {
    if (getComputedStyle(el).display === 'none') continue
    if (el.getClientRects().length === 0) continue
    return true
  }
  return false
}

/** Esc 捕获阶段入口：网格内的「返回上级 / 关闭网格」仍由 NoteGridView 自行处理（模式未命中时不消费）。
 *  应用级回退消费了按键就阻断下沉——否则事件到达 CM 键位会把补全面板一起关掉（FR-2.9.10 P1） */
function onEscapeCapture(e: KeyboardEvent): void {
  // MRU 快切面板按住中（FR-2.4.26 D6）：Esc = 取消跳转（面板关、停留原地），最高优先
  if (e.key === 'Escape' && editor.mruActive) {
    editor.mruCancel()
    e.preventDefault()
    e.stopPropagation()
    return
  }
  if (e.key === 'Escape' && onEscape()) {
    e.preventDefault()
    e.stopPropagation()
  }
}

function onGlobalKeydown(e: KeyboardEvent): void {
  // 长按自动重复（e.repeat）对开关 / 导航类按键只会造成来回翻转（Ctrl+, 按住 =
  // 设置 ↔ 编辑器快速抖动），一律忽略，一次物理按下只处理一次。例外：MRU 面板的
  // Tab 连按要响应 repeat（按住 Tab 连续翻动，VS Code 同款手感）
  if (e.repeat && !editor.mruActive) return
  if (hasModalOpen()) {
    // MRU 面板按住中弹出了系统对话框（跨库确认框等）：立即取消跳转，键归对话框
    if (editor.mruActive) editor.mruCancel()
    return
  }

  // MRU 快切面板按住中（FR-2.4.26 D6，Ctrl+Tab 弦）：Tab / Shift+Tab 翻动，其余放行
  if (editor.mruActive) {
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault()
      editor.mruMove(e.shiftKey ? -1 : 1)
    }
    return
  }

  // Ctrl+Tab 弦按下（FR-2.4.26 D6）：开启 MRU 快切面板（编辑视图内，≥2 篇历史）。
  // 提交在 keyup（Ctrl 松开）——见 onGlobalKeyup
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab') {
    if (app.view.name === 'editor' && editor.current) {
      e.preventDefault()
      editor.mruBegin()
    }
    return
  }

  // Alt 系：界面视图切换（与 Ctrl 系通用动作分层）。
  // 焦点在 CM 查找/替换面板内时整体让位（FR-2.9.11）：面板自带 Alt+C / Alt+R / Alt+W
  // 切换键，不拦会和应用级 Alt+W（心流）等双双触发
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if ((e.target as HTMLElement | null)?.closest?.('.cm-panel')) return
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
    } else if (e.key.toLowerCase() === 't') {
      // 打字机模式开关（编辑视图内；FR-2.4.14）
      e.preventDefault()
      if (app.view.name === 'editor' && editor.current) app.toggleTypewriter()
    } else if (e.key.toLowerCase() === 'm') {
      // Vim 编辑模式开关（FR-2.4.23）。Alt+V 已被「显示/隐藏预览区」占用（另为搜索弹窗
      // 的库范围下拉键），故取空闲的 Alt+M（Mode）；与 Alt+T 同守卫（编辑视图内生效）
      e.preventDefault()
      if (app.view.name === 'editor' && editor.current) app.toggleVim()
    } else if (e.key.toLowerCase() === 'i') {
      // 快速引用面板开关（FR-2.9.12）：目录树（含草稿）选笔记插入 [[引用]]，不切走当前
      // 笔记。与 Alt+T / Alt+M 同守卫（编辑视图内生效）；心流 / 专注均可用；面板开着时
      // 再按关闭（el-dialog 模态不拦全局 keydown，焦点在面板输入框也照常到达）
      e.preventDefault()
      if (app.view.name === 'editor' && editor.current) app.toggleQuickRefPicker()
    } else if (e.key === 'ArrowLeft') {
      // 后退历史（FR-2.4.26 D5）：逐步退回之前打开的笔记（恢复离开时光标，见
      // editor.cursorMap）——搜索 / 双链误点切走后一键回。
      // 编辑器聚焦时 CM 键位层（Prec.high）已消费并 preventDefault，此处守卫防双跳
      if (e.defaultPrevented) return
      e.preventDefault()
      if (app.view.name === 'editor' && editor.current) void editor.goBackNote()
    } else if (e.key === 'ArrowRight') {
      // 前进历史（FR-2.4.26 D5）：后退过再「回来」（Alt+← 的反方向），新开导航清空前进栈
      if (e.defaultPrevented) return
      e.preventDefault()
      if (app.view.name === 'editor' && editor.current) void editor.goForwardNote()
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
      // FR-2.3.9：Ctrl+N 创建草稿（写入应用草稿箱，Ctrl+S 转正选择库与目录）
      void draft.createDraft()
    }
    if (e.key.toLowerCase() === 'f') {
      // Ctrl+F 专用语义（FR-2.9.11 二轮调整）：只做「笔记内查找 / 替换」，与 Double-Shift
      //（全局搜索 / 当前库搜索）完全隔离，避免两个键都开搜索弹窗的混乱。
      // 非编辑视图 / 无当前笔记时不响应；焦点在编辑器内由 CM 键位自行接管（此处不拦截），
      // 焦点在外（预览 / 工具栏等）置一次性意图，由 EditorView 聚焦编辑器并打开面板
      if (app.view.name !== 'editor' || !editor.current) return
      if ((e.target as HTMLElement | null)?.closest?.('.cm-editor')) return
      e.preventDefault()
      app.pendingNoteSearch = true
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

// Double-Shift：当前库搜索（FR-2.9.11，JetBrains 惯例）。正在编辑某库的笔记时
// 预置该库范围打开搜索框（下拉里可改），无当前笔记时回落全局搜索；
// 有模态（含搜索框本身）打开时不触发，防误触由检测器与 hasModalOpen 双重把关
const doubleShift = createDoubleShiftDetector(() => {
  if (hasModalOpen()) return
  const vault = editor.current?.vault
  if (vault) search.openSearch(vault)
  else search.openSearch()
})

/** Ctrl+N：目标是「当前位置上下文」——最近打开的笔记 / 网格钻入 / 侧栏点击所在处；无上下文时兜底第一个库 */
// 编辑视图的卡片（编辑卡 + 预览卡）由 EditorView 以多根节点输出，
// 其余视图统一包进一张 page-card。
const mainView = computed(() => {
  switch (app.view.name) {
    case 'trash':
      return TrashView
    // settings 不在此列（2026-09-27）：设置改为弹窗覆盖层，编辑/欢迎视图保持挂载
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
  // 新版本检测（FR-2.10.6）：启动静默检查（24h 节流，失败无感）——在 app.init 之后，
  // 独立 await 不阻塞首屏（fire-and-forget）
  void app.runUpdateCheck()
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
  // Double-Shift 检测与普通键处理各自独立（检测器只认 Shift，不影响其他键的计数清零逻辑）
  window.addEventListener('keydown', doubleShift.onKeyDown)
  // Esc 用捕获阶段：必须早于 Element Plus 对话框自身的 Esc 处理，否则等冒泡到窗口时
  // 对话框已经关闭、「有模态则让位」的判断失效（实测：关对话框的同一次按键把心流也退了）
  window.addEventListener('keydown', onEscapeCapture, true)
  // MRU 快切面板的提交时机（FR-2.4.26 D6）：**Ctrl 松开**提交（Tab 要反复按，不能在
  // Tab keyup 上提交）；窗口失焦时取消（keyup 可能丢失）
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.key === 'Control' && editor.mruActive) void editor.mruCommit()
  })
  window.addEventListener('blur', () => editor.mruCancel())
  // 窗口标题跟随当前笔记（FR-2.10.7）：常规「笔记名 - Trace 笔迹」、心流「库名 / 笔记名」。
  // Electron 自动把 document.title 同步为原生窗口标题（任务栏 / Alt+Tab 可见），无需 IPC
  const syncWindowTitle = (): void => {
    document.title = buildWindowTitle(editor.current, app.flowMode)
  }
  syncWindowTitle()
  // deep：重命名是原地改 current 的字段（引用不变），浅 watch 感知不到
  watch(() => [editor.current, app.flowMode] as const, syncWindowTitle, { deep: true })
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
      <EditorView v-if="app.view.name === 'editor' || app.view.name === 'settings'" />
      <div v-else class="page-card">
        <component :is="mainView" />
      </div>
    </div>

    <!-- 设置弹窗（编辑 / 欢迎视图保持挂载，弹窗覆盖其上） -->
    <SettingsView v-if="app.view.name === 'settings'" />
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
    :preset-vault="search.presetVault"
    @close="search.closeSearch()"
    @open-note="handleOpenNoteFromSearch"
    @preview-note="(vault: string, path: string, title: string) => app.requestNotePreview(vault, path, title)"
  />
  <!-- 右键上下文菜单（FR-2.4.28）：全局单例浮层，调用侧经 app.openContextMenu 组装 -->
  <ContextMenu />
  <NoteSwitcher />
  <DraftPromoteDialog />

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
