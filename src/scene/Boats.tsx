/**
 * Water Metro boats — pooled 24 m electric catamarans driven by the water
 * engine every frame. Twin hulls, teal band, glazed cabin, gentle bob and a
 * speed-faded wake. Route-coloured billboard markers float above.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { poseAtWater } from '../sim/waterAlignment'
import { liveBoatStates, waterRoutes, type BoatState } from '../sim/waterEngine'
import { useSimStore } from '../state/useSimStore'
import { mat } from './materials'

const POOL = 18

const routeMarkerMats = new Map(
  waterRoutes.map((r) => [r.id, new THREE.MeshBasicMaterial({ color: r.color })]),
)

function Catamaran() {
  return (
    <group>
      {/* twin hulls with bow wedges */}
      {[-2.3, 2.3].map((x) => (
        <group key={x} position={[x, 0.55, 0]}>
          <mesh material={mat.boatHull} position={[0, 0, -1]}>
            <boxGeometry args={[1.7, 1.5, 19]} />
          </mesh>
          <mesh material={mat.boatHull} position={[0, 0.1, 9.4]} rotation={[Math.PI / 2.6, 0, 0]}>
            <coneGeometry args={[0.85, 3.2, 4, 1]} />
          </mesh>
        </group>
      ))}
      {/* deck */}
      <mesh material={mat.boatHull} position={[0, 1.5, 0.4]}>
        <boxGeometry args={[7.2, 0.5, 21]} />
      </mesh>
      {/* teal band along the deck edge */}
      <mesh material={mat.boatBand} position={[0, 1.85, 0.4]}>
        <boxGeometry args={[7.3, 0.28, 20.6]} />
      </mesh>
      {/* cabin */}
      <mesh material={mat.boatHull} position={[0, 3.1, -0.4]}>
        <boxGeometry args={[6.4, 2.6, 15.5]} />
      </mesh>
      {/* panoramic glazing */}
      <mesh material={mat.boatGlass} position={[0, 3.5, -0.4]}>
        <boxGeometry args={[6.5, 1.15, 15]} />
      </mesh>
      {/* wheelhouse windshield */}
      <mesh material={mat.boatGlass} position={[0, 3.35, 7.6]} rotation={[-0.4, 0, 0]}>
        <boxGeometry args={[5.6, 1.5, 0.2]} />
      </mesh>
      {/* roof with overhang + teal trim */}
      <mesh material={mat.boatRoof} position={[0, 4.55, -0.2]}>
        <boxGeometry args={[7.0, 0.22, 17.4]} />
      </mesh>
      <mesh material={mat.boatBand} position={[0, 4.72, -0.2]}>
        <boxGeometry args={[6.2, 0.14, 16.6]} />
      </mesh>
      {/* mast + beacon */}
      <mesh material={mat.gangway} position={[0, 5.4, 5.5]}>
        <cylinderGeometry args={[0.08, 0.12, 1.4, 6]} />
      </mesh>
      <mesh material={mat.led} position={[0, 6.2, 5.5]}>
        <sphereGeometry args={[0.16, 8, 6]} />
      </mesh>
      {/* wake: two shear planes trailing the hulls (faded by speed) */}
      <group name="wake">
        {[-2.3, 2.3].map((x) => (
          <mesh key={x} material={mat.wake} position={[x, 0.02, -14]} rotation={[-Math.PI / 2, 0, 0.06 * Math.sign(x)]}>
            <planeGeometry args={[1.6, 10]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

export function Boats() {
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const select = useSimStore((s) => s.select)
  const camera = useThree((s) => s.camera)
  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const look = useMemo(() => new THREE.Vector3(), [])

  useFrame((state) => {
    const epochMs = useSimStore.getState().epochMs
    const states: BoatState[] = liveBoatStates(epochMs)
    const t = state.clock.elapsedTime
    for (let i = 0; i < POOL; i++) {
      const g = groupRefs.current[i]
      if (!g) continue
      const st = states[i]
      if (!st) {
        g.visible = false
        continue
      }
      g.visible = true
      g.userData.tripId = st.tripId
      poseAtWater(st.routeId, st.sKm, st.dir, pose)
      const bob = Math.sin(t * 1.1 + i * 2.1) * 0.09
      g.position.set(pose.pos.x, pose.pos.y + bob, pose.pos.z)
      look.copy(g.position).add(pose.heading)
      g.lookAt(look)
      g.rotation.z = Math.sin(t * 0.8 + i) * 0.015
      // hull group is children[0]; wake fades with speed
      const hull = g.children[0] as THREE.Group
      const wake = hull.getObjectByName('wake')
      if (wake) wake.visible = st.speedKmh > 2
      // marker (children[1])
      const marker = g.children[1] as THREE.Group
      marker.position.set(0, 10.5 - bob, 0)
      marker.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion)
      const mm = marker.children[0] as THREE.Mesh
      mm.material = routeMarkerMats.get(st.routeId)!
      const sel = useSimStore.getState().selection
      marker.scale.setScalar(sel?.kind === 'boat' && sel.id === st.tripId ? 1.5 : 1)
    }
  })

  return (
    <group>
      {Array.from({ length: POOL }, (_, i) => (
        <group
          key={i}
          ref={(el) => {
            groupRefs.current[i] = el
          }}
          visible={false}
          onClick={(e) => {
            e.stopPropagation()
            const tripId = (e.eventObject as THREE.Group).userData.tripId as string | undefined
            if (tripId) select({ kind: 'boat', id: tripId })
          }}
        >
          <Catamaran />
          {/* marker (children[1]): route-coloured disc */}
          <group>
            <mesh>
              <circleGeometry args={[3.4, 20]} />
            </mesh>
            <mesh position={[0, 0, -0.08]} material={mat.markerRing}>
              <ringGeometry args={[3.4, 4.3, 20]} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}
