// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import { matchTaskMarker, normalizeInvisibleChars, collectDocInvisible } from '../src/renderer/src/lib/invisibleChars'
import { handleInvisiblePaste, buildCleanInvisibleTransaction } from '../src/renderer/src/lib/invisibleEdits'

describe('任务标记容忍匹配 matchTaskMarker（FR-2.4.24）', () => {
  it('ASCII 基线：[ ] / [x] / [X] 勾选态与切片位置与旧正则一致', () => {
    expect(matchTaskMarker('[ ] 任务')).toMatchObject({ checked: false, start: 0, end: 3, contentStart: 4 })
    expect(matchTaskMarker('[x] 任务')?.checked).toBe(true)
    expect(matchTaskMarker('[X] 任务')?.checked).toBe(true)
    // 旧规则 \s+ 贪婪吃掉全部尾随空白，contentStart 等价
    expect(matchTaskMarker('[x]   任务')?.contentStart).toBe(6)
    // 尾随空白后无正文同样识别（旧 \s+ 行为一致）
    expect(matchTaskMarker('[x] ')).toMatchObject({ checked: true, end: 3, contentStart: 4 })
  })

  it('`]` 前导污染：列表标记与 `[` 之间的 NBSP / 零宽被跳过', () => {
    expect(matchTaskMarker('\u00a0[x] 任务')).toMatchObject({ checked: true, start: 1, end: 4 })
    expect(matchTaskMarker(' \u202f\u200b[x] 任务')?.start).toBe(3)
    expect(matchTaskMarker('\u2060[x] 任务')?.start).toBe(1)
  })

  it('`]` 后分隔符为 NBSP / 零宽同样认可（lezer 守卫只认 ASCII 空格，此处即兜底点）', () => {
    expect(matchTaskMarker('[x]\u00a0任务')).toMatchObject({ checked: true, contentStart: 4 })
    expect(matchTaskMarker('[ ]\u200b任务')?.checked).toBe(false)
    expect(matchTaskMarker('[X]\u202fok')?.checked).toBe(true)
  })

  it('中括号内空白变体视为未勾选（D3）', () => {
    expect(matchTaskMarker('[\u00a0] 任务')).toMatchObject({ checked: false, start: 0 })
    expect(matchTaskMarker('[\u202f] 任务')?.checked).toBe(false)
  })

  it('不该认的一律不认：行尾裸标记 / 非开头 / 未知括号内容 / ZWJ 不得越过', () => {
    expect(matchTaskMarker('[x]')).toBeNull() // 无分隔（与两管线既有行为一致）
    expect(matchTaskMarker('[x]task')).toBeNull()
    expect(matchTaskMarker('文字 [x] 任务')).toBeNull() // 非开头位置
    expect(matchTaskMarker('[无] 任务')).toBeNull()
    expect(matchTaskMarker('[x]\u200dtask')).toBeNull() // ZWJ 不是分隔空白（emoji 组成部分）
    expect(matchTaskMarker('')).toBeNull()
  })
})

describe('不可见字符归一化 normalizeInvisibleChars（FR-2.4.25）', () => {
  it('NBSP / 窄 NBSP → 普通空格并计数', () => {
    expect(normalizeInvisibleChars('a\u00a0b\u202fc')).toEqual({ text: 'a b c', nbsp: 2, zeroWidth: 0 })
  })

  it('零宽字符（ZWSP / 词连接符 / BOM）→ 删除并计数', () => {
    expect(normalizeInvisibleChars('a\u200bb\u2060c\ufeffd')).toEqual({ text: 'abcd', nbsp: 0, zeroWidth: 3 })
  })

  it('ZWJ / ZWNJ 原样保留（emoji 与阿拉伯系文字的合法成分，D4）', () => {
    const src = 'a\u200db\u200cc'
    expect(normalizeInvisibleChars(src)).toEqual({ text: src, nbsp: 0, zeroWidth: 0 })
  })

  it('无污染文本零改动', () => {
    expect(normalizeInvisibleChars('普通 - [x] 任务')).toEqual({ text: '普通 - [x] 任务', nbsp: 0, zeroWidth: 0 })
  })
})

describe('文档级扫描 collectDocInvisible（FR-2.4.25 清理命令）', () => {
  const mk = (doc: string): EditorState => EditorState.create({ doc })

  it('NBSP 产出空格替换区间，零宽产出删除区间，计数与区间同源', () => {
    const { nbsp, zeroWidth, changes } = collectDocInvisible(mk('ab\u00a0cd\u200be').doc)
    expect(nbsp).toBe(1)
    expect(zeroWidth).toBe(1)
    expect(changes).toEqual([
      { from: 2, to: 3, insert: ' ' },
      { from: 5, to: 6, insert: '' }
    ])
  })

  it('相邻同类字符合并为一个区间', () => {
    const { changes } = collectDocInvisible(mk('a\u200b\u200bb').doc)
    expect(changes).toEqual([{ from: 1, to: 3, insert: '' }])
    expect(collectDocInvisible(mk('a\u00a0\u00a0b').doc).changes).toEqual([{ from: 1, to: 3, insert: ' ' }])
  })

  it('多行逐行定位正确', () => {
    const { nbsp, zeroWidth, changes } = collectDocInvisible(mk('x\u00a0\ny\u200b\u200bz').doc)
    expect(nbsp).toBe(1)
    expect(zeroWidth).toBe(2)
    expect(changes).toEqual([
      { from: 1, to: 2, insert: ' ' },
      { from: 4, to: 6, insert: '' }
    ])
  })

  it('干净文档与仅含 ZWJ / ZWNJ 的文档不产出任何替换', () => {
    expect(collectDocInvisible(mk('- [x] 正常任务').doc).changes).toEqual([])
    expect(collectDocInvisible(mk('a\u200db\u200cc').doc).changes).toEqual([])
  })
})

describe('粘贴归一化 handleInvisiblePaste（FR-2.4.25）', () => {
  /** 与既有 toggleTaskAt 测试同款的轻量视图桩：记录 dispatch 的全部 spec（光标在文末） */
  function mkView(doc: string): {
    state: EditorState
    dispatch(...specs: unknown[]): void
    dispatched: unknown[]
  } {
    const state = EditorState.create({ doc, selection: { anchor: doc.length } })
    const dispatched: unknown[] = []
    return {
      state,
      dispatched,
      dispatch(...specs: unknown[]) {
        dispatched.push(...specs)
      }
    }
  }
  const mkEvent = (text: string | null, files = 0): unknown => ({
    clipboardData:
      text === null
        ? null
        : { files: { length: files }, getData: (t: string) => (t === 'text/plain' ? text : '') },
    preventDefault: vi.fn()
  })
  const asArgs = (
    event: unknown,
    view: ReturnType<typeof mkView>
  ): [Parameters<typeof handleInvisiblePaste>[0], Parameters<typeof handleInvisiblePaste>[1]] => [
    event as Parameters<typeof handleInvisiblePaste>[0],
    view as unknown as Parameters<typeof handleInvisiblePaste>[1]
  ]

  it('污染文本：preventDefault + 归一化替换 + input.paste 注解 + 回调计数', () => {
    const view = mkView('前文')
    const onClean = vi.fn()
    const ev = mkEvent('a\u00a0b\u200bc') as { preventDefault: ReturnType<typeof vi.fn> }
    expect(handleInvisiblePaste(...asArgs(ev, view), onClean)).toBe(true)
    expect(ev.preventDefault).toHaveBeenCalled()
    // 合并全部 spec 后的结果事务：文档归一化写入（光标在文末 → 追加），userEvent 供下游分流
    const merged = view.state.update(...(view.dispatched as TransactionSpec[]))
    expect(merged.state.doc.toString()).toBe('前文a bc')
    expect(merged.annotation(Transaction.userEvent)).toBe('input.paste')
    expect(onClean).toHaveBeenCalledWith(1, 1)
  })

  it('零污染 / 空文本 / 无剪贴板 / 文件粘贴：让路原生（返回 false、不 dispatch）', () => {
    for (const [label, ev] of [
      ['干净文本', mkEvent('普通文本')],
      ['空文本', mkEvent('')],
      ['无剪贴板', mkEvent(null)],
      ['文件粘贴', mkEvent('a\u00a0b', 1)]
    ] as const) {
      const view = mkView('原文')
      expect(handleInvisiblePaste(...asArgs(ev, view)), label).toBe(false)
      expect(view.dispatched, label).toEqual([])
    }
  })
})

describe('清理事务 buildCleanInvisibleTransaction（FR-2.4.25）', () => {
  it('产出单事务：应用后 NBSP 变空格、零宽删除；无污染返回 null', () => {
    const dirty = EditorState.create({ doc: '- [\u00a0] a\u200bb' })
    const tr = buildCleanInvisibleTransaction(dirty)
    expect(tr).not.toBeNull()
    // 括号内 NBSP 归一为普通空格（渲染侧按 D3 视为未勾选，文件里则变回合法空格）
    expect(tr!.state.doc.toString()).toBe('- [ ] ab')

    expect(buildCleanInvisibleTransaction(EditorState.create({ doc: '- [x] 干净' }))).toBeNull()
  })

  it('事务携带 input 注解（走正常保存 / 撤销链路）', () => {
    const tr = buildCleanInvisibleTransaction(EditorState.create({ doc: 'a\u00a0b' }))
    expect(tr?.annotation(Transaction.userEvent)).toBe('input.clean-invisible')
  })
})
