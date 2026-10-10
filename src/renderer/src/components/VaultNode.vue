<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronRight as ArrowRight,
  Folder,
  FileText as Document,
  Plus,
  Ellipsis as MoreFilled
} from 'lucide-vue-next'
import type { TreeNode } from '@shared/types'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import { useNoteActions } from '../composables/actions'
import { useAppStore } from '../stores/app'
import { defsToVM, dirContextItems, noteContextItems, treeDirItems, treeNoteItems, treePlusItems } from '../composables/menuItems'
import { beginNoteRefDrag } from '../lib/dragDrop'
import TagPickerDialog from './TagPickerDialog.vue'
import ShareGistDialog from './ShareGistDialog.vue'
import NoteInfoDialog from './NoteInfoDialog.vue'

const props = defineProps<{
  vault: string
  node: TreeNode
  depth: number
}>()

const tree = useTreeStore()
const editor = useEditorStore()
const actions = useNoteActions()

/** 下拉打开期间保持按钮组可见（防 popper 失锚闪现），关闭后延迟隐藏 */
const menuHold = ref(false)
let menuHideTimer: ReturnType<typeof setTimeout> | null = null

function onMenuVisible(visible: boolean): void {
  if (menuHideTimer) {
    clearTimeout(menuHideTimer)
    menuHideTimer = null
  }
  if (visible) {
    menuHold.value = true
  } else {
    menuHideTimer = setTimeout(() => {
      menuHold.value = false
    }, 300)
  }
}

const isDir = computed(() => props.node.kind === 'dir')
const expanded = computed(() => tree.isExpanded(props.vault, props.node.path))
const active = computed(() => editor.activeKey === `${props.vault}::${props.node.path}`)
const favorited = computed(() =>
  tree.favorites.some((f) => f.vault === props.vault && f.path === props.node.path)
)

function onRowClick(): void {
  if (isDir.value) {
    tree.toggleExpand(props.vault, props.node.path)
    // 点击文件夹更新位置上下文（Ctrl+N 新建目标）
    tree.setLocation(props.vault, props.node.path)
  } else {
    void actions.openNote(props.vault, props.node.path, props.node.name)
  }
}

/** 拖曳插入引用（FR-2.9.10 P3）：笔记行可拖（文件夹不可），载荷 path 含 .md。
 *  遮罩让行 / 恢复由 beginNoteRefDrag 内部统一处理（document 级一次性 dragend） */
function onRowDragStart(e: DragEvent): void {
  if (isDir.value) return
  beginNoteRefDrag(e, { vault: props.vault, path: props.node.path, name: props.node.name })
}

function handleMenuCommand(cmd: string): void {
  if (cmd === 'exportPdf') {
    if (isDir.value) actions.exportFolderPdf(props.vault, props.node.path)
    else void actions.exportNotes([{ vault: props.vault, path: props.node.path, name: props.node.name }])
    return
  }
  if (cmd === 'exportPdfMerge') {
    if (isDir.value) void actions.exportFolderMergePdf(props.vault, props.node.path)
    else void actions.exportMergePdf([{ vault: props.vault, path: props.node.path, name: props.node.name }], tree, editor)
    return
  }
  if (cmd === 'exportHtml') {
    if (isDir.value) actions.exportFolderHtml(props.vault, props.node.path)
    else void actions.exportNotesHtml([{ vault: props.vault, path: props.node.path, name: props.node.name }])
    return
  }
  if (cmd === 'rename') {
    if (isDir.value) actions.renameDir(props.vault, props.node.path, props.node.name)
    else actions.renameNote(props.vault, props.node.path, props.node.name)
  } else if (cmd === 'move') {
    actions.moveNode(props.vault, props.node.path, props.node.kind, props.node.name)
  } else if (cmd === 'delete') {
    if (isDir.value) void actions.deleteDir(props.vault, props.node.path, props.node.name)
    else void actions.deleteNote(props.vault, props.node.path, props.node.name)
  } else if (cmd === 'favorite' || cmd === 'unfavorite') {
    void actions.toggleFavorite(props.vault, props.node.path, props.node.name, cmd === 'unfavorite')
  } else if (cmd === 'info') {
    infoDialogVisible.value = true
  } else if (cmd === 'tag') {
    tagDialogVisible.value = true
  } else if (cmd === 'share') {
    shareDialogVisible.value = true
  } else if (cmd === 'newDir') {
    // 右键并集（FR-2.4.29 D7）：树菜单原本无新建入口（由 ⋔ + 按钮承担），右键补齐
    actions.createDir(props.vault, props.node.path)
  } else if (cmd === 'newNote') {
    actions.createNote(props.vault, props.node.path)
  } else if (cmd === 'locate') {
    tree.revealNode(props.vault, props.node.path, props.node.kind)
  }
}

/** 树行右键（FR-2.4.29）：并集菜单，动作全部落到既有 handleMenuCommand（单一定义源） */
function onRowContextmenu(e: MouseEvent): void {
  const defs = isDir.value ? dirContextItems() : noteContextItems(favorited.value)
  useAppStore().openContextMenu({ x: e.clientX, y: e.clientY, items: defsToVM(defs, handleMenuCommand) })
}

function handlePlusCommand(cmd: string): void {
  if (cmd === 'dir') actions.createDir(props.vault, props.node.path)
  else if (cmd === 'note') actions.createNote(props.vault, props.node.path)
}

// ---------- 标签选择 / 分享弹窗（仅笔记；按需渲染） ----------
const tagDialogVisible = ref(false)
const shareDialogVisible = ref(false)
/** 信息弹窗（FR-2.6.6 扩展）：与标签 / 分享同款按需渲染 */
const infoDialogVisible = ref(false)

</script>

<template>
  <div>
    <div
      class="tree-row"
      :class="{ active, located: tree.locateKey === `${vault}::${node.path}`, 'menu-hold': menuHold }"
      :data-locate="`${vault}::${node.path}`"
      :style="{ paddingLeft: `${40 + depth * 16}px` }"
      :draggable="!isDir"
      @click="onRowClick"
      @dragstart="onRowDragStart"
      @contextmenu.prevent="onRowContextmenu"
    >
      <span class="chevron" :class="{ open: isDir && expanded }">
        <el-icon v-if="isDir"><ArrowRight /></el-icon>
      </span>
      <el-icon class="node-icon">
        <Folder v-if="isDir" />
        <Document v-else />
      </el-icon>
      <span class="row-name">{{ node.name }}</span>
      <span class="side-row-actions">
        <el-dropdown
          v-if="isDir"
          trigger="click"
          @command="handlePlusCommand"
          @visible-change="onMenuVisible" popper-class="dd-instant-hide">
          <!-- 下拉触发器不能用 el-tooltip 包裹（会拦截点击使菜单失效），用原生 title -->
          <button class="row-btn" title="新建文件夹 / 笔记" @click.stop>
            <el-icon><Plus /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="d in treePlusItems"
                :key="d.command"
                :command="d.command"
              >{{ d.label }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click" @command="handleMenuCommand" @visible-change="onMenuVisible" popper-class="dd-instant-hide">
          <button class="row-btn" title="更多操作" @click.stop>
            <el-icon><MoreFilled /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <!-- 菜单定义走 composables/menuItems 单一来源（FR-2.4.29）：与右键菜单同源 -->
              <el-dropdown-item
                v-for="d in isDir ? treeDirItems() : treeNoteItems(favorited)"
                :key="d.command"
                :command="d.command"
                :divided="d.divided"
                :class="{ 'danger-item': d.danger }"
              >{{ d.label }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </span>
    </div>
    <TagPickerDialog
      v-if="tagDialogVisible"
      :visible="tagDialogVisible"
      :note="{ vault, path: node.path, name: node.name }"
      @update:visible="tagDialogVisible = $event"
      @changed="void tree.loadTags()"
    />
    <ShareGistDialog
      v-if="shareDialogVisible"
      :visible="shareDialogVisible"
      :note="{ vault, path: node.path, name: node.name }"
      @update:visible="shareDialogVisible = $event"
      @changed="void tree.loadShared()"
    />
    <NoteInfoDialog
      v-if="infoDialogVisible"
      :visible="infoDialogVisible"
      :note="{ vault, path: node.path, name: node.name }"
      @update:visible="infoDialogVisible = $event"
    />
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
