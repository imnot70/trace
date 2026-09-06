import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PluginHost } from '../src/main/services/pluginHost'
import { JsonStore } from '../src/main/lib/jsonStore'
import type { AppSettings } from '../src/shared/types'

let tmp: string
let settings: JsonStore<AppSettings>
let notifications: string[]

function makeHost(pluginsDir: string): PluginHost {
  return new PluginHost(
    pluginsDir,
    null,
    settings,
    () => ({
      notify: (m) => notifications.push(m),
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    }),
    createRequire(import.meta.url)
  )
}

function installPlugin(dir: string, mainJs: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ id: 'sample', name: '示例插件', version: '1.0.0', description: 'd', main: 'main.js' })
  )
  fs.writeFileSync(path.join(dir, 'main.js'), mainJs)
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-plugin-'))
  settings = new JsonStore<AppSettings>(path.join(tmp, 'settings.json'), {
    workspaceRoot: tmp,
    theme: 'system',
    editorFontSize: 15,
    autoSave: true,
    attachmentsDir: 'attachments',
    enablePlugins: false,
    pluginEnabled: {}
  })
  notifications = []
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('PluginHost', () => {
  it('未开启插件功能时不发现即不加载', () => {
    const host = makeHost(path.join(tmp, 'plugins'))
    host.init()
    installPlugin(path.join(tmp, 'plugins', 'sample'), 'exports.activate = () => {}')
    expect(host.discover()).toHaveLength(1)
    expect(host.discover()[0].loaded).toBe(false)
  })

  it('开启后激活插件并可停用', () => {
    const pluginsDir = path.join(tmp, 'plugins')
    const host = makeHost(pluginsDir)
    host.init()
    installPlugin(pluginsDir + '/sample', 'module.exports.activate = (ctx) => { ctx.notify("hi") }')
    settings.update((s) => {
      s.enablePlugins = true
    })
    host.setEnabled('sample', true)
    expect(notifications).toEqual(['hi'])
    expect(host.discover()[0]).toMatchObject({ enabled: true, loaded: true })

    host.setEnabled('sample', false)
    expect(host.discover()[0]).toMatchObject({ enabled: false, loaded: false })
  })

  it('插件入口抛错时记录错误而不是崩溃', () => {
    const pluginsDir = path.join(tmp, 'plugins')
    const host = makeHost(pluginsDir)
    host.init()
    installPlugin(pluginsDir + '/sample', 'throw new Error("boom")')
    settings.update((s) => {
      s.enablePlugins = true
    })
    host.setEnabled('sample', true)
    expect(host.discover()[0].error).toMatch(/boom/)
  })

  it('无效 manifest 的目录被跳过', () => {
    const host = makeHost(path.join(tmp, 'plugins'))
    host.init()
    const bad = path.join(tmp, 'plugins', 'bad')
    fs.mkdirSync(bad, { recursive: true })
    fs.writeFileSync(path.join(bad, 'manifest.json'), 'not json')
    expect(host.discover()).toHaveLength(0)
  })
})
