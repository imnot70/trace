<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { useAppStore } from '../stores/app'
import { useEditorStore } from '../stores/editor'
import { useTreeStore } from '../stores/tree'
import { useGitStore } from '../stores/git'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import MarkdownPreview from '../components/MarkdownPreview.vue'
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'

const app = useAppStore()
const editor = useEditorStore()
const tree = useTreeStore()
const git = useGitStore()

const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const previewRef = ref<HTMLElement | null>(null)
const splitPercent = ref(50)
const dragging = ref(false)

const pathParts = computed(() => (editor.current ? editor.current.path.split('/') : []))

function toolbarInsert(before: string, after = '', placeholder = ''): void {
  editorRef.value?.insertText(`${before}${placeholder}${after}`)
}

async function onImage(fileName: string, base64: string): Promise<void> {
  if (!editor.current) return
  const { vault, path } = editor.current
  const result = await window.trace.saveImage(vault, path, fileName, base64)
  if (result.ok && result.reference) {
    editorRef.value?.insertText(`![${fileName}](${result.reference})\n`)
    ElMessage.success('图片已保存到库附件目录')
  } else {
    ElMessage.error(result.error ?? '图片保存失败')
  }
}

/** 简易滚动同步：按滚动比例联动（CodeMirror 的滚动发生在 .cm-scroller 上） */
function bindEditorScroll(): void {
  const scroller = editorWrapRef.value?.querySelector('.cm-scroller') as HTMLElement | null
  scroller?.addEventListener('scroll', () => {
    const preview = previewRef.value
    const target = scroller
    if (!preview || !target) return
    const ratio = target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight)
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight)
  })
}

// 拖动分隔条
const editorBody = ref<HTMLElement | null>(null)
const editorWrapRef = ref<HTMLElement | null>(null)

function startDrag(): void {
  dragging.value = true
  const move = (ev: MouseEvent): void => {
    const rect = editorBody.value?.getBoundingClientRect()
    if (!rect) return
    splitPercent.value = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100))
  }
  const up = (): void => {
    dragging.value = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// Ctrl/Cmd+S 手动保存
function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void editor.flushSave().then(() => ElMessage.success('已保存'))
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void nextTick(bindEditorScroll)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  void editor.flushSave()
})

watch(
  () => editor.current?.vault,
  () => void nextTick(bindEditorScroll)
)

const vaultName = computed(() => editor.current?.vault ?? '')
const vaultGit = computed(() => (vaultName.value ? tree.gitStatuses[vaultName.value] : null))

watch(
  () => editor.current?.path,
  async () => {
    await nextTick()
    if (previewRef.value) previewRef.value.scrollTop = 0
  }
)
</script>

<template>
  <div class="editor-view">
    <!-- 顶部：路径 + git 状态 -->
    <div class="editor-topbar">
      <div class="breadcrumb">
        <template v-if="editor.current">
          <span>{{ editor.current.vault }}</span>
          <template v-for="(part, i) in pathParts.slice(0, -1)" :key="i">
            <span style="color: var(--text-tertiary)">/</span>
            <span>{{ part }}</span>
          </template>
          <span style="color: var(--text-tertiary)">/</span>
          <span class="crumb-current">{{ editor.current.name }}</span>
          <span v-if="editor.dirty" class="dirty-dot" title="未保存（自动保存已开启）"></span>
        </template>
      </div>

      <el-tag
        v-if="vaultGit?.associated"
        :type="vaultGit.dirty ? 'warning' : 'info'"
        size="small"
        effect="plain"
      >
        {{ vaultGit.branch }}
        <template v-if="vaultGit.ahead"> ↑{{ vaultGit.ahead }}</template>
        <template v-if="vaultGit.behind"> ↓{{ vaultGit.behind }}</template>
        <template v-if="vaultGit.dirty"> · 有未提交修改</template>
      </el-tag>

      <el-button
        v-if="vaultGit?.associated"
        size="small"
        type="primary"
        plain
        :loading="git.syncing[vaultName]"
        @click="git.sync(vaultName)"
      >
        同步
      </el-button>
    </div>

    <!-- 外部修改提示 -->
    <div v-if="editor.externalChanged" class="external-banner">
      <span>笔记在应用外被修改，本地还有未保存的内容。</span>
      <el-button size="small" @click="editor.reloadFromDisk()">放弃本地修改并重载</el-button>
      <el-button size="small" type="primary" @click="editor.externalChanged = false">
        保留本地修改继续编辑
      </el-button>
    </div>

    <!-- 工具栏 -->
    <div class="editor-toolbar">
      <button class="tool-btn" title="加粗" @click="toolbarInsert('**', '**', '加粗文字')">
        <strong>B</strong>
      </button>
      <button class="tool-btn" title="斜体" @click="toolbarInsert('*', '*', '斜体文字')"><i>I</i></button>
      <button class="tool-btn" title="删除线" @click="toolbarInsert('~~', '~~', '删除线')"><s>S</s></button>
      <span style="width: 8px"></span>
      <button class="tool-btn" title="一级标题" @click="toolbarInsert('# ', '', '标题')">
        H1
      </button>
      <button class="tool-btn" title="二级标题" @click="toolbarInsert('## ', '', '标题')">
        H2
      </button>
      <button class="tool-btn" title="引用" @click="toolbarInsert('> ', '', '引用内容')">❝</button>
      <span style="width: 8px"></span>
      <button class="tool-btn" title="行内代码" @click="toolbarInsert('`', '`', 'code')">
        &lt;/&gt;
      </button>
      <button class="tool-btn" title="代码块" @click="toolbarInsert('\n```js\n', '\n```\n', 'code')">
        { }
      </button>
      <button class="tool-btn" title="链接" @click="toolbarInsert('[', '](https://)', '链接文字')">
        <el-icon><Link /></el-icon>
      </button>
      <button class="tool-btn" title="行内公式" @click="toolbarInsert('$', '$', 'E=mc^2')">
        ∑
      </button>
      <button class="tool-btn" title="公式块" @click="toolbarInsert('\n$$\n', '\n$$\n', '\\frac{a}{b}')">
        ∫
      </button>
    </div>

    <!-- 编辑 + 预览 -->
    <div ref="editorBody" class="editor-body">
      <div
        ref="editorWrapRef"
        class="editor-pane-wrap"
        :style="{ flexBasis: `${splitPercent}%` }"
      >
        <MarkdownEditor
          v-if="editor.current"
          ref="editorRef"
          :model-value="editor.content"
          :font-size="app.settings.editorFontSize"
          @update:model-value="editor.setContent"
          @save="editor.flushSave()"
          @image="(name: string, b64: string) => onImage(name, b64)"
        />
      </div>
      <div
        class="split-divider"
        :class="{ dragging }"
        @mousedown.prevent="startDrag"
      ></div>
      <div style="flex: 1; overflow: hidden">
        <MarkdownPreview
          v-if="editor.current"
          ref="previewRef"
          :content="editor.content"
          :vault="vaultName"
          :note-path="editor.current.path"
          :font-size="app.settings.editorFontSize"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-pane-wrap {
  height: 100%;
  overflow: hidden;
  flex-shrink: 0;
  flex-grow: 0;
}
</style>
