<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useTreeStore } from '../stores/tree'
import { useNoteActions } from '../composables/actions'
import { useGitStore } from '../stores/git'
import type { VaultInfo } from '@shared/types'
import VaultNode from './VaultNode.vue'

const app = useAppStore()
const tree = useTreeStore()
const git = useGitStore()
const actions = useNoteActions()

const expandedSections = ref<Record<string, boolean>>({
  vaults: true
})

function toggleSection(key: string): void {
  expandedSections.value[key] = !expandedSections.value[key]
}

/** 点击「常用 / 收藏」标题：在主区域打开对应卡片网格；再点一次关闭 */
function toggleGrid(section: 'recents' | 'favorites'): void {
  if (app.view.name === 'grid' && app.view.section === section) app.view = { name: 'welcome' }
  else app.view = { name: 'grid', section }
}

function isGridOpen(section: 'recents' | 'favorites'): boolean {
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
          title="查看常用笔记"
          @click="toggleGrid('recents')"
        >
          <el-icon><Clock /></el-icon>
          <span>常用</span>
          <span v-if="tree.recents.length" class="side-section-count">{{ tree.recents.length }}</span>
        </div>
      </div>

      <!-- 收藏：点击标题在主区域打开卡片网格 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ active: isGridOpen('favorites') }"
          title="查看收藏笔记"
          @click="toggleGrid('favorites')"
        >
          <el-icon><Star /></el-icon>
          <span>收藏</span>
          <span v-if="tree.favorites.length" class="side-section-count">{{ tree.favorites.length }}</span>
        </div>
      </div>

      <!-- 回收站：点击标题直接进入（占位对齐其他区块的展开箭头） -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ active: app.view.name === 'trash' }"
          title="打开回收站"
          @click="app.view = { name: 'trash' }"
        >
          <el-icon><Delete /></el-icon>
          <span>回收站</span>
        </div>
      </div>

      <!-- 笔记库 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ collapsed: !expandedSections.vaults }"
          @click="toggleSection('vaults')"
        >
          <span class="chevron-hit">
            <el-icon class="chevron"><ArrowDown /></el-icon>
          </span>
          <span>笔记库</span>
          <span style="flex: 1"></span>
          <el-tooltip content="创建笔记库" placement="top">
            <button class="row-btn" @click.stop="actions.createVault()">
              <el-icon><Plus /></el-icon>
            </button>
          </el-tooltip>
        </div>
        <template v-if="expandedSections.vaults">
          <div v-if="tree.vaults.length === 0" class="empty-hint">还没有笔记库，点击右上角 + 创建</div>
          <div v-for="vault in tree.vaults" :key="vault.name">
            <div
              class="side-row vault-row"
              @click="tree.toggleVault(vault.name)"
            >
              <el-icon class="chevron" :class="{ open: tree.isVaultExpanded(vault.name) }">
                <ArrowRight />
              </el-icon>
              <el-icon class="node-icon"><Folder /></el-icon>
              <span class="row-name">{{ vault.name }}</span>
              <el-icon v-if="tree.gitStatuses[vault.name]?.associated" class="git-badge" title="已关联 Git 仓库">
                <Connection />
              </el-icon>
              <span class="side-row-actions">
                <el-dropdown trigger="click" @command="(cmd: string) => handleVaultCommand(cmd, vault.name)">
                  <button class="row-btn" title="笔记库设置" @click.stop>
                    <el-icon><Setting /></el-icon>
                  </button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-if="tree.gitStatuses[vault.name]?.associated" command="sync">
                        立即同步
                      </el-dropdown-item>
                      <el-dropdown-item command="associate">
                        {{ tree.gitStatuses[vault.name]?.associated ? '重新关联 Git 仓库' : '关联 Git 仓库' }}
                      </el-dropdown-item>
                      <el-dropdown-item v-if="tree.gitStatuses[vault.name]?.associated" command="disconnect" divided>
                        解除关联
                      </el-dropdown-item>
                      <el-dropdown-item command="rename" divided>重命名</el-dropdown-item>
                      <el-dropdown-item command="delete" class="danger-item">删除笔记库</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-dropdown trigger="click" @command="(cmd: string) => handleVaultPlus(cmd, vault.name)">
                  <button class="row-btn" title="新建" @click.stop>
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
      <el-tooltip content="设置" placement="top">
        <button class="row-btn" @click="app.view = { name: 'settings', tab: 'general' }">
          <el-icon><Setting /></el-icon>
        </button>
      </el-tooltip>
    </div>
  </div>
</template>
