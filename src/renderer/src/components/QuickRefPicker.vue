<template>
  <!-- close-on-press-escape 动态：预览开着时禁用 EP 内建 Esc 关面板（它在 dialog 元素上
       监听真实按键，会与本组件 window 级 Esc 分级「先关预览」同击双关——2026-09-29 用户
       实测反馈）；预览关后恢复内建关闭（与组件显式关闭幂等） -->
  <el-dialog
    :model-value="visible"
    title="插入引用"
    width="500px"
    :close-on-click-modal="false"
    :close-on-press-escape="!app.floatingPreview"
    append-to-body
    class="quick-ref-dialog"
    @update:model-value="(v: boolean) => !v && emit('close')"
    @open="onOpen"
    @opened="onOpened"
  >
    <div class="qr-container">
      <div class="qr-vault-row">
        <span class="qr-vault-label">库</span>
        <el-select v-model="selectedVault" size="small" class="qr-vault-select" @change="switchVault">
          <el-option v-for="v in realVaults" :key="v" :label="v === props.vault ? `${v}（当前）` : v" :value="v" />
        </el-select>
        <span v-if="selectedVault !== props.vault" class="qr-cross-hint">跨库引入将复制为当前库副本（确认后）</span>
      </div>
      <el-input
        ref="inputRef"
        v-model="query"
        placeholder="过滤笔记名（留空 = 浏览目录树）"
        clearable
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <div ref="listRef" class="qr-list">
        <div v-if="treeLoading" class="qr-empty">加载目录树…</div>
        <template v-else>
          <div
            v-for="(item, i) in items"
            :key="item.key"
            :data-idx="i"
            class="qr-row"
            :class="{ 'qr-hl': i === hl, 'qr-header': item.kind === 'header', 'qr-dir': item.kind === 'dir' }"
            :style="{ paddingLeft: 10 + item.depth * 16 + 'px' }"
            :draggable="item.kind === 'note' || item.kind === 'draft'"
            @click="onRowClick(item, i)"
            @dragstart="onRowDragStart($event, item)"
          >
            <template v-if="item.kind === 'header'">
              <span class="qr-header-text">{{ item.name }}</span>
            </template>
            <template v-else>
              <span v-if="item.kind === 'dir'" class="qr-caret">{{ expanded.has(item.rel) ? '▾' : '▸' }}</span>
              <el-icon v-else class="qr-icon"><Document /></el-icon>
              <span class="qr-name" :class="{ 'qr-draft-name': item.kind === 'draft' }">{{ item.name }}</span>
              <span v-if="item.detail" class="qr-detail">{{ item.detail }}</span>
              <span v-if="item.kind === 'draft' && item.mtime" class="qr-detail">{{ formatRelativeTime(new Date(item.mtime).toISOString()) }}</span>
            </template>
          </div>
          <div v-if="items.length === 0" class="qr-empty">无匹配笔记</div>
        </template>
      </div>
      <div class="qr-footer">
        <span>Enter 引入</span>
        <span>Alt+Enter 预览</span>
        <span>→ / ← 展开 / 收起</span>
        <span>Ctrl+← / → 切库</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 快速引用面板（FR-2.9.12）：目录树（含草稿分组）+ 过滤态扁平匹配，键盘优先动线，
 * 选中即把笔记以 [[引用]] 插入编辑器光标处（不切换当前笔记）。
 * 引入分两路交给父层（EditorView）：当前库直插（insertReferenceAtPath）；跨库 / 草稿
 * 走 insertPreviewTarget（确认复制语义）。键盘模型照抄搜索弹窗（窗口级 keydown +
 * 焦点常驻过滤输入框）；Esc 归 el-dialog 内建（hasModalOpen 让位链自动生效）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Document, Search } from '@element-plus/icons-vue'
import type { TreeNode } from '@shared/types'
import { SCRATCH_VAULT } from '@shared/types'
import { noteDisplayName } from '@shared/validate'
import { collectNotes, flatNoteOptions, type NoteTreeNode } from '../lib/noteCompletion'
import { filterDrafts, flattenVisibleTree, locateNote, type PickerItem } from '../lib/quickRef'
import { beginNoteRefDrag } from '../lib/dragDrop'
import { formatRelativeTime } from '../lib/relativeTime'
import { useTreeStore } from '../stores/tree'
import { useDraftStore } from '../stores/draft'
import { useAppStore } from '../stores/app'

const props = defineProps<{
  visible: boolean
  /** 当前笔记所在库（默认选中；2026-09-30 起面板可切换浏览其他库——跨库引入自动走确认复制） */
  vault: string
  /** 当前笔记完整路径（无则不落位），如 `日记/2026-09-29.md` */
  currentPath: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** 引入：vault 为当前库 = 直插；跨库 / 草稿 = EditorView 走确认复制 */
  (e: 'insert', target: { vault: string; path: string; name: string; rel: string }): void
  /** Alt+Enter：以悬浮预览查看（面板保持打开——FR-2.9.10 ③ 搜索弹窗同款语义，预览内容
   *  随选中项自动跟随，Esc 先关预览回焦面板） */
  (e: 'preview', target: { vault: string; path: string; name: string }): void
}>()

const tree = useTreeStore()
const draft = useDraftStore()
const app = useAppStore()

const query = ref('')
const inputRef = ref<{ focus: () => void } | null>(null)
/** 当前浏览的库（FR-2.9.12 跨库扩展，2026-09-30 待办 #14）：默认 = 当前笔记所在库，
 *  可切换浏览其他库（跨库引入自动走确认复制管线）。草稿分组与库无关，恒显示 */
const selectedVault = ref(props.vault)
const realVaults = computed(() => tree.vaults.map((v) => v.name))
const listRef = ref<HTMLElement | null>(null)
const hl = ref(-1)
const treeLoading = ref(false)
/** 本面板独立的目录展开状态（与侧栏互不影响） */
const expanded = ref<Set<string>>(new Set())

interface RowItem extends PickerItem {
  key: string
  detail?: string
}

const currentRel = computed(() => props.currentPath.replace(/\.md$/i, ''))
const treeNodes = computed<NoteTreeNode[]>(() => (tree.trees[selectedVault.value] ?? []) as TreeNode[])

/** 视图序列：过滤空 = 树形态（展开可见的目录 + 笔记 + 草稿分组）；非空 = 扁平命中列表 */
const items = computed<RowItem[]>(() => {
  if (!query.value.trim()) {
    const rows: RowItem[] = flattenVisibleTree(treeNodes.value, expanded.value).map((it) => ({
      ...it,
      key: `${it.kind}:${it.rel}`
    }))
    if (draft.drafts.length) {
      rows.push({ kind: 'header', name: '草稿（不进同步与双链，引入时复制为正式笔记）', rel: '', depth: 0, key: 'header:drafts' })
      for (const d of draft.drafts) {
        rows.push({
          kind: 'draft',
          name: noteDisplayName(d.name),
          rel: noteDisplayName(d.name),
          depth: 0,
          mtime: d.mtime,
          key: `draft:${d.name}`
        })
      }
    }
    return rows
  }
  const q = query.value.trim()
  const excludeRel = selectedVault.value === props.vault ? currentRel.value : ''
  const notes = flatNoteOptions(collectNotes(treeNodes.value), q, excludeRel).map((o) => ({
    kind: 'note' as const,
    name: o.label,
    rel: o.notePath ?? o.label,
    depth: 0,
    detail: o.detail,
    key: `note:${o.notePath ?? o.label}`
  }))
  const drafts = filterDrafts(draft.drafts, q).map((d) => ({
    kind: 'draft' as const,
    name: noteDisplayName(d.name),
    rel: noteDisplayName(d.name),
    depth: 0,
    mtime: d.mtime,
    detail: '草稿',
    key: `draft:${d.name}`
  }))
  return [...notes, ...drafts]
})

/** 光标可停留的行（分组标题跳过） */
function selectable(item: RowItem | undefined): boolean {
  return item?.kind !== 'header'
}

function move(delta: number): void {
  if (items.value.length === 0) return
  let i = hl.value
  for (let step = 0; step < items.value.length; step++) {
    i += delta
    if (i < 0 || i >= items.value.length) return
    if (selectable(items.value[i])) {
      hl.value = i
      return
    }
  }
}

/** 高亮变更滚动到可视区（最近位置，不整屏跳） */
watch(hl, () => {
  void nextTick(() => {
    listRef.value?.querySelector(`[data-idx="${hl.value}"]`)?.scrollIntoView({ block: 'nearest' })
  })
})

/** 当前高亮的目标（无高亮 / 标题行 = null） */
function currentTarget(): RowItem | null {
  const item = items.value[hl.value]
  if (!item || item.kind === 'header') return null
  return item
}

function targetOf(item: RowItem): { vault: string; path: string; name: string; rel: string } {
  if (item.kind === 'draft') {
    return { vault: SCRATCH_VAULT, path: `${item.rel}.md`, name: item.name, rel: item.rel }
  }
  // 跨库浏览（2026-09-30 待办 #14）：目标库 = 当前浏览的库；引入经 EditorView 的
  // insertPreviewTarget——跨库目标自动弹「确认 → 复制进当前库」管线
  return { vault: selectedVault.value, path: `${item.rel}.md`, name: item.name, rel: item.rel }
}

/** 拖曳插入引用（FR-2.9.10 P3）：笔记 / 草稿行可拖（目录 / 分组标题不可），
 *  载荷与「引入」emit 同源（targetOf）；from: 'dialog' = 插入成功后默认关闭面板
 *  （Alt 拖入保留，与键盘 Enter 插入即关一致）。遮罩让行 / 弹窗隐藏 / 恢复由
 *  beginNoteRefDrag 内部统一处理 */
function onRowDragStart(e: DragEvent, item: RowItem): void {
  if (item.kind === 'dir' || item.kind === 'header') return
  const t = targetOf(item)
  beginNoteRefDrag(e, { vault: t.vault, path: t.path, name: t.name, from: 'dialog' })
}

function toggleDir(rel: string): void {
  const next = new Set(expanded.value)
  if (next.has(rel)) next.delete(rel)
  else next.add(rel)
  expanded.value = next
}

/** 引入当前高亮项（Enter / 单击共用）：目录行 = 切换展开 */
function insertCurrent(item: RowItem | null = currentTarget()): void {
  if (!item) return
  if (item.kind === 'dir') {
    toggleDir(item.rel)
    return
  }
  emit('insert', targetOf(item))
}

/** Alt+Enter：悬浮预览（面板**保持打开**——FR-2.9.10 ③ 搜索弹窗同款语义；预览内容
 *  随选中项自动跟随，Esc 先关预览回焦面板再定去留） */
function previewCurrent(): void {
  const item = currentTarget()
  if (!item || item.kind === 'dir') return
  const t = targetOf(item)
  emit('preview', { vault: t.vault, path: t.path, name: t.name })
}

// ---------- 键盘（窗口级，面板可见时生效；焦点常驻过滤输入框，动线不依赖焦点位置） ----------
function onKeydown(e: KeyboardEvent): void {
  if (!props.visible) return
  // Element Plus 下拉 / 消息框打开时让位（跨库确认框期间 Enter/方向键归它们）
  if (document.querySelector('.el-overlay.is-message-box, .el-message-box')) return
  if ((e.target as HTMLElement | null)?.closest?.('.el-dropdown-menu, .el-popper')) return
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'Enter' && !e.repeat) {
      e.preventDefault()
      // 两段语义（与 [[ 补全预览态的「再按落引用」一致，FR-2.9.10）：预览未开 = 先预览
      // （面板保持，↑/↓ 换目标预览跟随）；预览开着 = 把当前选中笔记插入为引用
      if (app.floatingPreview) insertCurrent()
      else previewCurrent()
    }
    return
  }
  // Ctrl+← / →：切换浏览的库（跨库扩展，2026-09-30 待办 #14）——循环切换，树按需加载
  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    if (realVaults.value.length < 2) return
    e.preventDefault()
    const i = realVaults.value.indexOf(selectedVault.value)
    const next = realVaults.value[(i + (e.key === 'ArrowRight' ? 1 : realVaults.value.length - 1)) % realVaults.value.length]
    void switchVault(next)
    return
  }
  if (e.ctrlKey || e.metaKey || e.shiftKey) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
    followPreview()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
    followPreview()
  } else if (e.key === 'ArrowRight') {
    const item = currentTarget()
    if (item?.kind === 'dir' && !expanded.value.has(item.rel)) {
      e.preventDefault()
      toggleDir(item.rel)
    }
  } else if (e.key === 'ArrowLeft') {
    const item = currentTarget()
    if (!item) return
    if (item.kind === 'dir' && expanded.value.has(item.rel)) {
      e.preventDefault()
      toggleDir(item.rel)
    } else if (item.depth > 0) {
      // 笔记 / 深层项：高亮跳到最近的可展开祖先文件夹
      e.preventDefault()
      const prefix = item.rel.includes('/') ? item.rel.slice(0, item.rel.lastIndexOf('/')) : null
      if (prefix) {
        const idx = items.value.findIndex((it) => it.kind === 'dir' && it.rel === prefix)
        if (idx >= 0) hl.value = idx
      }
    }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    insertCurrent()
  } else if (e.key === 'Escape') {
    // 分级消费（与 App.vue onEscape 的浮层顺序一致）：悬浮预览开着时 Esc 先关预览
    // 并回焦过滤框（继续换目标预览 / 引入），再按才关面板；幂等——el-dialog 内建
    // close-on-press-escape 监听在 document 层且依赖焦点，这里收口保证任何焦点可关
    e.preventDefault()
    if (app.floatingPreview) {
      app.closeFloatingPreview()
      void nextTick(() => inputRef.value?.focus())
      return
    }
    emit('close')
  }
}

/** 预览跟随（搜索弹窗 Alt+↑/↓ 同款）：悬浮预览开着时移动高亮 = 预览内容切换 */
function followPreview(): void {
  if (app.floatingPreview) previewCurrent()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/** 切换浏览的库（下拉 / Ctrl+←/→ 共用）：重置展开态与高亮，树按需加载 */
async function switchVault(vault: string): Promise<void> {
  if (vault === selectedVault.value) return
  selectedVault.value = vault
  query.value = ''
  expanded.value = new Set()
  hl.value = -1
  if (!tree.trees[vault]) {
    treeLoading.value = true
    try {
      await tree.loadTree(vault)
    } finally {
      treeLoading.value = false
    }
  }
  hl.value = items.value.findIndex((it) => selectable(it))
}

/** 面板打开：重置过滤与高亮 → 确保树 / 草稿数据就绪 → 落位当前笔记（D5）。
 *  跨库扩展（2026-09-30 待办 #14）：浏览库重置为当前笔记所在库（草稿态 = 第一个真实库） */
async function onOpen(): Promise<void> {
  query.value = ''
  hl.value = -1
  expanded.value = new Set()
  void draft.refresh()
  selectedVault.value =
    props.vault === SCRATCH_VAULT ? realVaults.value[0] ?? props.vault : props.vault
  if (!tree.trees[selectedVault.value]) {
    treeLoading.value = true
    try {
      await tree.loadTree(selectedVault.value)
    } finally {
      treeLoading.value = false
    }
  }
  // 落位：展开当前笔记的祖先目录并高亮（仅正式笔记且浏览的是当前库；草稿态高亮首行）
  if (props.currentPath && selectedVault.value === props.vault && props.vault !== SCRATCH_VAULT) {
    const locate = locateNote(treeNodes.value, currentRel.value)
    if (locate) expanded.value = locate.expand
  }
  hl.value = items.value.findIndex((it) => selectable(it))
  if (selectedVault.value === props.vault && props.vault !== SCRATCH_VAULT) {
    const at = items.value.findIndex((it) => it.kind === 'note' && it.rel === currentRel.value)
    if (at >= 0) hl.value = at
  }
  void nextTick(() => listRef.value?.querySelector(`[data-idx="${hl.value}"]`)?.scrollIntoView({ block: 'center' }))
}

/** 聚焦过滤框（@opened = 弹窗动画完成后；@open 时输入框尚未挂载、focus() 静默落空）。
 *  焦点常驻过滤框是键盘动线的根基——打字即过滤、↑/↓ 即导航 */
function onOpened(): void {
  inputRef.value?.focus()
}

/** 过滤输入变化：高亮回落到首个可停行（避免停在已被重算掉的位置） */
watch(query, () => {
  hl.value = items.value.findIndex((it) => selectable(it))
})

function onRowClick(item: RowItem, i: number): void {
  if (item.kind === 'header') return
  hl.value = i
  if (item.kind === 'dir') toggleDir(item.rel)
  else insertCurrent(item)
}
</script>

<style scoped>
.qr-vault-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qr-vault-label {
  font-size: 12px;
  color: var(--text-tertiary);
  flex: none;
}
.qr-vault-select {
  width: 200px;
  flex: none;
}
.qr-cross-hint {
  font-size: 12px;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qr-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qr-list {
  height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px 0;
  background: var(--bg-secondary);
}
.qr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding-right: 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}
.qr-row.qr-hl {
  background: var(--accent-soft, var(--bg-hover, rgba(0, 0, 0, 0.06)));
}
.qr-row.qr-dir {
  font-weight: 600;
}
.qr-caret {
  width: 14px;
  flex: none;
  color: var(--text-tertiary);
  font-size: 11px;
}
.qr-icon {
  flex: none;
  color: var(--text-tertiary);
}
.qr-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.qr-draft-name {
  color: var(--text-secondary);
}
.qr-detail {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--text-tertiary);
  padding-left: 8px;
}
.qr-header {
  cursor: default;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--border-color);
  color: var(--text-tertiary);
  font-size: 11px;
}
.qr-header:first-child {
  border-top: none;
  margin-top: 0;
}
.qr-header-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.qr-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}
.qr-footer {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
