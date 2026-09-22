import type { BrowserWindow } from 'electron'
import type { AppSettings } from '@shared/types'
import { logger } from '../lib/logger'

/** WCO 标题栏按钮区配色（随应用深浅主题；底色与应用顶区 bg-secondary 一致） */
const OVERLAY_THEME = {
  dark: { color: '#17191e', symbolColor: '#c8ccd4' },
  light: { color: '#f5f6f8', symbolColor: '#5f6368' }
} as const

/** 按设置计算 WCO 配色（createWindow 初始化与主题切换共用；systemDark 由调用方传 nativeTheme.shouldUseDarkColors） */
export function overlayThemeFor(settings: AppSettings | undefined, systemDark: boolean): { color: string; symbolColor: string; height: number } {
  const dark =
    settings?.theme === 'dark' || (settings?.theme === 'system' && systemDark)
  return { height: 36, ...OVERLAY_THEME[dark ? 'dark' : 'light'] }
}

/**
 * WCO 标题栏按钮区配色跟随主题（仅 Windows；非 WCO 环境 setTitleBarOverlay 抛错，静默）。
 * 调用点：settings:set 主题变化时 + nativeTheme 'updated'（跟随系统主题）。
 */
export function applyOverlayTheme(win: BrowserWindow, settings: AppSettings, systemDark: boolean): void {
  if (process.platform !== 'win32' || win.isDestroyed()) return
  try {
    win.setTitleBarOverlay(overlayThemeFor(settings, systemDark))
  } catch {
    /* 未启用 WCO 的窗口无此能力，忽略 */
  }
}

/**
 * 应用窗口玻璃效果
 * 根据平台和设置应用不同的窗口效果（FR-2.9 扩展；Windows 路径见
 * requirements/2026-09-22_custom-titlebar/custom-titlebar_design.md）
 *
 * 平台支持：
 * - Windows：WCO（hidden title bar）+ backgroundMaterial（Mica / Acrylic，Win11 22H2+）。
 *   ⚠️ 不使用 transparent: true（会剥离原生标题栏，v0.4.4 严重回归根源）；
 *   Win10 / setBackgroundMaterial 失败时自动降级为不透明 + 仅透明度
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

  // 应用透明度（毛玻璃材质建议透明度 100%，半透明下材质不可见）
  if (windowOpacity < 100) {
    window.setOpacity(windowOpacity / 100)
  } else {
    window.setOpacity(1.0)
  }

  // Windows：WCO 窗口上的 DWM 系统背景材质
  if (platform === 'win32') {
    applyWindowsMaterial(window, windowGlassEffect)
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

/** Windows 玻璃材质：mica（auto 归一）/ acrylic / 关闭 */
function applyWindowsMaterial(window: BrowserWindow, windowGlassEffect: AppSettings['windowGlassEffect']): void {
  if (window.isDestroyed()) return

  // Win10 及以下不支持 backgroundMaterial（官方仅 Win11 22H2+），直接降级。
  // ⚠️ Windows 11 的 getSystemVersion() 仍返回 "10.0.x"（兼容性保留主版本号），
  // 必须按 build 号判定：build >= 22000 即 Win11
  // vitest 环境无 getSystemVersion（Electron 专属 API），缺省视为不支持 → 降级
  const sysVersion =
    typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '10.0.0'
  const build = Number(sysVersion.split('.')[2] ?? 0)
  if (build < 22000) {
    logger.info(`Windows build ${build} 不支持 backgroundMaterial，玻璃效果降级为仅透明度`)
    return
  }

  if (windowGlassEffect === 'none') {
    try {
      window.setBackgroundMaterial('none')
    } catch {
      /* 部分环境可能抛错，忽略即可（无材质即默认） */
    }
    return
  }

  if (windowGlassEffect === 'mica' || windowGlassEffect === 'acrylic' || windowGlassEffect === 'auto') {
    const material = windowGlassEffect === 'acrylic' ? 'acrylic' : 'mica'
    try {
      window.setBackgroundMaterial(material)
      logger.info(`Windows 玻璃材质已应用：${material}`)
    } catch (err) {
      // 不支持的环境（Win10 / 未开启桌面合成等）：静默降级为仅透明度
      logger.info(`Windows 玻璃材质应用失败，已降级：${String(err).slice(0, 120)}`)
    }
  }
}
