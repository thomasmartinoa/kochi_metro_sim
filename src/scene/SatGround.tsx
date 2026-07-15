/**
 * Aerial-imagery ground plane. The image is the Blosm aerial overlay lifted
 * off the (flat, zero-elevation) terrain of the authored Blender scene and
 * re-exported for web by scripts/blender_export_city_v2.py's prep step; its
 * bounds come from that terrain's UV->world fit (src/data/kochi-overlay-meta).
 *
 * Sits just below the building base so buildings/roads render on top of the
 * real photograph. Depth precision across the 1 m..60 km view range is handled
 * globally by the canvas's logarithmic depth buffer (see World.tsx).
 */
import { useTexture } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import meta from '../data/kochi-overlay-meta.json'
import { project } from '../sim/projection'

const OVERLAY_URL = '/textures/kochi-overlay.webp'
/** Just under the building base (y=0): clear of it, but not so low the
 *  buildings read as floating at street level. */
const GROUND_Y = -0.35

export function SatGround() {
  const tex = useTexture(OVERLAY_URL)
  const gl = useThree((s) => s.gl)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())

  const nw = project(meta.north, meta.west)
  const se = project(meta.south, meta.east)
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(nw.x + se.x) / 2, GROUND_Y, (nw.z + se.z) / 2]}
    >
      <planeGeometry args={[se.x - nw.x, se.z - nw.z]} />
      <meshStandardMaterial map={tex} roughness={1} metalness={0} />
    </mesh>
  )
}

useTexture.preload(OVERLAY_URL)
