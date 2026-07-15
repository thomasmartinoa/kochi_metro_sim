/**
 * Convert the aerial overlay exported by scripts/blender_export_overlay.py
 * into the web ground texture + its bounds metadata.
 *
 *   public/textures/kochi-overlay.webp   (<=4096 px, ~5 MB)
 *   src/data/kochi-overlay-meta.json     (bounds consumed by SatGround.tsx)
 *
 * Run: node scripts/export-overlay.mjs <overlay.png>
 * (the matching <overlay.png>.bounds.json must sit next to it)
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/export-overlay.mjs <overlay.png>')
  process.exit(1)
}

// 4096 keeps the ground sharp (~7 m/px over the 31 km sheet) while staying
// within mobile GPU texture limits; raise it for desktop-only builds.
const MAX_PX = 4096
const out = join(root, 'public', 'textures', 'kochi-overlay.webp')

sharp.cache(false)
const meta = await sharp(src, { limitInputPixels: false }).metadata()
await sharp(src, { limitInputPixels: false })
  .resize(MAX_PX, null, { fit: 'inside' })
  .removeAlpha()
  .webp({ quality: 82 })
  .toFile(out)

const outMeta = await sharp(out).metadata()
const bounds = JSON.parse(readFileSync(src + '.bounds.json', 'utf8'))
writeFileSync(
  join(root, 'src', 'data', 'kochi-overlay-meta.json'),
  JSON.stringify(
    {
      ...bounds,
      px: [outMeta.width, outMeta.height],
      source: 'Blosm aerial overlay (authored Blender scene), bounds from Terrain UV fit',
    },
    null,
    1,
  ),
)
console.log(
  `${meta.width}x${meta.height} -> ${outMeta.width}x${outMeta.height} ` +
    `(${(statSync(out).size / 1048576).toFixed(2)} MB)`,
)
console.log(bounds)
