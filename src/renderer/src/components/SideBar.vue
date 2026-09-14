<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '../stores/app'
import { useTreeStore } from '../stores/tree'
import { useTrashStore } from '../stores/trash'
import { useNoteActions } from '../composables/actions'
import { useGitStore } from '../stores/git'
import type { VaultInfo } from '@shared/types'
import VaultNode from './VaultNode.vue'

const app = useAppStore()
const tree = useTreeStore()
const trash = useTrashStore()
const git = useGitStore()
const actions = useNoteActions()

function toggleSection(): void {
  tree.vaultSectionOpen = !tree.vaultSectionOpen
}

/** 点击库行：展开/收起，并更新位置上下文（Ctrl+N 新建目标） */
function clickVaultRow(vault: string): void {
  tree.toggleVault(vault)
  tree.setLocation(vault, '')
}

/** 点击「常用 / 收藏 / 笔记库」标题：在主区域打开对应卡片网格；再点一次关闭 */
/** 正在显示下拉菜单的库行：菜单打开期间保持按钮组可见，防止 popper 失去锚点在左上角闪现 */
const openVaultMenu = ref<string | null>(null)

function onVaultMenuVisible(visible: boolean, vaultName: string): void {
  if (visible) {
    openVaultMenu.value = vaultName
  } else {
    setTimeout(() => {
      if (openVaultMenu.value === vaultName) openVaultMenu.value = null
    }, 300)
  }
}

function toggleGrid(section: 'recents' | 'favorites' | 'vaults' | 'tags', tagId?: string): void {
  if (section === 'tags' && tagId) {
    if (app.view.name === 'grid' && app.view.section === 'tags' && app.view.tagId === tagId) {
      app.view = { name: 'welcome' }
    } else {
      app.view = { name: 'grid', section: 'tags', tagId }
    }
    return
  }
  app.toggleGridSection(section)
}

function isGridOpen(section: 'recents' | 'favorites' | 'vaults' | 'tags', tagId?: string): boolean {
  if (app.view.name !== 'grid' || app.view.section !== section) return false
  if (section === 'tags') return app.view.tagId === tagId
  return true
}

const TAG_COLORS = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#1abc9c','#95a5a6']

async function createTag(): Promise<void> {
  const { value } = await ElMessageBox.prompt('标签名称', '新建标签', {
    confirmButtonText: '创建',
    cancelButtonText: '取消',
    inputPattern: /\S+/,
    inputErrorMessage: '标签名不能为空'
  })
  const color = TAG_COLORS[tree.tags.length % TAG_COLORS.length]
  const result = await window.trace.createTag(value.trim(), color)
  if (result.ok) {
    await tree.loadTags()
    ElMessage.success('标签已创建')
  } else {
    ElMessage.error(result.error ?? '创建失败')
  }
}

async function handleTagMenu(cmd: string, tag: { id: string; name: string; color: string }): Promise<void> {
  if (cmd === 'rename') {
    const { value } = await ElMessageBox.prompt('新名称', '重命名标签', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: tag.name,
      inputPattern: /\S+/,
      inputErrorMessage: '标签名不能为空'
    })
    const result = await window.trace.renameTag(tag.id, value.trim())
    if (result.ok) await tree.loadTags()
    else ElMessage.error(result.error ?? '重命名失败')
  } else if (cmd === 'color') {
    // 打开选色弹窗（预设色板 + 自定义拾色器）
    colorDialog.value = { visible: true, id: tag.id, name: tag.name, color: tag.color }
  } else if (cmd === 'delete') {
    await ElMessageBox.confirm(`确定删除标签「${tag.name}」？关联的笔记不会被删除。`, '删除标签', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await window.trace.deleteTag(tag.id)
    await tree.loadTags()
    ElMessage.success('标签已删除')
  }
}

// ---------- 标签颜色选择弹窗 ----------
const colorDialog = ref<{ visible: boolean; id: string; name: string; color: string } | null>(null)

async function applyTagColor(): Promise<void> {
  const dialog = colorDialog.value
  if (!dialog) return
  const result = await window.trace.setTagColor(dialog.id, dialog.color)
  if (result.ok) {
    await tree.loadTags()
    colorDialog.value = null
    ElMessage.success('颜色已更新')
  } else {
    ElMessage.error(result.error ?? '颜色修改失败')
  }
}

const colorDialogVisible = computed(() => !!colorDialog.value?.visible)

const colorDialogColor = computed<string>({
  get: () => colorDialog.value?.color ?? TAG_COLORS[0],
  set: (v) => {
    if (colorDialog.value && v) colorDialog.value.color = v
  }
})

function handleVaultCommand(cmd: string, vault: string): void {
  if (cmd === 'sync') void git.sync(vault)
  else if (cmd === 'associate') void git.openAssociate(vault)
  else if (cmd === 'disconnect') void git.disconnect(vault)
  else if (cmd === 'rename') actions.renameVault(vault)
  else if (cmd === 'delete') void actions.deleteVault(vault)
}

function handleVaultPlus(cmd: string, vault: string): void {
  if (cmd === 'dir') actions.createDir(vault, '')
  else if (cmd === 'note') actions.createNote(vault, '')
}

defineProps<{ vaults?: VaultInfo[] }>()
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">迹</div>
      <div class="sidebar-title">Trace 笔迹</div>
    </div>

    <div class="sidebar-scroll">
      <!-- 常用：点击标题在主区域打开卡片网格 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ active: isGridOpen('recents') }"
          @click="toggleGrid('recents')"
        >
          <el-icon><Clock /></el-icon>
          <span>常用</span>
          <span v-if="tree.recents.length" class="side-section-count">{{
            tree.recents.length
          }}</span>
        </div>
      </div>

      <!-- 收藏：点击标题在主区域打开卡片网格 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ active: isGridOpen('favorites') }"
          @click="toggleGrid('favorites')"
        >
          <el-icon><Star /></el-icon>
          <span>收藏</span>
          <span v-if="tree.favorites.length" class="side-section-count">{{
            tree.favorites.length
          }}</span>
        </div>
      </div>

      <!-- 标签：点击标签筛选笔记（区块标题不随选中标签高亮，如同选中笔记不点亮其父文件夹） -->
      <div class="side-section">
        <div
          class="side-section-header"
          @click="tree.tags.length ? toggleGrid('tags', tree.tags[0].id) : createTag()"
        >
          <el-icon><PriceTag /></el-icon>
          <span>标签</span>
          <span v-if="tree.tags.length" class="side-section-count">{{ tree.tags.length }}</span>
          <button class="side-section-add" title="新建标签" @click.stop="createTag()">
            <el-icon><Plus /></el-icon>
          </button>
        </div>
        <div v-if="tree.tags.length" class="tag-list">
          <div
            v-for="tag in tree.tags"
            :key="tag.id"
            class="tag-row"
            :class="{ active: isGridOpen('tags', tag.id) }"
            @click="toggleGrid('tags', tag.id)"
          >
            <span class="tag-dot" :style="{ background: tag.color }" />
            <span class="tag-name">{{ tag.name }}</span>
            <el-dropdown trigger="click" @command="(cmd: string) => handleTagMenu(cmd, tag)" popper-class="dd-instant-hide">
              <button class="row-btn tag-menu-btn" title="更多操作" @click.stop>
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">重命名</el-dropdown-item>
                  <el-dropdown-item command="color">更换颜色</el-dropdown-item>
                  <el-dropdown-item command="delete" divided class="danger-item">删除标签</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>

      <!-- 回收站：点击标题直接进入 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ active: app.view.name === 'trash' }"
          @click="app.view = { name: 'trash' }"
        >
          <el-icon><Delete /></el-icon>
          <span>回收站</span>
          <span v-if="trash.entries.length" class="side-section-count">{{
            trash.entries.length
          }}</span>
        </div>
      </div>

      <!-- 笔记库：箭头展开树，标题打开库网格 -->
      <div class="side-section">
        <!-- 注意：tooltip 不能包住按钮/下拉菜单（el-tooltip 会拦截子元素点击），只包纯文本 -->
        <div
          class="side-section-header"
          :class="{ collapsed: !tree.vaultSectionOpen, active: isGridOpen('vaults') }"
          title="点击查看全部笔记库"
          @click="toggleGrid('vaults')"
        >
          <span class="chevron-hit" title="展开 / 收起" @click.stop="toggleSection()">
            <el-icon class="chevron"><ArrowDown /></el-icon>
          </span>
          <span>笔记库</span>
          <span v-if="tree.vaults.length" class="side-section-count">{{ tree.vaults.length }}</span>
          <button class="row-btn" @click.stop="actions.createVault()">
            <el-icon><Plus /></el-icon>
          </button>
        </div>
        <template v-if="tree.vaultSectionOpen">
          <div v-if="tree.vaults.length === 0" class="empty-hint">
            还没有笔记库，点击右上角 + 创建
          </div>
          <div v-for="vault in tree.vaults" :key="vault.name">
            <div
              class="side-row vault-row"
              :class="{ 'menu-hold': openVaultMenu === vault.name, located: tree.locateKey === vault.name }"
              :data-locate="vault.name"
              @click="clickVaultRow(vault.name)"
            >
              <el-icon class="chevron" :class="{ open: tree.isVaultExpanded(vault.name) }">
                <ArrowRight />
              </el-icon>
              <el-icon class="node-icon"><Folder /></el-icon>
              <span class="row-name">{{ vault.name }}</span>
              <el-icon v-if="tree.gitStatuses[vault.name]?.associated" class="git-badge">
                <Connection />
              </el-icon>
              <span class="side-row-actions">
                <el-dropdown
                  trigger="click"
                  @command="(cmd: string) => handleVaultCommand(cmd, vault.name)"
                  @visible-change="(v: boolean) => onVaultMenuVisible(v, vault.name)" popper-class="dd-instant-hide">
                  <!-- 下拉触发器不能用 el-tooltip 包裹（会拦截点击使菜单失效），用原生 title -->
                  <button class="row-btn" title="笔记库设置" @click.stop>
                    <el-icon><Setting /></el-icon>
                  </button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item
                        v-if="tree.gitStatuses[vault.name]?.associated"
                        command="sync"
                      >
                        立即同步
                      </el-dropdown-item>
                      <el-dropdown-item command="associate">
                        {{
                          tree.gitStatuses[vault.name]?.associated
                            ? '重新关联 Git 仓库'
                            : '关联 Git 仓库'
                        }}
                      </el-dropdown-item>
                      <el-dropdown-item
                        v-if="tree.gitStatuses[vault.name]?.associated"
                        command="disconnect"
                        divided
                      >
                        解除关联
                      </el-dropdown-item>
                      <el-dropdown-item command="rename" divided>重命名</el-dropdown-item>
                      <el-dropdown-item command="delete" class="danger-item"
                        >删除笔记库</el-dropdown-item
                      >
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-dropdown
                  trigger="click"
                  @command="(cmd: string) => handleVaultPlus(cmd, vault.name)"
                  @visible-change="(v: boolean) => onVaultMenuVisible(v, vault.name)" popper-class="dd-instant-hide">
                  <button class="row-btn" title="新建文件夹 / 笔记" @click.stop>
                    <el-icon><Plus /></el-icon>
                  </button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="dir">新建文件夹</el-dropdown-item>
                      <el-dropdown-item command="note">创建笔记</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </span>
            </div>
            <template v-if="tree.isVaultExpanded(vault.name)">
              <VaultNode
                v-for="node in tree.trees[vault.name] ?? []"
                :key="node.path"
                :vault="vault.name"
                :node="node"
                :depth="0"
              />
            </template>
          </div>
        </template>
      </div>
    </div>

    <div class="sidebar-footer">
      <!-- 专注模式浮层中隐藏：由导航条的 Fold 按钮负责关闭浮层 -->
      <button class="row-btn" @click="app.toggleSidebar()">
        <el-icon><Fold /></el-icon>
      </button>
      <button class="row-btn" @click="app.view = { name: 'settings', tab: 'general' }">
        <el-icon><Setting /></el-icon>
      </button>
    </div>

    <!-- 标签颜色选择弹窗 -->
    <el-dialog
      :model-value="colorDialogVisible"
      :title="`标签颜色 — ${colorDialog?.name ?? ''}`"
      width="320px"
      append-to-body
      @update:model-value="colorDialog = null"
    >
      <div class="color-swatch-grid">
        <button
          v-for="c in TAG_COLORS"
          :key="c"
          class="color-swatch"
          :class="{ active: colorDialogColor === c }"
          :style="{ background: c }"
          @click="colorDialogColor = c"
        />
      </div>
      <div class="color-custom-row">
        <span class="color-custom-label">自定义</span>
        <el-color-picker v-model="colorDialogColor" :show-alpha="false" />
      </div>
      <template #footer>
        <el-button @click="colorDialog = null">取消</el-button>
        <el-button type="primary" @click="applyTagColor">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 标签颜色选择弹窗 */
.color-swatch-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
}

.color-swatch {
  height: 26px;
  border: 2px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.active {
  border-color: var(--text-primary);
}

.color-custom-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.color-custom-label {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
