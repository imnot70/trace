import { describe, expect, it } from 'vitest'
import { dispatchCapabilityCall, type GatewayServices, type GatewayCall } from '../src/main/services/pluginGateway'

/**
 * 能力网关分层语义（plugin-design.md 测试基线）：
 * - 权限违规 / 未知能力域 / 未知方法 → 致命（ok=false，bridge 侧 reject，设计要求直接抛错）
 * - 业务失败（未知库、重名、冲突、超限）→ RPC 成功，result = { ok:false, error } 由插件判断
 * - logger / 命令注册内置开放，不走权限
 */

function makeServices(overrides: Partial<GatewayServices> = {}): GatewayServices & { notifications: string[]; logs: string[] } {
  const notifications: string[] = []
  const logs: string[] = []
  const data: Record<string, unknown> = {}
  return {
    notifications,
    logs,
    listVaultNames: () => ['vault-a', 'vault-b'],
    vaultPath: (name) => (name === 'vault-a' || name === 'vault-b' ? `/root/${name}` : null),
    listTree: () => [{ name: 'note1', path: 'note1.md', kind: 'note' }],
    readNote: (vault, relPath) => {
      if (relPath === 'missing.md') return { ok: false, error: '笔记不存在' }
      return { ok: true, content: `# ${vault}/${relPath}\n内容`, hash: 'h1' }
    },
    writeNote: (_vault, relPath, content, expectedHash) => {
      if (expectedHash === 'mismatch') return { ok: false, error: '外部修改冲突，已拒绝写入' }
      return { ok: true, hash: `hash-of-${relPath}-${content.length}` }
    },
    createNote: (vault, parentPath, name) => {
      if (name === '存在.md') return { ok: false, error: '重名' }
      return { ok: true, path: parentPath ? `${parentPath}/${name}` : name }
    },
    notifyUser: (message) => notifications.push(message),
    log: (level, pluginId, args) => logs.push(`${level}:${pluginId}:${args.join(' ')}`),
    getStorage: () => ({
      get: (key) => ({ ok: true, value: key in data ? data[key] : null }),
      set: (key, value) => {
        data[key] = value
        return { ok: true }
      },
      delete: (key) => {
        delete data[key]
        return { ok: true }
      },
      keys: () => ({ ok: true, keys: Object.keys(data) })
    }),
    ...overrides
  }
}

function dispatch(c: GatewayCall, permissions: string[], services = makeServices()): { result: ReturnType<typeof dispatchCapabilityCall>; services: typeof services } {
  return { result: dispatchCapabilityCall(c, new Set(permissions), services, 'sample'), services }
}

describe('能力网关 · 权限过滤矩阵', () => {
  it('notifications：未声明权限 → 致命拒绝；声明后 → 通知送达', () => {
    const denied = dispatch({ domain: 'notifications', method: 'notify', args: ['hi'] }, [])
    expect(denied.result.ok).toBe(false)
    expect(denied.result.error).toContain('notifications')

    const allowed = dispatch({ domain: 'notifications', method: 'notify', args: ['你好'] }, ['notifications'])
    expect(allowed.result.ok).toBe(true)
    expect(allowed.result.result).toEqual({ ok: true })
    expect(allowed.services.notifications).toEqual(['你好'])
  })

  it('notifications：空内容与超长内容为业务失败（不 reject）', () => {
    const empty = dispatch({ domain: 'notifications', method: 'notify', args: [''] }, ['notifications'])
    expect(empty.result.ok).toBe(true)
    expect(empty.result.result).toMatchObject({ ok: false })
    const long = dispatch({ domain: 'notifications', method: 'notify', args: ['x'.repeat(501)] }, ['notifications'])
    expect(long.result.result).toMatchObject({ ok: false, error: expect.stringContaining('500') })
  })

  it('notes:read.vaults：声明权限后返回库名列表', () => {
    const { result } = dispatch({ domain: 'notes:read', method: 'vaults', args: [] }, ['notes:read'])
    expect(result.ok).toBe(true)
    expect(result.result).toEqual({ ok: true, vaults: ['vault-a', 'vault-b'] })
  })

  it('notes:read.list：未声明权限 → 致命拒绝', () => {
    const denied = dispatch({ domain: 'notes:read', method: 'list', args: ['vault-a'] }, [])
    expect(denied.result.ok).toBe(false)
    expect(denied.result.error).toContain('notes:read')
  })

  it('notes:read.read：读取成功带 content/hash；未知库与缺失笔记为业务失败', () => {
    const okRead = dispatch({ domain: 'notes:read', method: 'read', args: ['vault-a', 'dir/a.md'] }, ['notes:read'])
    expect(okRead.result.ok).toBe(true)
    expect(okRead.result.result).toMatchObject({ ok: true, content: expect.stringContaining('# vault-a/dir/a.md'), hash: 'h1' })

    const badVault = dispatch({ domain: 'notes:read', method: 'read', args: ['ghost', 'a.md'] }, ['notes:read'])
    expect(badVault.result.ok).toBe(true)
    expect(badVault.result.result).toMatchObject({ ok: false, error: expect.stringContaining('笔记库不存在') })

    const missing = dispatch({ domain: 'notes:read', method: 'read', args: ['vault-a', 'missing.md'] }, ['notes:read'])
    expect(missing.result.result).toMatchObject({ ok: false, error: '笔记不存在' })
  })

  it('notes:read.read：超过大小上限的内容为业务失败', () => {
    const services = makeServices({
      readNote: () => ({ ok: true, content: 'x'.repeat(4_000_001), hash: 'h' })
    })
    const { result } = dispatch({ domain: 'notes:read', method: 'read', args: ['vault-a', 'big.md'] }, ['notes:read'], services)
    expect(result.ok).toBe(true)
    expect(result.result).toMatchObject({ ok: false, error: expect.stringContaining('上限') })
  })

  it('notes:write.write：声明权限后透传防覆盖 hash', () => {
    const okWrite = dispatch(
      { domain: 'notes:write', method: 'write', args: ['vault-a', 'a.md', '新内容', { expectedHash: 'h1' }] },
      ['notes:write']
    )
    expect(okWrite.result.ok).toBe(true)
    expect(okWrite.result.result).toMatchObject({ ok: true, hash: 'hash-of-a.md-3' })

    const conflict = dispatch(
      { domain: 'notes:write', method: 'write', args: ['vault-a', 'a.md', '新内容', { expectedHash: 'mismatch' }] },
      ['notes:write']
    )
    expect(conflict.result.ok).toBe(true)
    expect(conflict.result.result).toMatchObject({ ok: false, error: expect.stringContaining('拒绝写入') })
  })

  it('notes:write.create：未声明权限致命拒绝；声明后创建；重名为业务失败', () => {
    const denied = dispatch({ domain: 'notes:write', method: 'create', args: ['vault-a', '', 'n.md', ''] }, [])
    expect(denied.result.ok).toBe(false)

    const okCreate = dispatch(
      { domain: 'notes:write', method: 'create', args: ['vault-a', 'folder', 'n.md', '# hi'] },
      ['notes:write']
    )
    expect(okCreate.result.result).toEqual({ ok: true, path: 'folder/n.md' })

    const dup = dispatch({ domain: 'notes:write', method: 'create', args: ['vault-a', '', '存在.md', ''] }, ['notes:write'])
    expect(dup.result.ok).toBe(true)
    expect(dup.result.result).toMatchObject({ ok: false, error: '重名' })
  })

  it('notes:write.write：内容超限为业务失败', () => {
    const { result } = dispatch(
      { domain: 'notes:write', method: 'write', args: ['vault-a', 'a.md', 'x'.repeat(4_000_001)] },
      ['notes:write']
    )
    expect(result.ok).toBe(true)
    expect(result.result).toMatchObject({ ok: false, error: expect.stringContaining('上限') })
  })

  it('logger：内置能力无需权限', () => {
    const { result, services } = dispatch({ domain: 'logger', method: 'info', args: ['插件日志'] }, [])
    expect(result.ok).toBe(true)
    expect(services.logs).toEqual(['info:sample:插件日志'])
  })

  it('未知能力域与未知方法为致命拒绝', () => {
    const badDomain = dispatch({ domain: 'fs', method: 'readFile', args: [] }, ['fs'])
    expect(badDomain.result.ok).toBe(false)
    expect(badDomain.result.error).toContain('未知能力域')

    const badMethod = dispatch({ domain: 'notes:read', method: 'delete', args: ['vault-a'] }, ['notes:read'])
    expect(badMethod.result.ok).toBe(false)
    expect(badMethod.result.error).toContain('未知方法')
  })

  it('非法参数（缺库名 / 缺路径）为业务失败且不抛异常', () => {
    const noVault = dispatch({ domain: 'notes:read', method: 'list', args: [] }, ['notes:read'])
    expect(noVault.result.ok).toBe(true)
    expect(noVault.result.result).toMatchObject({ ok: false })
    const noPath = dispatch({ domain: 'notes:read', method: 'read', args: ['vault-a'] }, ['notes:read'])
    expect(noPath.result.result).toMatchObject({ ok: false })
  })
})
