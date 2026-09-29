import { describe, expect, it } from 'vitest'
import {
  isNewerVersion,
  parseLatestVersion,
  shouldCheckUpdate,
  UPDATE_CHECK_INTERVAL_MS
} from '../src/shared/updateCheck'
import { checkForUpdate } from '../src/main/services/updateCheck'

describe('新版本检测：版本比较（FR-2.10.6）', () => {
  it('相同版本 → 无更新', () => {
    expect(isNewerVersion('0.13.0', '0.13.0')).toBe(false)
  })

  it('patch / minor / major 更新均判新', () => {
    expect(isNewerVersion('0.13.0', '0.13.1')).toBe(true)
    expect(isNewerVersion('0.13.0', '0.14.0')).toBe(true)
    expect(isNewerVersion('0.13.0', '1.0.0')).toBe(true)
  })

  it('更旧版本 → 无更新', () => {
    expect(isNewerVersion('0.13.0', '0.12.9')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(false)
  })

  it('逐段数字比较（0.10.0 新于 0.9.0，非字符串序）', () => {
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(false)
  })

  it('v 前缀与缺段容错', () => {
    expect(isNewerVersion('0.13.0', 'v0.14.0')).toBe(true)
    expect(isNewerVersion('v0.13.0', '0.13.0')).toBe(false)
    expect(isNewerVersion('0.13', '0.13.1')).toBe(true)
  })
})

describe('新版本检测：tag 解析', () => {
  it('v 前缀剥离与原样', () => {
    expect(parseLatestVersion('v0.14.0')).toBe('0.14.0')
    expect(parseLatestVersion('0.14.0')).toBe('0.14.0')
  })

  it('非法 tag 返回 null（远端数据不可信，不抛错）', () => {
    expect(parseLatestVersion('abc')).toBeNull()
    expect(parseLatestVersion('v1.2')).toBeNull()
    expect(parseLatestVersion('')).toBeNull()
  })
})

describe('新版本检测：24h 节流判定', () => {
  const now = 1_700_000_000_000

  it('无记录 → 需要检查', () => {
    expect(shouldCheckUpdate(null, now)).toBe(true)
  })

  it('24h 内 → 不检查；超过 → 检查', () => {
    expect(shouldCheckUpdate(now - UPDATE_CHECK_INTERVAL_MS + 1000, now)).toBe(false)
    expect(shouldCheckUpdate(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true)
    expect(shouldCheckUpdate(now - UPDATE_CHECK_INTERVAL_MS * 3, now)).toBe(true)
  })

  it('非法记录值视为无记录', () => {
    expect(shouldCheckUpdate(Number.NaN, now)).toBe(true)
  })
})

describe('新版本检测：service（注入桩客户端）', () => {
  const stub = (status: number, body?: string) => ({
    getText: async () => ({ status, body })
  })

  it('200 + 新 tag → available 且带链接', async () => {
    const r = await checkForUpdate(
      stub(200, JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://github.com/imnot70/trace/releases/tag/v9.9.9' })),
      '0.13.0'
    )
    expect(r.ok).toBe(true)
    expect(r.available).toBe(true)
    expect(r.latestVersion).toBe('9.9.9')
    expect(r.releaseUrl).toContain('/releases/tag/v9.9.9')
  })

  it('200 + 相同版本 → ok 但无更新', async () => {
    const r = await checkForUpdate(
      stub(200, JSON.stringify({ tag_name: 'v0.13.0', html_url: 'https://x' })),
      '0.13.0'
    )
    expect(r.ok).toBe(true)
    expect(r.available).toBe(false)
  })

  it('非 200 → ok:false（静默失败）', async () => {
    const r = await checkForUpdate(stub(404), '0.13.0')
    expect(r.ok).toBe(false)
    expect(r.available).toBe(false)
    expect(r.error).toContain('404')
  })

  it('网络抛错 → ok:false（不向上抛）', async () => {
    const r = await checkForUpdate(
      { getText: async () => { throw new Error('net down') } },
      '0.13.0'
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('net down')
  })

  it('响应缺字段 → ok:false（远端数据不可信）', async () => {
    const r = await checkForUpdate(stub(200, JSON.stringify({ foo: 1 })), '0.13.0')
    expect(r.ok).toBe(false)
  })
})
