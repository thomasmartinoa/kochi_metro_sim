/**
 * Drop every UV set but the first from a GLB, in place.
 *
 * The cab's meshes carry three UV layers from Blender; only UVMap is mapped.
 * `gltf-transform optimize --prune-attributes false` (which the cab needs, or
 * its untextured screens lose their UVs) would otherwise keep all three.
 *
 * Run: node scripts/strip-extra-uvs.mjs <file.glb>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [path] = process.argv.slice(2)
if (!path) {
  console.error('usage: node scripts/strip-extra-uvs.mjs <file.glb>')
  process.exit(1)
}
const buf = readFileSync(path)
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
let dropped = 0
for (const mesh of json.meshes ?? []) {
  for (const prim of mesh.primitives) {
    for (const key of Object.keys(prim.attributes)) {
      if (/^TEXCOORD_[1-9]/.test(key)) {
        delete prim.attributes[key]
        dropped++
      }
    }
  }
}
// rewrite the JSON chunk; the BIN chunk is untouched (the orphaned accessors
// are pruned by the optimize pass that follows)
const text = Buffer.from(JSON.stringify(json))
const pad = (4 - (text.length % 4)) % 4
const chunk = Buffer.concat([text, Buffer.alloc(pad, 0x20)])
const rest = buf.subarray(20 + jsonLen)
const out = Buffer.alloc(20 + chunk.length + rest.length)
out.write('glTF', 0)
out.writeUInt32LE(2, 4)
out.writeUInt32LE(out.length, 8)
out.writeUInt32LE(chunk.length, 12)
out.writeUInt32LE(0x4e4f534a, 16)
chunk.copy(out, 20)
rest.copy(out, 20 + chunk.length)
writeFileSync(path, out)
console.log(`dropped ${dropped} extra UV sets`)
