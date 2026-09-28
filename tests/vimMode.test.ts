// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Vim } from '@replit/codemirror-vim'
import {
  buildVimExtension,
  formatVimModeLabel,
  getVimCM,
  handleEscapeKey,
  shouldYieldEscapeToVim,
  VIM_INPUT_EVENT,
  VIM_SELECT_EVENT,
  VIM_YIELDED_KEYS
} from '../src/renderer/src/lib/vimMode'

describe('Vim 模式：Esc 让位判定（FR-2.4.23 拍板：浮层优先、心流退出让位）', () => {
  it('vim 未开启时不让位（应用级 Esc 回退行为完全不变）', () => {
    expect(shouldYieldEscapeToVim(false, true)).toBe(false)
    expect(shouldYieldEscapeToVim(false, false)).toBe(false)
  })

  it('vim 开启且编辑器聚焦：Esc 让位给 vim（返回 normal，退出心流走 Alt+W）', () => {
    expect(shouldYieldEscapeToVim(true, true)).toBe(true)
  })

  it('vim 开启但焦点不在编辑器：不让位（维持 Esc 退出心流等现有动线）', () => {
    expect(shouldYieldEscapeToVim(true, false)).toBe(false)
  })
})

describe('Vim 模式：键位冲突卸载（应用优先）', () => {
  it('让渡键清单恰为与应用相撞的六键（CM5 记法）', () => {
    expect(VIM_YIELDED_KEYS).toEqual(['<C-f>', '<C-b>', '<C-e>', '<C-i>', '<C-n>', '<C-t>'])
  })

  it('构建扩展幂等且不抛错（返回 CM 扩展）', () => {
    const ext = buildVimExtension()
    expect(ext).toBeTruthy()
    expect(() => buildVimExtension()).not.toThrow()
  })

  it('构建扩展后，让渡键已从包内全局键位表移除（再次 unmap 无匹配）', () => {
    buildVimExtension()
    // 包内 unmap 的运行时签名允许省略 ctx（d.ts 声明为必选）
    const unmap = Vim.unmap as unknown as (lhs: string, ctx?: string) => unknown
    for (const key of VIM_YIELDED_KEYS) {
      expect(unmap(key)).toBeFalsy()
    }
  })
})

describe('Vim 模式：徽标文案', () => {
  it('基础模式大写化', () => {
    expect(formatVimModeLabel('normal')).toBe('NORMAL')
    expect(formatVimModeLabel('insert')).toBe('INSERT')
    expect(formatVimModeLabel('visual')).toBe('VISUAL')
  })

  it('子模式缩写（避免胶囊过宽）', () => {
    expect(formatVimModeLabel('visual line')).toBe('V-LINE')
    expect(formatVimModeLabel('visual block')).toBe('V-BLOCK')
  })
})

describe('Vim 模式：Ctrl-[ 退出 insert（Esc 等价键）', () => {
  function createView(): EditorView {
    return new EditorView({
      state: EditorState.create({ doc: 'line one\nline two', extensions: [buildVimExtension()] }),
      parent: document.body
    })
  }

  it('无 vim 时 handleEscapeKey 返回 false（不拦截）', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'x', extensions: [] }),
      parent: document.body
    })
    expect(handleEscapeKey(view)).toBe(false)
    view.destroy()
  })

  it('handleEscapeKey 退出 insert 并返回 true（Ctrl-[ 绑定的 run）', () => {
    const view = createView()
    const cm = getVimCM(view)!
    expect(cm.state.vim).toBeTruthy()
    cm.state.vim!.insertMode = true
    expect(handleEscapeKey(view)).toBe(true)
    expect(cm.state.vim!.insertMode).toBe(false)
    view.destroy()
  })
})

describe('Vim 事务的 userEvent 注解（2026-09-28 修复：vim 下打字机锚定失效）', () => {
  /** jsdom 无 Range 几何：打桩让 vim 的块光标 / 坐标测量走空路径（只看事务注解） */
  function stubRangeGeometry(): void {
    const rectList = { length: 0, item: () => null } as unknown as DOMRectList
    const zero = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect
    ;(Range.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = () => rectList
    ;(Range.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => zero
  }

  function createObservedView(onTr: (tr: Transaction) => void): EditorView {
    stubRangeGeometry()
    return new EditorView({
      state: EditorState.create({
        doc: 'abc\ndef\nghi',
        extensions: [
          buildVimExtension(),
          EditorView.updateListener.of((u) => u.transactions.forEach(onTr))
        ]
      }),
      parent: document.body
    })
  }

  const eventsOf = (trs: Transaction[]) => trs.map((tr) => tr.annotation(Transaction.userEvent) ?? null)

  it('normal 移动（j）的事务带 select 注解（此前为 null → 打字机不重锚）', () => {
    const trs: Transaction[] = []
    const view = createObservedView((tr) => trs.push(tr))
    Vim.handleKey(getVimCM(view)!, 'j', 'user')
    expect(eventsOf(trs)).toContain(VIM_SELECT_EVENT)
    view.destroy()
  })

  it('normal 编辑（x 删字符）自带包内 input 注解且 docChanged（既有行为，锚定本就生效）', () => {
    const trs: Transaction[] = []
    const view = createObservedView((tr) => trs.push(tr))
    Vim.handleKey(getVimCM(view)!, 'x', 'user')
    const input = trs.filter((tr) => (tr.annotation(Transaction.userEvent) ?? '').startsWith('input'))
    expect(input.length).toBeGreaterThan(0)
    expect(input.some((tr) => tr.docChanged)).toBe(true)
    view.destroy()
  })

  it('注解落在无注解的 spec 上：选区 → select、编辑 → input；已带注解的不改写', () => {
    const trs: Transaction[] = []
    const view = createObservedView((tr) => trs.push(tr))
    // vim 操作内手动 dispatch：自带注解的保持原值，无注解的按形状归类
    const cm = getVimCM(view)!
    cm.operation(() => {
      cm.curOp!.isVimOp = true
      view.dispatch({ selection: { anchor: 0 }, userEvent: 'select.keep-me' })
      view.dispatch({ selection: { anchor: 1 } })
      view.dispatch({ changes: { from: 0, to: 1, insert: 'X' } })
    })
    const evs = eventsOf(trs)
    expect(evs).toContain('select.keep-me')
    expect(evs).toContain(VIM_SELECT_EVENT)
    expect(evs).toContain(VIM_INPUT_EVENT)
    view.destroy()
  })

  it('vim 操作之外的 dispatch 原样透传（不补注解）', () => {
    const trs: Transaction[] = []
    const view = createObservedView((tr) => trs.push(tr))
    view.dispatch({ selection: { anchor: 0 } })
    expect(eventsOf(trs)).toContain(null)
    view.destroy()
  })
})
