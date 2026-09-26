<template>
  <el-dialog
    :model-value="visible"
    title="保存为笔记"
    width="420px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v: boolean) => !v && draft.cancelPromote()"
    @close="draft.cancelPromote()"
  >
    <div class="promote-form">
      <div class="form-row">
        <span class="form-label">目标库</span>
        <el-select v-model="vault">
          <el-option v-for="v in tree.vaults" :key="v.name" :label="v.name" :value="v.name" />
        </el-select>
      </div>
      <div class="form-row">
        <span class="form-label">目录</span>
        <div class="dir-tree">
          <div
            v-for="d in allDirs"
            :key="d"
            class="dir-node"
            :class="{ selected: dir === d }"
            @click="dir = d"
          >
            📁 <span>{{ d === '' ? '（根目录）' : d }}</span>
          </div>
        </div>
      </div>
      <div class="form-row">
        <span class="form-label">笔记名</span>
        <el-input v-model="newName" placeholder="笔记名" @keydown.enter="confirm" />
      </div>
      <p class="promote-hint">保存后草稿将移入笔记库，参与搜索、双链与 Git 同步；草稿内引用的图片会一并迁移。</p>
    </div>
    <template #footer>
      <el-button @click="draft.cancelPromote()">取消</el-button>
      <el-button type="primary" :disabled="!newName.trim()" @click="confirm">保存为笔记</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TreeNode } from '@shared/types'
import { useDraftStore } from '../stores/draft'
import { useTreeStore } from '../stores/tree'

const draft = useDraftStore()
const tree = useTreeStore()

const visible = computed(() => draft.promoteName !== null)
const vault = ref(tree.vaults[0]?.name ?? '')
const dir = ref('')
const nodes = ref<TreeNode[]>([])
const newName = ref('')

// 打开时初始化：库名 / 目录 / 默认笔记名
watch(
  () => draft.promoteName,
  async (name) => {
    if (name === null) return
    vault.value = tree.vaults[0]?.name ?? ''
    dir.value = ''
    newName.value = defaultName(name)
    await loadTree()
  }
)

watch(vault, () => void loadTree())

async function loadTree(): Promise<void> {
  if (!vault.value) {
    nodes.value = []
    return
  }
  const result = await window.trace.listTree(vault.value)
  nodes.value = result.ok && result.nodes ? result.nodes : []
}

/** 递归拍平所有目录路径（含根 ''），供目录选择列表 */
function collectDirPaths(nodes: TreeNode[], prefix = ''): string[] {
  const out: string[] = prefix === '' ? [''] : []
  for (const node of nodes) {
    if (node.kind !== 'dir') continue
    const rel = prefix ? `${prefix}/${node.name}` : node.name
    out.push(rel)
    if (node.children) out.push(...collectDirPaths(node.children, rel))
  }
  return out
}

const allDirs = computed(() => collectDirPaths(nodes.value))

function defaultName(draftName: string): string {
  return draftName.replace(/\.md$/i, '').replace(/^速记\s*\d{4}(-\d{4})?\s*/, '').trim() || draftName.replace(/\.md$/i, '')
}

async function confirm(): Promise<void> {
  const name = newName.value.trim()
  if (!name || !vault.value) return
  await draft.promote(vault.value, dir.value, name)
}
</script>

<style scoped>
.promote-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.form-label {
  width: 56px;
  flex-shrink: 0;
  padding-top: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
.dir-tree {
  flex: 1;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px;
}
.dir-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
}
.dir-node:hover {
  background: var(--bg-hover);
}
.dir-node.selected {
  background: var(--accent-soft);
  color: var(--text-primary);
}
.promote-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
</style>
