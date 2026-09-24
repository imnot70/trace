<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, Prec, Transaction, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import {
  defaultKeymap,
  cursorDocEnd,
  cursorDocStart,
  history,
  historyKeymap,
  redo,
  undo
} from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import { livePreview } from '../lib/livePreview'
import { typewriter, type TypewriterMode } from '../lib/typewriter'
import { createCaretSound, type SoundVariant } from '../lib/caretSound'
import { setHeading, type HeadingLevel } from '../lib/heading'
import { insertTable } from '../lib/table'
import { tableTab } from '../lib/tableNav'
import { useTablePromptStore } from '../stores/tablePrompt'
import type { PromptKey } from '../lib/tablePrompt'
import type { TreeNode } from '@shared/types'

const props = defineProps<{
  modelValue: string
  fontSize: number
  vault: string
  notePath: string
  /** 所见即所得模式（Live Preview）：true 时挂载装饰扩展 */
  wysiwyg?: boolean
  /** 打字机模式：off 关闭 / center 高位 / bottom 低位（见 lib/typewriter.ts） */
  typewriterMode?: TypewriterMode
  /** 回车音效：启用时回车插入换行播放合成音（心流模式内由父组件置位） */
  returnSound?: { enabled: boolean; volume: number; variant: SoundVariant; skipRepeat: boolean }
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'save'): void
  (e: 'image', fileName: string, base64: string): void
  (e: 'open-note', target: { vault: string; path: string; name: string }): void
}>()

const container = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
/** 是否由外部（props）导致的文档替换，避免回环 */
let applyingExternal = false

/** 回车音效合成器（懒建 AudioContext；仅在心流模式且开关开启时被调用） */
const caretSound = createCaretSound()

/** 编辑位置（FR-2.4.18）：打开笔记后由 store 置一次性意图，本组件消费 */
const editorStore = useEditorStore()

/** 表格尺寸输入提示态（FR-2.4.20）：状态在 store（浮层在 EditorView 渲染） */
const tablePrompt = useTablePromptStore()

/** 提示态按键：已被状态机消费返回 true（不进入编辑器）；未激活时返回 false */
function promptKey(key: PromptKey, digit = ''): boolean {
  if (!tablePrompt.active) return false
  return tablePrompt.step(key, digit)
}

/** 该事务是否为「插入换行」的用户输入（排除粘贴：粘贴多行不应发声） */
function isReturnInsertion(tr: Transaction): boolean {
  const event = tr.annotation(Transaction.userEvent) ?? ''
  if (!event.startsWith('input') || event.startsWith('input.paste')) return false
  let hasNewline = false
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.toString().includes('\n')) hasNewline = true
  })
  return hasNewline
}

/** livePreview 扩展挂载点：模式开关 / 换库换笔记都经 Compartment 重配置（不重建视图） */
const livePreviewCompartment = new Compartment()
/** 打字机扩展挂载点：模式切换经 Compartment 换装（无 StateField，允许增删） */
const typewriterCompartment = new Compartment()

/**
 * 折叠标记：默认的文本字形（`⌄` / `›`）太小且与应用图标语言不一致，改为自绘线性箭头。
 * 形如 `foldGutter({ markerDOM })` 的配置必须替换 basicSetup——它不开放配置，
 * 故按其官方建议改为下方 traceSetup 自有装配（清单逐项对齐 basicSetup，仅换折叠按钮）
 */
const FOLD_CHEVRON_DOWN =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 6.5L8 10L11.5 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const FOLD_CHEVRON_RIGHT =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 4.5L10 8L6.5 11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function foldMarker(open: boolean): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.tabIndex = -1
  btn.className = 'trace-fold-marker'
  btn.setAttribute('aria-label', open ? '折叠' : '展开')
  btn.innerHTML = open ? FOLD_CHEVRON_DOWN : FOLD_CHEVRON_RIGHT
  return btn
}

/**
 * 编辑器基础装配（等价于 codemirror 的 basicSetup，仅折叠按钮改自绘）。
 * 保留清单：行号、活动行（含行号高亮）、特殊字符、历史、折叠、选区绘制、拖放光标、
 * 多选、输入重缩进、语法高亮回退、括号配对与自动闭合、补全、矩形选择、十字光标、
 * 选中词高亮、以及各默认键位表。
 * 说明：basicSetup 含 lintKeymap，但本项目未配置任何 linter（未直接依赖 @codemirror/lint），
 * 无 linter 时该键位本就无作用，故不纳入。
 */
function traceSetup(): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter({ markerDOM: foldMarker }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap
    ])
  ]
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '')
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
  // 1. [[双链]] 笔记名补全（逐级路径）
  const wikilink = context.matchBefore(/\[\[[^\]]*$/)
  if (wikilink) {
    const prefix = wikilink.text.slice(2) // 去掉 [[
    const tree = useTreeStore()
    const nodes = tree.trees[props.vault] ?? []
    const currentRel = props.notePath.replace(/\.md$/i, '')

    // 逐级补全：按 "/" 分割，最后一段是当前输入前缀，前面的是已选路径
    const segments = prefix.split('/')
    const dirSegments = segments.length > 1 ? segments.slice(0, -1) : []
    const inputPrefix = segments.length > 1 ? segments[segments.length - 1] : prefix

    // 定位到当前目录节点
    let currentNodes = nodes
    for (const seg of dirSegments) {
      const child = currentNodes.find(
        (n) => n.kind === 'dir' && n.name.toLowerCase() === seg.toLowerCase()
      )
      if (!child || child.kind !== 'dir' || !child.children) return null
      currentNodes = child.children
    }

    const basePath = dirSegments.length > 0 ? dirSegments.join('/') + '/' : ''
    const completionFrom = wikilink.from + 2
    const completionTo = completionFrom + prefix.length

    // 收集当前层级的文件夹和笔记
    const options: { label: string; detail: string; apply?: string | ((view: EditorView, _c: any, from: number, to: number) => void) }[] = []
    for (const node of currentNodes) {
      if (node.name.startsWith('.')) continue
      if (node.kind === 'dir') {
        if (!inputPrefix || node.name.toLowerCase().startsWith(inputPrefix.toLowerCase())) {
          const folderLabel = basePath + node.name + '/'
          options.push({
            label: folderLabel,
            detail: '文件夹',
            apply: (view: EditorView, _c: any, from: number, to: number) => {
              // 替换 [[ 和游标之间的文本，光标停在 / 后
              view.dispatch({
                changes: { from, to, insert: folderLabel },
                selection: { anchor: from + folderLabel.length }
              })
              // 延迟触发下一轮补全
              setTimeout(() => startCompletion(view), 50)
            }
          })
        }
      } else if (node.kind === 'note') {
        const notePath = basePath + node.name
        if (notePath.toLowerCase() === currentRel.toLowerCase()) continue
        if (!inputPrefix || node.name.toLowerCase().startsWith(inputPrefix.toLowerCase())) {
          // 笔记用简单字符串替换，自动处理闭合 ]] 的逻辑
          options.push({
            label: basePath + node.name,
            detail: '笔记'
          })
        }
      }
    }
    if (options.length === 0) return null
    return {
      from: completionFrom,
      to: completionTo,
      options
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
    width: '22px',
    padding: '0',
    borderRadius: '4px',
    color: 'var(--text-tertiary)'
  },
  // 折叠标记本体：20×20 热区 + 16px 线性箭头（默认的文本字形太小且与图标语言不一致）
  '.trace-fold-marker': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    padding: '0',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease'
  },
  '.trace-fold-marker:hover': {
    backgroundColor: 'var(--bg-tertiary)',
    color: 'var(--text-primary)'
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
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  // 补全提示框样式（匹配应用整体风格）
  '.cm-tooltip': {
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    backgroundColor: 'var(--bg-primary)',
    overflow: 'hidden'
  },
  '.cm-tooltip-autocomplete': {
    maxHeight: '240px',
    overflow: 'auto'
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Sarasa Mono SC', Consolas, monospace",
    fontSize: '12px'
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 10px',
    lineHeight: '1.6',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: '#fff'
  },
  '.cm-completionDetail': {
    fontSize: '11px',
    color: 'var(--text-tertiary)',
    marginLeft: 'auto',
    fontStyle: 'normal'
  }
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
      traceSetup(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      traceTheme,
      livePreviewCompartment.of(buildLivePreview()),
      typewriterCompartment.of(typewriter(props.typewriterMode ?? 'off')),
      // 表格尺寸提示态（FR-2.4.20）：最高优先级拦截数字 / 空格 / 回车 / Esc；未激活时一律放行。
      // 「其它按键即取消」用 keymap 的 any 处理器（仅在无具体绑定命中时执行）实现
      // ⚠️ 这些绑定同样不能带 preventDefault。CM 的语义是「标志只在命令未处理时生效」：
      //   · 未激活 → 命令返回 false → 标志生效，按键被 CM 标记为已处理并 preventDefault
      //     （空格与数字 0-9 因此再也打不进编辑器，v0.8.0 的实测缺陷）；
      //   · 激活 → 命令返回 true → CM 在事件分发里自会 preventDefault，尺寸输入不会漏进正文。
      // 即「返回 false 时也要 preventDefault」这件事只应交给绑定自己按状态决定，见下方 any 处理器
      Prec.highest(
        keymap.of([
          { key: 'Escape', run: () => promptKey('escape') },
          { key: 'Enter', run: () => promptKey('enter') },
          { key: 'Space', run: () => promptKey('space') },
          ...'0123456789'.split('').map((d) => ({
            key: d,
            run: () => promptKey('digit', d)
          })),
          {
            any: (_view, event) => {
              const key = event.key
              if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
              if (key === 'Escape' || key === 'Enter' || key === ' ' || /^[0-9]$/.test(key)) return false
              if (!tablePrompt.active) return false
              tablePrompt.cancel() // 输入其它按键：退出提示态并把按键交给编辑器
              return false
            }
          }
        ])
      ),
      // 表格内 Tab / Shift+Tab 跳转（FR-2.4.21）：非表格内 / 补全浮层打开时返回 false 让位。
      // ⚠️ 这两个绑定不能带 preventDefault——CM 的语义是「绑定声明了 preventDefault 就无条件阻断默认行为」，
      // 那样表格外按 Tab 也无法移动焦点了（命令返回 true 时 CM 自会 preventDefault）
      Prec.high(
        keymap.of([
          { key: 'Tab', run: (target: EditorView) => tableTab(target, 1) },
          { key: 'Shift-Tab', run: (target: EditorView) => tableTab(target, -1) }
        ])
      ),
      // 提示态期间点击编辑区其它位置 / 编辑器失焦 → 取消（不插入）
      EditorView.domEventHandlers({
        mousedown: () => {
          if (tablePrompt.active) tablePrompt.cancel()
          return false
        },
        blur: () => {
          if (tablePrompt.active) tablePrompt.cancel()
          return false
        }
      }),
      // Prec.high：这些是应用级绑定，必须优先于 basicSetup 内置键位（如 searchKeymap 的 Mod-f）
      Prec.high(keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            emit('save')
            return true
          }
        },
        // 禁用 CM 原生查找面板，由全局搜索接管。
        // 必须 return true 才算「消费」该按键：返回 false 表示未处理，会继续落到
        // basicSetup 的 searchKeymap 上把查找面板弹出来（实测焦点会被面板抢走）。
        // CM 只 preventDefault、不阻断冒泡，App.vue 的窗口级 Ctrl+F 仍会打开全局搜索
        {
          key: 'Mod-f',
          preventDefault: true,
          run: () => true
        },
        // Markdown 格式化快捷键（复用工具栏的智能插入：有选中包裹 / 无选中插占位）
        { key: 'Mod-b', preventDefault: true, run: () => (insertSnippet('**', '**'), true) },
        { key: 'Mod-i', preventDefault: true, run: () => (insertSnippet('*', '*'), true) },
        { key: 'Mod-Shift-x', preventDefault: true, run: () => (insertSnippet('~~', '~~'), true) },
        // 标题层级（FR-2.4.15）：Ctrl+1–6 设级别、Ctrl+0 清除；Ctrl+T 插入表格（FR-2.4.16）
        ...[1, 2, 3, 4, 5, 6].map((level) => ({
          key: `Mod-${level}`,
          preventDefault: true,
          run: (target: EditorView) => (setHeading(target, level as HeadingLevel), true)
        })),
        { key: 'Mod-0', preventDefault: true, run: (target: EditorView) => (setHeading(target, 0), true) },
        // 表格：Ctrl+T 进入尺寸提示态（FR-2.4.20）；提示态中再按一次 = 按当前尺寸插入
        {
          key: 'Mod-t',
          preventDefault: true,
          run: () => {
            if (tablePrompt.active) tablePrompt.finish()
            else beginTablePrompt()
            return true
          }
        },
        // 文首 / 文尾跳转（FR-2.4.19）：主键盘区替代键位（笔记本上 Home / End 常需 Fn）；
        // CM 自带 scrollIntoView，视图随光标滚动
        { key: 'Mod-Shift-h', preventDefault: true, run: (target: EditorView) => (cursorDocStart(target), true) },
        { key: 'Mod-Shift-e', preventDefault: true, run: (target: EditorView) => (cursorDocEnd(target), true) }
      ])),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        if (applyingExternal) return
        // 回车音效：心流模式内（父组件仅在该模式下置 enabled）且为换行插入时播放
        const sound = props.returnSound
        if (sound?.enabled && update.transactions.some(isReturnInsertion)) {
          caretSound.playReturn(sound.volume, sound.variant, { skipConsecutive: sound.skipRepeat })
        }
        emit('update:modelValue', update.state.doc.toString())
      }),
      autoCloseHtmlTags,
      autocompletion({ override: [traceCompletions] })
    ]
  })
  return new EditorView({ state, parent: container.value! })
}

/** 组装所见即所得扩展：结构（含 StateField）必须常驻挂载——Compartment 不允许增删
 *  StateField，只能重配 Facet 值，故以 enabled 开关门控（开关即重配，无重建） */
function buildLivePreview() {
  return livePreview({
    enabled: props.wysiwyg ?? false,
    vault: props.vault,
    notePath: props.notePath,
    resolveName: (name: string) => {
      const tree = useTreeStore()
      const nodes = tree.trees[props.vault] ?? []
      const target = name.toLowerCase()
      const match = (list: TreeNode[]): boolean =>
        list.some((n) =>
          n.kind === 'note'
            ? n.name.toLowerCase() === `${target}.md` || n.name.toLowerCase() === target
            : n.kind === 'dir' && n.children
              ? match(n.children)
              : false
        )
      return match(nodes)
    },
    openNote: (target) => emit('open-note', target),
    openExternal: (url: string) => window.open(url, '_blank', 'noopener,noreferrer')
  })
}

watch(
  () => [props.wysiwyg, props.vault, props.notePath] as const,
  () => {
    if (!view) return
    view.dispatch({ effects: livePreviewCompartment.reconfigure(buildLivePreview()) })
  }
)

// 关闭音效开关即释放音频上下文（验收标准：关闭后无残留音频上下文）
watch(
  () => props.returnSound?.enabled,
  (enabled) => {
    if (!enabled) caretSound.dispose()
  }
)

watch(
  () => props.typewriterMode,
  (mode) => {
    if (!view) return
    view.dispatch({ effects: typewriterCompartment.reconfigure(typewriter(mode ?? 'off')) })
  }
)

/**
 * 消费「表格尺寸」插入意图（FR-2.4.20）：提示态结束（空格 / 回车 / 倒计时 / 再按 Ctrl+T）后
 * 由 store 置位，这里执行实际插入
 */
function applyPendingTableInsert(): void {
  const dims = tablePrompt.pendingInsert
  if (!dims || !view) return
  const consumed = tablePrompt.consumeInsert()
  if (consumed) insertTable(view, consumed)
}

/**
 * 应用「编辑位置」意图（FR-2.4.18）：打开笔记后把光标放到文首 / 文末，消费后清空意图。
 * 由两个时机调用，保证任何打开路径都生效：① 文档被整体替换时（props.modelValue watcher）；
 * ② 组件挂载时——首次打开笔记时 store 已置位、组件才随后挂载，只靠 watcher 会漏掉这一次
 */
function applyPendingPlacement(): void {
  const place = editorStore.pendingPlacement
  if (!place || !view) return
  editorStore.pendingPlacement = null
  const pos = place === 'end' ? view.state.doc.length : 0
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: place === 'end' ? 'end' : 'start' })
  })
}

watch(
  () => tablePrompt.pendingInsert,
  () => applyPendingTableInsert()
)

onMounted(() => {
  view = createView(props.modelValue)
  // 挂载前 store 可能已置下「编辑位置」意图（首次打开笔记：先 openNote 再挂载编辑器）
  applyPendingPlacement()
})

onBeforeUnmount(() => {
  tablePrompt.cancel()
  view?.destroy()
  view = null
  caretSound.dispose()
})

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) {
      // 内容未变（例如重新打开同一篇笔记）：仍按设置落位，并避免留下陈旧意图
      applyPendingPlacement()
      return
    }
    applyingExternal = true
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    applyingExternal = false
    applyPendingPlacement()
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

/** 滚动到指定源码行（0 基），供预览→编辑器同步 / 反向链接定位。
 *  注意 scrollIntoView 接受的是文档字符偏移（pos），须先经 doc.line(n).from 换算 */
function scrollToLine(line: number, y: 'start' | 'center' | 'end' | 'nearest' = 'start'): void {
  if (!view) return
  const lineNo = Math.min(line + 1, view.state.doc.lines)
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(lineNo).from, { y }) })
}

/** 表格插入（工具栏 / Ctrl+T 共用入口）；见 lib/table.ts */
function insertTableAtCursor(): void {
  if (!view) return
  insertTable(view)
}

/**
 * 进入表格尺寸提示态（FR-2.4.20）：Ctrl+T 与工具栏「表格」按钮共用。
 * 浮层锚点取光标屏幕坐标（转为编辑卡片内的相对坐标）；下方空间不足时翻到光标上方
 */
function beginTablePrompt(): void {
  if (!view) return
  const pos = view.state.selection.main.head
  const coords = view.coordsAtPos(pos)
  const card = container.value?.closest('.editor-card') as HTMLElement | null
  let x = 12
  let y = 12
  let above = false
  if (coords && card) {
    const box = card.getBoundingClientRect()
    x = Math.max(8, Math.min(coords.left - box.left, Math.max(8, box.width - 240)))
    above = box.bottom - coords.bottom < 120 && coords.top - box.top > 120
    y = above ? coords.top - box.top : coords.bottom - box.top
  }
  tablePrompt.begin({ x, y, above })
}

/** 设置 / 清除标题层级（工具栏下拉 / Ctrl+1–6、Ctrl+0 共用入口）；见 lib/heading.ts */
function setHeadingLevel(level: HeadingLevel): void {
  if (!view) return
  setHeading(view, level)
}

defineExpose({
  insertText,
  firstVisibleLine,
  scrollToLine,
  insertSnippet,
  insertTable: insertTableAtCursor,
  beginTablePrompt,
  setHeading: setHeadingLevel,
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
