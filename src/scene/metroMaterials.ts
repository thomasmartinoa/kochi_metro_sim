/**
 * Makes the authored metro assets render correctly in this scene.
 *
 * Two different kinds of material arrive from Blender and they want opposite
 * treatment, so everything that touches them lives here:
 *
 *   the trainset      a real PBR asset — its glazing, chrome and painted
 *                     bodywork carry genuine metalness. Metal reflects; with
 *                     nothing to reflect it renders black, which is why the
 *                     trainset first came out charcoal instead of KMRL white.
 *                     It needs an environment.
 *
 *   station + span    lighting already baked into the textures (`*_Baked_Mat`).
 *                     Lighting them again — as metal, under a bright
 *                     environment — is what blew them out into a glowing cyan
 *                     block. They want to be treated as near-unlit.
 *
 * The Blender export also wrote KHR_materials_transmission at full strength on
 * the station's roof arch and its glazing. In three that is physical
 * transmission: the arched roof lost its colour completely and the glass all
 * but vanished. Only the glazing should see through at all, and as a plain
 * translucent panel rather than transmission.
 *
 * The environment itself is a small PMREM built from the current sky colour.
 * Two things it has to get right or metals stay black:
 *   - **Linear, not sRGB.** THREE.Color holds linear values; writing them into
 *     an sRGB-tagged texture converts twice and costs most of the light.
 *   - **Radiance, not display colour.** Atmosphere's KEYS are what the sky
 *     should *look* like, roughly 0-1. Daylight is several times that, and a
 *     rough metal returns only a fraction of what it receives.
 */
import * as THREE from 'three'

/** equirect gradient size — PMREM derives its cube size from width/4 */
const W = 64
const H = 32
/** regenerate once the sky radiance has drifted this far in any channel */
const COLOR_EPS = 0.05
/** how much brighter true daylight is than the palette's display colours */
const RADIANCE = (sunI: number) => 0.35 + sunI * 1.5

/**
 * Per-glass opacity, by the material names the Blender scene actually uses.
 * Nothing here is physical transmission — see the note in prepareMetroMaterial.
 *
 * The saloon windows are nearly opaque on purpose: the passenger cabin has no
 * modelled interior, so anything you can see through them is empty space.
 * The cab glass is genuinely see-through because there IS a cab behind it.
 */
const GLASS_OPACITY: { test: RegExp; opacity: number }[] = [
  { test: /^Glass_bogy$/i, opacity: 0.9 }, // saloon windows — hide the empty shell
  { test: /^(Glass|M_Cockpit_glass|M_Headlight_glass)$/i, opacity: 0.5 }, // cab + door glazing
  { test: /glass/i, opacity: 0.72 }, // station grid panels and anything else
]
/** baked textures already contain their diffuse lighting — a light touch of sky */
const BAKED_ENV = 0.4
/**
 * >1 on purpose. The trainset's bodywork is authored at metalness ~1, and a
 * fully rough metal returns only a fraction of what it receives, so it needs
 * markedly more sky than the baked assets before it reads as the sunlit white
 * it should be. Tuned against the viaduct beside it.
 */
const PBR_ENV = 1.7

const materials = new Set<THREE.MeshStandardMaterial>()
const lastSky = new THREE.Color(-1, -1, -1)
const lastGround = new THREE.Color(-1, -1, -1)

let pmrem: THREE.PMREMGenerator | null = null
let source: THREE.DataTexture | null = null
let target: THREE.WebGLRenderTarget | null = null

const _sky = new THREE.Color()
const _ground = new THREE.Color()
const _row = new THREE.Color()

/**
 * Light a material with the sky environment at the given strength. Idempotent.
 * Used on its own for anything that just wants a sky to reflect — the city's
 * backwaters — and internally by prepareMetroMaterial.
 */
export function lightWithSky(material: THREE.Material, intensity: number): void {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return
  const m = material as THREE.MeshStandardMaterial
  m.envMapIntensity = intensity
  if (materials.has(m)) return
  materials.add(m)
  if (target) {
    m.envMap = target.texture
    m.needsUpdate = true
  }
}

/**
 * Normalise one material off an authored metro GLB and light it with the sky.
 * Idempotent — safe to call for every mesh of every load.
 */
export function prepareMetroMaterial(material: THREE.Material): void {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return
  const m = material as THREE.MeshStandardMaterial
  if (materials.has(m)) return

  const phys = m as THREE.MeshPhysicalMaterial
  const glass = GLASS_OPACITY.find((g) => g.test.test(m.name))
  const isBaked = /_baked_mat$/i.test(m.name)

  // Never physical transmission. The export writes KHR_materials_transmission
  // at full strength onto anything the author gave a Transmission Weight —
  // including the station's roof arch, whose mask only marks *part* of it as
  // glass. In three that is all-or-nothing see-through, so the roof lost its
  // colour entirely. Glazing is done as plain translucency instead.
  if (phys.transmission > 0) phys.transmission = 0

  if (glass) {
    m.transparent = true
    m.opacity = glass.opacity
    // panels are double-sided, so two layers stack; skipping depth writes stops
    // them occluding each other, but only where enough light gets through to
    // notice — a near-opaque pane is better off sorting normally
    m.depthWrite = glass.opacity >= 0.85
  }

  // Baked surfaces keep the metal/roughness maps they were authored with — the
  // roof's glazed panels are glossy on purpose and read as flat black without
  // them. They just get a gentler share of the sky, because their diffuse
  // lighting is already painted into the texture.
  lightWithSky(m, isBaked ? BAKED_ENV : PBR_ENV)
  m.needsUpdate = true
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
  const radiance = RADIANCE(sunI)
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
