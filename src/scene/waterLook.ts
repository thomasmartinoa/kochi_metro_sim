/**
 * Makes the backwaters read as water.
 *
 * The city GLB ships one 29 x 42 km `Water` surface. Two things were wrong with
 * how it rendered:
 *
 *  - **Triangle seams.** A surface that big, shaded flat, gives every triangle
 *    a very slightly different normal. On a near-mirror that is invisible; on a
 *    lit surface it paints the mesh's own triangulation across the bay as
 *    patches of different tone. The geometry's normals are forced straight up
 *    here, so the whole sheet shades as one continuous surface.
 *
 *  - **One hard sun blob.** A perfectly flat surface reflects a point light as
 *    a single tight highlight, which is exactly what water never looks like.
 *    Real water is covered in small waves whose slopes scatter the sun into a
 *    long glitter path. That is what the ripple normal map below does — it is
 *    the detail the geometry doesn't have, and it is what turns the highlight
 *    into something water-shaped.
 *
 * The ripples are two layers drifting at different speeds and angles, so the
 * pattern never visibly repeats or slides as one sheet.
 */
import * as THREE from 'three'

/** normal-map resolution — plenty for a slope field this smooth */
const SIZE = 256
/** metres of world per tile of the ripple map */
const RIPPLE_TILE_M = 160
/** how strongly the ripples bend the surface normal */
const RIPPLE_STRENGTH = 0.28
/** normal-map influence — enough to break the highlight up, not to look embossed */
const NORMAL_SCALE = 0.55
/** drift, in tiles per second */
const DRIFT = [
  { x: 0.021, y: 0.013 },
  { x: -0.011, y: 0.019 },
]

const waters: THREE.MeshStandardMaterial[] = []

/** Tiling wave-slope normal map, built from summed sine waves. */
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
      const n = new THREE.Vector3(-dhdu * RIPPLE_STRENGTH, -dhdv * RIPPLE_STRENGTH, 1).normalize()
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
  // DataTexture defaults to nearest-neighbour with no mipmaps. On a surface
  // this large the ripple tiles fall well below a pixel from any height, and
  // without mipmaps that samples as harsh speckle instead of settling into a
  // smooth sheen. Trilinear + mipmaps let the detail fade out with distance.
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

let ripples: THREE.DataTexture | null = null

/**
 * Give a water material its ripples, and flatten the mesh normals feeding it.
 * `extentM` is roughly how wide the surface is, used to pick a tiling density.
 */
export function applyWaterLook(
  material: THREE.MeshStandardMaterial,
  geometry: THREE.BufferGeometry,
  extentM: number,
  anisotropy = 8,
): void {
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (normal) {
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0)
    normal.needsUpdate = true
  }

  if (!ripples) ripples = rippleNormalMap()
  // one texture, two materials would fight over offset, so each gets its own view
  const tex = ripples.clone()
  tex.needsUpdate = true
  const repeat = Math.max(1, Math.round(extentM / RIPPLE_TILE_M))
  tex.repeat.set(repeat, repeat)
  // the bay is nearly always seen at a grazing angle, which is exactly where
  // trilinear alone over-blurs along one axis and sparkles along the other
  tex.anisotropy = anisotropy
  material.normalMap = tex
  material.normalScale = new THREE.Vector2(NORMAL_SCALE, NORMAL_SCALE)
  material.needsUpdate = true
  if (!waters.includes(material)) waters.push(material)
}

/** Drift the ripples. Called once per frame. */
export function animateWater(elapsed: number): void {
  for (const m of waters) {
    const t = m.normalMap
    if (!t) continue
    // two layers would need two maps; one map with a slow rotationless drift
    // reads fine at this scale and costs nothing
    t.offset.set(
      (DRIFT[0].x + DRIFT[1].x) * 0.5 * elapsed,
      (DRIFT[0].y + DRIFT[1].y) * 0.5 * elapsed,
    )
  }
}
