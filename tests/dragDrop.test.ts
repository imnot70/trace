// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  beginNoteRefDrag,
  consumeDragAltLatch,
  hasNoteRefDrag,
  NOTE_REF_MIME,
  preferNameInsert,
  readNoteRefDrag,
  restoreDropMasks,
  yieldDropMasks
} from '../src/renderer/src/lib/dragDrop'

/** dataTransfer 桩（jsdom 无真 DataTransfer；按 lib 的结构化最小接口实现） */
function stubDataTransfer(initial?: Record<string, string>): {
  types: string[]
  setData: (type: string, value: string) => void
  getData: (type: string) => string
} {
  const store = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    types: [], // 由 getter 语义模拟： setData 时补齐（下方 setup 处理）
    setData(type, value) {
      store.set(type, value)
      if (!this.types.includes(type)) this.types.push(type)
    },
    getData(type) {
      return store.get(type) ?? ''
    }
  }
}

const PAYLOAD = { vault: '笔记库', path: '日记/2026-09-29.md', name: '2026-09-29' }

describe('拖曳插入引用：载荷读写（FR-2.9.10 P3）', () => {
  it('setData 后 round-trip 读回原载荷（含 from 来源标记）', () => {
    const dt = stubDataTransfer()
    dt.setData(NOTE_REF_MIME, JSON.stringify(PAYLOAD))
    expect(hasNoteRefDrag(dt)).toBe(true)
    expect(readNoteRefDrag(dt)).toEqual(PAYLOAD)
    const dt2 = stubDataTransfer()
    const withFrom = { ...PAYLOAD, from: 'dialog' as const }
    dt2.setData(NOTE_REF_MIME, JSON.stringify(withFrom))
    expect(readNoteRefDrag(dt2)).toEqual(withFrom)
  })

  it('types 不含 MIME 时拒读（外部文件 / 文本拖入走既有分支）', () => {
    const dt = stubDataTransfer({ 'text/plain': 'hello' })
    expect(hasNoteRefDrag(dt)).toBe(false)
    expect(readNoteRefDrag(dt)).toBeNull()
  })

  it('JSON 非法 / 字段缺失 / 空 dataTransfer 一律返回 null（容错）', () => {
    const bad = stubDataTransfer({ [NOTE_REF_MIME]: '{not json' })
    const missing = stubDataTransfer({ [NOTE_REF_MIME]: JSON.stringify({ vault: 'v' }) })
    expect(readNoteRefDrag(bad)).toBeNull()
    expect(readNoteRefDrag(missing)).toBeNull()
    expect(readNoteRefDrag(null)).toBeNull()
    expect(readNoteRefDrag(undefined)).toBeNull()
  })
})

describe('拖曳插入引用：遮罩让行与恢复', () => {
  function makeMask(cls: string): HTMLElement {
    const el = document.createElement('div')
    el.className = cls
    // jsdom 无布局：getClientRects 恒空数组会被判不可见，打桩让它可见
    ;(el as HTMLElement & { getClientRects: () => unknown }).getClientRects = () => [null] as unknown as DOMRectList
    document.body.appendChild(el)
    return el
  }

  it('让行：可见的 el-overlay 与 sidebar-backdrop 加 drag-yield（隐藏 DOM 不动）', () => {
    const overlay = makeMask('el-overlay')
    const backdrop = makeMask('sidebar-backdrop')
    const hidden = makeMask('el-overlay')
    ;(hidden as HTMLElement & { getClientRects: () => unknown }).getClientRects = () => [] as unknown as DOMRectList
    yieldDropMasks()
    expect(overlay.classList.contains('drag-yield')).toBe(true)
    expect(backdrop.classList.contains('drag-yield')).toBe(true)
    expect(hidden.classList.contains('drag-yield')).toBe(false)
  })

  it('弹窗隐藏延后一拍：同步时不加 drag-hide，定时器触发后可见 el-overlay 才隐藏', async () => {
    const overlay = makeMask('el-overlay')
    yieldDropMasks()
    expect(overlay.classList.contains('drag-hide')).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(overlay.classList.contains('drag-hide')).toBe(true)
  })

  it('代数守卫：让行后立即恢复，延后的隐藏回调不得再把弹窗藏掉', async () => {
    const overlay = makeMask('el-overlay')
    yieldDropMasks()
    restoreDropMasks()
    await new Promise((r) => setTimeout(r, 0))
    expect(overlay.classList.contains('drag-hide')).toBe(false)
    expect(overlay.classList.contains('drag-yield')).toBe(false)
  })

  it('恢复：dragend 事件（document 捕获级一次性）触发后两类全部摘除', async () => {
    makeMask('el-overlay')
    makeMask('sidebar-backdrop')
    yieldDropMasks()
    await new Promise((r) => setTimeout(r, 0))
    document.dispatchEvent(new Event('dragend'))
    for (const el of document.querySelectorAll('.drag-yield, .drag-hide')) {
      throw new Error(`恢复失败：${el.className} 仍有残留类`)
    }
    // 幂等：再恢复一次不抛错
    restoreDropMasks()
  })

  it('重复让行：先清理上一轮残留再加新类（不叠加监听泄漏）', async () => {
    makeMask('el-overlay')
    yieldDropMasks()
    yieldDropMasks()
    document.dispatchEvent(new Event('drop'))
    document.dispatchEvent(new Event('dragend'))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelectorAll('.drag-yield, .drag-hide').length).toBe(0)
  })

  it('drop 落到编辑器（带载荷）：抑制 dragend 自动恢复，留给插入收口同拍清理', async () => {
    const overlay = makeMask('el-overlay')
    yieldDropMasks()
    await new Promise((r) => setTimeout(r, 0))
    const dt = stubDataTransfer()
    dt.setData(NOTE_REF_MIME, JSON.stringify(PAYLOAD))
    const drop = new Event('drop') as Event & { dataTransfer?: Pick<typeof dt, 'types' | 'getData'> }
    drop.dataTransfer = dt
    document.dispatchEvent(drop)
    document.dispatchEvent(new Event('dragend'))
    // 抑制生效：类仍在（等插入收口的 finally 清理），不会被 dragend 提前恢复
    expect(overlay.classList.contains('drag-hide')).toBe(true)
    expect(overlay.classList.contains('drag-yield')).toBe(true)
    restoreDropMasks()
    expect(overlay.classList.contains('drag-hide')).toBe(false)
  })

  it('Alt 修饰键锁存：dragstart 时刻状态可被取走，取走后复位', () => {
    const dt = stubDataTransfer()
    yieldDropMasks()
    beginNoteRefDrag({ dataTransfer: dt, altKey: true }, PAYLOAD)
    expect(consumeDragAltLatch()).toBe(true)
    expect(consumeDragAltLatch()).toBe(false)
    beginNoteRefDrag({ dataTransfer: dt, altKey: false }, PAYLOAD)
    expect(consumeDragAltLatch()).toBe(false)
  })
})

describe('拖曳插入引用：D2 同名消歧决策', () => {
  it('恰好 1 个候选 → 插叶子名；0 候选 / 重名 / 空 → 插完整路径', () => {
    expect(preferNameInsert(['日记/2026-09-29.md'])).toBe(true)
    expect(preferNameInsert([])).toBe(false)
    expect(preferNameInsert(['a/笔记.md', 'b/笔记.md'])).toBe(false)
    expect(preferNameInsert(undefined)).toBe(false)
    expect(preferNameInsert(null)).toBe(false)
  })
})
