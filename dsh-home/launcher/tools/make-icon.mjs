#!/usr/bin/env node
/**
 * 生成桌面快捷方式用的 dsh.ico
 * ---------------------------------------------------------------------------
 * 把 @deepseek-ai/dsh-web-frontend 里的鲸鱼 logo（favicon.svg）渲染成
 * 多尺寸 PNG，再打包成 ICO（Vista+ 支持的 PNG 压缩 ICO，Windows 10/11 正常显示）。
 * 版本更新后如果要重画图标，重新跑一次即可：
 *     node tools/make-icon.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const RUNTIME = path.join(HERE, 'runtime')
const SVG_SOURCE = path.join(
  RUNTIME,
  'node_modules',
  '@deepseek-ai',
  'dsh-web-frontend',
  'dist',
  'favicon.svg'
)
const OUT_ICO = path.join(HERE, 'dsh.ico')

const SIZES = [16, 32, 48, 64, 128, 256]
const TILE_COLOR = '#4D6BFE' // DeepSeek 品牌蓝
const GLYPH_COLOR = '#FFFFFF'

function loadSharp() {
  const require = createRequire(path.join(RUNTIME, 'index.js'))
  return require('sharp')
}

/** 从官方 favicon.svg 里取出鲸鱼那条 path 的 d 属性，保证用的是官方图形。 */
function extractWhalePath(svg) {
  const match = svg.match(/\sd="([^"]+)"/u)
  if (match === null) throw new Error('favicon.svg 里找不到 path 的 d 属性')
  return match[1]
}

/** 蓝底圆角方块 + 居中白色鲸鱼。 */
function buildTileSvg(whalePath, size) {
  const pad = size * 0.16
  const inner = size - pad * 2
  const scale = inner / 50 // 官方 viewBox 是 0 0 50 50
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${TILE_COLOR}"/>
<g transform="translate(${pad} ${pad}) scale(${scale})">
<path d="${whalePath}" fill="${GLYPH_COLOR}"/>
</g>
</svg>`
}

/** 把若干张 PNG 打成一个 ICO（每张都以 PNG 形式内嵌）。 */
function packIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(images.length * 16)
  let offset = 6 + images.length * 16
  images.forEach((image, index) => {
    const entry = index * 16
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 0) // width
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1) // height
    directory.writeUInt8(0, entry + 2) // palette
    directory.writeUInt8(0, entry + 3) // reserved
    directory.writeUInt16LE(1, entry + 4) // color planes
    directory.writeUInt16LE(32, entry + 6) // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += image.data.length
  })

  return Buffer.concat([header, directory, ...images.map((i) => i.data)])
}

async function main() {
  const sharp = loadSharp()
  if (!fs.existsSync(SVG_SOURCE)) throw new Error(`找不到源 logo：${SVG_SOURCE}`)
  const whalePath = extractWhalePath(fs.readFileSync(SVG_SOURCE, 'utf8'))

  const images = []
  for (const size of SIZES) {
    const svg = Buffer.from(buildTileSvg(whalePath, size))
    // eslint-disable-next-line no-await-in-loop
    const data = await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
    images.push({ size, data })
    console.log(`  ${size}x${size}  ${data.length} bytes`)
  }

  fs.writeFileSync(OUT_ICO, packIco(images))
  console.log(`\n已写入 ${OUT_ICO}  (${fs.statSync(OUT_ICO).size} bytes)`)
}

main().catch((error) => {
  console.error(`生成图标失败：${error.message}`)
  process.exitCode = 1
})
