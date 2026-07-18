/**
 * Aerial-imagery ground plane. The image is the Blosm aerial overlay lifted
 * off the (flat, zero-elevation) terrain of the authored Blender scene and
 * re-exported for web by scripts/blender_export_city_v2.py's prep step; its
 * bounds come from that terrain's UV->world fit (src/data/kochi-overlay-meta).
 *
 * Since the streaming tile ground (TileGround) arrived this is the instant-on,
 * offline FALLBACK layer: it sits ~1 m under the tiles, shows immediately on
 * load and wherever tiles haven't streamed yet, and the tiles cover it as they
 * arrive. Depth precision across the 1 m..60 km view range is handled globally
 * by the canvas's logarithmic depth buffer (see World.tsx).
 */
import { useTexture } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import meta from '../data/kochi-overlay-meta.json'
import { project } from '../sim/projection'

const OVERLAY_URL = '/textures/kochi-overlay.webp'
/** ~1 m under the streamed tiles (-0.35) so they cleanly cover it. */
const GROUND_Y = -1.5

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
