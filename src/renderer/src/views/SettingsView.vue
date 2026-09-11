<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '../stores/app'
import { useGitStore } from '../stores/git'
import { resetGitAvailabilityCache } from '../stores/git'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import type { ThemeOption } from '@shared/types'
import { normalizeAttachDir, normalizeProxyUrl } from '@shared/validate'
import { SHORTCUT_GROUPS } from '../config/shortcuts'

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
  if (git.account.loggedIn) void tree.refreshAll()
})

watch(
  () => app.workspaceRoot,
  (value) => {
    workspaceInput.value = value
  }
)

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

/** 返回编辑：保留设置入口的「回来继续写」路径 */
function backToEditor(): void {
  if (!editor.current) return
  app.focusEditorOnce = true
  app.view = { name: 'editor' }
}

/** 重置 Git 来源选择：清空偏好 + 清除会话级缓存，下次触发同步时重新检测 */
async function resetGitSource(): Promise<void> {
  resetGitAvailabilityCache()
  await app.updateSettings({ gitSource: null })
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
          <div class="setting-row">
            <span class="setting-label">专注模式隐藏顶栏</span>
            <el-switch
              :model-value="app.settings.zenHideTopbar"
              @update:model-value="(v: string | number | boolean) => app.updateSettings({ zenHideTopbar: Boolean(v) })"
            />
            <span class="settings-desc" style="margin: 0">专注时隐藏顶栏与格式工具栏，鼠标移到编辑卡顶部可整体唤出</span>
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
          <p class="settings-desc">笔记库的云端同步依赖 Git。如果系统未安装 Git，首次同步时会提示选择内置 Git 或手动安装。</p>
          <div class="setting-row">
            <span class="setting-label">当前来源</span>
            <span style="color: var(--text-secondary)">
              {{ app.settings.gitSource === 'system' ? '系统 Git' : app.settings.gitSource === 'bundled' ? '内置 Git' : '自动检测' }}
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
</style>
