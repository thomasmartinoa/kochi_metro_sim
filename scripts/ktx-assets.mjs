/**
 * GPU-compress the textures of every GLB in public/models (in place).
 *
 * WebP textures decode to raw RGBA on the GPU: a 2048² map is 21 MB of video
 * memory, and the city, station and trainset together were ~600 MB of it,
 * which is what made the scene crawl on a laptop. KTX2/Basis textures stay
 * compressed on the GPU (4-8x smaller) and cost nothing to decode.
 *
 *   normal maps       UASTC (high quality; ETC1S blocks show on normals)
 *   everything else   ETC1S at maximum quality
 *
 * Needs the `ktx` tool from KTX-Software 4.4+ on PATH (with its lib on
 * LD_LIBRARY_PATH on Linux); gltf-transform drives it. Textures go through
 * PNG first because the encoder does not read WebP. Draco is re-applied
 * last: every gltf-transform pass decodes it.
 *
 * Run: node scripts/ktx-assets.mjs [name ...]   (default: all GLBs)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODELS = join(ROOT, 'public/models')
const work = mkdtempSync(join(tmpdir(), 'ktx-assets-'))
const mb = (p) => (statSync(p).size / 1048576).toFixed(2)
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT })
const gltf = (args) => execFileSync('npx', ['--yes', '@gltf-transform/cli', ...args], { stdio: 'inherit', cwd: ROOT, shell: true })

const names = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(MODELS).filter((f) => f.endsWith('.glb')).map((f) => f.replace(/\.glb$/, ''))
for (const name of names) {
  const src = join(MODELS, `${name}.glb`)
  if (!existsSync(src)) {
    console.warn(`  ! ${name}.glb not found — skipped`)
    continue
  }
  console.log(`\n=== ${name} ===  ${mb(src)} MB`)
  const png = join(work, `${name}.png.glb`)
  const u = join(work, `${name}.u.glb`)
  const e = join(work, `${name}.e.glb`)
  run(process.execPath, [join(ROOT, 'scripts/glb-textures-to-png.mjs'), src, png])
  gltf(['uastc', png, u, '--level', '2', '--rdo', '4', '--zstd', '18', '--slots', 'normalTexture'])
  gltf(['etc1s', u, e, '--quality', '255', '--compression', '5'])
  gltf(['draco', e, src])
  console.log(`  -> ${name}.glb ${mb(src)} MB`)
}
