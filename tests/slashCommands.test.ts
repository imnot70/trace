import { describe, expect, it } from 'vitest'

/** 斜杠命令过滤（FR-2.4.22）：命令名包含（中文）+ 别名前缀（英文）双通道匹配 */
import { SLASH_COMMANDS, filterSlashCommands } from '../src/renderer/src/lib/slashCommands'

describe('斜杠命令过滤', () => {
  it('空查询返回全部命令', () => {
    expect(filterSlashCommands('')).toEqual(SLASH_COMMANDS)
    expect(filterSlashCommands('  ')).toEqual(SLASH_COMMANDS)
  })

  it('中文命令名包含匹配：「表格」命中 /表格；「标题」命中全部标题命令', () => {
    // 「表」单字会同时命中 /表格 与 /任务列表（「列表」含「表」字），故用完整词断言精确命中
    const t = filterSlashCommands('表格')
    expect(t.map((c) => c.label)).toEqual(['/表格'])
    const heads = filterSlashCommands('标题')
    expect(heads.map((c) => c.label)).toEqual(['/标题1', '/标题2', '/标题3', '/标题4', '/标题5', '/标题6', '/标题0'])
  })

  it('英文别名前缀匹配：/t 命中 /表格（同 Ctrl+T），/h2 命中 /标题2', () => {
    expect(filterSlashCommands('t').map((c) => c.label)).toContain('/表格')
    expect(filterSlashCommands('h2').map((c) => c.label)).toEqual(['/标题2'])
    expect(filterSlashCommands('date').map((c) => c.label)).toEqual(['/日期'])
  })

  it('大小写不敏感；无匹配返回空', () => {
    expect(filterSlashCommands('T').map((c) => c.label)).toContain('/表格')
    expect(filterSlashCommands('不存在的命令')).toEqual([])
  })

  it('/日期 动作产出 YYYY-MM-DD 本地日期', () => {
    const date = SLASH_COMMANDS.find((c) => c.label === '/日期')!
    expect(date.action.kind).toBe('text')
    if (date.action.kind === 'text') {
      expect(date.action.text()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('FR 清单要求的命令全部在册', () => {
    const labels = SLASH_COMMANDS.map((c) => c.label)
    for (const required of ['/表格', '/标题1', '/标题6', '/标题0', '/引用', '/任务列表', '/代码块', '/行内公式', '/公式块', '/分割线', '/日期']) {
      expect(labels).toContain(required)
    }
  })

  it('/引入 在册（FR-2.9.12）：别名 ref / insert 可命中，动作为打开快速引用面板', () => {
    const cmd = SLASH_COMMANDS.find((c) => c.label === '/引入')!
    expect(cmd.action.kind).toBe('insertRef')
    expect(filterSlashCommands('ref').map((c) => c.label)).toContain('/引入')
    expect(filterSlashCommands('insert').map((c) => c.label)).toEqual(['/引入'])
    expect(filterSlashCommands('引入').map((c) => c.label)).toEqual(['/引入'])
  })
})
