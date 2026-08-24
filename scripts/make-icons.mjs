/**
 * Generate the PWA icons referenced by the manifest.
 *
 * Hand-rolled rather than pulling in an image library: these are two flat-colour squares
 * with a letterform, and adding `sharp` (a native binary, ~10 MB) to the dev dependencies
 * to draw them would be a poor trade.
 *
 * Replace the output with real artwork whenever branding exists — the manifest paths are
 * what matter, and they will not change.
 *
 * Usage: node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const BRAND = [49, 46, 129] // #312e81, matching theme_color
const INK = [255, 255, 255]

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/** `pixel(x, y)` returns [r, g, b]. */
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y)
      raw[offset++] = r
      raw[offset++] = g
      raw[offset++] = b
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A blocky "H" on the brand colour. Kept well inside the frame so it survives the
 * ~20% crop a maskable icon takes on Android.
 */
function haflawayMark(size) {
  const inset = size * 0.28
  const barWidth = size * 0.1
  const left = inset
  const right = size - inset
  const top = inset
  const bottom = size - inset
  const midTop = size / 2 - barWidth / 2
  const midBottom = size / 2 + barWidth / 2

  return (x, y) => {
    const inVertical =
      y >= top && y <= bottom && ((x >= left && x <= left + barWidth) || (x >= right - barWidth && x <= right))
    const inCrossbar = x >= left && x <= right && y >= midTop && y <= midBottom
    return inVertical || inCrossbar ? INK : BRAND
  }
}

const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))

for (const size of [192, 512]) {
  const file = out(`pwa-${size}.png`)
  writeFileSync(file, png(size, haflawayMark(size)))
  console.log(`  wrote public/pwa-${size}.png (${size}x${size})`)
}

console.log('Done. Replace these with real artwork when branding exists.')
