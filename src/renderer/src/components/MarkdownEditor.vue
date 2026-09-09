<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { undo, redo } from '@codemirror/commands'

const props = defineProps<{
  modelValue: string
  fontSize: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'save'): void
  (e: 'image', fileName: string, base64: string): void
}>()

const container = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
/** 是否由外部（props）导致的文档替换，避免回环 */
let applyingExternal = false

const traceTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    height: '100%',
    fontSize: `${props.fontSize}px`
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Sarasa Mono SC', Consolas, monospace",
    lineHeight: '1.7',
    padding: '12px 0 40vh'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-tertiary)',
    border: 'none'
  },
  // 标题折叠按钮：与侧栏折叠箭头同语言——弱化常态色、圆角热区、悬停反馈
  '.cm-foldGutter .cm-foldGutterElement': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    padding: '1px 0',
    borderRadius: '4px',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease'
  },
  '.cm-foldGutter .cm-foldGutterElement:hover': {
    backgroundColor: 'var(--bg-tertiary)',
    color: 'var(--text-primary)'
  },
  '.cm-foldGutter .cm-foldGutterElement svg': {
    fill: 'currentColor',
    width: '14px',
    height: '14px'
  },
  // 折叠后在正文中留下的「⋯」占位符
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text-secondary)',
    border: 'none',
    borderRadius: '4px',
    padding: '0 6px',
    margin: '0 4px',
    cursor: 'pointer'
  },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--accent-soft) !important'
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' }
})

function createView(initialDoc: string): EditorView {
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      traceTheme,
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            emit('save')
            return true
          }
        },
        // Markdown 格式化快捷键（复用工具栏的智能插入：有选中包裹 / 无选中插占位）
        { key: 'Mod-b', preventDefault: true, run: () => (insertSnippet('**', '**'), true) },
        { key: 'Mod-i', preventDefault: true, run: () => (insertSnippet('*', '*'), true) },
        { key: 'Mod-Shift-x', preventDefault: true, run: () => (insertSnippet('~~', '~~'), true) }
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        if (applyingExternal) return
        emit('update:modelValue', update.state.doc.toString())
      })
    ]
  })
  return new EditorView({ state, parent: container.value! })
}

onMounted(() => {
  view = createView(props.modelValue)
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    applyingExternal = true
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    applyingExternal = false
  }
)

watch(
  () => props.fontSize,
  (size) => {
    container.value?.style.setProperty('font-size', `${size}px`)
    const cm = container.value?.querySelector('.cm-editor') as HTMLElement | null
    if (cm) cm.style.fontSize = `${size}px`
  }
)

/** 在光标处插入文本（图片引用等） */
function insertText(text: string): void {
  if (!view) return
  const pos = view.state.selection.main.head
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length }
  })
  view.focus()
}

/**
 * 工具栏插入（成对标记）：
 * - 有选中文字 → 用 before/after 包裹选中内容，保持选中
 * - 无选中且有占位文字 → 插入 before+占位+after 并选中占位（直接打字即替换）
 * - 无选中且无占位（如公式定界符）→ 插入标记，光标落在中间
 */
function insertSnippet(before: string, after = '', placeholder = ''): void {
  if (!view) return
  const sel = view.state.selection.main
  if (!sel.empty) {
    const selected = view.state.sliceDoc(sel.from, sel.to)
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `${before}${selected}${after}` },
      selection: { anchor: sel.from + before.length, head: sel.from + before.length + selected.length }
    })
  } else {
    const insert = `${before}${placeholder}${after}`
    view.dispatch({
      changes: { from: sel.from, insert },
      selection: { anchor: sel.from + before.length, head: sel.from + before.length + placeholder.length }
    })
  }
  view.focus()
}

/** 处理粘贴 / 拖入的图片 */
function handleFiles(files: FileList): void {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] ?? ''
      emit('image', file.name, base64)
    }
    reader.readAsDataURL(file)
  }
}

function onPaste(e: ClipboardEvent): void {
  if (e.clipboardData?.files.length) {
    e.preventDefault()
    handleFiles(e.clipboardData.files)
  }
}

function onDrop(e: DragEvent): void {
  if (e.dataTransfer?.files.length) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }
}

defineExpose({
  insertText,
  insertSnippet,
  focus: () => {
    if (view) view.focus()
  },
  undo: () => {
    if (view) undo(view)
  },
  redo: () => {
    if (view) redo(view)
  }
})
</script>

<template>
  <div
    ref="container"
    class="editor-pane"
    @paste="onPaste"
    @drop="onDrop"
    @dragover.prevent
  ></div>
</template>
