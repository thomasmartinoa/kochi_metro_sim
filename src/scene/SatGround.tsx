/**
 * Satellite-imagery ground plane (Esri World Imagery, stitched by
 * scripts/fetch-satellite.mjs). Sits just above the plain ground colour and
 * below every vector layer, so buildings/roads/water render on top of the
 * real photograph. Bounds come from the stitched tile grid.
 */
import { useTexture } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import meta from '../data/kochi-sat-meta.json'
import { project } from '../sim/projection'

export function SatGround() {
  const tex = useTexture('/textures/kochi-sat.jpg')
  const gl = useThree((s) => s.gl)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())

  const nw = project(meta.north, meta.west)
  const se = project(meta.south, meta.east)
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(nw.x + se.x) / 2, 0.05, (nw.z + se.z) / 2]}
    >
      <planeGeometry args={[se.x - nw.x, se.z - nw.z]} />
      <meshStandardMaterial map={tex} roughness={1} metalness={0} />
    </mesh>
  )
}

useTexture.preload('/textures/kochi-sat.jpg')
