<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useAppStore, type GridSection } from '../stores/app'
import { useTreeStore } from '../stores/tree'
import { useNoteActions } from '../composables/actions'
import { collectNotes, exportNotesToHtml, exportNotesToPdf } from '../composables/exportPdf'
import { useEditorStore } from '../stores/editor'
import MarkdownPreview from '../components/MarkdownPreview.vue'
import TagPickerDialog from '../components/TagPickerDialog.vue'
import { formatRelativeTime } from '../lib/relativeTime'
import { stripFrontmatter } from '@shared/noteTags'
import type { TreeNode } from '@shared/types'

/** 卡片网格视图：常用 / 收藏（笔记卡片，单击预览双击编辑）、笔记库（库卡片双击钻入，
 *  库内容网格 = 文件夹卡片 + 笔记卡片，面包屑 / Esc 逐级回退，见 vault-grid-navigation-design.md） */
const app = useAppStore()
const tree = useTreeStore()
const actions = useNoteActions()
const editor = useEditorStore()

type GridItem = { id?: string; vault: string; path: string; name: string; openedAt?: string }
type VaultCard = { id?: string; name: string; description?: string }

const SECTION_TITLE: Record<GridSection, string> = {
  recents: '常用',
  favorites: '收藏',
  vaults: '笔记库',
  tags: '标签'
}

const section = computed<GridSection>(() =>
  app.view.name === 'grid' ? app.view.section : 'recents'
)
const title = computed(() => {
  if (section.value === 'tags' && tagId.value) {
    const tag = tree.tags.find((t) => t.id === tagId.value)
    return tag ? `标签：${tag.name}` : '标签'
  }
  return SECTION_TITLE[section.value]
})
const isVaults = computed(() => section.value === 'vaults')

// ---------- 库内容导航（vaultPath = '库名' 或 '库名/文件夹/…'，POSIX 风格） ----------
const vaultPath = computed(() =>
  app.view.name === 'grid' && app.view.section === 'vaults' ? app.view.vaultPath ?? '' : ''
)
const inVaultContent = computed(() => isVaults.value && !!vaultPath.value)
const crumbSegs = computed(() => vaultPath.value.split('/').filter(Boolean))
const vaultName = computed(() => crumbSegs.value[0] ?? '')
/** 当前所在文件夹相对库根的路径（库级为 ''） */
const folderRel = computed(() => crumbSegs.value.slice(1).join('/'))

/** 面包屑：[{ 库名, '库' }, { 子文件夹, '库/子文件夹' }, …] */
const crumbs = computed(() =>
  crumbSegs.value.map((seg, i) => ({
    name: seg,
    path: crumbSegs.value.slice(0, i + 1).join('/')
  }))
)

/** 库内容（文件夹 + 笔记）：复用 tree:list 的树，沿 vaultPath 逐级下钻 */
const contentNodes = computed<TreeNode[]>(() => {
  if (!inVaultContent.value) return []
  let nodes = tree.trees[vaultName.value] ?? []
  for (const seg of crumbSegs.value.slice(1)) {
    const next = nodes.find((n) => n.kind === 'dir' && n.name === seg)?.children
    if (!next) return []
    nodes = next
  }
  return nodes
})
const contentNotes = computed<GridItem[]>(() =>
  contentNodes.value
    .filter((n) => n.kind === 'note')
    .map((n) => ({ vault: vaultName.value, path: n.path, name: n.name }))
)

function childCounts(node: TreeNode): { notes: number; dirs: number } {
  const children = node.children ?? []
  return {
    notes: children.filter((c) => c.kind === 'note').length,
    dirs: children.filter((c) => c.kind === 'dir').length
  }
}

// 进入库内容时确保该库的树已加载（侧栏未展开过则 trees 为空）
watch(
  () => `${section.value}|${vaultPath.value}`,
  () => {
    if (inVaultContent.value && vaultName.value) void tree.loadTree(vaultName.value)
  },
  { immediate: true }
)

const items = computed<GridItem[]>(() =>
  section.value === 'recents'
    ? tree.recents
    : section.value === 'favorites'
      ? tree.favorites
      : section.value === 'tags'
        ? tagItems.value
        : contentNotes.value
)

// ---------- 标签视图：按 tagId 加载笔记 ----------
const tagId = computed(() =>
  app.view.name === 'grid' && app.view.section === 'tags' ? app.view.tagId ?? '' : ''
)
const tagItems = ref<GridItem[]>([])

watch(tagId, async (id) => {
  if (!id) { tagItems.value = []; return }
  const result = await window.trace.notesByTag(id)
  if (result.ok && result.entries) {
    tagItems.value = result.entries.map((e) => ({
      vault: e.vault,
      path: e.path,
      name: e.path.replace(/\.md$/i, '').replace(/.*\//, '')
    }))
  }
}, { immediate: true })
const vaultCards = computed<VaultCard[]>(() =>
  isVaults.value && !inVaultContent.value
    ? tree.vaults.map((v) => ({ name: v.name, description: v.description }))
    : []
)
const itemCount = computed(() =>
  inVaultContent.value ? contentNodes.value.length : isVaults.value ? vaultCards.value.length : items.value.length
)

// ---------- 钻入 / 回退动画方向 ----------
const drillAnim = ref<'drill-forward' | 'drill-backward'>('drill-forward')
const drillDepth = ref(0)
watch(vaultPath, (next) => {
  const depth = next.split('/').filter(Boolean).length
  drillAnim.value = depth >= drillDepth.value ? 'drill-forward' : 'drill-backward'
  drillDepth.value = depth
})

// ---------- 卡片摘要 ----------
const excerpts = ref<Record<string, string>>({})
let excerptSeq = 0

async function loadExcerpts(): Promise<void> {
  const seq = ++excerptSeq
  const next: Record<string, string> = {}
  for (const item of items.value) {
    const result = await window.trace.readNote(item.vault, item.path)
    if (seq !== excerptSeq) return // 读取期间列表已变化，丢弃本轮结果
    const content = result.ok && result.content != null ? result.content : ''
    // 摘要不含 frontmatter（标签信息由卡片标签展示，不进摘要）
    next[`${item.vault}::${item.path}`] = content ? toExcerpt(stripFrontmatter(content)) : ''
  }
  excerpts.value = next
}

watch(
  () => `${section.value}|${items.value.map((i) => `${i.vault}::${i.path}`).join('|')}`,
  () => void loadExcerpts(),
  { immediate: true }
)

/** 提取纯文本摘要：去代码块/图片/链接/标记符号，压平空白，截断 120 字 */
function toExcerpt(content: string): string {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~[\s\S]*?~~/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

// ---------- 标签选择对话框（共享组件 TagPickerDialog） ----------
const tagDialogVisible = ref(false)
const tagDialogNote = ref<GridItem | null>(null)

function openTagDialog(item: GridItem): void {
  tagDialogNote.value = item
  tagDialogVisible.value = true
}

function dirOf(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.filter(Boolean).join('/')
}

// ---------- 卡片菜单 ----------
function isFavorited(item: GridItem): boolean {
  return tree.favorites.some((f) => f.vault === item.vault && f.path === item.path)
}

function onVaultMenuCommand(cmd: string, card: VaultCard): void {
  if (cmd === 'rename') actions.renameVault(card.name)
  else if (cmd === 'deleteVault') void actions.deleteVault(card.name)
  else if (cmd === 'locate') void tree.revealNode(card.name, '', 'vault')
  else if (cmd === 'exportPdf') actions.exportFolderPdf(card.name, '')
  else if (cmd === 'exportHtml') actions.exportFolderHtml(card.name, '')
}

function onFolderMenuCommand(cmd: string, node: TreeNode): void {
  const folderPath = [folderRel.value, node.name].filter(Boolean).join('/')
  if (cmd === 'exportPdf') {
    // 递归导出该文件夹下全部笔记
    const nodes = node.children ?? []
    const targets = collectNotes(nodes, `${vaultName.value}/${folderPath}`, folderPath)
    void exportNotesToPdf(targets, tree, editor)
    return
  }
  if (cmd === 'exportHtml') {
    const nodes = node.children ?? []
    const targets = collectNotes(nodes, `${vaultName.value}/${folderPath}`, folderPath)
    void exportNotesToHtml(targets, tree, editor)
    return
  }
  if (cmd === 'rename') actions.renameDir(vaultName.value, folderPath, node.name)
  else if (cmd === 'move') actions.moveNode(vaultName.value, folderPath, 'dir', node.name)
  else if (cmd === 'delete') void actions.deleteDir(vaultName.value, folderPath, node.name)
  else if (cmd === 'newDir') actions.createDir(vaultName.value, folderPath)
  else if (cmd === 'newNote') actions.createNote(vaultName.value, folderPath)
  else if (cmd === 'locate') void tree.revealNode(vaultName.value, folderPath, 'dir')
}

async function onNoteMenuCommand(cmd: string, item: GridItem): Promise<void> {
  // 会移除当前卡片的操作（移出常用 / 收藏区取消收藏）先等 ⋮ 菜单收起动画结束：
  // 否则 teleport 到 body 的 popper 会在锚点卡片消失时对分离元素重定位，闪现到视口左上角
  const removesCard =
    cmd === 'removeRecent' || (section.value === 'favorites' && cmd === 'favorite')
  if (removesCard) await new Promise((resolve) => setTimeout(resolve, 350))

  if (cmd === 'exportPdf') {
    void actions.exportNotes([{ vault: item.vault, path: item.path, name: item.name }])
    return
  }
  if (cmd === 'exportHtml') {
    void actions.exportNotesHtml([{ vault: item.vault, path: item.path, name: item.name }])
    return
  }
  if (cmd === 'delete') {
    void actions.deleteNote(item.vault, item.path, item.name)
    return
  }
  if (cmd === 'info') {
    const result = await window.trace.noteGetInfo(item.vault, item.path)
    if (result.ok && result.info) {
      const created = new Date(result.info.birthtime).toLocaleString('zh-CN')
      const modified = new Date(result.info.mtime).toLocaleString('zh-CN')
      await ElMessageBox.alert(`创建时间：${created}\n最后修改：${modified}`, `${item.name} 信息`, {
        confirmButtonText: '确定',
        customStyle: { whiteSpace: 'pre-wrap' }
      })
    }
    return
  }
  if (cmd === 'tag') {
    await openTagDialog(item)
    return
  }
  if (cmd === 'move') {
    actions.moveNode(item.vault, item.path, 'note', item.name)
    return
  }
  if (cmd === 'favorite') {
    void actions.toggleFavorite(item.vault, item.path, item.name, isFavorited(item))
  } else if (cmd === 'removeRecent') {
    void actions.removeRecent(item.vault, item.path)
  } else if (cmd === 'locate') {
    void tree.revealNode(item.vault, item.path, 'note')
  }

  // 悬浮预览若正显示被移除的笔记，一并关闭
  if (removesCard && preview.value?.vault === item.vault && preview.value?.path === item.path) {
    preview.value = null
  }
}

// ---------- 卡片交互：单击预览 / 双击编辑或钻入；长按等同单击（手势宽容） ----------
const preview = ref<{ vault: string; path: string; name: string; content: string } | null>(null)
let clickTimer: ReturnType<typeof setTimeout> | null = null
let pressTimer: ReturnType<typeof setTimeout> | null = null
/** 长按已触发预览时吞掉其后的 click，避免二次触发 */
let suppressClick = false

async function openPreview(item: GridItem): Promise<void> {
  const result = await window.trace.readNote(item.vault, item.path)
  preview.value = {
    vault: item.vault,
    path: item.path,
    name: item.name,
    content:
      result.ok && result.content != null ? result.content : `> 读取失败：${result.error ?? '未知错误'}`
  }
}

function onCardClick(item: GridItem): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (clickTimer) return // 双击的第二次 click 交给 dblclick 处理
  clickTimer = setTimeout(() => {
    clickTimer = null
    void openPreview(item)
  }, 220)
}

/** 长按 400ms 等同单击（呼出预览）：用户把手势习惯带过来时不再「没反应」 */
function onCardPressStart(item: GridItem, e: PointerEvent): void {
  // 操作按钮区域交给按钮自身，不长按
  if ((e.target as HTMLElement).closest('.note-card-actions')) return
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    pressTimer = null
    suppressClick = true
    void openPreview(item)
  }, 400)
}

function onCardPressEnd(): void {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onCardDblClick(item: GridItem): void {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  preview.value = null
  void actions.openNote(item.vault, item.path, item.name)
}

/** 预览卡「打开」：把一瞥升级为进入编辑 */
function openPreviewNote(): void {
  const p = preview.value
  if (!p) return
  preview.value = null
  void actions.openNote(p.vault, p.path, p.name)
}

function close(): void {
  app.view = { name: 'welcome' }
}

/** 点击空白区域（卡片与预览卡片之外）关闭悬浮预览 */
function onRootClick(e: MouseEvent): void {
  const el = e.target as HTMLElement
  if (el.closest('.floating-preview') || el.closest('.note-card')) return
  preview.value = null
}

/** 悬浮预览中点击库内笔记链接：收回预览并打开目标笔记 */
function onPreviewOpenNote(target: { vault: string; path: string; name: string }): void {
  preview.value = null
  void actions.openNote(target.vault, target.path, target.name)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // Esc 分级：悬浮预览 → 关预览；库内容级 → 回上级；库列表级 → 关闭网格
  if (preview.value) {
    preview.value = null
    return
  }
  if (inVaultContent.value) {
    app.drillOut()
    return
  }
  if (isVaults.value) close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (clickTimer) clearTimeout(clickTimer)
  if (pressTimer) clearTimeout(pressTimer)
})

watch(section, () => {
  preview.value = null
})
</script>

<template>
  <div class="grid-view" @click="onRootClick">
    <!-- 顶栏：面包屑（库内容级）或区块标题 + 数量 + 操作提示 -->
    <div class="grid-header">
      <template v-if="inVaultContent">
        <button class="tool-btn" title="返回上一级 (Esc)" @click.stop="app.drillOut()">
          <el-icon><ArrowLeft /></el-icon>
        </button>
        <button class="crumb-item" @click.stop="app.view = { name: 'grid', section: 'vaults' }">
          <el-icon class="crumb-icon"><Collection /></el-icon>
          笔记库
        </button>
        <template v-for="(crumb, i) in crumbs" :key="crumb.path">
          <span class="crumb-sep">/</span>
          <button
            class="crumb-item"
            :class="{ current: i === crumbs.length - 1 }"
            @click.stop="i < crumbs.length - 1 && app.drillIn(crumb.path)"
          >
            <el-icon v-if="i === 0" class="crumb-icon"><Folder /></el-icon>
            {{ crumb.name }}
          </button>
        </template>
        <span v-if="itemCount" class="grid-count">{{ itemCount }}</span>
        <span class="grid-hint">单击预览笔记 · 双击进入文件夹</span>
      </template>
      <template v-else>
        <el-icon>
          <Clock v-if="section === 'recents'" />
          <Star v-else-if="section === 'favorites'" />
          <Collection v-else />
        </el-icon>
        <span class="grid-title">{{ title }}</span>
        <span v-if="itemCount" class="grid-count">{{ itemCount }}</span>
        <span class="grid-hint">
          {{ isVaults ? '双击打开笔记库' : '单击预览 · 双击编辑' }}
        </span>
      </template>
      <button class="tool-btn grid-view-toggle" :title="app.viewMode === 'grid' ? '切换列表' : '切换网格'" @click.stop="app.setViewMode(app.viewMode === 'grid' ? 'list' : 'grid')">
        <el-icon><Grid v-if="app.viewMode === 'grid'" /><List v-else /></el-icon>
      </button>
      <button class="tool-btn grid-close" title="关闭" @click="close">
        <el-icon><Close /></el-icon>
      </button>
    </div>

    <!-- 空状态 -->
    <div v-if="itemCount === 0" class="grid-empty">
      <el-icon class="grid-empty-icon">
        <FolderOpen v-if="inVaultContent" />
        <Clock v-else-if="section === 'recents'" />
        <Star v-else-if="section === 'favorites'" />
        <Collection v-else />
      </el-icon>
      <p>
        {{
          inVaultContent
            ? '此文件夹为空'
            : section === 'recents'
              ? '最近打开的笔记会显示在这里'
              : section === 'favorites'
                ? '收藏的笔记会显示在这里'
                : section === 'tags'
                  ? '该标签下还没有笔记，可在笔记的「标签…」菜单中添加'
                  : '还没有笔记库，点击侧栏「笔记库」旁的 + 创建'
        }}
      </p>
    </div>

    <!-- 笔记库网格（库列表级：库卡片双击钻入；内容级：文件夹 + 笔记卡片） -->
    <div v-else-if="isVaults" class="vault-grid-wrap">
      <Transition :name="drillAnim" mode="out-in">
        <div :key="vaultPath || '__list__'" class="grid-body" :class="app.viewMode">
          <!-- 库列表级 -->
          <template v-if="!inVaultContent">
            <el-tooltip
              v-for="card in vaultCards"
              :key="card.name"
              :content="card.description ? `${card.name}：${card.description}` : card.name"
              placement="bottom"
              :show-after="400"
            >
              <div class="note-card vault-card" @dblclick="app.drillIn(card.name)">
                <div class="note-card-actions">
                  <el-dropdown trigger="click" @command="(cmd: string) => onVaultMenuCommand(cmd, card)" popper-class="dd-instant-hide">
                    <button class="row-btn" title="更多操作" @click.stop @dblclick.stop>
                      <el-icon><MoreFilled /></el-icon>
                    </button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="locate">在侧栏中定位</el-dropdown-item>
                        <el-dropdown-item command="exportPdf" divided>导出 PDF…</el-dropdown-item>
                        <el-dropdown-item command="exportHtml">导出 HTML…</el-dropdown-item>
                        <el-dropdown-item command="rename">重命名</el-dropdown-item>
                        <el-dropdown-item command="deleteVault" class="danger-item">删除笔记库</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
                <el-icon class="note-card-icon"><Folder /></el-icon>
                <div class="note-card-body">
                  <div class="note-card-title"><span>{{ card.name }}</span></div>
                  <div class="note-card-excerpt">{{ card.description ?? '' }}</div>
                </div>
                <div class="note-card-meta">
                  <span>{{ tree.gitStatuses[card.name]?.associated ? '已关联 Git 仓库' : '本地笔记库' }}</span>
                </div>
              </div>
            </el-tooltip>
          </template>

          <!-- 库内容级：文件夹卡片在前，笔记卡片在后 -->
          <template v-else>
            <template v-for="node in contentNodes" :key="node.path">
              <div
                v-if="node.kind === 'dir'"
                class="note-card folder-card"
                @dblclick="app.drillIn(`${vaultName}/${node.path}`)"
              >
                <div class="note-card-actions">
                  <el-dropdown trigger="click" @command="(cmd: string) => onFolderMenuCommand(cmd, node)" popper-class="dd-instant-hide">
                    <button class="row-btn" title="更多操作" @click.stop @dblclick.stop>
                      <el-icon><MoreFilled /></el-icon>
                    </button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="newDir">新建文件夹</el-dropdown-item>
                        <el-dropdown-item command="newNote">创建笔记</el-dropdown-item>
                        <el-dropdown-item command="exportPdf" divided>导出 PDF…</el-dropdown-item>
                        <el-dropdown-item command="exportHtml">导出 HTML…</el-dropdown-item>
                        <el-dropdown-item command="locate" divided>在侧栏中定位</el-dropdown-item>
                        <el-dropdown-item command="move">移动到…</el-dropdown-item>
                        <el-dropdown-item command="rename">重命名</el-dropdown-item>
                        <el-dropdown-item command="delete" class="danger-item">删除文件夹</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
                <el-icon class="note-card-icon"><Folder /></el-icon>
                <div class="note-card-body">
                  <div class="note-card-title"><span>{{ node.name }}</span></div>
                </div>
                <div class="note-card-meta folder-counts">
                  <span v-if="childCounts(node).notes">{{ childCounts(node).notes }} 篇笔记</span>
                  <span v-if="childCounts(node).dirs">{{ childCounts(node).dirs }} 个文件夹</span>
                </div>
              </div>
              <div
                v-else
                class="note-card"
                @click="onCardClick({ vault: vaultName, path: node.path, name: node.name })"
                @dblclick="onCardDblClick({ vault: vaultName, path: node.path, name: node.name })"
                @pointerdown="onCardPressStart({ vault: vaultName, path: node.path, name: node.name }, $event)"
                @pointerup="onCardPressEnd"
                @pointerleave="onCardPressEnd"
              >
                <div class="note-card-actions">
                  <el-dropdown
                    trigger="click"
                    @command="(cmd: string) => onNoteMenuCommand(cmd, { vault: vaultName, path: node.path, name: node.name })" popper-class="dd-instant-hide">
                    <button class="row-btn" title="更多操作" @click.stop @dblclick.stop>
                      <el-icon><MoreFilled /></el-icon>
                    </button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="exportPdf">导出 PDF…</el-dropdown-item>
                        <el-dropdown-item command="exportHtml">导出 HTML…</el-dropdown-item>
                        <el-dropdown-item command="move">移动到…</el-dropdown-item>
                        <el-dropdown-item command="favorite">
                          {{ isFavorited({ vault: vaultName, path: node.path, name: node.name }) ? '取消收藏' : '收藏笔记' }}
                        </el-dropdown-item>
                        <el-dropdown-item command="locate">在侧栏中定位</el-dropdown-item>
                        <el-dropdown-item command="info" divided>信息</el-dropdown-item>
                        <el-dropdown-item command="tag">标签</el-dropdown-item>
                        <el-dropdown-item command="delete" divided class="danger-item">删除笔记</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
                <el-icon class="note-card-icon"><Document /></el-icon>
                <div class="note-card-body">
                  <div class="note-card-title"><span>{{ node.name }}</span></div>
                  <div class="note-card-excerpt">{{ excerpts[`${vaultName}::${node.path}`] ?? '' }}</div>
                </div>
                <div class="note-card-meta">
                  <span>{{ dirOf(node.path) || '根目录' }}</span>
                </div>
              </div>
            </template>
          </template>
        </div>
      </Transition>
    </div>

    <!-- 笔记卡片网格（常用 / 收藏） -->
    <div v-else class="grid-body" :class="app.viewMode">
      <el-tooltip
        v-for="item in items"
        :key="item.id ?? `${item.vault}::${item.path}`"
        :content="`${item.vault} / ${item.path}`"
        placement="bottom"
        :show-after="400"
      >
        <div
          class="note-card"
          @click="onCardClick(item)"
          @dblclick="onCardDblClick(item)"
          @pointerdown="onCardPressStart(item, $event)"
          @pointerup="onCardPressEnd"
          @pointerleave="onCardPressEnd"
        >
          <div class="note-card-actions">
            <el-dropdown trigger="click" @command="(cmd: string) => onNoteMenuCommand(cmd, item)" popper-class="dd-instant-hide">
              <button class="row-btn" title="更多操作" @click.stop @dblclick.stop>
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="favorite">
                    {{ isFavorited(item) ? '取消收藏' : '收藏笔记' }}
                  </el-dropdown-item>
                  <el-dropdown-item v-if="section === 'recents'" command="removeRecent">移出常用</el-dropdown-item>
                  <el-dropdown-item command="locate">在侧栏中定位</el-dropdown-item>
                  <el-dropdown-item command="info" divided>信息</el-dropdown-item>
                  <el-dropdown-item command="tag">标签</el-dropdown-item>
                  <el-dropdown-item command="exportPdf" divided>导出 PDF…</el-dropdown-item>
                  <el-dropdown-item command="exportHtml">导出 HTML…</el-dropdown-item>
                  <el-dropdown-item command="delete" class="danger-item">删除笔记</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <el-icon class="note-card-icon"><Document /></el-icon>
          <div class="note-card-body">
            <div class="note-card-title"><span>{{ item.name }}</span></div>
            <div class="note-card-excerpt">{{ excerpts[`${item.vault}::${item.path}`] ?? '' }}</div>
          </div>
          <div class="note-card-meta">
            <template v-if="section === 'recents' && item.openedAt">
              {{ formatRelativeTime(item.openedAt) }}
            </template>
            <template v-else>
              <span>{{ item.vault }}</span>
              <span v-if="dirOf(item.path)">/{{ dirOf(item.path) }}</span>
            </template>
          </div>
        </div>
      </el-tooltip>
    </div>

    <!-- 悬浮预览：自右侧滑入，Esc / × 关闭 -->
    <Transition name="float-preview">
      <div v-if="preview" class="floating-preview">
        <div class="floating-preview-header">
          <span class="floating-preview-title">{{ preview.name }}</span>
          <span class="floating-preview-actions">
            <button class="tool-btn" @click="openPreviewNote()">
              <el-icon><EditPen /></el-icon>
            </button>
            <button class="tool-btn" @click="preview = null">
              <el-icon><Close /></el-icon>
            </button>
          </span>
        </div>
        <div class="floating-preview-body">
          <MarkdownPreview
            :content="preview.content"
            :vault="preview.vault"
            :note-path="preview.path"
            :font-size="app.settings.editorFontSize"
            @open-note="onPreviewOpenNote"
          />
        </div>
      </div>
    </Transition>

    <!-- 标签选择对话框（共享组件） -->
    <TagPickerDialog
      v-model:visible="tagDialogVisible"
      :note="tagDialogNote"
      @changed="void tree.loadTags()"
    />
  </div>
</template>

<style scoped>
/* grid-view / grid-header / grid-title / grid-count / grid-hint / grid-empty
   为全局样式（main.css），与回收站视图共用 */

.grid-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  align-content: start;
}

.grid-view-toggle {
  margin-left: auto;
  margin-right: 8px;
}

/* 列表模式 */
.grid-body.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grid-body.list .note-card {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}

.grid-body.list .note-card:hover {
  transform: none;
}

.grid-body.list .note-card-body {
  flex: 1;
  min-width: 0;
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.grid-body.list .note-card-title {
  flex-shrink: 0;
}

.grid-body.list .note-card-excerpt {
  -webkit-line-clamp: 1;
  min-height: 0;
  flex: 1;
  min-width: 0;
}

.grid-body.list .note-card-meta {
  margin-top: 0;
  flex-shrink: 0;
  text-align: right;
  white-space: nowrap;
}

.grid-body.list .note-card.vault-card {
  grid-column: auto;
  background: var(--accent-soft);
}

.grid-body.list .note-card-actions {
  position: static;
  opacity: 0;
  flex-shrink: 0;
}

.note-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.note-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}

/* 卡片右上角 ⋮ 菜单按钮：悬浮显示 */
.note-card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.note-card:hover .note-card-actions,
.note-card:focus-within .note-card-actions {
  opacity: 1;
}

/* 库 / 文件夹卡片：双击钻入 */
.note-card.vault-card,
.note-card.folder-card {
  cursor: pointer;
}

/* 库卡片视觉强化（P2）：双列 + 强调色浅底 + 大图标大标题，与文件夹/笔记卡片形成多维区分 */
.note-card.vault-card {
  grid-column: span 2;
  background: var(--accent-soft);
  border-color: transparent;
}

/* 容器过窄放不下双列时回退单列 */
@media (max-width: 640px) {
  .note-card.vault-card {
    grid-column: span 1;
  }
}

.note-card.vault-card .note-card-icon {
  font-size: 24px;
}

.note-card.vault-card .note-card-title {
  font-size: 15px;
}

.note-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
}

.note-card-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-card-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.note-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-card-excerpt {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.note-card-meta {
  margin-top: auto;
  font-size: 11px;
  color: var(--text-tertiary);
  display: flex;
  gap: 2px;
  overflow: hidden;
  white-space: nowrap;
}

/* 文件夹卡片：无摘要，计数留白（设计第 7 节：空文件夹留白） */
.folder-card .note-card-meta.folder-counts {
  gap: 8px;
  min-height: 1em;
}

/* 库内容网格的包裹层：面包屑 + 钻入动画容器 */
.vault-grid-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.vault-grid-wrap .grid-body {
  width: 100%;
}

/* 面包屑 */
.grid-crumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 16px 0;
  overflow: hidden;
  white-space: nowrap;
}

.crumb-item {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.crumb-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.crumb-item.current {
  color: var(--text-primary);
  font-weight: 600;
  cursor: default;
}

.crumb-item.current:hover {
  background: transparent;
}

.crumb-sep {
  color: var(--text-tertiary);
}

.crumb-icon {
  color: var(--text-tertiary);
}

/* 钻入 / 回退滑动动画（translateX ±48px, 0.2s ease，与悬浮预览同款） */
.drill-forward-enter-active,
.drill-forward-leave-active,
.drill-backward-enter-active,
.drill-backward-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.drill-forward-enter-from {
  transform: translateX(48px);
  opacity: 0;
}

.drill-forward-leave-to {
  transform: translateX(-48px);
  opacity: 0;
}

.drill-backward-enter-from {
  transform: translateX(-48px);
  opacity: 0;
}

.drill-backward-leave-to {
  transform: translateX(48px);
  opacity: 0;
}

/* 悬浮预览卡片（与编辑器的悬浮预览同款：覆盖右侧，不挤压布局） */
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

.floating-preview-title {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.floating-preview-body {
  flex: 1;
  overflow: hidden;
}

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
