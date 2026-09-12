<script setup lang="ts">
import { computed, ref, type PropType } from 'vue'
import type { TreeNode } from '@shared/types'

const props = defineProps({
  nodes: { type: Array as PropType<TreeNode[]>, required: true },
  vault: { type: String, required: true },
  srcPath: { type: String, required: true },
  srcKind: { type: String as PropType<'dir' | 'note'>, required: true },
  selectedPath: { type: String, required: true },
  depth: { type: Number, required: true }
})

const emit = defineEmits<{
  select: [path: string]
}>()

const expanded = ref<Record<string, boolean>>({})

const dirNodes = computed(() => props.nodes.filter((n: TreeNode) => n.kind === 'dir'))

function toggle(path: string): void {
  expanded.value[path] = !expanded.value[path]
}

function isDisabled(nodePath: string): boolean {
  if (props.srcKind === 'note') return false
  return nodePath === props.srcPath || nodePath.startsWith(props.srcPath + '/')
}

function hasDirChildren(node: TreeNode): boolean {
  return (node.children ?? []).some((c: TreeNode) => c.kind === 'dir')
}
</script>

<template>
  <div v-if="dirNodes.length > 0" class="move-tree-level">
    <div v-for="node in dirNodes" :key="node.path">
      <div
        class="move-node"
        :class="{ selected: selectedPath === node.path, disabled: isDisabled(node.path) }"
        :style="{ paddingLeft: `${(depth + 1) * 20 + 8}px` }"
        @click="!isDisabled(node.path) && emit('select', node.path)"
      >
        <span
          v-if="hasDirChildren(node)"
          class="expand-arrow"
          @click.stop="toggle(node.path)"
        >{{ expanded[node.path] ? '▼' : '▶' }}</span>
        <span v-else class="expand-arrow placeholder" />
        <span class="node-icon">📁</span>
        <span class="node-name">{{ node.name }}</span>
      </div>
      <MoveTreeLevel
        v-if="expanded[node.path] && hasDirChildren(node)"
        :nodes="node.children ?? []"
        :vault="vault"
        :src-path="srcPath"
        :src-kind="srcKind"
        :selected-path="selectedPath"
        :depth="depth + 1"
        @select="(path: string) => emit('select', path)"
      />
    </div>
  </div>
</template>
