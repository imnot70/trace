<script setup lang="ts">
import { computed } from 'vue'
import type { TreeNode } from '@shared/types'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import { useNoteActions } from '../composables/actions'

const props = defineProps<{
  vault: string
  node: TreeNode
  depth: number
}>()

const tree = useTreeStore()
const editor = useEditorStore()
const actions = useNoteActions()

const isDir = computed(() => props.node.kind === 'dir')
const expanded = computed(() => tree.isExpanded(props.vault, props.node.path))
const active = computed(
  () =>
    editor.current?.vault === props.vault && editor.current?.path === props.node.path
)

function onRowClick(): void {
  if (isDir.value) tree.toggleExpand(props.vault, props.node.path)
  else void actions.openNote(props.vault, props.node.path, props.node.name)
}

function handleMenuCommand(cmd: string): void {
  if (cmd === 'rename') {
    if (isDir.value) actions.renameDir(props.vault, props.node.path, props.node.name)
    else actions.renameNote(props.vault, props.node.path, props.node.name)
  } else if (cmd === 'delete') {
    if (isDir.value) void actions.deleteDir(props.vault, props.node.path, props.node.name)
    else void actions.deleteNote(props.vault, props.node.path, props.node.name)
  } else if (cmd === 'favorite' || cmd === 'unfavorite') {
    void actions.toggleFavorite(props.vault, props.node.path, props.node.name, cmd === 'unfavorite')
  }
}

function handlePlusCommand(cmd: string): void {
  if (cmd === 'dir') actions.createDir(props.vault, props.node.path)
  else if (cmd === 'note') actions.createNote(props.vault, props.node.path)
}
</script>

<template>
  <div>
    <div
      class="tree-row"
      :class="{ active }"
      :style="{ paddingLeft: `${24 + depth * 16}px` }"
      @click="onRowClick"
    >
      <span class="chevron" :class="{ open: isDir && expanded }">
        <el-icon v-if="isDir"><CaretRight /></el-icon>
      </span>
      <el-icon class="node-icon">
        <Folder v-if="isDir" />
        <Document v-else />
      </el-icon>
      <span class="row-name" :title="node.name">{{ node.name }}</span>
      <span class="side-row-actions">
        <el-dropdown
          v-if="isDir"
          trigger="click"
          @command="handlePlusCommand"
        >
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
        <el-dropdown trigger="click" @command="handleMenuCommand">
          <button class="row-btn" title="更多操作" @click.stop>
            <el-icon><MoreFilled /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <template v-if="isDir">
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="delete" class="danger-item">删除文件夹</el-dropdown-item>
              </template>
              <template v-else>
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="delete" class="danger-item">删除笔记</el-dropdown-item>
                <el-dropdown-item command="favorite" divided>收藏笔记</el-dropdown-item>
              </template>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </span>
    </div>
    <template v-if="isDir && expanded">
      <VaultNode
        v-for="child in node.children ?? []"
        :key="child.path"
        :vault="vault"
        :node="child"
        :depth="depth + 1"
      />
    </template>
  </div>
</template>
