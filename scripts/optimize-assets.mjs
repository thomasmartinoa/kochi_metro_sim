/**
 * Compress the textures inside a GLB with sharp, in place.
 *
 * `gltf-transform optimize --texture-compress webp` would normally do this, but
 * its libvips call fails on these assets ("colourspace: parameter space not
 * set" — a sharp/libvips enum mismatch), while sharp itself reads the very same
 * PNGs happily. So we resize + re-encode here and leave the geometry passes
 * (join / weld / simplify / draco) to the gltf-transform CLI.
 *
 * Run: node scripts/optimize-assets.mjs <in.glb> <out.glb> [maxSize]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const [inPath, outPath, maxArg] = process.argv.slice(2)
const MAX = Number(maxArg || 1024)
if (!inPath || !outPath) {
  console.error('usage: node scripts/optimize-assets.mjs <in.glb> <out.glb> [maxSize]')
  process.exit(1)
}

const buf = readFileSync(inPath)
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')

// --- split the GLB container into its JSON + BIN chunks ---------------------
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
const binHeader = 20 + jsonLen
const binLen = buf.readUInt32LE(binHeader)
const bin = buf.subarray(binHeader + 8, binHeader + 8 + binLen)

const images = json.images ?? []
if (!images.length) {
  writeFileSync(outPath, buf)
  console.log('no images; copied through')
  process.exit(0)
}

// Re-encode every image, then rebuild the buffer with fresh views. Only the
// image bufferViews move; accessor views keep their bytes, so we rebuild all
// views in order and rewrite their offsets.
const newImages = await Promise.all(
  images.map(async (img) => {
    const bv = json.bufferViews[img.bufferView]
    const off = bv.byteOffset ?? 0
    const src = bin.subarray(off, off + bv.byteLength)
    const meta = await sharp(src).metadata()
    // Small images are lookup tables, not photographs: palettes, masks, ramps.
    // Neighbouring texels are unrelated colours, so lossy compression bleeds
    // them into each other. Keep those exact; only photographic maps get q85.
    const lossless = meta.width <= 64 || meta.height <= 64
    const out = await sharp(src)
      .resize(Math.min(meta.width, MAX), Math.min(meta.height, MAX), { fit: 'inside' })
      .webp(lossless ? { lossless: true } : { quality: 85 })
      .toBuffer()
    return { img, data: out, before: src.length }
  }),
)

// --- rebuild BIN: keep non-image views byte-identical, swap image views -----
const imageViewIdx = new Map(newImages.map((n) => [n.img.bufferView, n]))
const chunks = []
let cursor = 0
json.bufferViews.forEach((bv, i) => {
  const replacement = imageViewIdx.get(i)
  const data = replacement
    ? replacement.data
    : bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
  // 4-byte align every view
  const pad = (4 - (cursor % 4)) % 4
  if (pad) {
    chunks.push(Buffer.alloc(pad))
    cursor += pad
  }
  bv.byteOffset = cursor
  bv.byteLength = data.length
  chunks.push(Buffer.from(data))
  cursor += data.length
})
const newBin = Buffer.concat(chunks)
json.buffers[0].byteLength = newBin.length
for (const { img } of newImages) img.mimeType = 'image/webp'
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp'])]
json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_texture_webp'])]
// each texture must point at its image through the webp extension
for (const tex of json.textures ?? []) {
  if (tex.source !== undefined) {
    tex.extensions = { ...(tex.extensions ?? {}), EXT_texture_webp: { source: tex.source } }
    delete tex.source
  }
}

// --- write the GLB back out ------------------------------------------------
const jsonBuf = Buffer.from(JSON.stringify(json))
const jsonPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)
const binPad = Buffer.alloc((4 - (newBin.length % 4)) % 4, 0)
const jsonChunk = Buffer.concat([jsonBuf, jsonPad])
const binChunk = Buffer.concat([newBin, binPad])
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
const jsonHead = Buffer.alloc(8)
jsonHead.writeUInt32LE(jsonChunk.length, 0)
jsonHead.writeUInt32LE(0x4e4f534a, 4)
const binHead = Buffer.alloc(8)
binHead.writeUInt32LE(binChunk.length, 0)
binHead.writeUInt32LE(0x004e4942, 4)
writeFileSync(outPath, Buffer.concat([header, jsonHead, jsonChunk, binHead, binChunk]))

const before = newImages.reduce((a, n) => a + n.before, 0)
const after = newImages.reduce((a, n) => a + n.data.length, 0)
console.log(
  `${images.length} textures ${(before / 1048576).toFixed(1)} -> ${(after / 1048576).toFixed(1)} MB` +
    `  |  glb ${(buf.length / 1048576).toFixed(1)} -> ${(Buffer.byteLength(readFileSync(outPath)) / 1048576).toFixed(1)} MB`,
)
