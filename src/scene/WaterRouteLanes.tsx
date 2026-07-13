/**
 * Ferry-lane ribbons: each water route drawn as a translucent route-coloured
 * band on the water surface, so the network reads instantly even where the
 * satellite water is murky. The water twin of the Blue Line viaduct.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { waterAlignments } from '../sim/waterAlignment'
import { waterRoutes } from '../sim/waterEngine'

const LANE_W = 7
const LANE_Y = 0.32

function laneGeometry(routeId: string): THREE.BufferGeometry {
  const pts = waterAlignments.get(routeId)!
  const n = pts.length
  const positions = new Float32Array(n * 2 * 3)
  const indices: number[] = []
  const left = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const { pos, tan } = pts[i]
    left.set(tan.z, 0, -tan.x).multiplyScalar(LANE_W / 2)
    positions.set([pos.x + left.x, LANE_Y, pos.z + left.z], i * 6)
    positions.set([pos.x - left.x, LANE_Y, pos.z - left.z], i * 6 + 3)
    if (i < n - 1) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

export function WaterRouteLanes() {
  const lanes = useMemo(
    () =>
      waterRoutes.map((r) => ({
        id: r.id,
        geo: laneGeometry(r.id),
        mat: new THREE.MeshBasicMaterial({
          color: r.color,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
        }),
      })),
    [],
  )
  return (
    <group renderOrder={2}>
      {lanes.map((l) => (
        <mesh key={l.id} geometry={l.geo} material={l.mat} />
      ))}
    </group>
  )
}
