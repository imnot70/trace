<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { undo, redo } from '@codemirror/commands'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { useTreeStore } from '../stores/tree'
import type { TreeNode } from '@shared/types'

const props = defineProps<{
  modelValue: string
  fontSize: number
  vault: string
  notePath: string
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

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '')
}

/** 递归收集目录下所有笔记名（去 .md 后缀） */
function collectNotes(nodes: TreeNode[], prefix = ''): string[] {
  const result: string[] = []
  for (const n of nodes) {
    if (n.kind === 'note') result.push(prefix ? `${prefix}/${n.name}` : n.name)
    else if (n.kind === 'dir' && n.children) result.push(...collectNotes(n.children, prefix ? `${prefix}/${n.name}` : n.name))
  }
  return result
}

/** 根据相对路径获取目录节点 */
function getDirAt(tree: TreeNode[], relDir: string): TreeNode[] {
  if (!relDir) return tree
  const parts = relDir.split('/')
  let current = tree
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') return [] // 不支持向上
    const dir = current.find((n) => n.kind === 'dir' && n.name === part)
    if (!dir?.children) return []
    current = dir.children
  }
  return current
}

/** 综合补全：[[双链]] 笔记名 + 相对路径 + 锚点 */
function traceCompletions(context: CompletionContext): CompletionResult | null {
  // 1. [[双链]] 笔记名补全
  const wikilink = context.matchBefore(/\[\[[^\]]*$/)
  if (wikilink) {
    const prefix = wikilink.text.slice(2) // 去掉 [[
    const tree = useTreeStore()
    const nodes = tree.trees[props.vault] ?? []
    const notes = collectNotes(nodes)
    // 排除当前笔记自身（用完整路径比较，避免不同目录下同名笔记被误排除）
    const currentRel = props.notePath.replace(/\.md$/i, '').toLowerCase()
    const filtered = notes
      .filter((n) => n.toLowerCase() !== currentRel)
      .filter((n) => !prefix || n.toLowerCase().includes(prefix.toLowerCase()))
    if (filtered.length === 0) return null
    return {
      from: wikilink.from + 2,
      options: filtered.map((n) => ({
        label: n,
        detail: '笔记',
        // 选中后自动闭合 ]]，光标停在闭合符前（便于继续追加 |显示名）
        apply: (view, _completion, from, to) => {
          view.dispatch({
            changes: { from, to, insert: `${n}]]` },
            selection: { anchor: from + n.length }
          })
        }
      }))
    }
  }

  // 2. 相对路径链接补全：[text](./path) 或 [text](../path)
  const pathLink = context.matchBefore(/\]\(\.\/?[^)]*$|\]\(\.\.\/[^)]*$/)
  if (pathLink) {
    const refStart = pathLink.text.indexOf('(') + 1
    const ref = pathLink.text.slice(refStart)
    const lastSlash = ref.lastIndexOf('/')
    const dirPart = lastSlash >= 0 ? ref.slice(0, lastSlash + 1) : ''
    const prefix = lastSlash >= 0 ? ref.slice(lastSlash + 1) : ref

    const tree = useTreeStore()
    const nodes = tree.trees[props.vault] ?? []
    // 计算当前笔记所在目录
    const noteDir = props.notePath.includes('/') ? props.notePath.slice(0, props.notePath.lastIndexOf('/')) : ''
    // 解析相对路径到库内目录
    const resolvedDir = resolveRelDir(noteDir, dirPart)
    const dirNodes = getDirAt(nodes, resolvedDir)

    const options: { label: string; detail: string; apply: string }[] = []
    for (const n of dirNodes) {
      if (n.name.startsWith('.')) continue
      if (n.kind === 'dir') {
        if (!prefix || n.name.toLowerCase().startsWith(prefix.toLowerCase())) {
          options.push({ label: n.name + '/', detail: '文件夹', apply: n.name + '/' })
        }
      } else if (n.kind === 'note') {
        if (!prefix || n.name.toLowerCase().startsWith(prefix.toLowerCase())) {
          options.push({ label: n.name + '.md', detail: '笔记', apply: n.name + '.md' })
        }
      }
    }
    if (options.length === 0) return null
    return {
      from: pathLink.from + refStart,
      options
    }
  }

  // 3. 锚点补全
  const anchor = context.matchBefore(/#[\w\u4e00-\u9fff-]*$/)
  if (anchor) {
    const prefix = anchor.text.slice(1)
    const doc = context.state.doc.toString()
    const items: { label: string; detail: string }[] = []
    const seen = new Map<string, number>()
    const headingRe = /^(#{1,6})\s+(.+)$/gm
    let m: RegExpExecArray | null
    while ((m = headingRe.exec(doc))) {
      let id = slugify(m[2])
      const count = seen.get(id) ?? 0
      seen.set(id, count + 1)
      if (count > 0) id = `${id}-${count}`
      items.push({ label: id, detail: '标题' })
    }
    const idRe = /\bid="([^"]+)"/g
    while ((m = idRe.exec(doc))) {
      if (!seen.has(m[1])) {
        seen.set(m[1], 0)
        items.push({ label: m[1], detail: '锚点' })
      }
    }
    const filtered = prefix ? items.filter((o) => o.label.startsWith(prefix)) : items
    if (filtered.length === 0) return null
    return { from: anchor.from + 1, options: filtered }
  }

  return null
}

/** 解析相对路径到库内目录 */
function resolveRelDir(noteDir: string, rel: string): string {
  const parts = noteDir ? noteDir.split('/') : []
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { if (parts.length > 0) parts.pop() }
    else parts.push(seg)
  }
  return parts.join('/')
}

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

const selfClosers = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])

const autoCloseHtmlTags = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '>' || view.composing || view.state.readOnly || from !== to) return false
  const before = view.state.doc.sliceString(Math.max(0, from - 100), from)
  const match = before.match(/<([a-zA-Z][a-zA-Z0-9]*)\s*(?:[^>]*[^/])?\s*$/)
  if (!match || selfClosers.has(match[1].toLowerCase())) return false
  const tag = match[1]
  view.dispatch({
    changes: { from, to, insert: `></${tag}>` },
    selection: { anchor: from + 1 },
    userEvent: 'input.complete'
  })
  return true
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
      }),
      autoCloseHtmlTags,
      autocompletion({ override: [traceCompletions] })
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

/** 当前可视首行（0 基源码行号）与行内像素比例，供预览侧行级同步 */
function firstVisibleLine(): { line: number; ratio: number } | null {
  if (!view) return null
  const scroller = view.scrollDOM
  const block = view.lineBlockAtHeight(scroller.scrollTop)
  const line = view.state.doc.lineAt(block.from).number - 1
  const ratio =
    block.height > 0
      ? Math.min(1, Math.max(0, (scroller.scrollTop - block.top) / block.height))
      : 0
  return { line, ratio }
}

/** 滚动到指定源码行（0 基），供预览→编辑器同步。
 *  注意 scrollIntoView 接受的是文档字符偏移（pos），须先经 doc.line(n).from 换算 */
function scrollToLine(line: number): void {
  if (!view) return
  const lineNo = Math.min(line + 1, view.state.doc.lines)
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(lineNo).from, { y: 'start' }) })
}

defineExpose({
  insertText,
  firstVisibleLine,
  scrollToLine,
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
