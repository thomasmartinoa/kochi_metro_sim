/**
 * Makes the backwaters read as water.
 *
 * The city GLB ships one 29 x 42 km `Water` surface, authored with a real
 * photographed wave normal map (`water 0342normal`, 512px, in the GLB) and
 * planar UVs laid down by the export script at WATER_TILE = 30 m per UV unit.
 *
 * **Why the ripples were invisible.** The UVs already carry that 30 m tiling —
 * they run to roughly +/-500 in u and +/-740 in v, not 0..1. This module used
 * to assume 0..1 and set `repeat = extent / tile`, which came out at 261. On
 * top of UVs that were already in units of 30 m, that put one tile of the
 * ripple map every **11.5 cm** across a 42 km bay. From any camera height that
 * is far below one pixel, so every mipmap sample averaged the whole wave field
 * back to a flat (0,0,1) normal and the surface shaded as if it had no normal
 * map at all. The map was being sampled the whole time; it just could not
 * survive the trip through the mip chain.
 *
 * So the tiling is now derived from the mesh itself — world metres spanned per
 * UV unit — instead of assumed. If the export script's WATER_TILE ever changes,
 * this follows it.
 *
 * The rest is what turns a lit plane into water:
 *
 *  - **Two layers, not one.** A single scrolling layer slides across the bay as
 *    one visible sheet. The shader samples the same map twice, the second finer,
 *    rotated off-axis and drifting the other way, so the two never line up.
 *
 *  - **Fresnel.** Water you look straight down into shows what is under it —
 *    here the aerial imagery, which is where the bay's real colour and shoreline
 *    come from. Seen at a grazing angle it becomes a sky mirror instead. A
 *    constant opacity gave every angle the same milky wash.
 *
 *  - **Flat geometry normals.** A surface this big, shaded flat, gives every
 *    triangle a slightly different normal and paints its own triangulation
 *    across the bay as patches of tone. Forced straight up, it shades as one
 *    continuous sheet and the normal map supplies all the detail.
 */
import * as THREE from 'three'

/** procedural fallback resolution, only used if a material arrives with no map */
const SIZE = 256
/** metres of world per tile of the base ripple layer */
const RIPPLE_TILE_M = 64
/** the second layer is this much finer than the base */
const DETAIL_SCALE = 3.7
/** how much slope the second layer adds on top of the base */
const DETAIL_WEIGHT = 0.5
/** normal-map influence — enough to break the highlight up, not to look embossed */
const NORMAL_SCALE = 0.6
/** alpha looking straight down into the water, and at a grazing angle */
const ALPHA_FACING = 0.45
const ALPHA_GRAZING = 0.85
/** how fast reflectivity climbs toward grazing (3 reads well; true Schlick is 5) */
const FRESNEL_POWER = 3.0
/** drift of each layer, in tiles per second */
const DRIFT = { x: 0.011, y: 0.007 }
const DETAIL_DRIFT = { x: -0.028, y: 0.018 }

/**
 * Replaces three's `<normal_fragment_maps>`. Same job — take the tangent-space
 * normal map to a shaded normal — but sampling twice, and driving alpha off the
 * result so the ripples modulate reflectivity too.
 */
const WATER_NORMAL_CHUNK = /* glsl */ `
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  // second layer: finer, rotated ~37 degrees off the base and drifting the
  // other way, so the pair never resolves into one sliding sheet
  vec2 detailUv = mat2( 0.80, -0.60, 0.60, 0.80 ) * vNormalMapUv * uDetail + uDetailDrift;
  vec3 detailN = texture2D( normalMap, detailUv ).xyz * 2.0 - 1.0;
  mapN = vec3( mapN.xy + detailN.xy * uDetailWeight, mapN.z );
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );

  // fresnel: see-through looking down, sky mirror at a grazing angle
  float waterFacing = saturate( abs( dot( normalize( vViewPosition ), normal ) ) );
  diffuseColor.a = mix( uFresnel.y, uFresnel.x, pow( waterFacing, uFresnel.z ) );
`

interface Water {
  material: THREE.MeshStandardMaterial
  /** live uniform values, mutated per frame by animateWater */
  baseDrift: THREE.Vector2
  detailDrift: THREE.Vector2
}

const waters: Water[] = []

/** Tiling wave-slope normal map, built from summed sine waves. Fallback only. */
function rippleNormalMap(): THREE.DataTexture {
  // integer frequencies keep the pattern seamless across tile edges
  const waves = [
    { fx: 1, fy: 2, amp: 1.0, phase: 0.0 },
    { fx: 3, fy: -1, amp: 0.6, phase: 1.7 },
    { fx: -2, fy: 4, amp: 0.4, phase: 3.1 },
    { fx: 5, fy: 3, amp: 0.22, phase: 0.8 },
    { fx: -6, fy: 2, amp: 0.16, phase: 2.4 },
    { fx: 7, fy: -5, amp: 0.1, phase: 5.0 },
  ]
  const height = (u: number, v: number) => {
    let h = 0
    for (const w of waves) {
      h += w.amp * Math.sin(2 * Math.PI * (w.fx * u + w.fy * v) + w.phase)
    }
    return h
  }

  const data = new Uint8Array(SIZE * SIZE * 4)
  const d = 1 / SIZE
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE
      const v = y / SIZE
      // central differences -> surface slope -> tangent-space normal
      const dhdu = (height(u + d, v) - height(u - d, v)) / (2 * d)
      const dhdv = (height(u, v + d) - height(u, v - d)) / (2 * d)
      const n = new THREE.Vector3(-dhdu * 0.28, -dhdv * 0.28, 1).normalize()
      const i = (y * SIZE + x) * 4
      data[i] = (n.x * 0.5 + 0.5) * 255
      data[i + 1] = (n.y * 0.5 + 0.5) * 255
      data[i + 2] = (n.z * 0.5 + 0.5) * 255
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.NoColorSpace // a normal map is data, not colour
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

let fallback: THREE.DataTexture | null = null

/**
 * World metres spanned by one unit of UV, measured off the mesh. The export
 * script lays planar UVs down as `position / WATER_TILE`, so this recovers
 * WATER_TILE without this module having to know it. Returns null if the mesh
 * has no usable UVs.
 */
function metresPerUv(geometry: THREE.BufferGeometry): number | null {
  const uv = geometry.getAttribute('uv')
  const pos = geometry.getAttribute('position')
  if (!uv || !pos) return null

  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    if (u < uMin) uMin = u
    if (u > uMax) uMax = u
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
  }
  const uSpan = uMax - uMin
  const vSpan = vMax - vMin
  if (!(uSpan > 1e-6) || !(vSpan > 1e-6)) return null

  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const bb = geometry.boundingBox!
  // planar UVs map world x -> u and world z -> v (up to sign), so either axis
  // recovers the same scale; average them so a slight anisotropy can't skew it
  return ((bb.max.x - bb.min.x) / uSpan + (bb.max.z - bb.min.z) / vSpan) / 2
}

/** Sample the ripple map twice and drive alpha off the result. */
function installWaterShader(m: THREE.MeshStandardMaterial, w: Water): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: DETAIL_SCALE }
    shader.uniforms.uDetailDrift = { value: w.detailDrift }
    shader.uniforms.uDetailWeight = { value: DETAIL_WEIGHT }
    shader.uniforms.uFresnel = {
      value: new THREE.Vector3(ALPHA_FACING, ALPHA_GRAZING, FRESNEL_POWER),
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDetail;
        uniform vec2 uDetailDrift;
        uniform float uDetailWeight;
        uniform vec3 uFresnel;`,
      )
      .replace('#include <normal_fragment_maps>', WATER_NORMAL_CHUNK)
  }
  // this material's program is not interchangeable with a stock standard one
  m.customProgramCacheKey = () => 'kochi-water'
}

/**
 * Give a water material its ripples, and flatten the mesh normals feeding it.
 * `extentM` is roughly how wide the surface is — only used as a fallback if the
 * mesh turns out to have no usable UVs to measure.
 */
export function applyWaterLook(
  material: THREE.MeshStandardMaterial,
  geometry: THREE.BufferGeometry,
  extentM: number,
  anisotropy = 8,
): void {
  if (waters.some((w) => w.material === material)) return

  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (normal) {
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0)
    normal.needsUpdate = true
  }

  // prefer the wave normal the GLB was authored with; only synthesise one if
  // the material arrived without any
  let tex = material.normalMap
  if (!tex) {
    if (!fallback) fallback = rippleNormalMap()
    tex = fallback
  }
  // one texture shared by two materials would fight over offset — each gets
  // its own view of the same image
  tex = tex.clone()
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.NoColorSpace

  const mPerUv = metresPerUv(geometry)
  // UVs already carry a tiling (metres per UV unit); repeat only has to carry
  // it the rest of the way to RIPPLE_TILE_M. Without UVs, fall back to
  // assuming they span 0..1 across the whole surface.
  tex.repeat.setScalar(mPerUv ? mPerUv / RIPPLE_TILE_M : Math.max(1, extentM / RIPPLE_TILE_M))
  // the bay is nearly always seen at a grazing angle, which is exactly where
  // trilinear alone over-blurs along one axis and sparkles along the other
  tex.anisotropy = anisotropy
  tex.needsUpdate = true

  material.normalMap = tex
  material.normalScale = new THREE.Vector2(NORMAL_SCALE, NORMAL_SCALE)
  // alpha is driven per-pixel by the fresnel term in the shader, but the
  // material still has to be in the transparent pass for it to blend at all
  material.transparent = true
  material.depthWrite = true

  const w: Water = {
    material,
    baseDrift: tex.offset,
    detailDrift: new THREE.Vector2(),
  }
  installWaterShader(material, w)
  material.needsUpdate = true
  waters.push(w)
}

/** Drift both ripple layers. Called once per frame. */
export function animateWater(elapsed: number): void {
  for (const w of waters) {
    w.baseDrift.set(DRIFT.x * elapsed, DRIFT.y * elapsed)
    w.detailDrift.set(DETAIL_DRIFT.x * elapsed, DETAIL_DRIFT.y * elapsed)
  }
}
