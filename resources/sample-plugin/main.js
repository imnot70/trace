'use strict'

/**
 * Trace 示例插件：演示插件的最小结构。
 * manifest.json 声明插件元信息，main.js 导出 activate(ctx)。
 * ctx 目前提供 notify(message) 与 ctx.logger。
 */

exports.activate = function activate(ctx) {
  ctx.logger.info('示例插件已激活')
  // 激活 2 秒后提示一次，证明插件确实被执行了
  const timer = setTimeout(() => {
    ctx.notify('示例插件已激活 ✔')
  }, 2000)
  return function deactivate() {
    clearTimeout(timer)
  }
}
