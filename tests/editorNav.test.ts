// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 编辑导航（FR-2.4.26）store 单测：前进/后退历史栈（D5，Alt+←/→）、会话内每笔记
 * 光标存档（cursorMap）、MRU 快切面板状态机（D6，Ctrl+Tab 模型）。
 * window.trace 打桩。
 */
import { useEditorStore } from '../src/renderer/src/stores/editor'

beforeEach(() => {
  setActivePinia(createPinia())
  ;(window as unknown as { trace: unknown }).trace = {
    readNote: async () => ({ ok: true, content: '正文', hash: 'h' }),
    writeNote: async () => ({ ok: true, hash: 'h' }),
    addRecent: async () => ({}),
    listRecents: async () => ({ ok: true, items: [] }),
    reportNoteOpened: () => {},
    getSettings: async () => ({ ok: true, settings: {} })
  }
})

const editor = () => useEditorStore()

describe('编辑导航：前进/后退历史栈（FR-2.4.26 D5）', () => {
  it('首次打开：栈为空，按编辑位置设置落位', async () => {
    await editor().openNote('库', 'a.md', 'a')
    expect(editor().current?.path).toBe('a.md')
    expect(editor().pendingPlacement).toBe('start')
    expect(editor().backStack.length).toBe(0)
  })

  it('A→B 后退回 A，前进回 B（浏览器语义，双档互切是深度 1 的特例）', async () => {
    const ed = editor()
    ed.captureCursor = () => ({ anchor: 1, head: 1, scrollTop: 0 })
    await ed.openNote('库', 'a.md', 'a')
    await ed.openNote('库', 'b.md', 'b')
    expect(ed.backStack).toEqual([
      { vault: '库', path: 'a.md', name: 'a', cursor: { anchor: 1, head: 1, scrollTop: 0 } }
    ])
    await ed.goBackNote()
    expect(ed.current?.path).toBe('a.md')
    expect(ed.forwardStack).toEqual([
      { vault: '库', path: 'b.md', name: 'b', cursor: { anchor: 1, head: 1, scrollTop: 0 } }
    ])
    await ed.goForwardNote()
    expect(ed.current?.path).toBe('b.md')
    expect(ed.backStack).toMatchObject([{ vault: '库', path: 'a.md', name: 'a' }])
  })

  it('深度历史：A→B→C 连退两步到 A，前进一步到 B', async () => {
    const ed = editor()
    ed.captureCursor = () => null
    await ed.openNote('库', 'a.md', 'a')
    await ed.openNote('库', 'b.md', 'b')
    await ed.openNote('库', 'c.md', 'c')
    await ed.goBackNote()
    await ed.goBackNote()
    expect(ed.current?.path).toBe('a.md')
    await ed.goForwardNote()
    expect(ed.current?.path).toBe('b.md')
  })

  it('新开导航清空前进栈（浏览器语义）：A→B→退回 A→开 C→前进不可用', async () => {
    const ed = editor()
    ed.captureCursor = () => null
    await ed.openNote('库', 'a.md', 'a')
    await ed.openNote('库', 'b.md', 'b')
    await ed.goBackNote()
    await ed.openNote('库', 'c.md', 'c')
    expect(ed.forwardStack.length).toBe(0)
    await ed.goForwardNote()
    expect(ed.current?.path).toBe('c.md')
  })

  it('重开同一篇不算切换：栈不动', async () => {
    const ed = editor()
    ed.captureCursor = () => null
    await ed.openNote('库', 'a.md', 'a')
    await ed.openNote('库', 'b.md', 'b')
    await ed.openNote('库', 'b.md', 'b')
    expect(ed.backStack).toMatchObject([{ vault: '库', path: 'a.md', name: 'a' }])
  })

  it('切换时存档离开光标；有存档的笔记重开 → remembered 落位', async () => {
    const ed = editor()
    await ed.openNote('库', 'a.md', 'a')
    ed.captureCursor = () => ({ anchor: 42, head: 42, scrollTop: 100 })
    await ed.openNote('库', 'b.md', 'b')
    expect(ed.cursorMap['库::a.md']).toEqual({ anchor: 42, head: 42, scrollTop: 100 })
    expect(ed.pendingPlacement).toBe('start')
    await ed.goBackNote()
    expect(ed.pendingPlacement).toBe('remembered')
  })

  it('D7 条目级光标快照：同一笔记的多次到访各带各的光标，后退恢复对应那次', async () => {
    const ed = editor()
    // 序列：a(光标11) → b → a → c(离开 a 时光标 99)。栈 = [a(11), b(11), a(99)]
    await ed.openNote('库', 'a.md', 'a')
    ed.captureCursor = () => ({ anchor: 11, head: 11, scrollTop: 0 })
    await ed.openNote('库', 'b.md', 'b')
    await ed.openNote('库', 'a.md', 'a')
    ed.captureCursor = () => ({ anchor: 99, head: 99, scrollTop: 5 })
    await ed.openNote('库', 'c.md', 'c')
    // 后退 #1：回到 a 的第二次到访 → 恢复 99
    await ed.goBackNote()
    expect(ed.current?.path).toBe('a.md')
    expect(ed.pendingCursor).toEqual({ anchor: 99, head: 99, scrollTop: 5 })
    // 后退 #2：b → 恢复 11；后退 #3：a 的**第一次到访** → 恢复 11（同一笔记两条目各光标）
    await ed.goBackNote()
    expect(ed.current?.path).toBe('b.md')
    await ed.goBackNote()
    expect(ed.current?.path).toBe('a.md')
    expect(ed.pendingCursor).toEqual({ anchor: 11, head: 11, scrollTop: 0 })
  })

  it('笔记删除：栈 / MRU / 光标表剪枝；文件夹删除按前缀', async () => {
    const ed = editor()
    ed.captureCursor = () => ({ anchor: 1, head: 1, scrollTop: 0 })
    await ed.openNote('库', 'a.md', 'a')
    await ed.openNote('库', 'dir/b.md', 'b')
    await ed.openNote('库', 'c.md', 'c')
    ed.handleNodeDeleted('库', 'a.md', 'note')
    ed.handleNodeDeleted('库', 'dir', 'dir')
    expect(ed.backStack.length).toBe(0)
    expect(ed.mruList.length).toBe(1) // 只剩 c.md
    expect(ed.cursorMap['库::a.md']).toBeUndefined()
  })

  it('笔记重命名：栈 / MRU / 光标表跟随', async () => {
    const ed = editor()
    ed.captureCursor = () => ({ anchor: 1, head: 1, scrollTop: 0 })
    await ed.openNote('库', 'a.md', 'a')
    await ed.openNote('库', 'b.md', 'b')
    ed.handleNodeRenamed('库', 'a.md', 'new.md', 'note', 'new')
    expect(ed.backStack[0].path).toBe('new.md')
    expect(ed.mruList.some((m) => m.path === 'new.md')).toBe(true)
    expect(ed.cursorMap['库::new.md']).toBeTruthy()
  })
})

describe('编辑导航：MRU 快切面板状态机（FR-2.4.26 D6）', () => {
  it('不足 2 篇不启用；开启默认选中 index 1（上一次的笔记）', async () => {
    const ed = editor()
    await ed.openNote('库', 'a.md', 'a')
    ed.mruBegin()
    expect(ed.mruActive).toBe(false)
    ed.captureCursor = () => null
    await ed.openNote('库', 'b.md', 'b')
    ed.mruBegin()
    expect(ed.mruActive).toBe(true)
    expect(ed.mruIndex).toBe(1)
  })

  it('MRU 记序：新开移到最前、去重、上限 15', async () => {
    const ed = editor()
    ed.captureCursor = () => null
    for (let i = 0; i < 20; i++) {
      await ed.openNote('库', `n${i}.md`, `n${i}`)
    }
    expect(ed.mruList.length).toBe(15)
    expect(ed.mruList[0].path).toBe('n19.md')
    await ed.openNote('库', 'n5.md', 'n5')
    expect(ed.mruList[0].path).toBe('n5.md')
    expect(ed.mruList.filter((m) => m.path === 'n5.md').length).toBe(1)
  })

  it('翻动循环 + 提交跳转 + 选中当前 = 不动', async () => {
    const ed = editor()
    ed.captureCursor = () => null
    await ed.openNote('库', 'a.md', 'a')
    await ed.openNote('库', 'b.md', 'b')
    await ed.openNote('库', 'c.md', 'c')
    ed.mruBegin() // list = [c, b, a]，index 1 = b
    ed.mruMove(1)
    expect(ed.mruIndex).toBe(2)
    ed.mruMove(1)
    expect(ed.mruIndex).toBe(0) // 循环回绕
    ed.mruMove(-1)
    expect(ed.mruIndex).toBe(2)
    ed.mruIndex = 1
    await ed.mruCommit()
    expect(ed.current?.path).toBe('b.md')
    expect(ed.mruActive).toBe(false)
    ed.mruBegin()
    ed.mruIndex = 0 // c = 当前笔记
    await ed.mruCommit()
    expect(ed.current?.path).toBe('b.md') // 不动
  })

  it('取消：面板关、停留原地', async () => {
    const ed = editor()
    ed.captureCursor = () => null
    await ed.openNote('库', 'a.md', 'a')
    await ed.openNote('库', 'b.md', 'b')
    ed.mruBegin()
    ed.mruCancel()
    expect(ed.mruActive).toBe(false)
    expect(ed.current?.path).toBe('b.md')
  })
})
