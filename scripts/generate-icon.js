/**
 * 生成应用图标 build/icon.png（512x512）。
 * 纯 Node 实现 PNG 编码（zlib + CRC32），无需图像库。
 * 造型：渐变圆角方块 + 一道白色"笔迹"斜笔，呼应「Trace 笔迹」。
 *
 * 用法：node scripts/generate-icon.js
 */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 512
const RADIUS = 116

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

/** 圆角矩形内判定（带 1px 抗锯齿过渡） */
function roundedRectSdf(x, y, half, radius) {
  const qx = Math.abs(x) - half + radius
  const qy = Math.abs(y) - half + radius
  const dx = Math.max(qx, 0)
  const dy = Math.max(qy, 0)
  return Math.sqrt(dx * dx + dy * dy) + Math.min(Math.max(qx, qy), 0) - radius
}

/** 点到线段距离 */
function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby), 0, 1)
  const cx = ax + abx * t
  const cy = ay + aby * t
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const nx = x - SIZE / 2
    const ny = y - SIZE / 2

    // 背景渐变：左上 #4078D3 → 右下 #7A5CD0
    const t = (x / SIZE + y / SIZE) / 2
    let r = Math.round(64 + (122 - 64) * t)
    let g = Math.round(120 + (92 - 120) * t)
    let b = Math.round(211 + (208 - 211) * t)
    let a = 255

    // 圆角裁切（边缘 1px 渐隐）
    const sdf = roundedRectSdf(nx, ny, SIZE / 2, RADIUS)
    if (sdf > 1) {
      a = 0
    } else if (sdf > -1) {
      a = Math.round(255 * (1 - (sdf + 1) / 2))
    }

    // 白色斜笔（圆头粗线）
    const d1 = distToSegment(x, y, 150, 356, 300, 205)
    // 收尾的短笔（右上）
    const d2 = distToSegment(x, y, 322, 183, 372, 133)
    const stroke = Math.min(d1, d2)
    if (a > 0 && stroke < 30) {
      const mix = stroke < 27 ? 1 : (30 - stroke) / 3
      r = Math.round(r * (1 - mix) + 255 * mix)
      g = Math.round(g * (1 - mix) + 255 * mix)
      b = Math.round(b * (1 - mix) + 255 * mix)
    }

    const idx = (y * SIZE + x) * 4
    pixels[idx] = r
    pixels[idx + 1] = g
    pixels[idx + 2] = b
    pixels[idx + 3] = a
  }
}

// ---- PNG 编码 ----
function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA

// 每行前置 filter 字节 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = path.join(__dirname, '..', 'build', 'icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
console.log(`icon written: ${out} (${png.length} bytes)`)
