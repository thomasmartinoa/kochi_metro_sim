/**
 * A small pre-filtered environment map built from the current sky colour.
 *
 * The authored metro models (train, viaduct, station) are real PBR assets:
 * their glazing, chrome and painted bodywork carry genuine metalness, and a
 * metal with nothing to reflect renders black — the trainset came out charcoal
 * instead of KMRL white-and-teal. The rest of the world (procedural city,
 * boats, ground) is hand-authored non-metal and already looks right under the
 * sun + hemisphere rig, so this is handed to the metro materials alone rather
 * than being set as `scene.environment`, which would relight everything.
 *
 * Two things this has to get right or metals stay black:
 *
 *  - **Linear, not sRGB.** `THREE.Color` holds linear values, so writing them
 *    into an sRGB-tagged texture converts twice and costs most of the light.
 *    The source is a float texture in the working (linear) space.
 *  - **Radiance, not display colour.** The KEYS palette in Atmosphere is what
 *    the sky should *look* like, roughly 0-1. Real daylight is several times
 *    that, and a rough metal only returns a fraction of what it receives, so a
 *    0-1 sky leaves it far darker than the sun-lit surfaces around it. The
 *    colour is scaled to daylight strength before filtering.
 *
 * The source is a 64x32 equirect vertical gradient (sky over ground); PMREM
 * blurs it into roughness mips, so anything more detailed would be thrown away.
 * Regeneration is throttled to real colour movement.
 */
import * as THREE from 'three'

/** equirect gradient size — PMREM derives its cube size from width/4 */
const W = 64
const H = 32
/** regenerate once the sky radiance has drifted this far in any channel */
const COLOR_EPS = 0.05

const materials = new Set<THREE.MeshStandardMaterial>()
const lastSky = new THREE.Color(-1, -1, -1)
const lastGround = new THREE.Color(-1, -1, -1)

let pmrem: THREE.PMREMGenerator | null = null
let source: THREE.DataTexture | null = null
let target: THREE.WebGLRenderTarget | null = null

const _sky = new THREE.Color()
const _ground = new THREE.Color()
const _row = new THREE.Color()

/** Ask for this material to be lit by the sky env (idempotent). */
export function useSkyEnv(material: THREE.Material): void {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return
  const m = material as THREE.MeshStandardMaterial
  if (materials.has(m)) return
  materials.add(m)
  if (target) {
    m.envMap = target.texture
    m.needsUpdate = true
  }
}

function writeGradient(sky: THREE.Color, ground: THREE.Color): void {
  const data = source!.image.data as Float32Array
  for (let y = 0; y < H; y++) {
    // v runs top (sky) -> bottom (ground), with a soft horizon across the middle
    const t = THREE.MathUtils.smoothstep(y / (H - 1), 0.44, 0.6)
    _row.copy(sky).lerp(ground, t)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      data[i] = _row.r
      data[i + 1] = _row.g
      data[i + 2] = _row.b
      data[i + 3] = 1
    }
  }
  source!.needsUpdate = true
}

/**
 * Refresh the environment for the current sky. `sunI` is the directional
 * light's intensity — it carries the day/night cycle into the sky's radiance so
 * metals go dark at night with everything else. Cheap to call every frame: it
 * only re-runs PMREM when the result would actually change.
 */
export function updateSkyEnv(
  gl: THREE.WebGLRenderer,
  sky: THREE.Color,
  fog: THREE.Color,
  sunI: number,
): void {
  // display colour -> rough daylight radiance (see the header note)
  const radiance = 0.45 + sunI * 2.6
  _sky.copy(sky).multiplyScalar(radiance)
  // below the horizon the metro sees hazy ground, not sky: darker and duller
  _ground.copy(fog).multiplyScalar(radiance * 0.4)
  if (
    Math.abs(_sky.r - lastSky.r) < COLOR_EPS &&
    Math.abs(_sky.g - lastSky.g) < COLOR_EPS &&
    Math.abs(_sky.b - lastSky.b) < COLOR_EPS &&
    Math.abs(_ground.r - lastGround.r) < COLOR_EPS &&
    Math.abs(_ground.g - lastGround.g) < COLOR_EPS &&
    Math.abs(_ground.b - lastGround.b) < COLOR_EPS
  ) {
    return
  }
  lastSky.copy(_sky)
  lastGround.copy(_ground)

  if (!source) {
    source = new THREE.DataTexture(
      new Float32Array(W * H * 4),
      W,
      H,
      THREE.RGBAFormat,
      THREE.FloatType,
    )
    // already in the working colour space — do NOT tag this sRGB
    source.colorSpace = THREE.LinearSRGBColorSpace
    source.mapping = THREE.EquirectangularReflectionMapping
  }
  writeGradient(_sky, _ground)

  if (!pmrem) {
    pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
  }
  const prev = target
  target = pmrem.fromEquirectangular(source)
  prev?.dispose()

  for (const m of materials) {
    if (m.envMap === target.texture) continue
    m.envMap = target.texture
    m.needsUpdate = true
  }
}
