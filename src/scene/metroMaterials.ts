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
import { COLORS } from '../data/trainset'

/** equirect gradient size — PMREM derives its cube size from width/4 */
const W = 64
const H = 32
/** regenerate once the sky radiance has drifted this far in any channel */
const COLOR_EPS = 0.05
/**
 * How much brighter true daylight is than the palette's display colours.
 * Deliberately modest: the scene already carries its ambient in the hemisphere
 * light, and the metro assets are the only things that also get this sky as an
 * environment. Push it and they get lit roughly twice while the city around
 * them gets lit once, which is exactly how the metro ended up glowing.
 */
const RADIANCE = (sunI: number) => 0.25 + sunI * 0.9

/**
 * Per-glass opacity, by the material names the Blender scene actually uses.
 * Nothing here is physical transmission — see the note in prepareMetroMaterial.
 *
 * The saloon windows are nearly opaque on purpose: the passenger cabin has no
 * modelled interior, so anything you can see through them is empty space.
 * The cab glass is genuinely see-through because there IS a cab behind it.
 */
const GLASS_OPACITY: { test: RegExp; opacity: number; env?: number }[] = [
  { test: /^Glass_bogy$/i, opacity: 0.9 }, // saloon windows — hide the empty shell
  // the windscreen and cab glazing: driven from behind, so it has to be
  // nearly clear, and its sky reflection turned well down or the view out
  // is a milky wash of the sky
  { test: /^(Glass|M_Cockpit_glass)$/i, opacity: 0.2, env: 0.12 },
  { test: /^M_Headlight_glass$/i, opacity: 0.5 },
  { test: /glass/i, opacity: 0.72 }, // any other trainset glazing
]

/**
 * The station's glazed bays. Everything else baked is solid architecture.
 *
 * Its texture is `Glass_Grid_Panel_Transmission_2K` — a **mask**, not a colour
 * map: white where a bay is glazed, black on the mullions between them and on
 * the surrounding cladding. The exporter wired that one image into both base
 * colour and KHR_materials_transmission, which is why it doubles as the panel
 * artwork. Applying a single blanket opacity to the material threw the mask
 * away and made the entire wall see-through, so a trainset at the platform
 * showed through the cladding, windows and all. APPLY_PANE_ALPHA reads the mask
 * back and lets only the panes go translucent.
 */
const STATION_GLAZING = /^Glass_Grid_Panel/i
/** how see-through a glazed pane is; mullions and cladding stay fully opaque */
const PANE_ALPHA = 0.55
/** baked textures already contain their diffuse lighting — a light touch of sky */
const BAKED_ENV = 0.12
/**
 * The sky is here so metal has something to reflect, not as a second helping of
 * ambient. envMapIntensity scales diffuse irradiance as well as specular, and
 * the metro assets are the only things in the scene carrying an environment at
 * all — the city makes do with the hemisphere light. Anything much above this
 * lights the metro roughly twice over and it reads as lit from inside.
 */
const PBR_ENV = 0.4

/**
 * The coach bodywork and roof.
 *
 * "Bogie" here is Indian English for the carriage, not the running gear — the
 * saloon windows are `Glass_bogy` and this geometry spans the full 0.2-4.0 m
 * height of the car. The author gave these panels **metalness 0.9 over a dark
 * grey base**, i.e. polished dark metal, which has almost no diffuse: nearly
 * everything you see on them is reflected environment. That is why the trainset
 * came out charcoal under an ordinary sky, and why PBR_ENV had previously been
 * pushed to 1.7 to force it back to white — at which point the body is a mirror
 * returning ~4x the sky and reads as a glowing slab with no shading at all.
 *
 * A real Metropolis body is painted metal, so it is treated as one here: a
 * dielectric in the KMRL body white. It then shades like every other surface in
 * the scene — bright where the sun lands, darker on the shadowed flank — and
 * needs no exaggerated environment to look right.
 */
const BODY_SIDES = /^M_Bogiemetal$/i
const BODY_ROOF = /^M_Bogiemetal_top$/i
/**
 * The livery white, held back off the palette value. `COLORS.trainBody` is the
 * colour of the paint in a swatch; under an open midday sky a surface that pale
 * sits at the top of the range with nowhere left to go, and the trainset reads
 * as a light source rather than a white thing being lit. Dimming the albedo
 * keeps the highlights on the roof and window surrounds while letting the
 * flanks fall back to a believable grey.
 */
const BODY_DIM = 0.72

const materials = new Set<THREE.MeshStandardMaterial>()
const lastSky = new THREE.Color(-1, -1, -1)
const lastGround = new THREE.Color(-1, -1, -1)

let pmrem: THREE.PMREMGenerator | null = null
let source: THREE.DataTexture | null = null
let target: THREE.WebGLRenderTarget | null = null

const _sky = new THREE.Color()
const _ground = new THREE.Color()
const _row = new THREE.Color()

/** Drive alpha from the glazing mask instead of a single blanket opacity. */
function applyPaneAlpha(m: THREE.MeshStandardMaterial): void {
  m.transparent = true
  m.opacity = 1
  // the mullions come out of the mask fully opaque, so this writes depth like
  // any solid surface and the panes stop being a free window into the platform
  m.depthWrite = true
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPaneAlpha = { value: PANE_ALPHA }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uPaneAlpha;')
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
        // white in the mask = glazed bay, black = mullion or solid cladding
        diffuseColor.a = mix( 1.0, uPaneAlpha, texture2D( map, vMapUv ).g );`,
      )
  }
  m.customProgramCacheKey = () => 'kochi-station-glazing'
}

/** materials whose roughness the weather changes, with their dry value */
const wettable = new Map<THREE.MeshStandardMaterial, number>()
/** how much of the dry roughness a soaking takes away */
const WET_ROUGHNESS = 0.45

/**
 * Wet the metro: roughness comes down on the deck and the bodywork so they
 * pick up a sheen and the sky, the way wet concrete and paint do. `wet` is
 * 0 (dry) to 1 (soaked); cheap to call every frame.
 */
export function setWetness(wet: number): void {
  for (const [m, dry] of wettable) {
    const r = dry * (1 - WET_ROUGHNESS * wet)
    if (Math.abs(m.roughness - r) > 0.002) m.roughness = r
  }
}

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

  // painted bodywork, not polished metal — see BODY_SIDES
  if (BODY_SIDES.test(m.name)) {
    m.color.set(COLORS.trainBody).multiplyScalar(BODY_DIM)
    m.metalness = 0.1
    m.roughness = 0.42
  } else if (BODY_ROOF.test(m.name)) {
    // roofs carry equipment and weather; a shade off the flank's white
    m.color.set('#CDD5D7').multiplyScalar(BODY_DIM)
    m.metalness = 0.15
    m.roughness = 0.55
  }

  if (isBaked) {
    // Station and viaduct. Only the glazed bays see through; the rest is
    // architecture and belongs in the opaque pass.
    if (STATION_GLAZING.test(m.name)) {
      applyPaneAlpha(m)
    } else {
      // The exporter marked the roof arch alphaMode BLEND, but the alpha in its
      // texture never drops below 0.89 — there is nothing there to see through.
      // All it bought was a place in the transparent pass, where it sorted
      // against the glazing by object centre rather than by depth and punched
      // rib-shaped holes clean through the roof, flickering as the camera moved.
      m.transparent = false
      m.opacity = 1
      m.depthWrite = true
    }
  } else if (glass) {
    m.transparent = true
    m.opacity = glass.opacity
    // A pane dense enough to hide what is behind it has to write depth, or the
    // geometry behind it keeps drawing over it and the transparent meshes are
    // left sorting against each other by object centre — an order that flips as
    // the camera moves. Only genuinely see-through glazing (the cab, where
    // there is a modelled cab to look into) skips the depth write.
    m.depthWrite = glass.opacity >= 0.85
  }

  // Baked surfaces keep the metal/roughness maps they were authored with — the
  // roof's glazed panels are glossy on purpose and read as flat black without
  // them. They just get a gentler share of the sky, because their diffuse
  // lighting is already painted into the texture.
  lightWithSky(m, isBaked ? BAKED_ENV : PBR_ENV)
  if (glass?.env !== undefined) {
    m.envMapIntensity = glass.env
    m.roughness = Math.max(m.roughness, 0.25)
    const pm = m as THREE.MeshPhysicalMaterial
    if ('clearcoat' in pm) pm.clearcoat = 0
  }
  // the surfaces the rain lands on
  if (BODY_SIDES.test(m.name) || BODY_ROOF.test(m.name) || /^Bridge_Baked/i.test(m.name) || /^Deck_Base/i.test(m.name)) {
    wettable.set(m, m.roughness)
  }
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
