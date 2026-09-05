<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useGitStore } from '../stores/git'
import { useAppStore } from '../stores/app'
import { useRemoteRepos } from '../stores/trash'
import { useTreeStore } from '../stores/tree'

const git = useGitStore()
const app = useAppStore()
const repos = useRemoteRepos()
const tree = useTreeStore()

const filter = ref('')
const selected = ref('')
const creating = ref(false)
const newName = ref('')
const newPrivate = ref(true)
const busy = ref(false)

const visible = computed(() => git.associateVault !== null)

onMounted(() => {
  void git.refreshAccount()
})

watch(visible, async (v) => {
  if (v) {
    selected.value = ''
    filter.value = ''
    creating.value = false
    newName.value = ''
    if (git.account.loggedIn) void repos.load()
  }
})

const filteredRepos = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return repos.repos
  return repos.repos.filter((r) => r.fullName.toLowerCase().includes(q))
})

function goLogin(): void {
  git.closeAssociate()
  app.view = { name: 'settings', tab: 'account' }
}

async function confirmAssociate(): Promise<void> {
  const vault = git.associateVault
  if (!vault) return
  let fullName = selected.value
  if (creating.value) {
    if (!newName.value.trim()) {
      ElMessage.warning('请输入仓库名称')
      return
    }
    busy.value = true
    const error = await repos.create(newName.value.trim(), newPrivate.value)
    busy.value = false
    if (error) {
      ElMessage.error(error)
      return
    }
    fullName = newName.value.trim()
    // 若以 owner/ 前缀创建过，优先用列表里最新的同名项
    const hit = repos.repos.find((r) => r.fullName.toLowerCase().endsWith(`/${fullName!.toLowerCase()}`))
    if (hit) fullName = hit.fullName
  }
  if (!fullName) {
    ElMessage.warning('请选择一个仓库或新建仓库')
    return
  }
  busy.value = true
  const result = await window.trace.associateVault(vault, fullName)
  busy.value = false
  if (result.ok) {
    ElMessage.success(`已关联 ${fullName}`)
    git.closeAssociate()
    await tree.refreshGitStatus(vault)
  } else if (result.conflicts?.length) {
    ElMessage.error(`已关联但同步冲突：${result.conflicts.join('、')}`)
    git.closeAssociate()
  } else {
    ElMessage.error(result.error ?? '关联失败')
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`关联 Git 仓库 — ${git.associateVault ?? ''}`"
    width="560px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="git.closeAssociate()"
  >
    <template v-if="!git.account.loggedIn">
      <el-empty description="尚未登录 GitHub 账号">
        <p style="color: var(--text-tertiary); font-size: 13px">
          关联远程仓库前需要先登录 GitHub 账号（使用 Personal Access Token）
        </p>
        <el-button type="primary" @click="goLogin">去登录</el-button>
      </el-empty>
    </template>

    <template v-else>
      <div style="display: flex; gap: 8px; margin-bottom: 12px">
        <el-radio-group :model-value="creating ? 'create' : 'select'" @update:model-value="(v) => (creating = v === 'create')">
          <el-radio-button value="select">选择已有仓库</el-radio-button>
          <el-radio-button value="create">新建仓库</el-radio-button>
        </el-radio-group>
      </div>

      <template v-if="!creating">
        <el-input v-model="filter" placeholder="搜索仓库…" clearable style="margin-bottom: 10px" />
        <div v-if="repos.loading" style="text-align: center; padding: 20px">
          <el-icon class="is-loading"><Loading /></el-icon>
        </div>
        <el-alert v-else-if="repos.error" :title="repos.error" type="error" :closable="false" />
        <el-empty v-else-if="filteredRepos.length === 0" description="没有找到仓库" :image-size="60" />
        <div v-else class="repo-list">
          <div
            v-for="repo in filteredRepos"
            :key="repo.fullName"
            class="repo-item"
            :class="{ selected: selected === repo.fullName }"
            @click="selected = repo.fullName"
          >
            <el-icon><Collection /></el-icon>
            <span class="repo-name">{{ repo.fullName }}</span>
            <el-tag v-if="repo.private" size="small" type="info" effect="plain">私有</el-tag>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="setting-row">
          <span class="setting-label">仓库名称</span>
          <el-input v-model="newName" placeholder="例如：my-notes" />
        </div>
        <div class="setting-row">
          <span class="setting-label">可见性</span>
          <el-switch v-model="newPrivate" active-text="私有" inactive-text="公开" />
        </div>
        <p class="settings-desc">将在你的 GitHub 账号下创建空仓库并推送当前笔记库内容。</p>
      </template>
    </template>

    <template #footer>
      <el-button @click="git.closeAssociate()">取消</el-button>
      <el-button
        v-if="git.account.loggedIn"
        type="primary"
        :loading="busy || repos.loading"
        @click="confirmAssociate"
      >
        关联并同步
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.repo-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.repo-item:hover {
  background: var(--bg-hover);
}

.repo-item.selected {
  background: var(--bg-active);
}

.repo-name {
  flex: 1;
  font-family: monospace;
}
</style>
