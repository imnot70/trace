<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore, type GridSection } from '../stores/app'
import { useTreeStore } from '../stores/tree'
import { useNoteActions } from '../composables/actions'
import MarkdownPreview from '../components/MarkdownPreview.vue'

/** 卡片网格视图：常用 / 收藏（笔记卡片，单击预览双击编辑）、笔记库（库卡片，显示描述） */
const app = useAppStore()
const tree = useTreeStore()
const actions = useNoteActions()

type GridItem = { id?: string; vault: string; path: string; name: string }
type VaultCard = { id?: string; name: string; description?: string }

const SECTION_TITLE: Record<GridSection, string> = {
  recents: '常用',
  favorites: '收藏',
  vaults: '笔记库'
}

const section = computed<GridSection>(() =>
  app.view.name === 'grid' ? app.view.section : 'recents'
)
const title = computed(() => SECTION_TITLE[section.value])
const isVaults = computed(() => section.value === 'vaults')
const items = computed<GridItem[]>(() =>
  section.value === 'recents' ? tree.recents : section.value === 'favorites' ? tree.favorites : []
)
const vaultCards = computed<VaultCard[]>(() =>
  isVaults.value ? tree.vaults.map((v) => ({ name: v.name, description: v.description })) : []
)
const itemCount = computed(() => (isVaults.value ? vaultCards.value.length : items.value.length))

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
    next[`${item.vault}::${item.path}`] = content ? toExcerpt(content) : ''
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

function dirOf(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.filter(Boolean).join('/')
}

// ---------- 卡片菜单：库卡片（重命名 / 删除笔记库）、笔记卡片（收藏 / 移出常用 / 删除笔记） ----------
function isFavorited(item: GridItem): boolean {
  return tree.favorites.some((f) => f.vault === item.vault && f.path === item.path)
}

function onVaultMenuCommand(cmd: string, card: VaultCard): void {
  if (cmd === 'rename') actions.renameVault(card.name)
  else if (cmd === 'deleteVault') void actions.deleteVault(card.name)
}

async function onNoteMenuCommand(cmd: string, item: GridItem): Promise<void> {
  // 会移除当前卡片的操作（移出常用 / 收藏区取消收藏）先等 ⋮ 菜单收起动画结束：
  // 否则 teleport 到 body 的 popper 会在锚点卡片消失时对分离元素重定位，闪现到视口左上角
  const removesCard =
    cmd === 'removeRecent' || (section.value === 'favorites' && cmd === 'favorite')
  if (removesCard) await new Promise((resolve) => setTimeout(resolve, 350))

  if (cmd === 'delete') {
    void actions.deleteNote(item.vault, item.path, item.name)
    return
  }
  if (cmd === 'favorite') {
    void actions.toggleFavorite(item.vault, item.path, item.name, isFavorited(item))
  } else if (cmd === 'removeRecent') {
    void actions.removeRecent(item.vault, item.path)
  }

  // 悬浮预览若正显示被移除的笔记，一并关闭
  if (removesCard && preview.value?.vault === item.vault && preview.value?.path === item.path) {
    preview.value = null
  }
}

// ---------- 卡片交互：单击预览 / 双击编辑 ----------
const preview = ref<{ vault: string; path: string; name: string; content: string } | null>(null)
let clickTimer: ReturnType<typeof setTimeout> | null = null

function onCardClick(item: GridItem): void {
  if (isVaults.value || clickTimer) return // 库卡片无预览；双击的第二次 click 交给 dblclick 处理
  clickTimer = setTimeout(async () => {
    clickTimer = null
    const result = await window.trace.readNote(item.vault, item.path)
    preview.value = {
      vault: item.vault,
      path: item.path,
      name: item.name,
      content:
        result.ok && result.content != null ? result.content : `> 读取失败：${result.error ?? '未知错误'}`
    }
  }, 220)
}

function onCardDblClick(item: GridItem): void {
  if (isVaults.value) return
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  preview.value = null
  void actions.openNote(item.vault, item.path, item.name)
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

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && preview.value) preview.value = null
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (clickTimer) clearTimeout(clickTimer)
})

watch(section, () => {
  preview.value = null
})
</script>

<template>
  <div class="grid-view" @click="onRootClick">
    <!-- 顶栏：区块标题 + 数量 + 操作提示 -->
    <div class="grid-header">
      <el-icon>
        <Clock v-if="section === 'recents'" />
        <Star v-else-if="section === 'favorites'" />
        <Collection v-else />
      </el-icon>
      <span class="grid-title">{{ title }}</span>
      <span v-if="itemCount" class="grid-count">{{ itemCount }}</span>
      <span class="grid-hint">
        {{ isVaults ? '管理你的笔记库' : '单击预览 · 双击编辑' }}
      </span>
      <button class="tool-btn" title="关闭" @click="close">
        <el-icon><Close /></el-icon>
      </button>
    </div>

    <!-- 空状态 -->
    <div v-if="itemCount === 0" class="grid-empty">
      <el-icon class="grid-empty-icon">
        <Clock v-if="section === 'recents'" />
        <Star v-else-if="section === 'favorites'" />
        <Collection v-else />
      </el-icon>
      <p>
        {{
          section === 'recents'
            ? '最近打开的笔记会显示在这里'
            : section === 'favorites'
              ? '收藏的笔记会显示在这里'
              : '还没有笔记库，点击侧栏「笔记库」旁的 + 创建'
        }}
      </p>
    </div>

    <!-- 库卡片网格 -->
    <div v-else-if="isVaults" class="grid-body">
      <div
        v-for="card in vaultCards"
        :key="card.name"
        class="note-card vault-card"
        :title="card.description ? `${card.name}：${card.description}` : card.name"
      >
        <div class="note-card-actions">
          <el-dropdown trigger="click" @command="(cmd: string) => onVaultMenuCommand(cmd, card)">
            <button class="row-btn" title="更多操作" @click.stop @dblclick.stop>
              <el-icon><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="deleteVault" divided class="danger-item">删除笔记库</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="note-card-title">
          <el-icon class="note-card-icon"><Folder /></el-icon>
          <span>{{ card.name }}</span>
        </div>
        <div class="note-card-excerpt">{{ card.description ?? '' }}</div>
        <div class="note-card-meta">
          <span>{{ tree.gitStatuses[card.name]?.associated ? '已关联 Git 仓库' : '本地笔记库' }}</span>
        </div>
      </div>
    </div>

    <!-- 笔记卡片网格（常用 / 收藏） -->
    <div v-else class="grid-body">
      <div
        v-for="item in items"
        :key="item.id ?? `${item.vault}::${item.path}`"
        class="note-card"
        :title="`${item.vault} / ${item.path}`"
        @click="onCardClick(item)"
        @dblclick="onCardDblClick(item)"
      >
        <div class="note-card-actions">
          <el-dropdown trigger="click" @command="(cmd: string) => onNoteMenuCommand(cmd, item)">
            <button class="row-btn" title="更多操作" @click.stop @dblclick.stop>
              <el-icon><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="favorite">
                  {{ isFavorited(item) ? '取消收藏' : '收藏笔记' }}
                </el-dropdown-item>
                <el-dropdown-item v-if="section === 'recents'" command="removeRecent">移出常用</el-dropdown-item>
                <el-dropdown-item command="delete" divided class="danger-item">删除笔记</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="note-card-title">
          <el-icon class="note-card-icon"><Document /></el-icon>
          <span>{{ item.name }}</span>
        </div>
        <div class="note-card-excerpt">{{ excerpts[`${item.vault}::${item.path}`] ?? '' }}</div>
        <div class="note-card-meta">
          <span>{{ item.vault }}</span>
          <span v-if="dirOf(item.path)">/{{ dirOf(item.path) }}</span>
        </div>
      </div>
    </div>

    <!-- 悬浮预览：自右侧滑入，Esc / × 关闭 -->
    <Transition name="float-preview">
      <div v-if="preview" class="floating-preview">
        <div class="floating-preview-header">
          <span class="floating-preview-title">{{ preview.name }}</span>
          <button class="tool-btn" title="关闭 (Esc)" @click="preview = null">
            <el-icon><Close /></el-icon>
          </button>
        </div>
        <div class="floating-preview-body">
          <MarkdownPreview
            :content="preview.content"
            :vault="preview.vault"
            :note-path="preview.path"
            :font-size="app.settings.editorFontSize"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.grid-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.grid-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}

.grid-title {
  font-size: 15px;
  font-weight: 700;
}

.grid-count {
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 1px 8px;
}

.grid-hint {
  flex: 1;
  text-align: right;
  font-size: 12px;
  color: var(--text-tertiary);
}

.grid-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.grid-empty-icon {
  font-size: 36px;
  opacity: 0.5;
}

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

/* 库卡片：无单击预览 / 双击编辑交互，保持默认光标 */
.note-card.vault-card {
  cursor: default;
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

.note-card-excerpt {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: calc(1.6em * 3);
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
