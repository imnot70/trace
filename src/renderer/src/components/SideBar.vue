<script setup lang="ts">
import { ref } from 'vue'
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

function toggleGrid(section: 'recents' | 'favorites' | 'vaults'): void {
  app.toggleGridSection(section)
}

function isGridOpen(section: 'recents' | 'favorites' | 'vaults'): boolean {
  return app.view.name === 'grid' && app.view.section === section
}

function handleVaultCommand(cmd: string, vault: string): void {
  if (cmd === 'sync') void git.sync(vault)
  else if (cmd === 'associate') git.openAssociate(vault)
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
  </div>
</template>
