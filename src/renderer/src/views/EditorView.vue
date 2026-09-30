<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '../stores/app'
import { useEditorStore } from '../stores/editor'
import { useTreeStore } from '../stores/tree'
import { useGitStore } from '../stores/git'
import { useSearchStore } from '../stores/search'
import { useDraftStore, scratchVaultLabel } from '../stores/draft'
import { useNoteActions } from '../composables/actions'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import QuickRefPicker from '../components/QuickRefPicker.vue'
import { formatVimModeLabel } from '../lib/vimMode'
import MarkdownPreview from '../components/MarkdownPreview.vue'
import TipButton from '../components/TipButton.vue'
import BacklinkPanel from '../components/BacklinkPanel.vue'
import TablePromptHud from '../components/TablePromptHud.vue'
import type { HeadingLevel } from '../lib/heading'
import { anchorRatioFor, typewriterPadding } from '../lib/typewriter'
import { preferNameInsert, restoreDropMasks, type NoteRefPayload } from '../lib/dragDrop'
import { SCRATCH_VAULT } from '@shared/types'
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'

const app = useAppStore()
const editor = useEditorStore()
const tree = useTreeStore()
const git = useGitStore()
const draft = useDraftStore()
const actions = useNoteActions()

/** 跨库引用确认框打开期间置顶预览临时让位（见 insertPreviewTarget 内注释） */
const confirmOverPreview = ref(false)

const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const previewRef = ref<InstanceType<typeof MarkdownPreview> | null>(null)
const floatPreviewRef = ref<InstanceType<typeof MarkdownPreview> | null>(null)
const splitPercent = ref(50)
const dragging = ref(false)

const pathParts = computed(() => (editor.current ? editor.current.path.split('/') : []))
/** 当前打开的是否为草稿（scratch 伪库） */
const isScratchNote = computed(() => editor.current?.vault === SCRATCH_VAULT)

function toolbarInsert(before: string, after = '', placeholder = ''): void {
  editorRef.value?.insertSnippet(before, after, placeholder)
}

/** 编辑器内 Ctrl+S：草稿 → 打开保存对话框；正式笔记 → 常规落盘保存 */
function onEditorSave(): void {
  if (editor.current?.vault === SCRATCH_VAULT) {
    draft.requestPromote()
    return
  }
  void editor.flushSave().then(() => ElMessage.success('已保存'))
}

/** 把正在预览 / 面板选中的笔记落成引用（FR-2.9.11 / FR-2.9.12）：库内目标直接插入；
 *  跨库目标先确认 → 复制到当前库（图片随迁 + 引用改写，重名自动加后缀）→ 插入指向
 *  副本的引用。编辑器内 Alt+Enter（经 insert-cross-vault 事件）、悬浮预览「插入引用」
 *  按钮、快速引用面板、拖曳释放（FR-2.9.10 P3）多条动线共用此函数。
 *  opts.at = 拖曳释放点（缺省 = 当前光标）；拖曳插入时按 D2 口径消歧——目标叶子名在
 *  当前库内唯一则插 `[[名字]]`，重名 / 查不到插 `[[完整路径]]`（草稿态不消歧：草稿
 *  不进双链索引，转正时再定归宿）。
 *  @returns 引用是否已插入（用户取消确认框 / 复制失败 / 无当前笔记 = false）——
 *  「插入即关」的调用方（拖入释放 / 悬浮预览插入）据此决定是否关闭来源弹窗 */
async function insertPreviewTarget(
  target: { vault: string; path: string; name: string },
  opts?: { at?: number | null }
): Promise<boolean> {
  const current = editor.current
  if (!current) return false

  let insertRel = target.path.replace(/\.md$/i, '')

  if (target.vault === SCRATCH_VAULT) {
    if (current.vault === SCRATCH_VAULT) {
      // 草稿内引用草稿（FR-2.3.9 D7 例外）：直接落引用文本，转正时再定归宿
      const inserted = editorRef.value?.insertReferenceFromCompletion()
      if (!inserted) editorRef.value?.insertReferenceAtPath(insertRel)
      app.closeFloatingPreview()
      editorRef.value?.focus()
      return true
    }
    // 正式笔记引用草稿（FR-2.9.12 D3）：确认后把草稿「复制」为当前库正式笔记
    // （keepDraft——原草稿保留，与跨库复制同语义），引用指向正式笔记。草稿不在
    // 双链索引，直接 [[草稿名]] 必然断链；目录沿用「跨库引用」体系（草稿子目录）
    const draftCopyDir = `${app.settings.crossVaultCopyDir?.trim() || '跨库引用'}/草稿`
    if (!app.settings.skipCrossVaultCopyConfirm) {
      confirmOverPreview.value = true
      try {
        await ElMessageBox.confirm(
          `草稿尚未转正：将先把草稿复制为当前库「${draftCopyDir}」目录下的正式笔记（原草稿保留，两者后续互不同步），并插入指向正式笔记的引用。确定要引用该草稿吗？`,
          '引用草稿',
          { type: 'warning', confirmButtonText: '复制并引用', cancelButtonText: '取消' }
        )
      } catch {
        return false // 用户取消
      } finally {
        confirmOverPreview.value = false
      }
    }
    const promoted = await window.trace.scratchPromote(target.path, current.vault, draftCopyDir, target.name, true)
    if (!promoted.ok || !promoted.path) {
      ElMessage.error(promoted.error ?? '草稿复制失败')
      return false
    }
    insertRel = promoted.path.replace(/\.md$/i, '')
    ElMessage.success(
      promoted.reused ? `已复用「${target.name}」的现有正式笔记` : `已复制草稿「${target.name}」为正式笔记`
    )
  } else if (target.vault !== current.vault && current.vault !== SCRATCH_VAULT) {
    // 跨库「强制引用」= 把笔记复制进当前库的专用目录（双链只在库内解析，直接插引用
    // 必然断链）。目录 = 设置「跨库引用目录」/ 源库名（按来源库分子目录：同名来源文件
    // 互不干扰、来源可辨）；重复引入相同内容自动复用已有副本（noteCopy 服务去重）。
    // 确认框文案即需求原文；设置开关「跨库引用免确认」可跳过（默认弹框）
    const copyDir = app.settings.crossVaultCopyDir?.trim() || '跨库引用'
    if (!app.settings.skipCrossVaultCopyConfirm) {
      // 置顶态（搜索框打开时预览盖在弹窗之上）需要临时让位：确认框 z 序低于置顶预览，
      // 不让位会被预览卡片盖住按钮（确认框关闭后恢复置顶）
      confirmOverPreview.value = true
      try {
        await ElMessageBox.confirm(
          `跨库文件会将笔记从原库复制到当前库的「${copyDir}」目录中（重复引入相同内容会自动复用已有副本），改变原笔记时复制内容不会同时改变，确定要强制引用吗？`,
          '跨库引用',
          { type: 'warning', confirmButtonText: '复制并引用', cancelButtonText: '取消' }
        )
      } catch {
        return false // 用户取消：保留悬浮预览，继续阅读
      } finally {
        confirmOverPreview.value = false
      }
    }
    const copied = await window.trace.crossVaultCopy(target.vault, target.path, current.vault, `${copyDir}/${target.vault}`)
    if (!copied.ok || !copied.path) {
      ElMessage.error(copied.error ?? '跨库复制失败')
      return false
    }
    insertRel = copied.path.replace(/\.md$/i, '')
    ElMessage.success(copied.reused ? `已复用现有副本「${copied.name ?? target.name}」` : `已复制「${copied.name ?? target.name}」到「${copyDir}」目录`)
  }

  // 当前是草稿（FR-2.3.9 D7 例外）：不复制，直接落引用文本，转正时再定归宿。
  // 补全活动态优先（括号语义由其处理；拖曳时补全必然不活动，走按路径插入兜底）；
  // 拖曳释放（at 存在）按 D2 口径消歧后插入
  if (opts?.at != null && current.vault !== SCRATCH_VAULT) {
    const leaf = insertRel.split('/').pop() ?? insertRel
    const candidates = await window.trace
      .resolveByNameCandidates(current.vault, leaf)
      .then((r) => r.paths)
      .catch(() => undefined)
    const insertText = preferNameInsert(candidates) ? leaf : insertRel
    editorRef.value?.insertReferenceAtPath(insertText, opts.at)
  } else {
    const inserted = editorRef.value?.insertReferenceFromCompletion()
    if (!inserted) editorRef.value?.insertReferenceAtPath(insertRel, opts?.at ?? undefined)
  }
  app.closeFloatingPreview()
  editorRef.value?.focus()
  return true
}

/** 关闭插入类弹窗（搜索 / Alt+I 面板）——「插入即关」统一语义（FR-2.9.10 ⑤ D6）的
 *  收口：拖入释放（来源弹窗且未按 Alt）与悬浮预览插入成功后调用；两个都关是无害的
 *  （未打开的那个本来就是关着的） */
function closeInsertDialogs(): void {
  searchStore.closeSearch()
  app.closeQuickRefPicker()
}

/** 拖曳插入引用（FR-2.9.10 P3）：编辑器释放笔记条目后经三路语义落引用。
 *  插入即关（D6）：来源是弹窗（搜索 / Alt+I）且释放时未按 Alt → 插入成功后关闭
 *  弹窗（单插主场景零负担；Alt 拖入 = 保留弹窗连续插入）；侧栏树 / 反向链接来源
 *  不关（没有弹窗可关）。取消拖曳不产生 drop → 天然不关。
 *  恢复拖曳类（drag-yield / drag-hide）放在 finally 与关闭决策**同一同步续体**执行：
 *  drop 接住时已抑制 dragend 的自动恢复（否则弹窗先恢复一帧再被关，闪现——2026-09-30
 *  真机反馈），这里恢复 + 关闭一次绘制直达终态 */
async function onDropNoteRef(target: NoteRefPayload, at: number | null, modifiers?: { alt?: boolean }): Promise<void> {
  try {
    const ok = await insertPreviewTarget(target, { at })
    if (ok && target.from === 'dialog' && !modifiers?.alt) closeInsertDialogs()
  } finally {
    restoreDropMasks()
  }
}

/** 快速引用面板（FR-2.9.12）：引入（三路语义收敛在 insertPreviewTarget）与预览。
 *  面板先关再动作——引入期间确认框 / 预览不再叠着面板 */
function onQuickRefInsert(target: { vault: string; path: string; name: string }): void {
  app.closeQuickRefPicker()
  void insertPreviewTarget(target)
}

function onQuickRefPreview(target: { vault: string; path: string; name: string }): void {
  // 面板保持打开（FR-2.9.10 ③ 同款语义）：继续换目标预览 / 引入，Esc 先关预览回焦面板
  app.requestNotePreview(target.vault, target.path, target.name)
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

/** 快速引入图片（FR-2.5.4）：工具栏按钮 / Ctrl+Shift+I 共用入口。
 *  主进程弹系统选择器（多选）并复制进附件目录，此处按粘贴同款格式批量插入引用 */
async function pickAndInsertImages(): Promise<void> {
  if (!editor.current) return
  const { vault, path } = editor.current
  const result = await window.trace.importImages(vault, path)
  if (!result.ok) {
    ElMessage.error(result.error ?? '引入图片失败')
    return
  }
  const images = result.images ?? []
  if (images.length === 0) return
  // 与粘贴管线同格式：![原始文件名](引用路径)，多张逐行、结尾换行（单事务一次插入）
  editorRef.value?.insertText(images.map((img) => `![${img.fileName}](${img.reference})`).join('\n') + '\n')
  ElMessage.success(`已引入 ${images.length} 张图片`)
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
    // 悬浮预览展示「别的笔记」时（搜索结果预览 / 补全预览）：内容与当前笔记没有行号对应
    // 关系，完全不绑双向同步——否则键盘滚动预览会经反向同步把正在编辑的笔记拖走（实测
    // Ctrl+Shift+E 跳预览尾部的同时编辑笔记被滚到末尾），编辑器滚动也不会抢走预览位置。
    // 展示当前笔记（Alt+P 同文一瞥）时维持原有双向同步
    if (completionPreview.value) return
    const scroller = editorWrapRef.value?.querySelector('.cm-scroller') as HTMLElement | null
    const activePreview = floatPreviewRef.value ?? previewRef.value
    const previewEl: HTMLElement | null = activePreview?.scrollElement ?? null
    if (!scroller || !previewEl) return

    const onEditorScroll = (): void => {
      if (Date.now() - syncGuard.time < 100 && syncGuard.source === 'preview') return
      // 打字机留白区（文档头部）：视口顶边落在留白内时行号映射失义——映射函数把整个留白区
      // 折算成第 1 行、比例钳 0，预览会被推到第 1 块顶部而编辑器顶边其实在留白区中间。两侧
      // 顶部留白等量（同源变量），直接按滚动坐标 1:1 传即可精确对齐
      const padTop = twPad.value.top
      if (padTop > 0 && scroller.scrollTop <= padTop) {
        syncGuard.time = Date.now()
        syncGuard.source = 'editor'
        previewEl.scrollTop = scroller.scrollTop
        return
      }
      const pos = editorRef.value?.firstVisibleLine()
      if (!pos) return
      syncGuard.time = Date.now()
      syncGuard.source = 'editor'
      activePreview?.syncToLine(pos.line, pos.ratio)
    }
    const onPreviewScroll = (): void => {
      if (Date.now() - syncGuard.time < 100 && syncGuard.source === 'editor') return
      // 编辑器方向头部区的镜像：预览顶边在留白区内时 1:1 回传（见上注释）
      const padTop = twPad.value.top
      if (padTop > 0 && previewEl.scrollTop <= padTop) {
        syncGuard.time = Date.now()
        syncGuard.source = 'preview'
        scroller.scrollTop = previewEl.scrollTop
        return
      }
      const line = activePreview?.lineAtScrollTop()
      if (line == null) return
      syncGuard.time = Date.now()
      syncGuard.source = 'preview'
      editorRef.value?.scrollToLine(line)
    }
    // 图片/媒体加载完成后按编辑器当前位置重对齐（捕获阶段监听 load）
    const onLoad = (): void => {
      const pos = editorRef.value?.firstVisibleLine()
      if (pos) activePreview?.syncToLine(pos.line, pos.ratio)
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

// ---------- 打字机留白（2026-09-27 重设计：CSS 变量的唯一写者）----------
// 数值 = 形态比例 × 滚动区高度，绑定在编辑卡 :style 的 --tw-pad-top / --tw-pad-bottom 上；
// 打字机扩展的 theme（.cm-content 的 padding 规则）与预览组件共同消费这套变量。扩展摘除
// （关）时规则被 CM 自动移除、padding 无条件回基线，本层只需把变量归零——留白清理不再
// 依赖任何 JS 时序（此前插件以内联样式直写 .cm-content、destroy() 里清理，真机上出现过
// 残留，见 2026-09-27_typewriter-padding-redesign/ 设计文档 1.1）。
const twPad = ref({ top: 0, bottom: 0 })

function updateTwPad(): void {
  const ratio = anchorRatioFor(app.effectiveTypewriterMode)
  if (ratio === null) {
    twPad.value = { top: 0, bottom: 0 }
    return
  }
  const wrap = editorWrapRef.value
  // 高度取滚动区实测值；滚动区尚未挂载（MarkdownEditor 随笔记 v-if）时用包裹层兜底——
  // .editor-cm 是 flex:1，高度由编辑卡决定、与内容无关，两者一致
  const scroller = wrap?.querySelector('.cm-scroller') as HTMLElement | null
  const height = scroller?.clientHeight || wrap?.clientHeight || 0
  if (!height) return
  twPad.value = typewriterPadding(ratio, height)
}

watch(() => app.effectiveTypewriterMode, () => updateTwPad())

let twPadRo: ResizeObserver | null = null
onMounted(() => {
  updateTwPad()
  if (typeof ResizeObserver !== 'undefined' && editorWrapRef.value) {
    // 观察常驻的包裹层：窗口缩放 / 分栏拖拽 / 心流进出（卡片变高）都会改变它；
    // MarkdownEditor 随笔记 v-if 重建也不需要重挂 RO
    twPadRo = new ResizeObserver(() => updateTwPad())
    twPadRo.observe(editorWrapRef.value)
  }
})
onBeforeUnmount(() => {
  twPadRo?.disconnect()
  twPadRo = null
})

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
  // 悬浮预览正在展示「补全预览」时，点击其中的双链改为**预览内导航**（不切走当前笔记、
  // 不收回）——心流下「顺藤摸瓜看一圈，点编辑区回来继续写」
  if (app.floatingPreview && completionPreview.value) {
    void onCompletionPreview(target)
    return
  }
  if (app.floatingPreview) app.closeFloatingPreview()
  void actions.openNote(target.vault, target.path, target.name)
}

// ---------- 心流快速查阅：补全面板 Mod+Enter 预览笔记 ----------
// 悬浮预览组件的 content prop 绑定 editor.content；预览「别的笔记」需要覆盖内容。
// 覆盖期间编辑器照常工作，悬浮预览关闭（一瞥结束）即恢复显示当前笔记。
const completionPreview = ref<{ vault: string; path: string; name: string; content: string } | null>(null)
const floatingContent = computed(() =>
  completionPreview.value ? completionPreview.value.content : editor.content
)

async function onCompletionPreview(target: { vault: string; path: string; name: string }): Promise<void> {
  const result = await window.trace.readNote(target.vault, target.path)
  if (!result.ok) {
    ElMessage.error(result.error ?? '无法读取笔记')
    return
  }
  completionPreview.value = { ...target, content: result.content ?? '' }
  app.openFloatingPreview()
}

/** 悬浮预览关闭（一瞥结束）时清除补全预览覆盖 */
watch(
  () => app.floatingPreview,
  (open) => {
    if (!open && completionPreview.value) completionPreview.value = null
  }
)

/** 悬浮预览头部的「插入引用」按钮（FR-2.9.10）与搜索框 Alt+Enter 二段插入的共用收口：
 *  把正在预览的笔记落成引用。目标是当前笔记自身时不插入（自引用无意义），仅收起预览；
 *  落引用逻辑统一走 insertPreviewTarget（库内直插 / 跨库确认后复制，FR-2.9.11）。
 *  插入成功后关闭插入类弹窗（FR-2.9.10 ⑤ D6：搜索弹窗二段插入后不再滞留——单插
 *  主场景零负担，连续插入用 Alt 拖入或重开搜索〔查询与结果保留〕） */
async function insertFromPreview(): Promise<boolean> {
  const target = completionPreview.value
  if (!target) return false
  const rel = target.path.replace(/\.md$/i, '')
  const isSelf = editor.current?.vault === target.vault && editor.current?.path.replace(/\.md$/i, '') === rel
  if (isSelf) {
    app.closeFloatingPreview()
    editorRef.value?.focus()
    return false
  }
  const ok = await insertPreviewTarget(target)
  if (ok) closeInsertDialogs()
  return ok
}

/** 悬浮预览是否正在展示跨库笔记（FR-2.9.11）：红色萤光边框 + 「跨库文件」标签 */
const previewCrossVault = computed(
  () => !!completionPreview.value && !!editor.current && completionPreview.value.vault !== editor.current.vault
)

/** 外部组件的预览请求（FR-2.9.10：搜索框 Alt+Enter 经 app store 握手到达）——
 *  先清空再消费，避免 await 期间重复触发；复用补全预览的同一条覆盖管线 */
watch(
  () => app.pendingNotePreview,
  (req) => {
    if (!req) return
    app.pendingNotePreview = null
    void onCompletionPreview(req)
  }
)

/** 外部组件的插入引用请求（FR-2.9.10 ⑤：搜索框 Alt+Enter 二段语义）——把正在预览的
 *  笔记落成引用，与悬浮预览「插入引用」按钮同一收口（insertFromPreview 自带
 *  无预览 / 自引用守卫）；计数型意图，每次到达都消费 */
watch(
  () => app.pendingNoteInsert,
  () => {
    insertFromPreview()
  }
)

/** 进入心流后编辑器可能因 wysiwyg 重配置 / 顶栏卸载失焦（用户实测：需点一下才能开始编辑）
 *  ——自动回焦。child 的 compartment 重配置发生在同一刷新周期内，nextTick 后再聚焦 */
watch(
  () => app.flowMode,
  (on) => {
    if (on) void nextTick(() => editorRef.value?.focus())
  }
)

/** 反向链接点击：打开来源笔记并定位到引用行（line 为 1 基） */
async function onBacklinkOpenNote(vault: string, path: string, line?: number): Promise<void> {
  const name = path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  await actions.openNote(vault, path, name)
  if (!line) return
  await nextTick()
  editorRef.value?.scrollToLine(line - 1, 'center')
  editorRef.value?.focus()
}

// Ctrl/Cmd+S 手动保存；Alt+P 呼出/收起悬浮预览；Esc 收起悬浮预览
// 悬浮预览键盘滚动（2026-09-27 用户反馈，FR-2.9.10 补充）：搜索结果预览等「非编辑态」
// 无法经编辑器光标 + 同步滚动让预览滚动，鼠标滚轮之外补键盘动线——
// ↑/↓ 逐屏滚动内容；Ctrl+Shift+H / Ctrl+Shift+E 跳到头部 / 尾部。
// 让位规则：焦点在编辑器内不抢（↑/↓ 是光标移动、Ctrl+Shift+H/E 是跳文件首尾的既有键位）；
// 搜索框打开时不抢（↑/↓ 归结果选择）；焦点在输入框时不抢（正常输入导航）。
const searchStore = useSearchStore()

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    // CM keymap 的 Mod-s 已走 onEditorSave（emit save）并 preventDefault——事件冒泡到此处时
    // defaultPrevented 为 true 则跳过，否则双触发两次「已保存」toast（2026-09-28 用户反馈）。
    // 本分支兜底的是「焦点在编辑器外」的场景（CM 收不到按键）
    if (e.defaultPrevented) return
    e.preventDefault()
    // 必须走 onEditorSave 的草稿分流（G4）：草稿态 Ctrl+S 是「转正」，不能落常规保存
    onEditorSave()
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    if (app.floatingPreview) app.closeFloatingPreview()
    else app.openFloatingPreview()
  }
  // Esc 的分级回退统一由 App.vue 的 onEscape 处置（唯一入口，避免一次按键退两级）

  if (app.floatingPreview && floatPreviewRef.value?.scrollElement) {
    const el = floatPreviewRef.value.scrollElement
    const focusInEditor = !!document.activeElement?.closest?.('.cm-editor')
    const key = e.key.toLowerCase()
    // 跳头部 / 尾部：Ctrl+Shift+H / E（编辑器聚焦时让位）
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (key === 'h' || key === 'e') && !focusInEditor) {
      e.preventDefault()
      el.scrollTop = key === 'h' ? 0 : el.scrollHeight
      return
    }
    // 逐屏滚动：↑/↓。让位规则：编辑器聚焦（光标移动）、「其它输入框」聚焦且搜索框未打开
    // （正常输入导航）、快速引用面板打开（面板的 ↑/↓ = 移动选中且预览内容跟随，FR-2.9.12）。
    // 搜索框打开且预览也在时 ↑/↓ 归预览——此时选结果走 Alt+↑/↓（搜索弹窗处理）
    if (
      !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
      (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
      !focusInEditor &&
      !(searchStore.visible
        ? false
        : (!!document.activeElement?.closest?.('input, textarea, [contenteditable="true"]') ||
          app.quickRefPickerOpen))
    ) {
      e.preventDefault()
      el.scrollBy({ top: e.key === 'ArrowDown' ? 72 : -72 })
    }
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
/** 运行插件工具栏按钮绑定的命令（M3 editor:toolbar 贡献点） */
async function invokePluginCommand(commandId: string): Promise<void> {
  const r = await window.trace.invokePluginCommand(commandId)
  if (!r.ok) ElMessage.error(r.error ?? '插件命令执行失败')
}

function locateCurrent(): void {
  if (!editor.current) return
  void tree.revealNode(editor.current.vault, editor.current.path, 'note')
  editorRef.value?.focus()
}

// 悬浮预览开/关后把键盘焦点交还编辑器：预览按钮与 Alt+P 都可能让焦点滞留在按钮上，
// 焦点不在编辑器则无法继续输入，「输入自动收回」也随之失效。
// 例外：搜索框打开时（Alt+Enter 预览动线）不抢焦点——焦点留在搜索框继续 ↑/↓ 选结果
watch(
  () => app.floatingPreview,
  async () => {
    await nextTick()
    if (searchStore.visible) return
    editorRef.value?.focus()
  }
)

// 搜索框关闭而悬浮预览仍在（Alt+Enter 预览后 Esc 收搜索框去阅读，FR-2.9.11 三轮反馈）：
// 焦点交给预览容器（tabindex=-1），↑/↓ / Ctrl+Shift+H/E 才能滚动预览——否则 EP 会在关窗
// 时把焦点机械还原到后面的编辑器，键盘滚动被「焦点在编辑器」让位规则挡住。
// ⚠️ EP 的焦点还原发生在 close 事件**之前**（先还焦点、后通知关闭），所以拦截器必须在
// 「预览打开且搜索框开着」时就武装，跨过关窗瞬间；拦截到还原落在编辑器 → 改道预览。
// 解除：用户点回编辑区（mousedown 先收回预览，floatingPreview 已为 false）或搜索框重开
//（重新武装是同一函数引用，addEventListener 天然幂等）
const floatPreviewEl = ref<HTMLElement | null>(null)
function onFloatFocusDivert(e: FocusEvent): void {
  // 实测时序（2026-09-27）：EP 还原焦点到编辑器发生在 close 事件之前——此刻 search.visible
  // 仍为 true，不能用「搜索框已关」做放行条件；模态开着时焦点落到编辑器只可能是关窗还原
  if (!app.floatingPreview) {
    document.removeEventListener('focusin', onFloatFocusDivert, true)
    return
  }
  if ((e.target as HTMLElement | null)?.closest?.('.cm-editor')) {
    document.removeEventListener('focusin', onFloatFocusDivert, true)
    floatPreviewEl.value?.focus()
  }
}
watch(
  () => app.floatingPreview && searchStore.visible,
  (on) => {
    if (on) document.addEventListener('focusin', onFloatFocusDivert, true)
  }
)

// 所见即所得 ↔ 分栏预览联动已移入 app store 的 setEditorWysiwyg（见该处注释）：
// 组件级 watcher 在重挂载时会丢失「进入前分栏状态」的记忆，且与心流的进入/退出互相覆盖。

// 「一次性聚焦」消费点：编辑器组件就位后执行。原在 onMounted 里消费，但「打开笔记 +
// 进入编辑视图」时 openNote（异步 IPC）晚于挂载完成，editorRef 此刻尚未绑定、聚焦静默
// 落空（Ctrl+N 草稿自动聚焦实测踩中）——改为观察 editorRef 绑定，两种时序统一收口。
watch(editorRef, (el) => {
  if (!el) return
  if (app.focusEditorOnce) {
    app.focusEditorOnce = false
    void nextTick(() => el.focus())
  }
  // Ctrl+F 在编辑器外按下（FR-2.9.11）：编辑器恰好在挂载窗口期内，绑定即消费
  if (app.pendingNoteSearch) {
    app.pendingNoteSearch = false
    void nextTick(() => {
      el.focus()
      el.openNoteSearch()
    })
  }
})

// Ctrl+F 意图消费（FR-2.9.11）：焦点在预览 / 工具栏等编辑器外时由 App.vue 全局层置位，
// 此处聚焦编辑器并打开查找/替换面板。编辑器聚焦时 CM 键位自行接管，App 层不会置位
watch(
  () => app.pendingNoteSearch,
  (v) => {
    if (!v || !editorRef.value) return
    app.pendingNoteSearch = false
    void nextTick(() => {
      editorRef.value?.focus()
      editorRef.value?.openNoteSearch()
    })
  }
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  rebindScrollSync()
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
  (visible) => {
    rebindScrollSync()
    // 预览初次出现：主动按编辑器当前可视位置同步一次。
    // 同步逻辑全在 scroll 事件里，而新挂载的预览从顶部（scrollTop=0）起步、编辑器也没滚动
    // ——双向都收不到事件，预览会停在开头（实测：编辑区滚到 80% 再开预览，预览显示 0%）。
    if (visible) syncPreviewToEditor()
  }
)
watch(
  () => app.floatingPreview,
  (open) => {
    if (!open && app.previewVisible) {
      syncPreviewToEditor(previewRef)
    } else if (open) {
      // 悬浮预览初次呼出：与分栏预览同理，主动同步一次（否则从开头显示）
      syncPreviewToEditor(floatPreviewRef)
    }
    rebindScrollSync()
  }
)

/**
 * 把指定预览（默认分栏预览）同步到编辑器当前可视行。nextTick 等待 v-if 挂载完成。
 * 必须在写预览 scrollTop 之前置位防回环 guard（source=editor）：该写入会触发预览的
 * scroll 事件 → onPreviewScroll → 编辑器 scrollToLine(此刻读到的行号) → CM 滚动——
 * 实测会把编辑器拖到完全不同的位置（预览挂载初期布局未稳，读出的行号偏差大）。
 * guard 的 100ms 窗口让这个紧随的回环事件被既有机制丢弃。
 */
function syncPreviewToEditor(
  target?: typeof previewRef | typeof floatPreviewRef
): void {
  void nextTick(() => {
    const padTop = twPad.value.top
    const scroller = editorWrapRef.value?.querySelector('.cm-scroller') as HTMLElement | null
    // 头部留白区 1:1 直传（与 onEditorScroll 同规则；编辑器停在留白区内时行号映射失义）
    if (padTop > 0 && scroller && scroller.scrollTop <= padTop) {
      const active = target?.value ?? previewRef.value
      if (active?.scrollElement) {
        syncGuard.time = Date.now()
        syncGuard.source = 'editor'
        active.scrollElement.scrollTop = scroller.scrollTop
        return
      }
    }
    const pos = editorRef.value?.firstVisibleLine()
    if (!pos) return
    syncGuard.time = Date.now()
    syncGuard.source = 'editor'
    ;(target?.value ?? previewRef.value)?.syncToLine(pos.line, pos.ratio)
  })
}

const vaultName = computed(() => editor.current?.vault ?? '')
const vaultGit = computed(() => (vaultName.value ? tree.gitStatuses[vaultName.value] : null))

watch(
  () => editor.current?.path,
  async () => {
    // 切换笔记：一瞥结束（新笔记内容未读过，留着只会误导）
    if (app.floatingPreview) app.closeFloatingPreview()
    await nextTick()
    if (previewRef.value?.scrollElement) previewRef.value.scrollElement.scrollTop = 0
    // 新笔记的编辑器按「编辑位置」设置落位（可能直接在文末），预览跟随一次，
    // 避免停在开头等第一次滚动才对齐
    syncPreviewToEditor()
  }
)

// ---------- 专注隐藏顶栏：热区触发 + 延迟隐藏 ----------
// 顶栏隐藏时被 overflow:hidden 裁剪，卡片 :hover 无法稳定覆盖「隐藏的顶栏 + 移动路径」，
// 改为显式热区（卡片顶部横条）与顶栏自身的 mouseenter/mleave 控制，离开后留 300ms 缓冲
// 顶栏隐藏形态判定收口在 app store 的 topbarConcealed（状态区显示 / 模式切换提示共用）
const concealed = computed(() => app.topbarConcealed)

// ---------- 心流模式：保存指示（FR-F5）----------
// 数据源全部复用 editor store，不新增状态机：
// 有未保存变更 → 微弱可见；保存中 → 脉冲；保存成功 → 一次闪烁；失败 / 外部冲突 → 红色常亮
type SaveDotState = '' | 'dirty' | 'saving' | 'saved' | 'error'
const justSaved = ref(false)
let justSavedTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => editor.lastSavedAt,
  (v, prev) => {
    if (!v || v === prev) return
    justSaved.value = true
    if (justSavedTimer) clearTimeout(justSavedTimer)
    justSavedTimer = setTimeout(() => (justSaved.value = false), 700)
  }
)
onBeforeUnmount(() => {
  if (justSavedTimer) clearTimeout(justSavedTimer)
})

const saveDotState = computed<SaveDotState>(() => {
  if (editor.externalChanged || editor.saveFailed) return 'error'
  if (editor.saving) return 'saving'
  if (justSaved.value) return 'saved'
  if (editor.dirty) return 'dirty'
  return ''
})
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
    :class="{
      'zen-concealed': concealed,
      peeking: topbarPeek,
      'flow-mode': app.flowMode,
      'flow-paper-on': app.flowMode && app.settings.flowPaperEnabled,
      'flow-paper-fade': app.flowMode && app.settings.flowPaperEnabled && app.settings.flowPaperFade,
      'flow-paper-tex-parchment': app.flowMode && app.settings.flowPaperEnabled && app.settings.flowPaperTexture === 'parchment',
      'flow-paper-tex-fiber': app.flowMode && app.settings.flowPaperEnabled && app.settings.flowPaperTexture === 'fiber'
    }"
    :style="{
      flexBasis: app.previewVisible ? (app.zenMode ? '50%' : `${splitPercent}%`) : '100%',
      '--flow-measure': `${app.flowMeasure}em`,
      '--flow-paper': `var(--flow-paper-${app.settings.flowPaperColor})`,
      '--tw-pad-top': `${twPad.top}px`,
      '--tw-pad-bottom': `${twPad.bottom}px`
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
          <span>{{ scratchVaultLabel(editor.current.vault) }}</span>
          <template v-for="(part, i) in pathParts.slice(0, -1)" :key="i">
            <span style="color: var(--text-tertiary)">/</span>
            <span>{{ part }}</span>
          </template>
          <span style="color: var(--text-tertiary)">/</span>
          <span class="crumb-current">{{ editor.current.name }}</span>
          <span v-if="editor.dirty" class="dirty-dot" title="未保存（自动保存已开启）"></span>
        </template>
        <!-- 新版本轻量入口（FR-2.10.6）：发现新版本时常驻显示，点击打开 Release 页（更新说明 + 下载） -->
        <a
          v-if="app.updateInfo?.ok && app.updateInfo.available"
          class="update-entry"
          :href="app.updateInfo.releaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          :title="`新版本 v${app.updateInfo.latestVersion} 可用，点击查看更新说明与下载`"
        >有更新 v{{ app.updateInfo.latestVersion }}</a>
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

      <TipButton v-if="!isScratchNote" tip="在侧栏中定位当前笔记" @click="locateCurrent">
        <el-icon><Aim /></el-icon>
      </TipButton>

      <span class="toolbar-sep"></span>
      <el-tooltip
        :content="app.editorWysiwyg ? '所见即所得（预览已合并进编辑区，Ctrl+E 切回源码）' : '点击：显示/隐藏预览；长按或 Alt+P：悬浮预览'"
        placement="bottom"
        :hide-after="0"
      >
        <button
          class="tool-btn"
          :class="{ 'tool-dimmed': app.editorWysiwyg }"
          @pointerdown="onPreviewBtnDown"
          @pointerup="onPreviewBtnUp"
          @pointerleave="onPreviewBtnLeave"
        >
          <el-icon><Expand v-if="!app.previewVisible && !app.floatingPreview" /><Fold v-else /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="打字机模式：关 → 高位 → 低位 循环（Alt+T）" placement="bottom" :hide-after="0">
        <button
          class="tool-btn"
          :class="{ 'flow-on': app.settings.typewriterMode !== 'off' }"
          :title="app.settings.typewriterMode === 'center' ? '打字机：高位' : app.settings.typewriterMode === 'bottom' ? '打字机：低位' : '打字机：关'"
          @click="app.toggleTypewriter(); editorRef?.focus()"
        >
          <!-- 字母 T 代替图标：Aim 与「定位笔记」的十字准星图标重复（用户实测反馈）；
               ↑ / ↓ 角标区分高位（锚点垂直居中）与低位（锚点靠下），关为纯 T（2026-09-28） -->
          <span class="tw-letter">T<span v-if="app.settings.typewriterMode !== 'off'" class="tw-arrow">{{ app.settings.typewriterMode === 'center' ? '↑' : '↓' }}</span></span>
        </button>
      </el-tooltip>
      <el-tooltip content="Vim 编辑模式（Alt+M 切换）：开启后编辑器支持 normal / insert / visual 键位" placement="bottom" :hide-after="0">
        <button
          class="tool-btn"
          :class="{ 'flow-on': app.settings.vimEnabled }"
          :title="app.settings.vimEnabled ? 'Vim 模式：开' : 'Vim 模式：关'"
          @click="app.toggleVim(); editorRef?.focus()"
        >
          <!-- 字母 V 状态标志：与打字机 T 同款字母标识，激活时 accent 高亮（2026-09-28） -->
          <span class="tw-letter">V</span>
        </button>
      </el-tooltip>
      <el-tooltip content="所见即所得编辑（Ctrl+E 切换）" placement="bottom" :hide-after="0">
        <button
          class="tool-btn"
          :class="{ 'wysiwyg-on': app.editorWysiwyg }"
          @click="app.toggleEditorMode(); editorRef?.focus()"
        >
          <el-icon><MagicStick /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip
        :content="app.flowMode ? '退出心流模式 (Alt+W)' : '心流模式：沉浸创作 (Alt+W)'"
        placement="bottom"
      >
        <button
          class="tool-btn"
          :class="{ 'flow-on': app.flowMode }"
          @click="app.toggleFlow(); editorRef?.focus()"
        >
          <el-icon><Coffee /></el-icon>
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
      <!-- 标题层级：一级 ~ 六级 + 清除（触发器不用 el-tooltip 包裹，原生 title） -->
      <el-dropdown trigger="click" popper-class="dd-instant-hide" @command="(lv: HeadingLevel) => editorRef?.setHeading(lv)">
        <button class="tool-btn" type="button" title="标题层级 (Ctrl+1~6，Ctrl+0 清除)">H</button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item :command="1">一级标题<span class="dd-keys">Ctrl+1</span></el-dropdown-item>
            <el-dropdown-item :command="2">二级标题<span class="dd-keys">Ctrl+2</span></el-dropdown-item>
            <el-dropdown-item :command="3">三级标题<span class="dd-keys">Ctrl+3</span></el-dropdown-item>
            <el-dropdown-item :command="4">四级标题<span class="dd-keys">Ctrl+4</span></el-dropdown-item>
            <el-dropdown-item :command="5">五级标题<span class="dd-keys">Ctrl+5</span></el-dropdown-item>
            <el-dropdown-item :command="6">六级标题<span class="dd-keys">Ctrl+6</span></el-dropdown-item>
            <el-dropdown-item :command="0" divided>清除标题<span class="dd-keys">Ctrl+0</span></el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
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
      <TipButton tip="引入图片 (Ctrl+Shift+I)" @click="pickAndInsertImages">
        <el-icon><Picture /></el-icon>
      </TipButton>
      <TipButton tip="表格 (Ctrl+T)" @click="editorRef?.beginTablePrompt()">
        <el-icon><Grid /></el-icon>
      </TipButton>
      <TipButton tip="行内公式" @click="toolbarInsert('$', '$')">
        ∑
      </TipButton>
      <TipButton tip="公式块" @click="toolbarInsert('\n$$\n', '\n$$\n')">
        ∫
      </TipButton>
      <!-- 清理不可见字符（FR-2.4.25，用户指定位置：公式块右侧）：网页粘贴夹带的 NBSP
           会让任务行在预览与所见即所得中双双失效，存量笔记 / Gist 发布前经此一键归一 -->
      <TipButton tip="清理不可见字符（NBSP→空格、零宽→删除）" @click="editorRef?.cleanInvisibleChars()">
        <el-icon><Brush /></el-icon>
      </TipButton>
    <template v-if="app.pluginToolbars.length">
      <span class="toolbar-sep"></span>
      <TipButton v-for="btn in app.pluginToolbars" :key="btn.command" :tip="`${btn.title}（${btn.pluginId}）`" @click="invokePluginCommand(btn.command)">
        <span style="font-size: 13px">{{ btn.icon }}</span>
      </TipButton>
    </template>
    <!-- Vim 模式徽标（FR-2.4.23）：工具栏右端，仅 vim 开启时显示；
         配色按模式区分——normal 中性 / insert accent 描边 / visual accent 底 -->
    <span v-if="editor.vimMode" class="vim-badge" :class="`vim-${editor.vimMode.split(' ')[0]}`">
      {{ formatVimModeLabel(editor.vimMode) }}
    </span>
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

    <!-- 顶栏隐藏时（专注隐藏顶栏 / 心流）：右下角长条形状态区。
         有底色与圆角以区别于正文；编辑模式四图标（打字机 / 所见即所得 / 心流 / 专注），
         各自激活时 accent 高亮；保存状态小圆点在胶囊**外**右侧（2026-09-27 用户要求：
         圆点静置时隐去，若留在胶囊内会让胶囊右侧空一块；git 信息已从状态区移除）；
         悬停唤出顶栏时整体淡出 -->
    <div v-if="concealed" class="zen-status-wrap" :class="{ peeking: topbarPeek }">
      <div class="zen-status-area">
      <!-- 编辑模式四图标：打字机（字母 T——Aim 与定位图标重复）/ 所见即所得（魔法棒）/
           心流（咖啡杯）/ 专注（全屏）；
           各自激活时 accent 高亮——从顶栏隐藏后仍能确认当前处于哪些模式 -->
      <span
        class="zen-status-mode tw-letter"
        :class="{ 'mode-on': app.effectiveTypewriterMode !== 'off' }"
        :title="`打字机模式：${app.effectiveTypewriterMode === 'center' ? '高位' : app.effectiveTypewriterMode === 'bottom' ? '低位' : '关'}`"
      >
        T<span v-if="app.effectiveTypewriterMode !== 'off'" class="tw-arrow">{{ app.effectiveTypewriterMode === 'center' ? '↑' : '↓' }}</span>
      </span>
      <!-- Vim 状态标志：心流 / 专注（顶栏隐藏）下确认 Vim 是否开启（Vim + 心流是自然组合） -->
      <span
        class="zen-status-mode tw-letter"
        :class="{ 'mode-on': app.settings.vimEnabled }"
        :title="app.settings.vimEnabled ? 'Vim 模式：开' : 'Vim 模式：关'"
      >
        V
      </span>
      <el-icon
        class="zen-status-mode"
        :class="{ 'mode-on': app.editorWysiwyg }"
        :title="app.editorWysiwyg ? '所见即所得：开' : '所见即所得：关'"
      >
        <MagicStick />
      </el-icon>
      <el-icon
        class="zen-status-mode"
        :class="{ 'mode-on': app.flowMode }"
        :title="app.flowMode ? '心流模式：开' : '心流模式：关'"
      >
        <Coffee />
      </el-icon>
      <el-icon
        class="zen-status-mode"
        :class="{ 'mode-on': app.zenMode }"
        :title="app.zenMode ? '专注模式：开' : '专注模式：关'"
      >
        <FullScreen />
      </el-icon>
      </div>
      <!-- 保存状态小圆点：胶囊外右侧（静置隐去，出现时才可见） -->
      <span class="zen-status-dot" :class="saveDotState" title=""></span>
    </div>

    <!-- 表格尺寸输入浮层（FR-2.4.20）：跟随光标，实时回显将插入的行列数 -->
    <TablePromptHud />

    <!-- 快速引用面板（FR-2.9.12）：Alt+I / /引入 呼出，目录树（含草稿分组）选笔记插入引用 -->
    <QuickRefPicker
      :visible="app.quickRefPickerOpen"
      :vault="editor.current?.vault ?? ''"
      :current-path="editor.current?.path ?? ''"
      @close="app.closeQuickRefPicker(); editorRef?.focus()"
      @insert="onQuickRefInsert"
      @preview="onQuickRefPreview"
    />

    <!-- 模式切换提示：屏幕居中大字号（顶栏隐藏时切换所见即所得，右下角图标被动高亮不够直观）。
         Teleport 到 body：fixed 居中不受编辑卡 overflow / 祖先 transform 影响；不拦截鼠标 -->
    <Teleport to="body">
      <Transition name="mode-toast">
        <div v-if="app.modeToastText" class="mode-toast">{{ app.modeToastText }}</div>
      </Transition>
    </Teleport>

    <!-- 编辑器主体（填满卡片剩余空间）；点回编辑区 = 一瞥结束 -->
    <div ref="editorWrapRef" class="editor-cm" @mousedown="onEditorBodyMousedown">
      <MarkdownEditor
        v-if="editor.current"
        ref="editorRef"
        :model-value="editor.content"
        :font-size="app.settings.editorFontSize"
        :typewriter-mode="app.effectiveTypewriterMode"
        :return-sound="{
          enabled: app.flowMode && app.settings.flowSoundEnabled,
          volume: app.settings.flowSoundVolume,
          variant: app.settings.flowSoundVariant,
          skipRepeat: app.settings.flowSoundSkipRepeat
        }"
        :vault="editor.current.vault"
        :note-path="editor.current.path"
        :wysiwyg="app.editorWysiwyg"
        :vim-enabled="app.settings.vimEnabled"
        :preview-target="completionPreview"
        @update:model-value="onEditorUpdate"
        @save="onEditorSave"
        @preview-note="onCompletionPreview"
        @insert-cross-vault="(t: { vault: string; path: string; name: string }) => void insertPreviewTarget(t)"
        @drop-note-ref="onDropNoteRef"
        @image="(name: string, b64: string) => onImage(name, b64)"
        @pick-image="pickAndInsertImages"
        @open-note="onPreviewOpenNote"
      />
    </div>

    <!-- 反向链接悬浮入口（编辑卡右下角，受「在编辑区显示反向链接」设置控制） -->
    <BacklinkPanel
      :visible="!!editor.current && app.settings.sidebarMenus.unresolved && app.settings.showBacklinks"
      :vault="editor.current?.vault ?? ''"
      :note-path="editor.current?.path ?? ''"
      :lifted="concealed"
      @open-note="onBacklinkOpenNote"
    />
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
      link-action="preview"
      :font-size="app.settings.editorFontSize"
      :typewriter-pad-top="twPad.top"
      :typewriter-pad-bottom="twPad.bottom"
      @open-note="onPreviewOpenNote"
      @preview-note="(t: { vault: string; path: string; name: string }) => app.requestNotePreview(t.vault, t.path, t.name)"
    />
  </div>

  <!-- 悬浮预览（长按预览按钮呼出，Esc 或关闭按钮收起）；跨库预览态加红色萤光边框（FR-2.9.11）。
       tabindex=-1：搜索框关闭而预览仍在时焦点落在这里（见下方 watch），↑/↓ / Ctrl+Shift+H/E 键盘滚动才不被「焦点在编辑器」让位规则挡住 -->
  <Transition name="float-preview">
    <div
      v-if="app.floatingPreview"
      ref="floatPreviewEl"
      class="floating-preview"
      :class="{ 'cross-vault': previewCrossVault, 'above-search': (searchStore.visible || app.quickRefPickerOpen) && !confirmOverPreview }"
      tabindex="-1"
    >
        <div class="floating-preview-header">
          <span class="floating-preview-title">
            {{ completionPreview ? `预览：${completionPreview.name}` : '预览' }}
            <span v-if="previewCrossVault" class="cross-vault-badge">跨库文件</span>
          </span>
          <span class="floating-preview-actions">
            <!-- 补全预览态：把正在预览的笔记落成引用（与编辑器内 Alt+Enter 同效） -->
            <button
              v-if="completionPreview"
              class="tool-btn"
              title="插入引用（Alt+Enter）"
              @click="insertFromPreview"
            >
              <el-icon><DocumentAdd /></el-icon>
            </button>
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
          ref="floatPreviewRef"
          v-if="editor.current"
          :content="floatingContent"
          :vault="vaultName"
          :note-path="editor.current.path"
          :font-size="app.settings.editorFontSize"
          :typewriter-pad-top="completionPreview ? 0 : twPad.top"
          :typewriter-pad-bottom="completionPreview ? 0 : twPad.bottom"
          @open-note="onPreviewOpenNote"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Vim 模式徽标（FR-2.4.23）：等宽小胶囊，仅 vim 开启时渲染；模式配色——
   normal 中性灰 / insert accent 描边 / visual accent 底（文字用 bg-primary 保证两主题对比度） */
.vim-badge {
  margin-left: auto;
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  background: var(--bg-hover);
  user-select: none;
}

.vim-badge.vim-insert {
  border-color: var(--accent);
  color: var(--accent);
  background: transparent;
}

.vim-badge.vim-visual {
  border-color: var(--accent);
  color: var(--bg-primary);
  background: var(--accent);
}

/* 打字机的字母 T 标识：与图标尺寸一致、加粗与图标视觉重量对齐（顶栏按钮 + 状态区共用） */
.tw-letter {
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

/* 高位 / 低位角标：小一号上标箭头（↑ 高位 / ↓ 低位），与 T 的视觉重量区分 */
.tw-arrow {
  font-size: 9px;
  font-weight: 700;
  vertical-align: super;
  margin-left: 1px;
}

.editor-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative; /* 反向链接悬浮入口的定位锚 */
  background: var(--bg-primary);
  border-radius: 8px;
  overflow: hidden;
  /* 编辑区至少 480px（约 40 字/行），窗口再窄也不压缩到无法编辑 */
  min-width: 480px;
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
  /* 预览区至少 280px，保留最小可读宽度 */
  min-width: 280px;
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

/* 程序化聚焦的容器（搜索框关闭后承接键盘滚动焦点）：不显示焦点环 */
.floating-preview:focus {
  outline: none;
}

/* 搜索框 / 快速引用面板打开期间的置顶态（FR-2.9.10 ③ 二次变更 + FR-2.9.12）：悬浮预览要
   盖在模态遮罩之上正常显示（EP 弹窗 z 序从 2000 起按次递增，3000 稳定高于任何会话内的
   弹窗计数，与 mode-toast 同级、DOM 靠后故提示条仍在其上）。跨库引用确认框打开期间临时
   让位（above-search 类摘除），否则确认框会被置顶预览盖住 */
.floating-preview.above-search {
  z-index: 3000;
}

.floating-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 14px;
  border-bottom: 1px solid var(--border-color);
}

/* 跨库预览态（FR-2.9.11）：红色萤光细边框警示——落引用会触发「复制到当前库」确认 */
.floating-preview.cross-vault {
  box-shadow:
    0 0 0 1.5px var(--danger),
    0 0 16px color-mix(in srgb, var(--danger) 40%, transparent),
    0 12px 40px rgba(0, 0, 0, 0.18);
}

.cross-vault-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  vertical-align: 1px;
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

/* 模式切换提示：屏幕居中，字号 / 内边距约为原 ElMessage 的 2 倍；
   浅绿底色 60% 不透明（--success-bg），文字用与底色同系的中深绿；不拦截鼠标 */
.mode-toast {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 3000;
  padding: 18px 38px;
  border-radius: 12px;
  background: var(--success-bg);
  color: var(--success-text);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.05em;
  white-space: nowrap;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  pointer-events: none;
}

.mode-toast-enter-active,
.mode-toast-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

/* 过渡前后保留居中位移，只做淡入淡出 + 轻微缩放 */
.mode-toast-enter-from,
.mode-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.94);
}
</style>
