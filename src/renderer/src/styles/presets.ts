export interface ThemePreset {
  id: string
  name: string
  light: Record<string, string>
  dark: Record<string, string>
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'warm',
    name: '暖色',
    light: {
      '--bg-primary': '#fdf8f4',
      '--bg-secondary': '#f7f0ea',
      '--bg-tertiary': '#f0e6db',
      '--bg-hover': 'rgba(180, 120, 60, 0.06)',
      '--bg-active': 'rgba(217, 119, 6, 0.12)',
      '--text-primary': '#3d2e1e',
      '--text-secondary': '#6b5a48',
      '--text-tertiary': '#9a8a78',
      '--border-color': '#e8ddd2',
      '--accent': '#d97706',
      '--accent-soft': 'rgba(217, 119, 6, 0.12)',
      '--danger': '#dc2626',
      '--code-bg': '#f5ede5',
      '--hljs-base': '#4a3728',
      '--hljs-comment': '#9a8a78',
      '--hljs-keyword': '#b45309',
      '--hljs-string': '#16a34a',
      '--hljs-number': '#c2410c',
      '--hljs-title': '#d97706'
    },
    dark: {
      '--bg-primary': '#231e19',
      '--bg-secondary': '#1c1814',
      '--bg-tertiary': '#2a2420',
      '--bg-hover': 'rgba(245, 158, 11, 0.08)',
      '--bg-active': 'rgba(245, 158, 11, 0.2)',
      '--text-primary': '#e8ddd2',
      '--text-secondary': '#b8a898',
      '--text-tertiary': '#887868',
      '--border-color': '#3a3228',
      '--accent': '#f59e0b',
      '--accent-soft': 'rgba(245, 158, 11, 0.18)',
      '--danger': '#f87171',
      '--code-bg': '#2a2420',
      '--hljs-base': '#e0d5c8',
      '--hljs-comment': '#887868',
      '--hljs-keyword': '#fbbf24',
      '--hljs-string': '#4ade80',
      '--hljs-number': '#fb923c',
      '--hljs-title': '#f59e0b'
    }
  },
  {
    id: 'cool',
    name: '冷色',
    light: {
      '--bg-primary': '#f8f9fc',
      '--bg-secondary': '#eef1f8',
      '--bg-tertiary': '#e2e6f0',
      '--bg-hover': 'rgba(99, 102, 241, 0.06)',
      '--bg-active': 'rgba(99, 102, 241, 0.12)',
      '--text-primary': '#1e1b4b',
      '--text-secondary': '#4a4678',
      '--text-tertiary': '#7c78a0',
      '--border-color': '#d8daf0',
      '--accent': '#6366f1',
      '--accent-soft': 'rgba(99, 102, 241, 0.12)',
      '--danger': '#e11d48',
      '--code-bg': '#eaeef8',
      '--hljs-base': '#2e2b5a',
      '--hljs-comment': '#7c78a0',
      '--hljs-keyword': '#7c3aed',
      '--hljs-string': '#0d9488',
      '--hljs-number': '#c026d3',
      '--hljs-title': '#6366f1'
    },
    dark: {
      '--bg-primary': '#17182a',
      '--bg-secondary': '#111222',
      '--bg-tertiary': '#1e1f36',
      '--bg-hover': 'rgba(129, 140, 248, 0.08)',
      '--bg-active': 'rgba(129, 140, 248, 0.2)',
      '--text-primary': '#d8daf0',
      '--text-secondary': '#a0a4c8',
      '--text-tertiary': '#6b6f98',
      '--border-color': '#2a2c48',
      '--accent': '#818cf8',
      '--accent-soft': 'rgba(129, 140, 248, 0.18)',
      '--danger': '#fb7185',
      '--code-bg': '#1e1f36',
      '--hljs-base': '#c8cae8',
      '--hljs-comment': '#6b6f98',
      '--hljs-keyword': '#a78bfa',
      '--hljs-string': '#2dd4bf',
      '--hljs-number': '#e879f9',
      '--hljs-title': '#818cf8'
    }
  },
  {
    id: 'high-contrast',
    name: '高对比度',
    light: {
      '--bg-primary': '#ffffff',
      '--bg-secondary': '#f0f0f0',
      '--bg-tertiary': '#e0e0e0',
      '--bg-hover': 'rgba(0, 0, 0, 0.06)',
      '--bg-active': 'rgba(0, 102, 204, 0.14)',
      '--text-primary': '#000000',
      '--text-secondary': '#333333',
      '--text-tertiary': '#555555',
      '--border-color': '#cccccc',
      '--accent': '#0066cc',
      '--accent-soft': 'rgba(0, 102, 204, 0.12)',
      '--danger': '#cc0000',
      '--code-bg': '#f0f0f0',
      '--hljs-base': '#000000',
      '--hljs-comment': '#666666',
      '--hljs-keyword': '#990099',
      '--hljs-string': '#006600',
      '--hljs-number': '#cc6600',
      '--hljs-title': '#0066cc'
    },
    dark: {
      '--bg-primary': '#0a0a0a',
      '--bg-secondary': '#000000',
      '--bg-tertiary': '#1a1a1a',
      '--bg-hover': 'rgba(255, 255, 255, 0.08)',
      '--bg-active': 'rgba(51, 153, 255, 0.25)',
      '--text-primary': '#ffffff',
      '--text-secondary': '#dddddd',
      '--text-tertiary': '#999999',
      '--border-color': '#444444',
      '--accent': '#3399ff',
      '--accent-soft': 'rgba(51, 153, 255, 0.2)',
      '--danger': '#ff4444',
      '--code-bg': '#141414',
      '--hljs-base': '#ffffff',
      '--hljs-comment': '#888888',
      '--hljs-keyword': '#cc88ff',
      '--hljs-string': '#66cc66',
      '--hljs-number': '#ffaa44',
      '--hljs-title': '#3399ff'
    }
  }
]

export function buildThemeCss(preset: ThemePreset): string {
  const toDecls = (vars: Record<string, string>): string =>
    Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')
  return `:root {\n${toDecls(preset.light)}\n}\nhtml.dark {\n${toDecls(preset.dark)}\n}`
}
