/**
 * Re-encode every image in a GLB as PNG, in place of whatever it was (WebP,
 * here). The KTX2 encoder behind `gltf-transform uastc/etc1s` reads PNG and
 * JPEG only, so this is the step before GPU texture compression.
 *
 * Run: node scripts/glb-textures-to-png.mjs <in.glb> <out.glb>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('usage: node scripts/glb-textures-to-png.mjs <in.glb> <out.glb>')
  process.exit(1)
}
const buf = readFileSync(inPath)
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
const binHeader = 20 + jsonLen
const binLen = buf.readUInt32LE(binHeader)
const bin = buf.subarray(binHeader + 8, binHeader + 8 + binLen)
const images = json.images ?? []
const replaced = new Map()
for (const img of images) {
  const bv = json.bufferViews[img.bufferView]
  const off = bv.byteOffset ?? 0
  const src = bin.subarray(off, off + bv.byteLength)
  replaced.set(img.bufferView, await sharp(src).png({ compressionLevel: 6 }).toBuffer())
  img.mimeType = 'image/png'
}
const chunks = []
let cursor = 0
json.bufferViews.forEach((bv, i) => {
  const data = replaced.get(i) ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
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
const binPad = (4 - (newBin.length % 4)) % 4
json.buffers[0].byteLength = newBin.length + binPad
const jsonBuf = Buffer.from(JSON.stringify(json))
const jsonPad = (4 - (jsonBuf.length % 4)) % 4
const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + newBin.length + binPad
const out = Buffer.alloc(total)
out.write('glTF', 0)
out.writeUInt32LE(2, 4)
out.writeUInt32LE(total, 8)
out.writeUInt32LE(jsonBuf.length + jsonPad, 12)
out.writeUInt32LE(0x4e4f534a, 16)
jsonBuf.copy(out, 20)
out.fill(0x20, 20 + jsonBuf.length, 20 + jsonBuf.length + jsonPad)
const binStart = 20 + jsonBuf.length + jsonPad
out.writeUInt32LE(newBin.length + binPad, binStart)
out.writeUInt32LE(0x004e4942, binStart + 4)
newBin.copy(out, binStart + 8)
writeFileSync(outPath, out)
console.log(`${images.length} images -> png; glb ${(buf.length / 1048576).toFixed(1)} -> ${(out.length / 1048576).toFixed(1)} MB`)
