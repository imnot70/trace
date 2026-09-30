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
import { highlightSelectionMatches, searchKeymap, openSearchPanel } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  completionStatus,
  selectedCompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { useTreeStore } from '../stores/tree'
import { useEditorStore } from '../stores/editor'
import { livePreview } from '../lib/livePreview'
import { smartVerticalMove } from '../lib/livePreview/smartMove'
import { typewriter, type TypewriterMode } from '../lib/typewriter'
import { buildVimExtension, getVimCM, readVimMode, VIM_INPUT_EVENT } from '../lib/vimMode'
import { createCaretSound, type SoundVariant } from '../lib/caretSound'
import { setHeading, type HeadingLevel } from '../lib/heading'
import { insertTable } from '../lib/table'
import { tableTab } from '../lib/tableNav'
import { useTablePromptStore } from '../stores/tablePrompt'
import { useAppStore } from '../stores/app'
import { SCRATCH_VAULT } from '@shared/types'
import type { PromptKey } from '../lib/tablePrompt'
import { flatCompletionOptions, type NoteTreeNode } from '../lib/noteCompletion'
import { referenceInsertSpec } from '../lib/quickRef'
import { filterSlashCommands, type SlashAction } from '../lib/slashCommands'
import { invisiblePasteExtension, buildCleanInvisibleTransaction } from '../lib/invisibleEdits'
import { collectDocInvisible } from '../lib/invisibleChars'
import { treeHasWikiTarget } from '../lib/wikiTarget'
import { hasNoteRefDrag, readNoteRefDrag, consumeDragAltLatch, type NoteRefPayload } from '../lib/dragDrop'
import { ElMessage, ElMessageBox } from 'element-plus'
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
  /** Vim 编辑模式（FR-2.4.23）：开启时挂载 vim 键位扩展（冲突键卸载与 Esc 策略见 lib/vimMode.ts） */
  vimEnabled?: boolean
  /** 回车音效：启用时回车插入换行播放合成音（心流模式内由父组件置位） */
  returnSound?: { enabled: boolean; volume: number; variant: SoundVariant; skipRepeat: boolean }
  /** 悬浮预览正在展示的笔记（FR-2.9.10）：非空时 Alt+Enter 语义变为把该笔记落成引用 */
  previewTarget?: { vault: string; path: string; name: string } | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'save'): void
  (e: 'image', fileName: string, base64: string): void
  (e: 'open-note', target: { vault: string; path: string; name: string }): void
  /** 补全面板里请求预览一篇笔记（不改变当前编辑中的笔记） */
  (e: 'preview-note', target: { vault: string; path: string; name: string }): void
  /** Alt+Enter 落跨库引用（FR-2.9.11）：交外层弹确认框 → 复制进当前库 → 插入引用 */
  (e: 'insert-cross-vault', target: { vault: string; path: string; name: string }): void
  /** 拖曳插入引用（FR-2.9.10 P3）：笔记条目拖入编辑器释放，at = 释放点（null = 无法
   *  解析回落光标）、modifiers = 释放时的修饰键（alt = 插入后保留来源弹窗）；
   *  三路引入语义收敛在外层 insertPreviewTarget */
  (e: 'drop-note-ref', target: { vault: string; path: string; name: string }, at: number | null, modifiers: { alt: boolean }): void
  /** 快速引入图片（FR-2.5.4）：Ctrl+Shift+I 交外层调系统文件选择器（需要 vault/path，外层有） */
  (e: 'pick-image'): void
}>()

/**
 * CM 内置查找/替换面板的中文文案（FR-2.9.11 当前笔记内搜索）。
 * @codemirror/search 的面板字符串都经 EditorState.phrases 取词，按 key 映射即可；
 * 未列出的 key 回退英文原文。附带快捷键提示由面板 title 属性承载，跟随映射。
 */
const SEARCH_PANEL_ZH: Record<string, string> = {
  Find: '查找',
  Replace: '替换',
  next: '下一个（Enter）',
  previous: '上一个（Shift+Enter）',
  all: '全部',
  'match case': '区分大小写（Alt+C）',
  'by word': '整词匹配（Alt+W）',
  regexp: '正则表达式（Alt+R）',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭（Esc）',
  'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 处',
  'replaced match on line $': '已在第 $ 行替换',
  'on line': '行',
  'go to line': '跳转到行'
}

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

/**
 * 补全面板预览（心流快速查阅）：补全打开时按 Mod+Enter，将当前选中的**笔记**候选项
 * 通过 preview-note 事件交由外层呼出悬浮预览——不插入文本、不关闭补全面板，
 * 看完点回编辑区（悬浮预览的「一瞥」语义自动收回），继续写作。
 * 场景：心流下写作想起某篇笔记，先看一眼再决定是否引用，全程不离开心流。
 */
function previewSelectedCompletion(): boolean {
  if (!view) return false
  if (completionStatus(view.state) !== 'active') return false
  const picked = selectedCompletion(view.state)
  if (!picked) return false
  // 只对笔记候选项生效（文件夹候选项以 / 结尾；笔记 label 是「路径/显示名」不带扩展名）
  if (picked.label.endsWith('/')) return false
  // 路径取候选项自带的 notePath（FR-2.9.10：扁平补全的唯一名候选项 label 只是叶子名，
  // 不能当路径拼 .md——否则预览会按库根路径找文件报 ENOENT）
  const notePath = (picked as { notePath?: string }).notePath ?? picked.label
  const name = notePath.replace(/.*\//, '')
  emit('preview-note', {
    vault: props.vault,
    path: `${notePath}.md`,
    name
  })
  return true
}

/**
 * Enter 接受补全（替换范围在 [[ 之后）：插入 label；光标后已有 closeBrackets 自动闭合的
 * ]] 时保留它（只插 label），没有则补上 ]]。**不要吸收删除既有闭合**——那会产出
 * [[label 缺右括号（FR-2.9.10 三轮实测反馈）。
 */
function applyNoteCompletion(target: EditorView, from: number, to: number, label: string): void {
  const closed = target.state.sliceDoc(to, to + 1) === ']'
  const insert = label + (closed ? '' : ']]')
  target.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length }
  })
  target.focus()
}

/**
 * 把当前选中的笔记候选项落成引用（FR-2.9.10：悬浮预览「插入引用」按钮 / 预览态 Alt+Enter）。
 * 替换范围**含 [[ 起点直到光标**，写入完整引用 `[[路径]]`，并吸收光标后紧邻的自动闭合 ]]
 * （替换范围含 [[，若只插裸 label 会把括号一起吃掉——前后都没了 []，三轮实测反馈）。
 * 补全非活动态返回 false，由调用方决定兜底行为。
 */
function insertReferenceFromCompletion(): boolean {
  if (!view) return false
  if (completionStatus(view.state) !== 'active') return false
  const picked = selectedCompletion(view.state)
  if (!picked || picked.label.endsWith('/')) return false
  const notePath = (picked as { notePath?: string }).notePath ?? picked.label
  const cursor = view.state.selection.main.head
  const line = view.state.doc.lineAt(cursor)
  const before = line.text.slice(0, cursor - line.from)
  const start = before.lastIndexOf('[[')
  if (start < 0) return false
  const from = line.from + start
  let end = cursor
  let n = 0
  while (n < 2 && view.state.sliceDoc(end, end + 1) === ']') {
    end++
    n++
  }
  const reference = `[[${notePath}]]`
  view.dispatch({
    changes: { from, to: end, insert: reference },
    selection: { anchor: from + reference.length }
  })
  view.focus()
  return true
}

/**
 * 从快速引用面板落引用（FR-2.9.12）：按路径插入 `[[path]]`，两态括号一致性——
 * 光标前有未闭合 `[[` 时从 `[[` 起替换并吸收光标后紧邻 `]]`（与上方补全落引用同款
 * 实测收敛行为），否则光标处直接插入。区间计算抽 lib/quickRef.referenceInsertSpec
 * （纯函数可单测）；跨库 / 草稿路径在 EditorView 侧解析为库内路径后也走本函数。
 * at = 拖曳释放点（FR-2.9.10 P3）：给定时在释放位置插入（两态判定同以该位置为基准），
 * 缺省沿用当前光标。
 */
function insertReferenceAtPath(path: string, at?: number): void {
  if (!view) return
  const cursor = Math.max(0, Math.min(at ?? view.state.selection.main.head, view.state.doc.length))
  const line = view.state.doc.lineAt(cursor)
  const spec = referenceInsertSpec(
    line.text.slice(0, cursor - line.from),
    line.text.slice(cursor - line.from),
    path
  )
  view.dispatch({
    changes: { from: line.from + spec.start, to: line.from + spec.end, insert: spec.insert },
    selection: { anchor: line.from + spec.start + spec.insert.length },
    userEvent: 'input.quickref'
  })
  view.focus()
}

/** 该事务是否为「插入换行」的用户输入（排除粘贴：粘贴多行不应发声）。
 *  input.trace-vim（vim normal 模式的结构编辑 o/O/p 等，见 vimMode.ts）一并排除——
 *  回车音效语义是打字流中的回车（insert 模式 Enter 走原生 input.type 不受影响） */
function isReturnInsertion(tr: Transaction): boolean {
  const event = tr.annotation(Transaction.userEvent) ?? ''
  if (!event.startsWith('input') || event.startsWith('input.paste') || event === VIM_INPUT_EVENT) return false
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
/** Vim 扩展挂载点（FR-2.4.23）：设置开关经 Compartment 换装（键位扩展无 StateField，允许增删） */
const vimCompartment = new Compartment()

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

/** 综合补全：[[双链]] 笔记名 + 相对路径 + 锚点 + 斜杠命令（FR-2.4.22） */
function slashCompletions(context: CompletionContext): CompletionResult | null {
  // 激活策略：仅「行首的 /」触发（/ 后可跟任意非空白过滤文本）——
  // URL（a/b）、日期（2026/09/26）中的 / 前面有别的字符，match 起点不在行首即放弃
  const m = context.matchBefore(/\/[^/\s]*$/)
  if (!m) return null
  if (context.state.doc.lineAt(m.from).from !== m.from) return null
  const query = context.state.sliceDoc(m.from + 1, m.to)
  const defs = filterSlashCommands(query)
  if (defs.length === 0) return null
  const options = defs.map((d) => ({
    label: d.label,
    detail: d.detail,
    type: 'keyword',
    apply: (view: EditorView, _c: unknown, from: number, to: number) => {
      // 先删掉已输入的「/命令文本」（completion apply 不会自动替换函数型 apply 的区间），
      // 再执行动作——动作与快捷键 / 工具栏走同一函数（一致性原则）
      view.dispatch({ changes: { from, to } })
      runSlashAction(d.action)
    }
  }))
  // 源已过滤（filterSlashCommands），关闭 CM 对中文不可靠的内置模糊过滤
  return { from: m.from, options, filter: false }
}

/** 执行斜杠命令：全部落到与快捷键 / 工具栏相同的既有函数，不另造第二套行为 */
function runSlashAction(action: SlashAction): void {
  if (!view) return
  switch (action.kind) {
    case 'table':
      beginTablePrompt()
      break
    case 'heading':
      setHeading(view, action.level)
      view.focus()
      break
    case 'snippet':
      insertSnippet(action.before, action.after, action.placeholder)
      break
    case 'text':
      insertText(action.text())
      break
    case 'cleanInvisible':
      void cleanInvisibleChars()
      break
    case 'insertRef':
      // 快速引用面板（FR-2.9.12）：不聚焦编辑器——面板打开后焦点归过滤输入框
      useAppStore().openQuickRefPicker()
      break
  }
}

/** 清理本文不可见字符（FR-2.4.25，顶栏按钮与 /清理字符 斜杠命令同一入口）：
 *  扫描（计数与写回 change 同源，lib/invisibleChars.collectDocInvisible）→ 确认框列明
 *  种类与处数 → 单事务替换（撤销 / 自动保存 / 外部修改保护既有机制自然生效）。
 *  不做静默清理——文件是唯一事实来源，改文件必须用户确认（不悄悄丢数据） */
async function cleanInvisibleChars(): Promise<void> {
  if (!view) return
  const { nbsp, zeroWidth, changes } = collectDocInvisible(view.state.doc)
  if (changes.length === 0) {
    ElMessage.info('未发现不可见字符')
    return
  }
  const parts: string[] = []
  if (nbsp) parts.push(`${nbsp} 处不换行空格（替换为普通空格）`)
  if (zeroWidth) parts.push(`${zeroWidth} 处零宽字符（删除）`)
  try {
    await ElMessageBox.confirm(`发现 ${parts.join('、')}。清理后可撤销。`, '清理不可见字符', {
      type: 'warning',
      confirmButtonText: '清理',
      cancelButtonText: '取消'
    })
  } catch {
    return // 用户取消
  }
  const tr = buildCleanInvisibleTransaction(view.state)
  if (!tr) return
  view.dispatch(tr)
  ElMessage.success(`已清理 ${nbsp + zeroWidth} 处不可见字符`)
}

function traceCompletions(context: CompletionContext): CompletionResult | null {
  // 1. [[双链]] 笔记名补全（前缀不含 / 走全库扁平模糊匹配 FR-2.9.10；含 / 逐级路径）
  const wikilink = context.matchBefore(/\[\[[^\]]*$/)
  if (wikilink) {
    const prefix = wikilink.text.slice(2) // 去掉 [[
    const tree = useTreeStore()
    const nodes = tree.trees[props.vault] ?? []
    const currentRel = props.notePath.replace(/\.md$/i, '')

    const completionFrom = wikilink.from + 2
    const completionTo = completionFrom + prefix.length

    // 扁平模糊匹配：记不住路径时直接按名字片段全库找（含 / 时走下方原逐级行为）。
    // 文件夹候选项一并列出（label 以 / 结尾，选中进入逐级导航）
    if (!prefix.includes('/')) {
      const flat = flatCompletionOptions(nodes as NoteTreeNode[], prefix, currentRel)
      if (flat.length === 0) return null
      const options = flat.map((o) =>
        o.isDir
          ? {
              ...o,
              apply: (view: EditorView, _c: any, from: number, to: number) => {
                view.dispatch({
                  changes: { from, to, insert: o.label },
                  selection: { anchor: from + o.label.length }
                })
                setTimeout(() => startCompletion(view), 50)
              }
            }
          : {
              ...o,
              apply: (view: EditorView, _c: any, from: number, to: number) =>
                applyNoteCompletion(view, from, to, o.label)
            }
      )
      // filter: false——源已按前缀过滤，CM 内置的模糊过滤对中文匹配不可靠（实测输入
      // 中文会把候选项全滤光、补全直接关闭），关闭它以源为准
      return { from: completionFrom, to: completionTo, options, filter: false }
    }

    // 逐级补全：按 "/" 分割，最后一段是当前输入前缀，前面的是已选路径
    const segments = prefix.split('/')
    const dirSegments = segments.length > 1 ? segments.slice(0, -1) : []
    const inputPrefix = segments.length > 1 ? segments[segments.length - 1] : prefix

    // 定位到当前目录节点（空段 = 库根，支持 [[/ 从根开始浏览）
    let currentNodes = nodes
    for (const seg of dirSegments) {
      if (seg === '') continue
      const child = currentNodes.find(
        (n) => n.kind === 'dir' && n.name.toLowerCase() === seg.toLowerCase()
      )
      if (!child || child.kind !== 'dir' || !child.children) return null
      currentNodes = child.children
    }

    // basePath 归一化：过滤空段（[[/ 从根浏览时 dirSegments 含 ''），避免 label 带前导斜杠
    const rootSegs = dirSegments.filter(Boolean)
    const basePath = rootSegs.length > 0 ? rootSegs.join('/') + '/' : ''

    // 收集当前层级的文件夹和笔记
    const options: { label: string; detail: string; notePath?: string; apply?: string | ((view: EditorView, _c: any, from: number, to: number) => void) }[] = []
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
          // 笔记候选项落成引用走 applyNoteCompletion（吸收 closeBrackets 的自动闭合 ]]）；
          // notePath 供预览 / 插入引用取真实路径
          const label = basePath + node.name
          options.push({
            label,
            detail: '笔记',
            notePath,
            apply: (target: EditorView, _c: any, from: number, to: number) =>
              applyNoteCompletion(target, from, to, label)
          })
        }
      }
    }
    if (options.length === 0) return null
    return {
      from: completionFrom,
      to: completionTo,
      options,
      // 同上：源已过滤（startsWith），关闭 CM 对中文不可靠的模糊过滤
      filter: false
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
  },
  // 内置查找/替换面板（FR-2.9.11 当前笔记内搜索）：按应用设计语言整体重做。
  // 布局用 grid 逐个子元素定位成两行（查找行 / 替换行）——DOM 是扁平的，且 Chromium 的
  // flex 不把 <br> 当换行盒（宽窗口下替换框会被挤上第一行，用户实测踩中），不能用
  // flex-wrap + br 的换行技巧。面板类名是 cm-search（非旧文档的 cm-searchPanel）；
  // 查找框 input[name=search]（带 main-field 属性）、替换框 input[name=replace]、
  // 三个选项开关各包在一个 label 里、关闭按钮 name=close（CM baseTheme 将其绝对
  // 定位在右上角，这里只改配色）。
  '.cm-panel.cm-search': {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: 'minmax(12em, 1fr) repeat(6, auto)',
    gridTemplateRows: 'auto auto',
    columnGap: '8px',
    rowGap: '6px',
    alignItems: 'center',
    padding: '8px 40px 8px 12px',
    overflowX: 'auto',
    backgroundColor: 'var(--bg-primary)',
    borderTop: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: '12px'
  },
  '.cm-panel.cm-search br': { display: 'none' },
  // 第一行：查找框 + 下一个 / 上一个 / 全部 + 三个选项开关
  '.cm-panel.cm-search input[name=search]': { gridRow: '1', gridColumn: '1' },
  '.cm-panel.cm-search button[name=next]': { gridRow: '1', gridColumn: '2' },
  '.cm-panel.cm-search button[name=prev]': { gridRow: '1', gridColumn: '3' },
  '.cm-panel.cm-search button[name=select]': { gridRow: '1', gridColumn: '4' },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    margin: 0,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap'
  },
  '.cm-panel.cm-search label:nth-of-type(1)': { gridRow: '1', gridColumn: '5' },
  '.cm-panel.cm-search label:nth-of-type(2)': { gridRow: '1', gridColumn: '6' },
  '.cm-panel.cm-search label:nth-of-type(3)': { gridRow: '1', gridColumn: '7' },
  // 第二行：替换框 + 替换 / 全部替换（替换框与查找框同列同宽，两行左缘对齐）
  '.cm-panel.cm-search input[name=replace]': { gridRow: '2', gridColumn: '1' },
  '.cm-panel.cm-search button[name=replace]': { gridRow: '2', gridColumn: '2' },
  '.cm-panel.cm-search button[name=replaceAll]': { gridRow: '2', gridColumn: '3' },
  '.cm-panel.cm-search input[type=checkbox]': {
    accentColor: 'var(--accent)',
    width: '13px',
    height: '13px',
    margin: 0,
    cursor: 'pointer'
  },
  '.cm-panel.cm-search input.cm-textfield': {
    width: '100%',
    padding: '4px 10px',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    outline: 'none',
    fontFamily: 'inherit',
    fontSize: '12px',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
  },
  '.cm-panel.cm-search input.cm-textfield:focus': {
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 2px var(--accent-soft)'
  },
  '.cm-panel.cm-search button': {
    appearance: 'none',
    WebkitAppearance: 'none',
    margin: 0,
    padding: '4px 12px',
    color: 'var(--text-secondary)',
    // background 简写（而非 background-color）+ 显式清掉 background-image：
    // Windows 上 UA 会给原生按钮画白→灰的纵向渐变，仅设 background-color 压不住
    background: 'var(--bg-secondary)',
    backgroundImage: 'none',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    fontFamily: 'inherit',
    fontSize: '12px',
    lineHeight: '1.5',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'color 0.15s ease, border-color 0.15s ease, background 0.15s ease'
  },
  '.cm-panel.cm-search button:hover': {
    color: 'var(--accent)',
    borderColor: 'var(--accent)',
    background: 'var(--accent-soft)'
  },
  '.cm-panel.cm-search button[name=close]': {
    border: 'none',
    background: 'transparent',
    color: 'var(--text-tertiary)',
    fontSize: '15px',
    padding: '2px 6px'
  },
  '.cm-panel.cm-search button[name=close]:hover': {
    color: 'var(--text-primary)',
    background: 'var(--bg-hover)'
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
      // 内置查找/替换面板中文文案（FR-2.9.11 当前笔记内搜索）
      EditorState.phrases.of(SEARCH_PANEL_ZH),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      traceTheme,
      livePreviewCompartment.of(buildLivePreview()),
      typewriterCompartment.of(typewriter(props.typewriterMode ?? 'off')),
      vimCompartment.of(props.vimEnabled ? buildVimExtension() : []),
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
      // 粘贴归一化（FR-2.4.25）：网页粘贴夹带的 NBSP / 零宽字符在入库前归一（任务行
      // 失效的污染源头，见 lib/invisibleChars.ts 模块注释）；有替换时 toast 告知
      invisiblePasteExtension((nbsp, zeroWidth) => {
        ElMessage.success(`已清理 ${nbsp + zeroWidth} 个不可见字符`)
      }),
      // Prec.high：这些是应用级绑定，必须优先于 basicSetup 内置键位（如 searchKeymap 的 Mod-f）
      Prec.high(keymap.of([
        {
          // 垂直移动的跨块修正（方案 A）：渲染中的块级公式不再整块跳过——
          // 跨块时落点改为近端边界并触发源码回落；无渲染块（含所见即所得关）返回 false
          // 放行 defaultKeymap。vim 开启时方向键被 vim 的 keydown 观察器先行接管
          // （<Down>/<Up> 映射 j/k 走 vimMode 的跨块 motion），本绑定不会触发
          key: 'ArrowDown',
          run: (target: EditorView) => smartVerticalMove(target, 1)
        },
        {
          key: 'ArrowUp',
          run: (target: EditorView) => smartVerticalMove(target, -1)
        },
        {
          // 笔记历史后退 / 前进（FR-2.4.26 D5）。必须在 CM 键位层无条件消费——否则历史
          // 栈走到头（goBackNote 静默返回）时按键漏进 defaultKeymap 的 Alt-Arrow 行边界
          // 移动，光标上 / 下跳一行（2026-09-30 真机反馈；同 Ctrl+S 双 toast 的「CM 先于
          // 窗口层处理」机制）。栈空吞键不动光标；vim 开启时不消费 Alt 前缀键，落回本绑定
          key: 'Alt-ArrowLeft',
          run: () => {
            void editorStore.goBackNote()
            return true
          }
        },
        {
          key: 'Alt-ArrowRight',
          run: () => {
            void editorStore.goForwardNote()
            return true
          }
        },
        {
          // 行插入快捷键（用户提出）：不论光标在行内什么位置，在上方 / 下方插入一个空行
          // 并移动到新行行首（典型场景：[[ 补全落成引用后光标在行中，直接换行写下一行）。
          // 补全打开时 Ctrl+Enter 让位给 completionKeymap（接受补全，Prec.highest）
          key: 'Ctrl-Enter',
          run: () => {
            if (tablePrompt.active || !view) return false
            const line = view.state.doc.lineAt(view.state.selection.main.head)
            view.dispatch({ changes: { from: line.to, insert: '\n' }, selection: { anchor: line.to + 1 } })
            return true
          }
        },
        {
          key: 'Ctrl-Shift-Enter',
          run: () => {
            if (tablePrompt.active || !view) return false
            const line = view.state.doc.lineAt(view.state.selection.main.head)
            view.dispatch({ changes: { from: line.from, insert: '\n' }, selection: { anchor: line.from } })
            return true
          }
        },
        {
          // Alt+Enter：补全面板里预览当前选中项（Enter 本身被 completionKeymap
          // 占用为「接受补全」且是 Prec.highest，Mod+Enter 同样会被其拦下）
          key: 'Alt-Enter',
          run: () => {
            // 预览态（悬浮预览正展示一篇笔记）：Alt+Enter = 把该笔记落成引用。
            // 三种情况都必须消费 Enter（落给 CM 默认行为会插入换行——「编辑区闪一下」的来源）：
            // ① 补全仍活动 → 整段替换并吸收自动闭合 ]]；② 补全已关 → 光标处插入完整引用；
            // ③ 目标是当前笔记自身 → 不插入（自引用无意义），仅收起预览
            if (props.previewTarget) {
              // 跨库目标（FR-2.9.11）：不再直接产出断链引用，交外层走「确认框 → 复制进当前库 → 落引用」
              if (props.previewTarget.vault !== props.vault) {
                // 草稿例外（FR-2.3.9 D7）：当前是草稿伪库时维持直接落引用文本——转正时再定归宿
                if (props.vault === SCRATCH_VAULT) {
                  const t = props.previewTarget
                  const rel = t.path.replace(/\.md$/i, '')
                  if (rel !== props.notePath.replace(/\.md$/i, '')) {
                    if (!insertReferenceFromCompletion()) insertText(`[[${rel}]]`)
                  }
                  useAppStore().closeFloatingPreview()
                  view?.focus()
                } else {
                  emit('insert-cross-vault', props.previewTarget)
                }
                return true
              }
              const t = props.previewTarget
              const rel = t.path.replace(/\.md$/i, '')
              if (rel !== props.notePath.replace(/\.md$/i, '')) {
                if (!insertReferenceFromCompletion()) insertText(`[[${rel}]]`)
              }
              useAppStore().closeFloatingPreview()
              view?.focus()
              return true
            }
            return previewSelectedCompletion()
          }
        },
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            emit('save')
            return true
          }
        },
        // Ctrl+F：笔记内查找/替换。不再在此拦截——searchKeymap（traceSetup 内）的
        // openSearchPanel 自然接管；窗口层 App.vue 按焦点分流（编辑器聚焦时不抢），
        // 编辑器外的 Ctrl+F 仍是全局搜索（FR-2.9.11）
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
        // 快速引入图片（FR-2.5.4）：Ctrl+Shift+I 打开系统文件选择器，选中后批量插引用。
        // IPC 需要 vault/path，事件交外层 EditorView 处理（与粘贴 @image 同一挂载点）
        { key: 'Mod-Shift-i', preventDefault: true, run: () => (emit('pick-image'), true) },
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
      // 斜杠命令在前（/ 激活），[[ 双链 / 相对路径 / 锚点在后——激活区间不相交，互斥由 CM 保证
      autocompletion({ override: [slashCompletions, traceCompletions] })
    ]
  })
  const v = new EditorView({ state, parent: container.value! })
  attachVimModeListener(v)
  if (props.vimEnabled) editorStore.vimMode = readVimMode(v) ?? 'normal'
  return v
}

/**
 * vim 模式徽标（FR-2.4.23）：模式变化经 CM5 适配层事件写入 editor store（工具栏读取渲染）。
 * ⚠️ 适配层实例随 vim 扩展的挂载/摘除重建（Compartment 换装 → ViewPlugin 重建 → 新适配层），
 * 监听器必须跟着重挂——只在 createView 时挂一次的话，开关切换后的事件全部丢失
 * （实测：模式正常切换但徽标永久停留在挂载初值）。同一实例不重复挂。
 * 注意：createView 时模块级 view 尚未赋值（返回后才赋值），必须显式传入目标 view。
 */
let vimListenerCM: ReturnType<typeof getVimCM> | null = null
function attachVimModeListener(target?: EditorView): void {
  const v = target ?? view
  if (!v) return
  const cm = getVimCM(v)
  if (!cm || cm === vimListenerCM) return
  vimListenerCM = cm
  cm.on('vim-mode-change', () => {
    editorStore.vimMode = readVimMode(v)
  })
}

/** 组装所见即所得扩展：结构（含 StateField）必须常驻挂载——Compartment 不允许增删
 *  StateField，只能重配 Facet 值，故以 enabled 开关门控（开关即重配，无重建） */
function buildLivePreview() {
  return livePreview({
    enabled: props.wysiwyg ?? false,
    vault: props.vault,
    notePath: props.notePath,
    resolveName: (name: string) => treeHasWikiTarget(useTreeStore().trees[props.vault] ?? [], name),
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

// Vim 开关（FR-2.4.23）：经 Compartment 换装；关闭即摘除扩展（键位完全恢复现状）并清空模式徽标。
// 挂载后必须重挂适配层监听（新适配层实例，见 attachVimModeListener 注释）
watch(
  () => props.vimEnabled,
  (enabled) => {
    if (!view) return
    view.dispatch({ effects: vimCompartment.reconfigure(enabled ? buildVimExtension() : []) })
    if (enabled) {
      attachVimModeListener()
      editorStore.vimMode = readVimMode(view) ?? 'normal'
    } else {
      editorStore.vimMode = null
    }
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
 * 应用「编辑位置」意图（FR-2.4.18 / FR-2.4.26）：打开笔记后落位，消费后清空意图。
 * start / end 按设置落到文首 / 文末；remembered = 会话内有该笔记的光标存档
 * （editor.cursorMap）——恢复上次编辑位置与滚动（任何方式切走再回来都在原地）。
 * 由两个时机调用，保证任何打开路径都生效：① 文档被整体替换时（props.modelValue watcher）；
 * ② 组件挂载时——首次打开笔记时 store 已置位、组件才随后挂载，只靠 watcher 会漏掉这一次
 */
function applyPendingPlacement(): void {
  const place = editorStore.pendingPlacement
  if (!place || !view) return
  editorStore.pendingPlacement = null
  if (place === 'remembered') {
    // D7：历史导航带条目级快照（pendingCursor）——恢复「那一次到访」的光标；
    // 普通打开 / 重挂载查 cursorMap（最新一次离开的位置）
    const cur = editorStore.current
    const saved = editorStore.pendingCursor ?? (cur ? editorStore.cursorMap[`${cur.vault}::${cur.path}`] : undefined)
    editorStore.pendingCursor = null
    if (!saved) return
    const clamp = (pos: number) => Math.min(Math.max(pos, 0), view!.state.doc.length)
    view.dispatch({
      selection: { anchor: clamp(saved.anchor), head: clamp(saved.head) },
      effects: EditorView.scrollIntoView(clamp(saved.head), { y: 'center' })
    })
    requestAnimationFrame(() => {
      if (view) view.scrollDOM.scrollTop = saved.scrollTop
    })
    return
  }
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
  // 实时选区上报槽（FR-2.4.26）：store 切换笔记前经此存档离开笔记的光标
  editorStore.captureCursor = () =>
    view && editorStore.current
      ? {
          anchor: view.state.selection.main.anchor,
          head: view.state.selection.main.head,
          scrollTop: view.scrollDOM.scrollTop
        }
      : null
  if (editorStore.pendingPlacement) {
    // 挂载前 store 可能已置下落位意图（首次打开笔记：先 openNote 再挂载编辑器）
    applyPendingPlacement()
  } else {
    // 设置页往返等场景：编辑视图被整体卸载又重挂载（App 的 v-if），恢复离开时的
    // 光标与滚动位置——新视图的光标默认落在文档开头，会丢位置（2026-09-27 用户反馈）
    const saved = editorStore.current ? editorStore.cursorMap[`${editorStore.current.vault}::${editorStore.current.path}`] : undefined
    if (saved && view) {
      view.dispatch({ selection: { anchor: saved.anchor, head: saved.head } })
      const targetScroll = saved.scrollTop
      requestAnimationFrame(() => {
        if (view) view.scrollDOM.scrollTop = targetScroll
      })
    }
  }
})

onBeforeUnmount(() => {
  // 存档光标与滚动位置（供重挂载恢复，见 onMounted）
  if (view && editorStore.current) {
    const sel = view.state.selection.main
    editorStore.cursorMap[`${editorStore.current.vault}::${editorStore.current.path}`] = {
      anchor: sel.anchor,
      head: sel.head,
      scrollTop: view.scrollDOM.scrollTop
    }
  }
  editorStore.captureCursor = null
  tablePrompt.cancel()
  editorStore.vimMode = null
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

/** 拖曳悬停：维持全量放行（外部文件 / 外部文本拖入的既有行为不回归），
 *  笔记引用载荷（FR-2.9.10 P3）设 copy 效果，dropCursor 给出落点竖线 */
function onDragover(e: DragEvent): void {
  if (e.dataTransfer && hasNoteRefDrag(e.dataTransfer)) {
    e.dataTransfer.dropEffect = 'copy'
  }
  e.preventDefault()
}

function onDrop(e: DragEvent): void {
  // 笔记引用拖入（FR-2.9.10 P3）：定释放点后交外层走三路引入语义（含 Alt 修饰——
  // 插入后保留来源弹窗；修饰键取「事件状态 ∨ dragstart 锁存」，后者覆盖真机上
  // 各平台对拖拽会话中 Alt 交付不一的问题，约定手势为「按住 Alt 再拖」）。
  // posAtCoords 对渲染块 widget 返回最近合法位置；解析失败（卡片 padding 等）回落光标
  const payload: NoteRefPayload | null = readNoteRefDrag(e.dataTransfer)
  if (payload) {
    e.preventDefault()
    const at = view ? view.posAtCoords({ x: e.clientX, y: e.clientY }) : null
    const alt = e.altKey || consumeDragAltLatch()
    emit('drop-note-ref', payload, at, { alt })
    return
  }
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
  insertReferenceFromCompletion,
  /** 快速引用面板落引用（FR-2.9.12）：按路径插入 [[path]]，两态括号一致性 */
  insertReferenceAtPath,
  firstVisibleLine,
  scrollToLine,
  insertSnippet,
  insertTable: insertTableAtCursor,
  beginTablePrompt,
  setHeading: setHeadingLevel,
  /** 清理本文不可见字符（FR-2.4.25）：顶栏橡皮擦按钮经此调用（与 /清理字符 同一函数） */
  cleanInvisibleChars: () => cleanInvisibleChars(),
  /** 打开笔记内查找/替换面板（Ctrl+F 专用语义，FR-2.9.11）：焦点在编辑器外时经
   *  EditorView 的 pendingNoteSearch 意图调用（先聚焦再开面板） */
  openNoteSearch: () => (view ? openSearchPanel(view) : false),
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
    @dragover="onDragover"
  ></div>
</template>
