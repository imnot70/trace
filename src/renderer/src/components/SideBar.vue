<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import { useNoteActions } from '../composables/actions'
import { useGitStore } from '../stores/git'
import type { VaultInfo } from '@shared/types'
import VaultNode from './VaultNode.vue'

const app = useAppStore()
const tree = useTreeStore()
const editor = useEditorStore()
const git = useGitStore()
const actions = useNoteActions()

const expandedSections = ref<Record<string, boolean>>({
  recents: true,
  favorites: true,
  trash: true,
  vaults: true
})

function toggleSection(key: string): void {
  expandedSections.value[key] = !expandedSections.value[key]
}

const editorKey = computed(() =>
  editor.current ? `${editor.current.vault}::${editor.current.path}` : ''
)

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
      <!-- 常用 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ collapsed: !expandedSections.recents }"
          @click="toggleSection('recents')"
        >
          <el-icon class="chevron"><CaretBottom /></el-icon>
          <el-icon><Clock /></el-icon>
          <span>常用</span>
        </div>
        <template v-if="expandedSections.recents">
          <div v-if="tree.recents.length === 0" class="empty-hint">最近打开的笔记会显示在这里</div>
          <div
            v-for="item in tree.recents"
            :key="`${item.vault}::${item.path}`"
            class="side-row"
            :class="{ active: editorKey === `${item.vault}::${item.path}` }"
            :title="`${item.vault} / ${item.path}`"
            @click="actions.openNote(item.vault, item.path, item.name)"
          >
            <el-icon class="node-icon"><Document /></el-icon>
            <span class="row-name">{{ item.name }}</span>
          </div>
        </template>
      </div>

      <!-- 收藏 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ collapsed: !expandedSections.favorites }"
          @click="toggleSection('favorites')"
        >
          <el-icon class="chevron"><CaretBottom /></el-icon>
          <el-icon><Star /></el-icon>
          <span>收藏</span>
        </div>
        <template v-if="expandedSections.favorites">
          <div v-if="tree.favorites.length === 0" class="empty-hint">收藏的笔记会显示在这里</div>
          <div
            v-for="item in tree.favorites"
            :key="item.id"
            class="side-row"
            :class="{ active: editorKey === `${item.vault}::${item.path}` }"
            :title="`${item.vault} / ${item.path}`"
            @click="actions.openNote(item.vault, item.path, item.name)"
          >
            <el-icon class="node-icon"><Document /></el-icon>
            <span class="row-name">{{ item.name }}</span>
          </div>
        </template>
      </div>

      <!-- 回收站 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ collapsed: !expandedSections.trash }"
          @click="toggleSection('trash')"
        >
          <el-icon class="chevron"><CaretBottom /></el-icon>
          <el-icon><Delete /></el-icon>
          <span>回收站</span>
        </div>
        <template v-if="expandedSections.trash">
          <div
            class="side-row"
            :class="{ active: app.view.name === 'trash' }"
            @click="app.view = { name: 'trash' }"
          >
            <el-icon class="node-icon"><FolderOpened /></el-icon>
            <span class="row-name">查看回收站</span>
          </div>
        </template>
      </div>

      <!-- 笔记库 -->
      <div class="side-section">
        <div
          class="side-section-header"
          :class="{ collapsed: !expandedSections.vaults }"
          @click="toggleSection('vaults')"
        >
          <el-icon class="chevron"><CaretBottom /></el-icon>
          <el-icon><Collection /></el-icon>
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
                <CaretRight />
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
