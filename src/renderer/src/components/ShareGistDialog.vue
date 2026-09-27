<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { GistShare } from '@shared/types'

/**
 * 分享为 Gist 弹窗（FR-2.3.10）：
 * - 未分享 → 一键发布为 secret gist（有链接即可见、不被公开检索），展示链接并复制；
 * - 已分享 → 可更新（重推当前内容）或删除（同时删除远端 gist）；
 * - 令牌缺 gist scope（GitHub 返回 404）→ 展示分步引导，去 GitHub 令牌页补勾选（一次性）。
 * 图片附件不随行：分享的是 Markdown 原文，引用在本机才能解析。
 */
const props = defineProps<{
  visible: boolean
  note: { vault: string; path: string; name: string } | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  /** 分享 / 删除成功后通知外层刷新分享计数与网格 */
  (e: 'changed'): void
}>()

const share = ref<GistShare | null>(null)
const busy = ref(false)
const needScope = ref(false)
/** GitHub 令牌管理页：给现有令牌补勾 gist scope（无需改令牌值，保存即生效） */
const TOKENS_URL = 'https://github.com/settings/tokens'

watch(
  () => props.visible,
  async (visible) => {
    if (!visible || !props.note) return
    needScope.value = false
    share.value = null
    const res = await window.trace.gistGet(props.note.vault, props.note.path)
    if (res.ok && res.share) share.value = res.share
  },
  { immediate: true }
)

async function doShare(): Promise<void> {
  if (!props.note) return
  busy.value = true
  try {
    const res = await window.trace.gistShare(props.note.vault, props.note.path)
    if (res.ok && res.share) {
      share.value = res.share
      needScope.value = false
      await copyLink(res.share.url)
      ElMessage.success('分享成功，链接已复制')
      emit('changed')
    } else if (res.needScope) {
      needScope.value = true
    } else {
      ElMessage.error(res.error ?? '分享失败')
    }
  } finally {
    busy.value = false
  }
}

async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择链接复制')
  }
}

async function removeShare(): Promise<void> {
  if (!props.note || !share.value) return
  await ElMessageBox.confirm(
    '确定删除这条分享吗？远端 gist 将被删除，已分享出去的链接会立刻失效。',
    '删除分享',
    { type: 'warning', confirmButtonText: '删除分享', cancelButtonText: '取消' }
  )
  busy.value = true
  try {
    const res = await window.trace.gistRemove(props.note.vault, props.note.path, true)
    if (res.ok) {
      share.value = null
      ElMessage.success('分享已删除')
      emit('changed')
    } else {
      ElMessage.error(res.error ?? '删除失败')
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`分享 — ${note?.name ?? ''}`"
    width="420px"
    :append-to-body="true"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <!-- 令牌缺 gist scope：分步引导（一次性操作，补完回到本弹窗重新点发布） -->
    <div v-if="needScope" class="gist-guide">
      <el-alert type="warning" :closable="false" title="GitHub 令牌缺少 gist 权限" />
      <ol class="gist-guide-steps">
        <li>
          打开
          <a :href="TOKENS_URL" target="_blank" rel="noreferrer">GitHub 令牌设置页</a>
          ，找到登录 Trace 时创建的令牌（描述含「Trace 笔记」）
        </li>
        <li>勾选 <b>gist</b> 权限（repo 已勾选的保持不变）</li>
        <li>点页面底部「Update token」保存——令牌值不变，无需在 Trace 重新登录</li>
        <li>回到本弹窗重新点击「发布」</li>
      </ol>
    </div>

    <template v-else>
      <div v-if="!share" class="gist-empty">
        <p>把这篇笔记的 Markdown 原文发布为 <b>secret gist</b>：</p>
        <ul class="gist-notes">
          <li>拿到链接的人即可查看，不会出现在你的公开主页与搜索里</li>
          <li>图片附件不随行（原位置显示占位说明）；frontmatter 不随行；[[双链引用]] 转为纯文本</li>
          <li>分享后可随时在本弹窗更新内容或删除</li>
        </ul>
      </div>
      <div v-else class="gist-shared">
        <div class="gist-row">
          <span class="gist-label">分享链接</span>
          <a class="gist-link" :href="share.url" target="_blank" rel="noreferrer">{{ share.url }}</a>
        </div>
        <div class="gist-row">
          <span class="gist-label">最近更新</span>
          <span>{{ new Date(share.updatedAt).toLocaleString('zh-CN') }}</span>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="gist-footer">
        <el-button
          v-if="share"
          :loading="busy"
          @click="() => copyLink(share!.url)"
        >
          复制链接
        </el-button>
        <el-button v-if="share" type="danger" plain :disabled="busy" @click="removeShare">删除分享</el-button>
        <el-button type="primary" :loading="busy" @click="doShare">
          {{ share ? '更新分享' : '发布为 secret gist' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.gist-empty p {
  margin: 0 0 8px;
}

.gist-notes {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.9;
}

.gist-shared {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gist-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
}

.gist-label {
  flex-shrink: 0;
  width: 64px;
  color: var(--text-tertiary);
}

.gist-link {
  color: var(--accent);
  word-break: break-all;
}

.gist-guide-steps {
  margin: 12px 0 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 2;
}

.gist-guide-steps a {
  color: var(--accent);
}

.gist-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
