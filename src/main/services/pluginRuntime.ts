import { utilityProcess } from 'electron'
import type { RuntimeHandle, RuntimeSpawner } from './pluginHost'
import type { HostToPlugin, PluginToHost } from '../plugin-runtime/protocol'

/**
 * electron utilityProcess 运行时适配：
 * - fork bridge.js（--plugin-id / --plugin-dir 通过 argv 传入）
 * - postMessage / message / exit 映射为 RuntimeHandle 接口
 * PluginHost 本身不依赖 electron，测试可注入进程内桩。
 */
export const spawnUtilityRuntime: RuntimeSpawner = (bridgePath, pluginId, pluginDir) => {
  const child = utilityProcess.fork(bridgePath, [`--plugin-id=${pluginId}`, `--plugin-dir=${pluginDir}`], {
    serviceName: `plugin:${pluginId}`
  })

  const handle: RuntimeHandle = {
    post: (msg: HostToPlugin) => child.postMessage(msg),
    onMessage: (cb: (msg: PluginToHost) => void) => {
      child.on('message', (msg: PluginToHost) => cb(msg))
    },
    onExit: (cb: (code: number) => void) => {
      child.on('exit', (code: number) => cb(code))
    },
    kill: () => {
      child.kill()
    }
  }
  return handle
}
