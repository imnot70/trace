<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '../stores/app'
import { useGitStore } from '../stores/git'
import { resetGitAvailabilityCache } from '../stores/git'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import type { ThemeOption } from '@shared/types'
import { normalizeAttachDir, normalizeProxyUrl } from '@shared/validate'
import type { AppSettings } from '@shared/types'
import { SHORTCUT_GROUPS } from '../config/shortcuts'
import { THEME_PRESETS } from '../styles/presets'

const app = useAppStore()
const git = useGitStore()
const tree = useTreeStore()
const editor = useEditorStore()

// Windows 下窗口保持原生边框（透明窗口会失去标题栏，见主进程 createWindow），
// 毛玻璃材质不可用，玻璃效果仅窗口透明度生效
const isWindows = window.trace.platform === 'win32'

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
// 经典令牌创建页：scopes=repo 自动勾选仓库权限，description 自动填备注，对普通用户最省事
const PAT_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Trace%20%E7%AC%94%E8%AE%B0'

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
const attachmentsDirInput = ref('')

onMounted(() => {
  workspaceInput.value = app.workspaceRoot
  attachmentsDirInput.value = app.settings.attachmentsDir
  void git.refreshAccount()
  void git.loadAvailability()
  if (git.account.loggedIn) void tree.refreshAll()
})

watch(
  () => app.workspaceRoot,
  (value) => {
    workspaceInput.value = value
  }
)

// ---------- 回收站 / 自动同步 ----------
const retentionOptions = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
  { label: '永久保留', value: 0 }
]

const capOptions = [
  { label: '100 条', value: 100 },
  { label: '200 条', value: 200 },
  { label: '500 条', value: 500 },
  { label: '1000 条', value: 1000 },
  { label: '不限', value: 0 }
]

const autoSyncModes = [
  { label: '关闭', value: 'off' },
  { label: '定时（按间隔）', value: 'interval' },
  { label: '变更触发（保存后 5 秒）', value: 'change' }
]

const autoSyncIntervals = [
  { label: '每 1 分钟', value: 1 },
  { label: '每 5 分钟', value: 5 },
  { label: '每 10 分钟', value: 10 },
  { label: '每 30 分钟', value: 30 }
]

// ---------- 网络代理 ----------
const proxyInput = ref('')
const proxyTesting = ref(false)
const proxyResult = ref<{ ok: boolean; text: string } | null>(null)

async function applyProxy(): Promise<void> {
  const normalized = normalizeProxyUrl(proxyInput.value)
  if (!normalized.ok) {
    proxyResult.value = { ok: false, text: normalized.error }
    return
  }
  proxyInput.value = normalized.url
  if (normalized.url === app.settings.proxyUrl) return
  await app.updateSettings({ proxyUrl: normalized.url })
  proxyResult.value = {
    ok: true,
    text: normalized.url ? '代理已保存，Git 同步将经由该代理' : '已清除代理配置'
  }
}

async function testProxy(): Promise<void> {
  const normalized = normalizeProxyUrl(proxyInput.value)
  if (!normalized.ok) {
    proxyResult.value = { ok: false, text: normalized.error }
    return
  }
  // 测试前先保存当前输入，确保测的就是所填配置
  if (normalized.url !== app.settings.proxyUrl) {
    await app.updateSettings({ proxyUrl: normalized.url })
    proxyInput.value = normalized.url
  }
  proxyTesting.value = true
  proxyResult.value = null
  const result = await window.trace.testProxy()
  proxyTesting.value = false
  proxyResult.value = result.ok
    ? { ok: true, text: '连接成功：可经由该代理访问 GitHub' }
    : { ok: false, text: result.error ?? '连接失败' }
}

async function applyAttachmentsDir(): Promise<void> {
  const normalized = normalizeAttachDir(attachmentsDirInput.value)
  if (!normalized.ok) {
    ElMessage.error(normalized.error)
    attachmentsDirInput.value = app.settings.attachmentsDir
    return
  }
  attachmentsDirInput.value = normalized.dir
  if (normalized.dir === app.settings.attachmentsDir) return
  await app.updateSettings({ attachmentsDir: normalized.dir })
  ElMessage.success(`附件目录已设为 ${normalized.dir}，对之后粘贴的图片生效`)
}

// ---------- 主题包 ----------
async function importTheme(): Promise<void> {
  const result = await app.importThemeFile()
  if (result.canceled) return
  if (result.error || !result.theme) {
    ElMessage.error(result.error ?? '导入失败')
    return
  }
  const theme = result.theme
  if (app.customThemes.some((t) => t.id === theme.id)) {
    try {
      await ElMessageBox.confirm(`已存在主题「${theme.name}」，覆盖更新？`, '导入主题', {
        type: 'warning',
        confirmButtonText: '覆盖'
      })
    } catch {
      return
    }
  }
  const error = await app.saveTheme(theme)
  if (error) ElMessage.error(error)
  else ElMessage.success(`主题「${theme.name}」已导入`)
}

async function removeTheme(id: string, name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除主题「${name}」吗？`, '删除主题', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  const error = await app.deleteTheme(id)
  if (error) ElMessage.error(error)
  else ElMessage.success('主题已删除')
}

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
interface PluginRow {
  id: string
  name: string
  version: string
  description: string
  permissions: string[]
  permissionsConfirmed: boolean
  enabled: boolean
  running: boolean
  error: string | null
  crashCount: number
  commands: { id: string; title: string }[]
}

const plugins = ref<PluginRow[]>([])

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

/** 权限标识 -> 中文说明（与主进程能力网关的权限域一一对应） */
const PERMISSION_LABELS: Record<string, string> = {
  notifications: '发送通知',
  'notes:read': '读取笔记内容与列表',
  'notes:write': '创建和修改笔记',
  events: '订阅笔记与同步事件'
}

function permissionLabel(p: string): string {
  return PERMISSION_LABELS[p] ?? p
}

/** 待确认权限的插件（启用开关触发，用户确认后调 confirmEnablePlugin） */
const pendingPermission = ref<PluginRow | null>(null)
const invokeError = ref('')

async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  const row = plugins.value.find((p) => p.id === id)
  const result = await window.trace.setPluginEnabled(id, enabled)
  if (!result.ok && result.needsConfirmation && row) {
    // 权限未确认（或 manifest 权限已变化）：弹确认对话框，开关回弹
    pendingPermission.value = row
  }
  await loadPlugins()
}

async function confirmEnable(): Promise<void> {
  if (!pendingPermission.value) return
  await window.trace.confirmEnablePlugin(pendingPermission.value.id)
  pendingPermission.value = null
  await loadPlugins()
}

function cancelEnable(): void {
  pendingPermission.value = null
  void loadPlugins()
}

async function runCommand(commandId: string): Promise<void> {
  invokeError.value = ''
  const result = await window.trace.invokePluginCommand(commandId)
  if (!result.ok) {
    invokeError.value = result.error ?? '命令执行失败'
    ElMessage.error(invokeError.value)
  } else {
    ElMessage.success('命令已执行')
  }
  await loadPlugins()
}

async function toggleEnablePlugins(enabled: boolean): Promise<void> {
  await app.updateSettings({ enablePlugins: enabled })
  await loadPlugins()
}

// ---------- 插件包导入（.trace-plugin，M2） ----------
interface PluginImportPreview {
  importId: string
  id: string
  name: string
  version: string
  description: string
  permissions: string[]
  isUpgrade: boolean
}

const pendingImport = ref<PluginImportPreview | null>(null)

async function importPlugin(): Promise<void> {
  const r = await window.trace.importPlugin()
  if (!r.ok) {
    if (r.error !== '已取消') ElMessage.error(r.error ?? '导入失败')
    return
  }
  if (r.preview) pendingImport.value = r.preview
}

async function confirmImport(): Promise<void> {
  if (!pendingImport.value) return
  const r = await window.trace.confirmImportPlugin(pendingImport.value.importId)
  if (!r.ok) ElMessage.error(r.error ?? '安装失败')
  else if (r.needsConfirmation) ElMessage.warning('插件包已安装：权限有变化，启用前需重新确认')
  else ElMessage.success('插件已安装')
  pendingImport.value = null
  await loadPlugins()
}

function cancelImport(): void {
  if (pendingImport.value) void window.trace.cancelImportPlugin(pendingImport.value.importId)
  pendingImport.value = null
}

// ---------- 插件详情 / 导出 / 卸载 ----------
const detailView = ref<{
  info: PluginRow
  crashes: { at: string; code: number }[]
  logs: string[]
  storageBytes: number
} | null>(null)

async function openDetail(id: string): Promise<void> {
  const r = await window.trace.pluginDetail(id)
  if (r.ok && r.detail) detailView.value = r.detail
  else ElMessage.error(r.error ?? '获取详情失败')
}

function closeDetail(): void {
  detailView.value = null
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

async function exportPlugin(id: string): Promise<void> {
  const r = await window.trace.exportPlugin(id)
  if (r.ok && r.path) ElMessage.success('已导出到 ' + r.path)
  else if (r.error !== '已取消') ElMessage.error(r.error ?? '导出失败')
}

async function uninstallPlugin(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将删除插件目录、权限记录与私有存储，不可恢复。确定卸载？',
      '卸载插件',
      { type: 'warning', confirmButtonText: '卸载', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const r = await window.trace.uninstallPlugin(id)
  if (r.ok) ElMessage.success('插件已卸载')
  else ElMessage.error(r.error ?? '卸载失败')
  closeDetail()
  await loadPlugins()
}

const themeOptions: { label: string; value: 'light' | 'dark' | 'system' }[] = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'system' }
]

/** 返回编辑：保留设置入口的「回来继续写」路径 */
function backToEditor(): void {
  if (!editor.current) return
  app.focusEditorOnce = true
  app.view = { name: 'editor' }
}

/** 当前 Git 来源的中文标签 */
const gitSourceLabel = computed(() => {
  if (app.settings.gitSource === 'system') return '系统 Git'
  if (app.settings.gitSource === 'bundled') return '内置 Git'
  return '自动检测'
})

/** 重置 Git 来源选择：清空偏好 + 清除会话级缓存，下次触发同步时重新检测 */
async function resetGitSource(): Promise<void> {
  resetGitAvailabilityCache()
  await app.updateSettings({ gitSource: null })
  await git.loadAvailability()
  ElMessage.success('已重置，下次同步时将重新检测 Git')
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2>设置</h2>
      <span v-if="editor.current" class="settings-back-note">正在编辑：{{ editor.current.name }}</span>
      <el-button
        v-if="editor.current"
        size="small"
        type="primary"
        plain
        @click="backToEditor"
      >
        返回编辑
      </el-button>
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
                placeholder="粘贴以 ghp_ 开头的令牌"
                style="flex: 1"
              />
              <el-button type="primary" :loading="loggingIn" @click="login">登录</el-button>
            </div>
            <div v-if="tokenError" style="color: var(--danger); font-size: 12px; margin: 4px 0 0 102px">
              {{ tokenError }}
            </div>

            <el-collapse class="pat-guide">
              <el-collapse-item title="第一次使用？查看获取令牌的步骤（约 1 分钟）" name="guide">
                <ol class="pat-guide-steps">
                  <li>
                    点击
                    <a :href="PAT_URL" target="_blank" rel="noreferrer">
                      <el-button size="small" type="primary" plain style="vertical-align: middle">
                        打开 GitHub 令牌创建页面
                      </el-button>
                    </a>
                    （需要先在浏览器里登录 GitHub）
                  </li>
                  <li>打开的页面已经自动填好备注、勾选好所需权限，不用改任何选项，直接拉到页面最底部</li>
                  <li>点击绿色的 <strong>Generate token</strong>（生成令牌）按钮</li>
                  <li>
                    页面最上方会出现一串以 <code>ghp_</code> 开头的字符——这就是你的令牌，
                    <strong>只显示这一次</strong>，点击它旁边的复制按钮复制
                  </li>
                  <li>回到 Trace，把令牌粘贴到上方输入框，点击「登录」，看到你的用户名就成功了</li>
                </ol>
                <div class="pat-guide-tips">
                  <p>· 令牌相当于你仓库的钥匙：Trace 只申请仓库读写权限，令牌只保存在本机的系统加密存储中，不会上传</p>
                  <p>· 请不要把令牌告诉别人；想作废时到 GitHub → Settings → Developer settings → Personal access tokens 里删除即可</p>
                  <p>
                    · 如果你熟悉 GitHub 新版的细粒度令牌（Fine-grained tokens）也可以使用：需将
                    Repository access 设为 All repositories，并在 Permissions 中把 Contents 设为
                    Read and write
                  </p>
                </div>
              </el-collapse-item>
            </el-collapse>
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
            插件运行在独立进程中，通过声明的权限读写笔记、订阅事件、注册命令。
            插件目录：设置 → 通用 → 工作区同级的用户数据目录 plugins/（示例插件首次启动自动放置）。
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
          <div class="setting-row" style="margin-bottom: 4px">
            <h3 style="margin: 0">已安装的插件</h3>
            <el-button size="small" @click="importPlugin">导入插件…</el-button>
          </div>
          <el-empty v-if="plugins.length === 0" description="暂无插件" :image-size="60" />
          <div v-for="plugin in plugins" :key="plugin.id" class="setting-row">
            <div style="flex: 1">
              <div>
                <strong>{{ plugin.name }}</strong>
                <span style="color: var(--text-tertiary); margin-left: 8px">v{{ plugin.version }}</span>
                <span v-if="plugin.running" class="plugin-badge plugin-badge-ok">运行中</span>
                <span v-else-if="plugin.enabled && plugin.permissionsConfirmed" class="plugin-badge">未运行</span>
                <span v-else-if="plugin.enabled && !plugin.permissionsConfirmed" class="plugin-badge plugin-badge-warn">需确认权限</span>
                <span v-if="plugin.crashCount > 0" class="plugin-badge plugin-badge-warn">崩溃 {{ plugin.crashCount }} 次</span>
              </div>
              <div class="settings-desc" style="margin: 2px 0 0">{{ plugin.description }}</div>
              <div v-if="plugin.permissions.length" class="settings-desc" style="margin: 4px 0 0">
                权限：{{ plugin.permissions.map(permissionLabel).join('、') }}
              </div>
              <div v-if="plugin.error" class="settings-desc" style="margin: 4px 0 0; color: var(--danger)">
                {{ plugin.error }}
              </div>
              <div v-if="plugin.commands.length" class="settings-desc" style="margin: 6px 0 0">
                <el-button
                  v-for="cmd in plugin.commands"
                  :key="cmd.id"
                  size="small"
                  style="margin-right: 8px"
                  @click="runCommand(cmd.id)"
                >
                  {{ cmd.title }}
                </el-button>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px">
              <el-button size="small" @click="openDetail(plugin.id)">详情</el-button>
              <el-switch
                :model-value="plugin.enabled"
                @update:model-value="(v: string | number | boolean) => togglePlugin(plugin.id, Boolean(v))"
              />
            </div>
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
          <div class="setting-row">
            <span class="setting-label">配色</span>
            <div class="theme-preset-grid">
              <div
                class="theme-preset-card"
                :class="{ active: (app.settings.themePreset ?? 'default') === 'default' }"
                @click="app.updateSettings({ themePreset: 'default' })"
              >
                <div class="preset-swatches">
                  <span class="swatch" style="background: #ffffff; border: 1px solid #e4e7ec" />
                  <span class="swatch" style="background: #4078d3" />
                  <span class="swatch" style="background: #d34850" />
                </div>
                <span class="preset-name">Trace</span>
              </div>
              <div
                v-for="preset in THEME_PRESETS"
                :key="preset.id"
                class="theme-preset-card"
                :class="{ active: app.settings.themePreset === preset.id }"
                @click="app.updateSettings({ themePreset: preset.id })"
              >
                <div class="preset-swatches">
                  <span class="swatch" :style="{ background: app.isDark ? preset.dark['--bg-primary'] : preset.light['--bg-primary'], border: '1px solid ' + (app.isDark ? preset.dark['--border-color'] : preset.light['--border-color']) }" />
                  <span class="swatch" :style="{ background: app.isDark ? preset.dark['--accent'] : preset.light['--accent'] }" />
                  <span class="swatch" :style="{ background: app.isDark ? preset.dark['--danger'] : preset.light['--danger'] }" />
                </div>
                <span class="preset-name">{{ preset.name }}</span>
              </div>
              <div
                v-for="custom in app.customThemes"
                :key="custom.id"
                class="theme-preset-card"
                :class="{ active: app.settings.themePreset === custom.id }"
                @click="app.updateSettings({ themePreset: custom.id })"
              >
                <div class="preset-swatches">
                  <span
                    class="swatch"
                    :style="{
                      background: app.isDark ? custom.dark['--bg-primary'] : custom.light['--bg-primary'],
                      border: '1px solid ' + (app.isDark ? custom.dark['--border-color'] : custom.light['--border-color'])
                    }"
                  />
                  <span class="swatch" :style="{ background: app.isDark ? custom.dark['--accent'] : custom.light['--accent'] }" />
                  <span class="swatch" :style="{ background: app.isDark ? custom.dark['--danger'] : custom.light['--danger'] }" />
                </div>
                <span class="preset-name">{{ custom.name }}</span>
                <button class="preset-remove" title="删除主题" @click.stop="removeTheme(custom.id, custom.name)">
                  <el-icon><Close /></el-icon>
                </button>
              </div>
              <div class="theme-preset-card theme-import-card" title="导入主题包（JSON）" @click="importTheme">
                <el-icon><Plus /></el-icon>
                <span class="preset-name">导入主题</span>
              </div>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">窗口效果</span>
            <el-select
              :model-value="app.settings.windowGlassEffect"
              style="width: 200px"
              @update:model-value="(v: string) => app.updateSettings({ windowGlassEffect: v as AppSettings['windowGlassEffect'] })"
            >
              <el-option label="自动（根据平台）" value="auto" />
              <el-option label="关闭" value="none" />
              <el-option label="Mica（Windows 11）" value="mica" />
              <el-option label="Acrylic（Windows）" value="acrylic" />
              <el-option label="毛玻璃（macOS）" value="vibrancy" />
            </el-select>
            <span class="settings-desc" style="margin: 0">{{ isWindows ? 'Windows 下毛玻璃暂不可用（保持原生标题栏），仅窗口透明度生效' : '窗口半透明和毛玻璃效果，不同平台支持程度不同' }}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">窗口透明度</span>
            <el-slider
              :model-value="app.settings.windowOpacity"
              :min="50"
              :max="100"
              :step="5"
              style="flex: 1; margin-right: 16px"
              @update:model-value="(v: number | number[]) => app.updateSettings({ windowOpacity: Array.isArray(v) ? v[0] : v })"
            />
            <span style="width: 40px; text-align: right; color: var(--text-secondary)">
              {{ app.settings.windowOpacity }}%
            </span>
          </div>
          <p class="settings-desc" style="margin: 0 0 0 102px">
            Windows 11 支持 Mica/Acrylic 效果，macOS 支持毛玻璃效果，Linux 依赖桌面合成器。透明度下限 50%，避免界面难以阅读。
          </p>
        </div>

        <div class="settings-block">
          <h3>侧栏菜单</h3>
          <p class="settings-desc">控制左侧栏显示哪些菜单分区；「笔记库」始终显示。</p>
          <div class="setting-row">
            <span class="setting-label">常用</span>
            <el-switch
              :model-value="app.settings.sidebarMenus.recents"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ sidebarMenus: { ...app.settings.sidebarMenus, recents: Boolean(v) } })"
            />
          </div>
          <div class="setting-row">
            <span class="setting-label">收藏</span>
            <el-switch
              :model-value="app.settings.sidebarMenus.favorites"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ sidebarMenus: { ...app.settings.sidebarMenus, favorites: Boolean(v) } })"
            />
          </div>
          <div class="setting-row">
            <span class="setting-label">标签</span>
            <el-switch
              :model-value="app.settings.sidebarMenus.tags"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ sidebarMenus: { ...app.settings.sidebarMenus, tags: Boolean(v) } })"
            />
          </div>
          <div class="setting-row">
            <span class="setting-label">断链引用</span>
            <el-switch
              :model-value="app.settings.sidebarMenus.unresolved"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ sidebarMenus: { ...app.settings.sidebarMenus, unresolved: Boolean(v) } })"
            />
            <span class="settings-desc" style="margin: 0">存在无法跳转的 [[双链]] 时在侧栏提示（仅有断链时显示）</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">回收站</span>
            <el-switch
              :model-value="app.settings.sidebarMenus.trash"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ sidebarMenus: { ...app.settings.sidebarMenus, trash: Boolean(v) } })"
            />
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
          <div class="setting-row">
            <span class="setting-label">专注隐藏顶栏</span>
            <el-switch
              :model-value="app.settings.zenHideTopbar"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ zenHideTopbar: Boolean(v) })"
            />
            <span class="settings-desc" style="margin: 0">专注时隐藏顶栏与格式工具栏，鼠标移到编辑卡顶部可整体唤出</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">显示反向链接</span>
            <el-switch
              :model-value="app.settings.showBacklinks"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ showBacklinks: Boolean(v) })"
            />
            <span class="settings-desc" style="margin: 0">编辑卡右下角的「反向链接」入口，显示引用当前笔记的笔记</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">附件目录</span>
            <el-input
              v-model="attachmentsDirInput"
              style="flex: 1"
              placeholder="粘贴图片的保存目录，可多级，如 media/image"
              @blur="applyAttachmentsDir"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
          </div>
          <p class="settings-desc" style="margin: 0 0 0 102px">
            相对于笔记库根目录，修改后只对之后粘贴的图片生效；已有图片的引用不受影响。
          </p>
        </div>

        <div class="settings-block">
          <h3>回收站</h3>
          <div class="setting-row">
            <span class="setting-label">保留天数</span>
            <el-select
              :model-value="app.settings.trashRetentionDays"
              style="width: 200px"
              @update:model-value="(v: number) => app.updateSettings({ trashRetentionDays: v })"
            >
              <el-option v-for="opt in retentionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
            <span class="settings-desc" style="margin: 0">超过保留天数的回收站条目将在应用启动时自动清理（0 / 永久保留 = 不自动清理）</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">容量上限</span>
            <el-select
              :model-value="app.settings.trashMaxEntries"
              style="width: 200px"
              @update:model-value="(v: number) => app.updateSettings({ trashMaxEntries: v })"
            >
              <el-option v-for="opt in capOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
            <span class="settings-desc" style="margin: 0">条目数超出上限时自动永久删除最旧的条目（0 / 不限 = 不限制数量）</span>
          </div>
        </div>

        <div class="settings-block">
          <h3>自动同步</h3>
          <p class="settings-desc">自动同步所有已关联 Git 仓库的笔记库；仅对磁盘上已保存的内容生效，失败时静默（状态见库徽标与编辑页）。</p>
          <div class="setting-row">
            <span class="setting-label">同步方式</span>
            <el-select
              :model-value="app.settings.autoSyncMode"
              style="width: 220px"
              @update:model-value="(v: string) => app.updateSettings({ autoSyncMode: v as AppSettings['autoSyncMode'] })"
            >
              <el-option v-for="opt in autoSyncModes" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
          <div class="setting-row" v-if="app.settings.autoSyncMode === 'interval'">
            <span class="setting-label">同步间隔</span>
            <el-select
              :model-value="app.settings.autoSyncIntervalMin"
              style="width: 140px"
              @update:model-value="(v: number) => app.updateSettings({ autoSyncIntervalMin: v })"
            >
              <el-option v-for="opt in autoSyncIntervals" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
        </div>

        <div class="settings-block">
          <h3>网络代理</h3>
          <p class="settings-desc">如果你的网络无法直连 GitHub，可为 Git 同步配置代理。代理仅用于同步，不会写入笔记库。</p>
          <div class="setting-row">
            <span class="setting-label">代理地址</span>
            <el-input
              v-model="proxyInput"
              style="flex: 1"
              placeholder="http://127.0.0.1:7890（留空 = 不使用代理）"
              @blur="applyProxy"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
          </div>
          <div class="setting-row" v-if="proxyResult" :style="{ color: proxyResult.ok ? 'var(--text-secondary)' : 'var(--danger)' }">
            <span class="setting-label"></span>
            <span style="font-size: 12px">{{ proxyResult.text }}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label"></span>
            <el-button size="small" :loading="proxyTesting" @click="testProxy">测试连接</el-button>
            <span class="settings-desc" style="margin: 0">
              修改或填写代理后点击「测试连接」验证可达性；测试通过后新同步立即生效。
            </span>
          </div>
        </div>

        <div class="settings-block">
          <h3>快捷键</h3>
          <table class="shortcut-table">
            <tbody>
              <template v-for="group in SHORTCUT_GROUPS" :key="group.group">
                <tr class="shortcut-group-row">
                  <td colspan="2">{{ group.group }}</td>
                </tr>
                <tr v-for="item in group.items" :key="item.keys">
                  <td class="shortcut-keys"><kbd>{{ item.keys }}</kbd></td>
                  <td class="shortcut-desc">{{ item.desc }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div class="settings-block">
          <h3>Git 信息</h3>
          <p class="settings-desc">
            笔记库的云端同步依赖 Git。Trace 已内置 Git，系统未安装时也能直接使用；首次同步时会自动检测并提示。
          </p>
          <div class="setting-row">
            <span class="setting-label">当前来源</span>
            <span style="color: var(--text-secondary)">{{ gitSourceLabel }}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">系统 Git</span>
            <span style="color: var(--text-secondary)">
              {{ git.availability?.systemVersion ? `v${git.availability.systemVersion}` : '未检测到' }}
            </span>
          </div>
          <div class="setting-row">
            <span class="setting-label">内置 Git</span>
            <span style="color: var(--text-secondary)">
              {{
                git.availability?.bundledVersion
                  ? `v${git.availability.bundledVersion}`
                  : git.availability?.bundledGit
                    ? '已内置（版本未知）'
                    : '未内置'
              }}
            </span>
          </div>
          <div class="setting-row">
            <span class="setting-label"></span>
            <el-button size="small" @click="resetGitSource">重置选择</el-button>
            <span class="settings-desc" style="margin: 0">下次同步时重新检测 Git 可用性</span>
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

    <!-- 插件权限确认对话框：启用/权限变化时必须经用户同意（设计第 6 节知情同意防线） -->
    <el-dialog
      :model-value="pendingPermission !== null"
      title="启用插件需要确认权限"
      width="480px"
      :close-on-click-modal="false"
      @update:model-value="(v: boolean) => { if (!v) cancelEnable() }"
    >
      <template v-if="pendingPermission">
        <p style="margin: 0 0 8px">
          插件 <strong>「{{ pendingPermission.name }}」</strong>（v{{ pendingPermission.version }}）请求以下权限：
        </p>
        <ul style="margin: 0 0 12px; padding-left: 20px; line-height: 1.8">
          <li v-for="p in pendingPermission.permissions" :key="p">
            <code style="font-size: 12px">{{ p }}</code> — {{ permissionLabel(p) }}
          </li>
        </ul>
        <p class="settings-desc" style="margin: 0">
          请仅启用你信任的插件。插件的笔记读写仅限工作区内；本地安装的插件未经 Trace 市场审阅。
        </p>
      </template>
      <template #footer>
        <el-button @click="cancelEnable">取消</el-button>
        <el-button type="primary" @click="confirmEnable">确认并启用</el-button>
      </template>
    </el-dialog>

    <!-- 插件包导入确认：本地包绕过市场审阅，警告必须显著（设计第 6 节） -->
    <el-dialog
      :model-value="pendingImport !== null"
      title="导入插件"
      width="480px"
      :close-on-click-modal="false"
      @update:model-value="(v: boolean) => { if (!v) cancelImport() }"
    >
      <template v-if="pendingImport">
        <p style="margin: 0 0 8px">
          {{ pendingImport.isUpgrade ? '升级插件' : '安装插件' }}
          <strong>「{{ pendingImport.name }}」</strong>（v{{ pendingImport.version }}）
          <span v-if="pendingImport.isUpgrade" style="color: var(--text-secondary)">——将覆盖已安装的同 id 插件</span>
        </p>
        <p v-if="pendingImport.description" class="settings-desc" style="margin: 0 0 8px">{{ pendingImport.description }}</p>
        <div v-if="pendingImport.permissions.length" style="margin: 0 0 12px">
          <p style="margin: 0 0 4px">该插件请求以下权限：</p>
          <ul style="margin: 0; padding-left: 20px; line-height: 1.8">
            <li v-for="p in pendingImport.permissions" :key="p">
              <code style="font-size: 12px">{{ p }}</code> — {{ permissionLabel(p) }}
            </li>
          </ul>
        </div>
        <p v-else class="settings-desc" style="margin: 0 0 12px">该插件未声明任何权限。</p>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="此插件未经 Trace 市场审阅，请确认来源可信后再安装"
        />
      </template>
      <template #footer>
        <el-button @click="cancelImport">取消</el-button>
        <el-button type="primary" @click="confirmImport">{{ pendingImport?.isUpgrade ? '覆盖安装' : '安装' }}</el-button>
      </template>
    </el-dialog>

    <!-- 插件详情：状态 / 权限 / 崩溃历史 / 日志 / 私有存储 / 导出 / 卸载 -->
    <el-dialog
      :model-value="detailView !== null"
      :title="detailView ? `插件详情 — ${detailView.info.name}` : '插件详情'"
      width="640px"
      @update:model-value="(v: boolean) => { if (!v) closeDetail() }"
    >
      <template v-if="detailView">
        <div class="setting-row">
          <span class="setting-label">状态</span>
          <span>
            <span v-if="detailView.info.running" class="plugin-badge plugin-badge-ok">运行中</span>
            <span v-else class="plugin-badge">未运行</span>
            <span v-if="detailView.info.crashCount > 0" class="plugin-badge plugin-badge-warn">
              连续崩溃 {{ detailView.info.crashCount }} 次
            </span>
          </span>
        </div>
        <div class="setting-row">
          <span class="setting-label">权限</span>
          <span class="settings-desc">{{ detailView.info.permissions.length ? detailView.info.permissions.map(permissionLabel).join('、') : '未声明权限' }}</span>
        </div>
        <div class="setting-row">
          <span class="setting-label">私有存储</span>
          <span class="settings-desc">{{ formatBytes(detailView.storageBytes) }}</span>
        </div>
        <div style="margin: 8px 0">
          <p style="margin: 0 0 4px">崩溃历史</p>
          <p v-if="detailView.crashes.length === 0" class="settings-desc" style="margin: 0">无崩溃记录</p>
          <ul v-else class="settings-desc" style="margin: 0; padding-left: 20px; line-height: 1.7">
            <li v-for="(c, i) in detailView.crashes" :key="i">
              {{ formatTime(c.at) }} — 进程退出码 {{ c.code }}
            </li>
          </ul>
        </div>
        <div style="margin: 8px 0">
          <p style="margin: 0 0 4px">最近日志</p>
          <pre
            v-if="detailView.logs.length"
            style="max-height: 200px; overflow: auto; margin: 0; padding: 8px; border-radius: 6px; background: var(--bg-secondary); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all"
          >{{ detailView.logs.join('\n') }}</pre>
          <p v-else class="settings-desc" style="margin: 0">暂无日志</p>
        </div>
      </template>
      <template #footer>
        <el-button type="danger" plain @click="uninstallPlugin(detailView!.info.id)">卸载</el-button>
        <el-button @click="exportPlugin(detailView!.info.id)">导出…</el-button>
        <el-button @click="closeDetail">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 获取令牌步骤说明 */
.pat-guide {
  margin-top: 14px;
  border-top: none;
}

.pat-guide :deep(.el-collapse-item__header) {
  color: var(--accent);
  font-size: 13px;
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 0 10px;
}

.pat-guide :deep(.el-collapse-item__content) {
  padding: 12px 10px 4px;
  color: var(--text-secondary);
}

.pat-guide-steps {
  margin: 0;
  padding-left: 22px;
  line-height: 2;
}

.pat-guide-steps code {
  background: var(--code-bg);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 12px;
}

.pat-guide-tips {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.pat-guide-tips p {
  margin: 2px 0;
}

/* 快捷键速查表 */
.shortcut-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.shortcut-table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.shortcut-group-row td {
  font-weight: 600;
  color: var(--text-primary);
  padding-top: 12px;
  border-bottom: none;
}

.shortcut-keys {
  width: 200px;
  white-space: nowrap;
}

.shortcut-table kbd {
  background: var(--bg-tertiary);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  color: var(--text-primary);
  font-family: inherit;
}

/* 返回编辑（设置页头部） */
.settings-back-note {
  margin-left: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.settings-back-note + .el-button {
  margin-left: auto;
}

.theme-preset-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  flex: 1;
}

.theme-preset-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border: 2px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s ease;
  position: relative;
}

.theme-preset-card:hover {
  border-color: var(--accent);
}

.theme-preset-card.active {
  border-color: var(--accent);
}

.preset-swatches {
  display: flex;
  gap: 4px;
}

.swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.preset-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.preset-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.theme-preset-card:hover .preset-remove {
  display: flex;
}

.preset-remove:hover {
  color: var(--danger);
}

.theme-import-card {
  justify-content: center;
  gap: 6px;
  border-style: dashed;
  color: var(--text-secondary);
}

.theme-import-card:hover {
  color: var(--accent);
}

/* ---------- 插件状态徽标 ---------- */
.plugin-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
  background: var(--bg-tertiary, var(--bg-secondary));
  color: var(--text-secondary);
}

.plugin-badge-ok {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.plugin-badge-warn {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
</style>
