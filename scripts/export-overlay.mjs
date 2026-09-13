/**
 * Convert the aerial overlay exported by scripts/blender_export_overlay.py
 * into the web ground texture + its bounds metadata.
 *
 *   public/textures/kochi-overlay.ktx2   (<=4096 px, ~4 MB, Basis-compressed)
 *   src/data/kochi-overlay-meta.json     (bounds consumed by SatGround.tsx)
 *
 * Run: node scripts/export-overlay.mjs <overlay.png>
 * (the matching <overlay.png>.bounds.json must sit next to it; needs the
 * `ktx` tool from KTX-Software 4.4+ on PATH, as scripts/ktx-assets.mjs does)
 *
 * KTX2 rather than WebP because a WebP decodes to raw RGBA on the GPU: this
 * image was 100 MB of texture memory. Basis stays compressed there (~13 MB).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
const out = join(root, 'public', 'textures', 'kochi-overlay.ktx2')
const png = join(tmpdir(), 'kochi-overlay-4096.png')

sharp.cache(false)
const meta = await sharp(src, { limitInputPixels: false }).metadata()
await sharp(src, { limitInputPixels: false })
  .resize(MAX_PX, null, { fit: 'inside' })
  .removeAlpha()
  .png()
  .toFile(png)
execFileSync('ktx', ['create', '--generate-mipmap', '--encode', 'basis-lz', '--clevel', '5', '--qlevel', '255',
  '--assign-tf', 'srgb', '--assign-primaries', 'bt709', '--format', 'R8G8B8_SRGB', '--threads', '8', png, out], { stdio: 'inherit' })

const outMeta = await sharp(png).metadata()
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
