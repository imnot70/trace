import type { BrowserWindow } from 'electron'
import type { AppSettings } from '@shared/types'
import { logger } from '../lib/logger'

/**
 * 应用窗口玻璃效果
 * 根据平台和设置应用不同的窗口效果（FR-2.9 扩展，实验性）
 *
 * 平台支持：
 * - Windows：仅窗口不透明度（setOpacity）。Mica / Acrylic 材质需要透明窗口才能透出，
 *   而 Windows 上 transparent: true 会剥离原生标题栏（窗口无法移动 / 关闭），故不使用——
 *   详见 createWindow 中的说明；待将来引入自定义标题栏后再恢复
 * - macOS：vibrancy（毛玻璃）
 * - Linux：依赖桌面合成器（Wayland/X11 合成器开启时透明才生效），尽力而为
 */
export function applyWindowGlassEffect(window: BrowserWindow, settings: AppSettings): void {
  // 检查窗口是否已被销毁
  if (window.isDestroyed()) {
    return
  }

  const { windowGlassEffect, windowOpacity } = settings
  const platform = process.platform

  // 应用透明度
  if (windowOpacity < 100) {
    window.setOpacity(windowOpacity / 100)
  } else {
    window.setOpacity(1.0)
  }

  // Windows 窗口不透明（见函数头注释），任何材质都不可见，到此为止
  if (platform === 'win32') {
    return
  }

  // 根据效果类型应用
  if (windowGlassEffect === 'none') {
    // 关闭所有效果
    if (platform === 'darwin') {
      window.setVibrancy(null)
    }
    return
  }

  // 根据平台应用效果
  switch (platform) {
    case 'darwin':
      // macOS 支持 vibrancy
      if (windowGlassEffect === 'vibrancy' || windowGlassEffect === 'auto') {
        // 根据主题选择 vibrancy 类型
        const theme = settings.theme
        let vibrancyType: string
        if (theme === 'dark') {
          vibrancyType = 'dark'
        } else if (theme === 'light') {
          vibrancyType = 'light'
        } else {
          vibrancyType = 'appearance-based'
        }
        window.setVibrancy(vibrancyType as never)
      }
      break

    case 'linux':
      // Linux 依赖桌面环境合成器，支持情况不一
      // 主要支持 KDE Plasma、GNOME（需要扩展）
      logger.info('Linux 平台窗口玻璃效果依赖桌面合成器，部分环境可能不支持')
      // 尝试设置透明背景
      if (windowGlassEffect === 'acrylic' || windowGlassEffect === 'auto') {
        window.setBackgroundColor('#00000000')
      }
      break

    default:
      logger.info(`平台 ${platform} 不支持窗口玻璃效果`)
  }
}
