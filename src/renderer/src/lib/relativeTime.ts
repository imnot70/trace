const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [30, 'day'],
  [12, 'month'],
  [Infinity, 'year']
]

export function formatRelativeTime(iso: string): string {
  let diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return '刚刚'
  for (const [limit, unit] of thresholds) {
    if (diff < limit) return rtf.format(-Math.floor(diff), unit)
    diff /= limit
  }
  return '很久以前'
}
