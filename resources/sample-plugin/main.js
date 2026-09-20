'use strict'

/**
 * Trace 示例插件（Tier 1 能力演示）：
 * - ctx.notify / ctx.logger：通知与日志（notifications 权限 / 内置）
 * - ctx.notes.vaults / list / read / create / write：笔记读写（notes:read / notes:write 权限）
 * - ctx.on('note:saved')：订阅笔记保存事件（events 权限）
 * - ctx.registerCommand：注册命令（内置），启用插件后在 设置 → 插件 中运行
 * - ctx.storage.get / set：插件私有 KV 存储（settings:persist 权限，随插件卸载清除）
 *
 * API 约定：
 * - notes.* 全部 resolve 为 { ok: true, ...数据 } 或 { ok: false, error }，用 .ok 判断；
 * - 未声明权限的调用直接抛错（reject），捕获后可提示用户；
 * - 完整命令 id = <插件id>.<命令id>。
 */

exports.activate = function activate(ctx) {
  ctx.logger.info('示例插件已激活')

  // 事件：保存笔记时在日志里记录（不弹通知，避免打扰）
  const onNoteSaved = function onNoteSaved(payload) {
    ctx.logger.info('检测到笔记保存：' + payload.vault + ' / ' + payload.path)
  }
  ctx.on('note:saved', onNoteSaved)

  // 命令：读取第一个库的第一篇笔记统计字数，并把报告写入一篇笔记
  ctx.registerCommand({
    id: 'stats',
    title: '统计首篇笔记',
    handler: async function () {
      // 私有存储：记录命令执行次数
      const runsRecord = await ctx.storage.get('runs')
      const runs = (runsRecord.ok && typeof runsRecord.value === 'number' ? runsRecord.value : 0) + 1
      await ctx.storage.set('runs', runs)

      const vaultsResult = await ctx.notes.vaults()
      if (!vaultsResult.ok || !vaultsResult.vaults.length) {
        await ctx.notify('示例插件：还没有笔记库，先创建一个吧')
        return
      }
      const vault = vaultsResult.vaults[0]
      const listResult = await ctx.notes.list(vault)
      if (!listResult.ok) {
        await ctx.notify('示例插件：读取库失败——' + listResult.error)
        return
      }
      const firstNote = findFirstNote(listResult.tree)
      if (!firstNote) {
        await ctx.notify('示例插件：库「' + vault + '」里还没有笔记')
        return
      }
      const note = await ctx.notes.read(vault, firstNote.path)
      if (!note.ok) {
        await ctx.notify('示例插件：读取笔记失败——' + note.error)
        return
      }
      const chars = note.content.length
      const lines = note.content.split('\n').length

      // 演示写入能力：把统计结果写进「插件示例报告.md」（已存在则覆盖）
      const reportName = '插件示例报告.md'
      const created = await ctx.notes.create(vault, '', reportName, '')
      const reportPath = created.ok ? created.path : reportName
      const report = [
        '# 插件示例报告',
        '',
        '- 统计对象：`' + firstNote.path + '`',
        '- 字符数：' + chars,
        '- 行数：' + lines,
        '- 统计时间：' + new Date().toLocaleString(),
        ''
      ].join('\n')
      const written = await ctx.notes.write(vault, reportPath, report, null)
      if (written.ok) {
        await ctx.notify('示例插件（第 ' + runs + ' 次）：「' + firstNote.name + '」共 ' + chars + ' 字，报告已写入')
      } else {
        await ctx.notify('示例插件：统计完成 ' + chars + ' 字（写入报告失败：' + written.error + '）')
      }
    }
  })

  return function deactivate() {
    ctx.off('note:saved', onNoteSaved)
    ctx.logger.info('示例插件已停用')
  }
}

/** 在笔记树里找第一篇笔记（list 的 tree 为 {name, kind, path, children?} 节点数组） */
function findFirstNote(nodes) {
  for (const node of nodes || []) {
    if (node.kind === 'note') return node
    if (node.children) {
      const found = findFirstNote(node.children)
      if (found) return found
    }
  }
  return null
}
