/**
 * Build the authored metro assets end to end:
 *
 *   metro_models.blend  --blender-->  raw GLB (PNG textures)
 *                       --sharp---->  WebP textures in place
 *                       --gltf-tf-->  geometry passes + Draco  ->  public/models
 *                       --gltf-tf-->  simplified -lod copies of the three cars
 *
 * `gltf-transform optimize --texture-compress webp` would normally do the
 * texture step, but its libvips call fails on these images ("colourspace:
 * parameter space not set"), so optimize-assets.mjs does it with sharp and the
 * CLI is left to the geometry.
 *
 * Run: node scripts/build-metro-assets.mjs <metro_models.blend> [blenderExe]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [libArg, blenderArg] = process.argv.slice(2)
if (!libArg) {
  console.error('usage: node scripts/build-metro-assets.mjs <metro_models.blend> [blenderExe]')
  process.exit(1)
}
const LIB = resolve(libArg)

const BLENDER_CANDIDATES = [
  blenderArg,
  'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'blender',
].filter(Boolean)
const BLENDER = BLENDER_CANDIDATES.find((p) => p === 'blender' || existsSync(p))
if (!BLENDER) throw new Error('no Blender executable found')

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'public/models')
const work = mkdtempSync(join(tmpdir(), 'metro-assets-'))
const raw = join(work, 'raw')
mkdirSync(raw, { recursive: true })
mkdirSync(OUT, { recursive: true })

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: 'inherit', shell: false, cwd: ROOT })
// shell: true — on Windows npx is a .cmd, which execFile cannot spawn directly
const gltf = (args) =>
  execFileSync('npx', ['--yes', '@gltf-transform/cli', ...args],
    { stdio: 'inherit', cwd: ROOT, shell: true })
const mb = (p) => (statSync(p).size / 1048576).toFixed(2)

// ---------------------------------------------------------------- 1. Blender
console.log('\n=== blender export ===')
run(BLENDER, ['-b', '--factory-startup', '-P', join(ROOT, 'scripts/blender_export_assets.py'),
  '--', LIB, raw])

const ASSETS = ['metro-span', 'metro-station', 'metro-car0', 'metro-car1', 'metro-car2',
  'metro-cockpit']
const CARS = ['metro-car0', 'metro-car1', 'metro-car2']
/** how much of each car's geometry the distant LOD keeps */
const LOD_RATIO = '0.35'

// -------------------------------------------------- 2. textures + 3. geometry
for (const name of ASSETS) {
  const src = join(raw, `${name}.glb`)
  if (!existsSync(src)) {
    console.warn(`  ! ${name}.glb not produced by Blender — skipped`)
    continue
  }
  console.log(`\n=== ${name} ===  blender ${mb(src)} MB`)
  const webp = join(work, `${name}.webp.glb`)
  run(process.execPath, [join(ROOT, 'scripts/optimize-assets.mjs'), src, webp, '1024'])
  const out = join(OUT, `${name}.glb`)
  gltf(['optimize', webp, out, '--compress', 'draco',
    '--texture-compress', 'false', '--simplify', 'false'])
  console.log(`  -> ${name}.glb ${mb(out)} MB`)
}

// ------------------------------------------------------------------ 4. LODs
for (const name of CARS) {
  const src = join(OUT, `${name}.glb`)
  if (!existsSync(src)) continue
  const out = join(OUT, `${name}-lod.glb`)
  console.log(`\n=== ${name}-lod ===`)
  // simplify decodes Draco and writes plain buffers, so re-compress afterwards
  // or the "cheap" LOD ships several times larger than the full-detail car
  const plain = join(work, `${name}-lod.plain.glb`)
  gltf(['simplify', src, plain, '--ratio', LOD_RATIO, '--error', '0.01'])
  gltf(['draco', plain, out])
  console.log(`  -> ${name}-lod.glb ${mb(out)} MB`)
}

rmSync(work, { recursive: true, force: true })
console.log('\ndone. Bump the ?v= cache keys in Line3D.tsx / MetroTrain.tsx.')
