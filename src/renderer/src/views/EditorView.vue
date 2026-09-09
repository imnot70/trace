<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { useAppStore } from '../stores/app'
import { useEditorStore } from '../stores/editor'
import { useTreeStore } from '../stores/tree'
import { useGitStore } from '../stores/git'
import { useNoteActions } from '../composables/actions'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import MarkdownPreview from '../components/MarkdownPreview.vue'
import TipButton from '../components/TipButton.vue'
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'

const app = useAppStore()
const editor = useEditorStore()
const tree = useTreeStore()
const git = useGitStore()
const actions = useNoteActions()

const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const previewRef = ref<InstanceType<typeof MarkdownPreview> | null>(null)
const splitPercent = ref(50)
const dragging = ref(false)

const pathParts = computed(() => (editor.current ? editor.current.path.split('/') : []))

function toolbarInsert(before: string, after = '', placeholder = ''): void {
  editorRef.value?.insertSnippet(before, after, placeholder)
}

async function onImage(fileName: string, base64: string): Promise<void> {
  if (!editor.current) return
  const { vault, path } = editor.current
  const result = await window.trace.saveImage(vault, path, fileName, base64)
  if (result.ok && result.reference) {
    editorRef.value?.insertText(`![${fileName}](${result.reference})\n`)
    ElMessage.success('图片已保存到库附件目录')
  } else {
    ElMessage.error(result.error ?? '图片保存失败')
  }
}

/**
 * 行级双向滚动同步（编辑器 ⇄ 预览，经 data-source-line 映射）。
 * 防回环：程序化滚动引发的对侧 scroll 事件在 100ms 守卫窗口内按来源跳过；
 * 图片异步加载改变预览高度时按编辑器当前位置重对齐（load 事件捕获委托）。
 */
const syncGuard = { time: 0, source: '' as 'editor' | 'preview' | '' }
let unbindScrollSync: (() => void) | null = null

function rebindScrollSync(): void {
  unbindScrollSync?.()
  unbindScrollSync = null
  void nextTick(() => {
    const scroller = editorWrapRef.value?.querySelector('.cm-scroller') as HTMLElement | null
    const previewEl: HTMLElement | null = previewRef.value?.scrollElement ?? null
    if (!scroller || !previewEl) return

    const onEditorScroll = (): void => {
      if (Date.now() - syncGuard.time < 100 && syncGuard.source === 'preview') return
      const pos = editorRef.value?.firstVisibleLine()
      if (!pos) return
      syncGuard.time = Date.now()
      syncGuard.source = 'editor'
      previewRef.value?.syncToLine(pos.line, pos.ratio)
    }
    const onPreviewScroll = (): void => {
      if (Date.now() - syncGuard.time < 100 && syncGuard.source === 'editor') return
      const line = previewRef.value?.lineAtScrollTop()
      if (line == null) return
      syncGuard.time = Date.now()
      syncGuard.source = 'preview'
      editorRef.value?.scrollToLine(line)
    }
    // 图片/媒体加载完成后按编辑器当前位置重对齐（捕获阶段监听 load）
    const onLoad = (): void => {
      const pos = editorRef.value?.firstVisibleLine()
      if (pos) previewRef.value?.syncToLine(pos.line, pos.ratio)
    }

    scroller.addEventListener('scroll', onEditorScroll, { passive: true })
    previewEl.addEventListener('scroll', onPreviewScroll, { passive: true })
    previewEl.addEventListener('load', onLoad, true)
    unbindScrollSync = () => {
      scroller.removeEventListener('scroll', onEditorScroll)
      previewEl.removeEventListener('scroll', onPreviewScroll)
      previewEl.removeEventListener('load', onLoad, true)
    }
  })
}

// 拖动分隔条
const editorCardRef = ref<HTMLElement | null>(null)
const editorWrapRef = ref<HTMLElement | null>(null)

function startDrag(): void {
  dragging.value = true
  const move = (ev: MouseEvent): void => {
    const rect = editorCardRef.value?.getBoundingClientRect()
    if (!rect) return
    splitPercent.value = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100))
  }
  const up = (): void => {
    dragging.value = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

/** 预览按钮：点击切换固定预览，长按（500ms）打开悬浮预览 */
let pressTimer: ReturnType<typeof setTimeout> | null = null

function onPreviewBtnDown(): void {
  pressTimer = setTimeout(() => {
    pressTimer = null
    app.openFloatingPreview()
  }, 500)
}

function onPreviewBtnUp(): void {
  if (pressTimer === null) return
  clearTimeout(pressTimer)
  pressTimer = null
  // 未达到长按时长，按普通点击处理
  if (app.floatingPreview) app.closeFloatingPreview()
  else app.togglePreview()
  editorRef.value?.focus()
}

function onPreviewBtnLeave(): void {
  if (pressTimer !== null) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

/** 预览中点击库内笔记链接：悬浮预览先收回，再打开目标笔记 */
function onPreviewOpenNote(target: { vault: string; path: string; name: string }): void {
  if (app.floatingPreview) app.closeFloatingPreview()
  void actions.openNote(target.vault, target.path, target.name)
}

// Ctrl/Cmd+S 手动保存；Alt+P 呼出/收起悬浮预览；Esc 收起悬浮预览
function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void editor.flushSave().then(() => ElMessage.success('已保存'))
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    if (app.floatingPreview) app.closeFloatingPreview()
    else app.openFloatingPreview()
  }
  if (e.key === 'Escape' && app.floatingPreview) {
    app.closeFloatingPreview()
  }
}

// ---------- 悬浮预览「一瞥」语义：回到写作即自动收回 ----------
/** 编辑器有输入：一瞥结束，预览自动让路 */
function onEditorUpdate(content: string): void {
  if (app.floatingPreview) app.closeFloatingPreview()
  editor.setContent(content)
}

/** 点击编辑区：回到写作，收起一瞥 */
function onEditorBodyMousedown(): void {
  if (app.floatingPreview) app.closeFloatingPreview()
}

/** 图钉：把一瞥转正为常驻分栏预览 */
function pinPeek(): void {
  app.setPreviewVisible(true)
  app.closeFloatingPreview()
}

/** 定位：在侧栏树中展开并高亮当前笔记（专注模式下以浮层侧栏展示） */
function locateCurrent(): void {
  if (!editor.current) return
  void tree.revealNode(editor.current.vault, editor.current.path, 'note')
  editorRef.value?.focus()
}

// 悬浮预览开/关后把键盘焦点交还编辑器：预览按钮与 Alt+P 都可能让焦点滞留在按钮上，
// 焦点不在编辑器则无法继续输入，「输入自动收回」也随之失效
watch(
  () => app.floatingPreview,
  async () => {
    await nextTick()
    editorRef.value?.focus()
  }
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  rebindScrollSync()
  // 从设置等视图返回：自动聚焦编辑器，落地即可继续输入
  if (app.focusEditorOnce) {
    app.focusEditorOnce = false
    void nextTick(() => editorRef.value?.focus())
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  unbindScrollSync?.()
  void editor.flushSave()
})

watch(
  () => editor.current?.vault,
  () => rebindScrollSync()
)
watch(
  () => app.previewVisible,
  () => rebindScrollSync()
)

const vaultName = computed(() => editor.current?.vault ?? '')
const vaultGit = computed(() => (vaultName.value ? tree.gitStatuses[vaultName.value] : null))

watch(
  () => editor.current?.path,
  async () => {
    // 切换笔记：一瞥结束（新笔记内容未读过，留着只会误导）
    if (app.floatingPreview) app.closeFloatingPreview()
    await nextTick()
    if (previewRef.value?.scrollElement) previewRef.value.scrollElement.scrollTop = 0
  }
)

// ---------- 专注隐藏顶栏：热区触发 + 延迟隐藏 ----------
// 顶栏隐藏时被 overflow:hidden 裁剪，卡片 :hover 无法稳定覆盖「隐藏的顶栏 + 移动路径」，
// 改为显式热区（卡片顶部横条）与顶栏自身的 mouseenter/mleave 控制，离开后留 300ms 缓冲
const concealed = computed(() => app.zenMode && app.settings.zenHideTopbar)
const topbarPeek = ref(false)
let topbarHideTimer: ReturnType<typeof setTimeout> | null = null

function keepTopbar(): void {
  if (topbarHideTimer) {
    clearTimeout(topbarHideTimer)
    topbarHideTimer = null
  }
  topbarPeek.value = true
}

function scheduleHideTopbar(): void {
  if (topbarHideTimer) clearTimeout(topbarHideTimer)
  topbarHideTimer = setTimeout(() => {
    topbarPeek.value = false
    topbarHideTimer = null
  }, 300)
}

watch([concealed, () => app.zenMode], () => {
  // 退出隐藏状态立即复位，不留计时器
  topbarPeek.value = false
  if (topbarHideTimer) {
    clearTimeout(topbarHideTimer)
    topbarHideTimer = null
  }
})

onBeforeUnmount(() => {
  if (topbarHideTimer) clearTimeout(topbarHideTimer)
})
</script>

<template>
  <!-- 编辑卡片：面包屑 + 工具栏 + 编辑器 -->
  <div
    ref="editorCardRef"
    class="editor-card"
    :class="{ 'zen-concealed': concealed, peeking: topbarPeek }"
    :style="{
      flexBasis: app.previewVisible ? (app.zenMode ? '50%' : `${splitPercent}%`) : '100%'
    }"
  >
    <!-- 专注隐藏顶栏时的悬停热区：卡片顶部横条，进入即唤出头部 -->
    <div
      v-if="concealed"
      class="zen-topbar-zone"
      @mouseenter="keepTopbar()"
      @mouseleave="scheduleHideTopbar()"
    ></div>

    <!-- 头部：信息栏 + 格式工具栏（专注隐藏顶栏时作为整体滑出） -->
    <div
      class="editor-header"
      @mouseenter="keepTopbar()"
      @mouseleave="scheduleHideTopbar()"
    >
    <div class="editor-topbar">
      <div class="breadcrumb">
        <template v-if="editor.current">
          <span>{{ editor.current.vault }}</span>
          <template v-for="(part, i) in pathParts.slice(0, -1)" :key="i">
            <span style="color: var(--text-tertiary)">/</span>
            <span>{{ part }}</span>
          </template>
          <span style="color: var(--text-tertiary)">/</span>
          <span class="crumb-current">{{ editor.current.name }}</span>
          <span v-if="editor.dirty" class="dirty-dot" title="未保存（自动保存已开启）"></span>
        </template>
      </div>

      <el-tag
        v-if="vaultGit?.associated"
        :type="vaultGit.dirty ? 'warning' : 'info'"
        size="small"
        effect="plain"
      >
        {{ vaultGit.branch }}
        <template v-if="vaultGit.ahead"> ↑{{ vaultGit.ahead }}</template>
        <template v-if="vaultGit.behind"> ↓{{ vaultGit.behind }}</template>
        <template v-if="vaultGit.dirty"> · 有未提交修改</template>
      </el-tag>

      <el-button
        v-if="vaultGit?.associated"
        size="small"
        type="primary"
        plain
        :loading="git.syncing[vaultName]"
        @click="git.sync(vaultName)"
      >
        同步
      </el-button>

      <TipButton tip="在侧栏中定位当前笔记" @click="locateCurrent">
        <el-icon><Aim /></el-icon>
      </TipButton>

      <span class="toolbar-sep"></span>
      <el-tooltip
        content="点击：显示/隐藏预览；长按或 Alt+P：悬浮预览"
        placement="bottom"
        :hide-after="0"
      >
        <button
          class="tool-btn"
          @pointerdown="onPreviewBtnDown"
          @pointerup="onPreviewBtnUp"
          @pointerleave="onPreviewBtnLeave"
        >
          <el-icon><Expand v-if="!app.previewVisible && !app.floatingPreview" /><Fold v-else /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip :content="app.zenMode ? '退出专注模式' : '专注模式（隐藏侧栏与预览）'" placement="bottom">
        <button class="tool-btn" :class="{ 'zen-on': app.zenMode }" @click="app.toggleZen(); editorRef?.focus()">
          <el-icon><FullScreen /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <!-- 工具栏 -->
    <div class="editor-toolbar">
      <TipButton tip="撤销 (Ctrl+Z)" @click="editorRef?.undo()">
        <el-icon><RefreshLeft /></el-icon>
      </TipButton>
      <TipButton tip="重做 (Ctrl+Shift+Z)" @click="editorRef?.redo()">
        <el-icon><RefreshRight /></el-icon>
      </TipButton>
      <span class="toolbar-sep"></span>
      <TipButton tip="加粗 (Ctrl+B)" @click="toolbarInsert('**', '**', '加粗文字')">
        <strong>B</strong>
      </TipButton>
      <TipButton tip="斜体 (Ctrl+I)" @click="toolbarInsert('*', '*', '斜体文字')"><i>I</i></TipButton>
      <TipButton tip="删除线 (Ctrl+Shift+X)" @click="toolbarInsert('~~', '~~', '删除线')"><s>S</s></TipButton>
      <span style="width: 8px"></span>
      <TipButton tip="一级标题" @click="toolbarInsert('# ', '', '标题')">
        H1
      </TipButton>
      <TipButton tip="二级标题" @click="toolbarInsert('## ', '', '标题')">
        H2
      </TipButton>
      <TipButton tip="引用" @click="toolbarInsert('> ', '', '引用内容')">❝</TipButton>
      <span style="width: 8px"></span>
      <TipButton tip="行内代码" @click="toolbarInsert('`', '`', 'code')">
        &lt;/&gt;
      </TipButton>
      <TipButton tip="代码块" @click="toolbarInsert('\n```js\n', '\n```\n', 'code')">
        { }
      </TipButton>
      <TipButton tip="链接" @click="toolbarInsert('[', '](https://)', '链接文字')">
        <el-icon><Link /></el-icon>
      </TipButton>
      <TipButton tip="行内公式" @click="toolbarInsert('$', '$')">
        ∑
      </TipButton>
      <TipButton tip="公式块" @click="toolbarInsert('\n$$\n', '\n$$\n')">
        ∫
      </TipButton>
    </div>
    </div>

    <!-- 外部修改提示：常显（重要警告，不随专注隐藏） -->
    <div v-if="editor.externalChanged" class="external-banner">
      <span>笔记在应用外被修改，本地还有未保存的内容。</span>
      <el-button size="small" @click="editor.reloadFromDisk()">放弃本地修改并重载</el-button>
      <el-button size="small" type="primary" @click="editor.externalChanged = false">
        保留本地修改继续编辑
      </el-button>
    </div>

    <!-- 编辑器主体（填满卡片剩余空间）；点回编辑区 = 一瞥结束 -->
    <div ref="editorWrapRef" class="editor-cm" @mousedown="onEditorBodyMousedown">
      <MarkdownEditor
        v-if="editor.current"
        ref="editorRef"
        :model-value="editor.content"
        :font-size="app.settings.editorFontSize"
        @update:model-value="onEditorUpdate"
        @save="editor.flushSave()"
        @image="(name: string, b64: string) => onImage(name, b64)"
      />
    </div>
  </div>

  <!-- 分栏拖拽间隙（预览隐藏时一并隐藏） -->
  <div
    v-if="app.previewVisible"
    class="split-divider"
    :class="{ dragging }"
    @mousedown.prevent="startDrag"
  ></div>

  <!-- 预览卡片 -->
  <div v-if="app.previewVisible" class="preview-card">
    <MarkdownPreview
      v-if="editor.current"
      ref="previewRef"
      :content="editor.content"
      :vault="vaultName"
      :note-path="editor.current.path"
      :font-size="app.settings.editorFontSize"
      @open-note="onPreviewOpenNote"
    />
  </div>

  <!-- 悬浮预览（长按预览按钮呼出，Esc 或关闭按钮收起） -->
  <Transition name="float-preview">
    <div v-if="app.floatingPreview" class="floating-preview">
        <div class="floating-preview-header">
          <span class="floating-preview-title">预览</span>
          <span class="floating-preview-actions">
            <button class="tool-btn" @click="pinPeek">
              <el-icon><Magnet /></el-icon>
            </button>
            <button class="tool-btn" @click="app.closeFloatingPreview()">
              <el-icon><Close /></el-icon>
            </button>
          </span>
        </div>
      <div class="floating-preview-body">
        <MarkdownPreview
          v-if="editor.current"
          :content="editor.content"
          :vault="vaultName"
          :note-path="editor.current.path"
          :font-size="app.settings.editorFontSize"
          @open-note="onPreviewOpenNote"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.editor-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-radius: 8px;
  overflow: hidden;
  min-width: 0;
  flex-shrink: 0;
  flex-grow: 0;
}

/* 专注隐藏顶栏：头部（信息栏 + 工具栏）整体悬浮化不占布局，热区或头部悬停时滑出 */
.editor-card.zen-concealed {
  position: relative;
}

/* 热区：卡片顶部 44px 横条，鼠标进入即唤出头部（区域内的点击只用于唤出，不透传到编辑器） */
.editor-card .zen-topbar-zone {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 44px;
  z-index: 25;
}

.editor-card.zen-concealed .editor-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  transform: translateY(-100%);
  opacity: 0;
  background: var(--bg-primary);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.editor-card.zen-concealed.peeking .editor-header {
  transform: translateY(0);
  opacity: 1;
}

.editor-cm {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.preview-card {
  flex: 1;
  min-width: 0;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-primary);
}

/* 悬浮预览卡片：覆盖在编辑区右侧，不挤压布局 */
.floating-preview {
  position: fixed;
  top: 20px;
  right: 20px;
  bottom: 20px;
  width: min(45vw, 720px);
  border-radius: 10px;
  background: var(--bg-primary);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.18),
    0 2px 10px rgba(0, 0, 0, 0.1);
  z-index: 200;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.floating-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 14px;
  border-bottom: 1px solid var(--border-color);
}

.floating-preview-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.floating-preview-actions .tool-btn {
  font-size: 13px;
}

.floating-preview-title {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.floating-preview-body {
  flex: 1;
  overflow: hidden;
}

/* 滑入/滑出动画 */
.float-preview-enter-active,
.float-preview-leave-active {
  transition:
    transform 0.22s ease,
    opacity 0.22s ease;
}

.float-preview-enter-from,
.float-preview-leave-to {
  transform: translateX(48px);
  opacity: 0;
}
</style>
