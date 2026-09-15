import { describe, expect, it } from 'vitest'
import { AutoSyncService, type AutoSyncDeps } from '../src/main/services/autoSync'

const fs = require('node:fs') as typeof import('node:fs')
const fsp = require('node:path') as typeof import('node:path')

/** 极简 fake：记录调用；sync 可被 gate 挂起以模拟慢同步 */
function makeDeps(overrides?: Partial<AutoSyncDeps>): AutoSyncDeps & { syncCalls: string[] } {
  const state = { syncCalls: [] as string[] }
  const deps: AutoSyncDeps = {
    getRoot: () => root(),
    git: {
      isRepo: (p: string) => !p.includes('非仓库'),
      status: async (p: string) => ({
        associated: !p.includes('未关联'),
        repoFullName: 'a/b',
        remoteUrl: 'x',
        branch: 'main',
        ahead: 0,
        behind: 0,
        dirty: false
      }),
      sync: async (p: string) => {
        state.syncCalls.push(p)
        return { ok: true }
      }
    } as unknown as AutoSyncDeps['git'],
    watcher: {
      suspend: () => undefined,
      resume: () => undefined
    } as unknown as AutoSyncDeps['watcher'],
    getConfig: () => ({ mode: 'change', intervalMin: 5 }),
    debounceMs: 30,
    ...overrides
  }
  return Object.assign(deps, state)
}

function makeWorkspace(root: string): void {
  for (const name of ['库A', '库B-未关联', '非仓库']) {
    fs.mkdirSync(fsp.join(root, name), { recursive: true })
  }
  for (const name of ['库A', '库B-未关联']) {
    fs.mkdirSync(fsp.join(root, name, '.git'), { recursive: true })
  }
}

function root(): string {
  return fs.mkdtempSync(fsp.join(require('node:os').tmpdir(), 'as-'))
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('AutoSyncService：变更触发模式', () => {
  it('防抖窗内不触发，窗后仅同步已关联的库（跳过未关联与非仓库）', async () => {
    const ws = root()
    makeWorkspace(ws)
    const deps = makeDeps({ getRoot: () => ws })
    const svc = new AutoSyncService(deps)
    svc.onChanged()
    await wait(20)
    expect(deps.syncCalls).toHaveLength(0) // 窗口内未触发
    await wait(300)
    expect(deps.syncCalls).toEqual([fsp.join(ws, '库A')]) // 仅已关联库
    fs.rmSync(ws, { recursive: true, force: true })
  })

  it('防抖窗口内多次变更合并为一轮', async () => {
    const ws = root()
    makeWorkspace(ws)
    const deps = makeDeps({ getRoot: () => ws })
    const svc = new AutoSyncService(deps)
    svc.onChanged()
    svc.onChanged()
    svc.onChanged()
    await wait(300)
    expect(deps.syncCalls).toHaveLength(1)
    fs.rmSync(ws, { recursive: true, force: true })
  })

  it('off / interval 模式下 onChanged 不触发', async () => {
    const ws = root()
    makeWorkspace(ws)
    for (const mode of ['off', 'interval'] as const) {
      const deps = makeDeps({ getRoot: () => ws, getConfig: () => ({ mode, intervalMin: 5 }) })
      const svc = new AutoSyncService(deps)
      svc.onChanged()
      await wait(300)
      expect(deps.syncCalls, `模式 ${mode}`).toHaveLength(0)
    }
    fs.rmSync(ws, { recursive: true, force: true })
  })

  it('同步进行中的新变更在轮次结束后补跑一轮（gate 挂起模拟慢同步）', async () => {
    const ws = root()
    makeWorkspace(ws)
    let gate: (() => void) | null = null
    const deps = makeDeps({
      getRoot: () => ws,
      git: {
        isRepo: (p: string) => !p.includes('非仓库'),
        status: async (p: string) => ({
          associated: true,
          repoFullName: 'a/b',
          remoteUrl: 'x',
          branch: 'main',
          ahead: 0,
          behind: 0,
          dirty: false
        }),
        sync: (p: string) =>
          new Promise((resolve) => {
            deps.syncCalls.push(p)
            gate = () => resolve({ ok: true })
            void p
          })
      } as unknown as AutoSyncDeps['git']
    })
    const svc = new AutoSyncService(deps)
    svc.onChanged()
    await wait(250) // 第一轮开始（sync 挂起中）
    expect(deps.syncCalls).toHaveLength(1)
    svc.onChanged() // 挂起期间的新变更 → 排队
    gate!()
    await wait(400) // 第一轮结束 → 补跑一轮
    expect(deps.syncCalls).toHaveLength(2)
    fs.rmSync(ws, { recursive: true, force: true })
  })
})
