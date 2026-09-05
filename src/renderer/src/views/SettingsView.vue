<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '../stores/app'
import { useGitStore } from '../stores/git'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import type { ThemeOption } from '@shared/types'

const app = useAppStore()
const git = useGitStore()
const tree = useTreeStore()
const editor = useEditorStore()

const tab = computed<'account' | 'plugins' | 'general'>({
  get: () => (app.view.name === 'settings' ? app.view.tab : 'general'),
  set: (value: string) => {
    app.view = { name: 'settings', tab: value as 'account' | 'plugins' | 'general' }
  }
})

// ---------- 账号 ----------
const tokenInput = ref('')
const tokenError = ref('')
const loggingIn = ref(false)
const PAT_URL = 'https://github.com/settings/personal-access-tokens/new'

async function login(): Promise<void> {
  if (!tokenInput.value.trim()) {
    tokenError.value = '请粘贴 Personal Access Token'
    return
  }
  loggingIn.value = true
  tokenError.value = ''
  const error = await git.login(tokenInput.value.trim())
  loggingIn.value = false
  if (error) tokenError.value = error
  else {
    ElMessage.success(`欢迎，${git.account.username}`)
    tokenInput.value = ''
    await tree.refreshAll()
  }
}

// ---------- 通用 ----------
const workspaceInput = ref('')

onMounted(() => {
  workspaceInput.value = app.workspaceRoot
  void git.refreshAccount()
  if (git.account.loggedIn) void tree.refreshAll()
})

watch(
  () => app.workspaceRoot,
  (value) => {
    workspaceInput.value = value
  }
)

async function chooseWorkspace(): Promise<void> {
  const dir = await window.trace.chooseDirectory(workspaceInput.value)
  if (dir) workspaceInput.value = dir
}

async function applyWorkspace(): Promise<void> {
  const error = await app.changeWorkspace(workspaceInput.value.trim())
  if (error) {
    ElMessage.error(error)
    return
  }
  await editor.closeNote()
  app.view = { name: 'welcome' }
  await tree.refreshAll()
  ElMessage.success('工作区已更新')
}

// ---------- 插件 ----------
const plugins = ref<{ id: string; name: string; version: string; description: string; enabled: boolean; loaded: boolean; error: string | null }[]>([])

async function loadPlugins(): Promise<void> {
  const result = await window.trace.listPlugins()
  if (result.ok && result.plugins) plugins.value = result.plugins
}

watch(
  () => tab.value,
  (t) => {
    if (t === 'plugins') void loadPlugins()
  },
  { immediate: true }
)

async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  await window.trace.setPluginEnabled(id, enabled)
  await loadPlugins()
}

async function toggleEnablePlugins(enabled: boolean): Promise<void> {
  await app.updateSettings({ enablePlugins: enabled })
  await loadPlugins()
}

const themeOptions: { label: string; value: 'light' | 'dark' | 'system' }[] = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'system' }
]
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2>设置</h2>
    </div>

    <el-tabs v-model="tab">
      <!-- 账号 -->
      <el-tab-pane label="账号" name="account">
        <div class="settings-block">
          <h3>GitHub 账号</h3>
          <p class="settings-desc">
            用于笔记库的 Git 云端同步。Trace 只申请仓库读写权限，令牌保存在系统加密存储中，不会上传。
          </p>

          <template v-if="!git.account.loggedIn">
            <div class="setting-row">
              <span class="setting-label">访问令牌</span>
              <el-input
                v-model="tokenInput"
                type="password"
                show-password
                placeholder="粘贴 Personal Access Token"
                style="flex: 1"
              />
              <el-button type="primary" :loading="loggingIn" @click="login">登录</el-button>
            </div>
            <div v-if="tokenError" style="color: var(--danger); font-size: 12px; margin: 4px 0 0 102px">
              {{ tokenError }}
            </div>
            <p class="settings-desc" style="margin-top: 10px">
              还没有令牌？
              <a :href="PAT_URL" target="_blank" style="color: var(--accent)">点击创建（勾选仓库读写权限）</a>
              ，创建后粘贴到上方输入框。
            </p>
          </template>

          <template v-else>
            <div class="setting-row">
              <el-icon :size="22" style="color: var(--accent)"><User /></el-icon>
              <span style="font-weight: 600">{{ git.account.username }}</span>
              <span style="flex: 1"></span>
              <el-button plain @click="git.logout()">退出登录</el-button>
            </div>
          </template>
        </div>
      </el-tab-pane>

      <!-- 插件 -->
      <el-tab-pane label="插件" name="plugins">
        <div class="settings-block">
          <h3>插件功能</h3>
          <p class="settings-desc">
            插件系统正在建设中，当前版本提供清单规范与加载器骨架。开启后，放置在工作区插件目录中的插件可被加载。
          </p>
          <div class="setting-row">
            <span class="setting-label">启用插件</span>
            <el-switch
              :model-value="app.settings.enablePlugins"
              @update:model-value="(v: string | number | boolean) => toggleEnablePlugins(Boolean(v))"
            />
          </div>
        </div>

        <div class="settings-block">
          <h3>已安装的插件</h3>
          <el-empty v-if="plugins.length === 0" description="暂无插件" :image-size="60" />
          <div v-for="plugin in plugins" :key="plugin.id" class="setting-row">
            <div style="flex: 1">
              <div>
                <strong>{{ plugin.name }}</strong>
                <span style="color: var(--text-tertiary); margin-left: 8px">v{{ plugin.version }}</span>
              </div>
              <div class="settings-desc" style="margin: 2px 0 0">
                {{ plugin.description }}
                <span v-if="plugin.error" style="color: var(--danger)">（加载失败：{{ plugin.error }}）</span>
              </div>
            </div>
            <el-switch
              :model-value="plugin.enabled"
              @update:model-value="(v: string | number | boolean) => togglePlugin(plugin.id, Boolean(v))"
            />
          </div>
        </div>
      </el-tab-pane>

      <!-- 通用 -->
      <el-tab-pane label="通用" name="general">
        <div class="settings-block">
          <h3>工作区</h3>
          <p class="settings-desc">所有笔记库都保存在工作区目录下，可随时更换。</p>
          <div class="setting-row">
            <el-input v-model="workspaceInput" style="flex: 1" />
            <el-button @click="chooseWorkspace">选择…</el-button>
            <el-button type="primary" :disabled="workspaceInput === app.workspaceRoot" @click="applyWorkspace">
              应用
            </el-button>
          </div>
        </div>

        <div class="settings-block">
          <h3>外观</h3>
          <div class="setting-row">
            <span class="setting-label">主题</span>
            <el-radio-group
              :model-value="app.settings.theme"
              @update:model-value="(v) => app.updateSettings({ theme: v as ThemeOption })"
            >
              <el-radio-button v-for="opt in themeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </el-radio-button>
            </el-radio-group>
          </div>
        </div>

        <div class="settings-block">
          <h3>编辑器</h3>
          <div class="setting-row">
            <span class="setting-label">字号</span>
            <el-slider
              :model-value="app.settings.editorFontSize"
              :min="12"
              :max="22"
              :step="1"
              style="flex: 1; margin-right: 16px"
              @update:model-value="(v: number | number[]) => app.updateSettings({ editorFontSize: Array.isArray(v) ? v[0] : v })"
            />
            <span style="width: 40px; text-align: right; color: var(--text-secondary)">
              {{ app.settings.editorFontSize }}px
            </span>
          </div>
          <div class="setting-row">
            <span class="setting-label">自动保存</span>
            <el-switch
              :model-value="app.settings.autoSave"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ autoSave: Boolean(v) })"
            />
            <span class="settings-desc" style="margin: 0">编辑后 1 秒自动写入文件（Ctrl+S 可手动保存）</span>
          </div>
        </div>

        <div class="settings-block">
          <h3>关于</h3>
          <div class="setting-row">
            <span class="setting-label">Trace 笔迹</span>
            <span style="color: var(--text-secondary)">v{{ app.version }} — 轻量级 Markdown 笔记</span>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
