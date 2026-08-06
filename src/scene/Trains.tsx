/**
 * Live trains — a pooled set of 3-car Metropolis models driven by the engine
 * every frame from the shared sim clock. Pooling avoids React churn.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MODEL_CAR_PITCH_M } from '../data/trainset'
import { liveTrainStates, type TrainState } from '../sim/engine'
import { offsetBy, poseAt } from '../sim/alignment'
import { useSimStore } from '../state/useSimStore'
import { mat } from './materials'
import { CarModel, useCarParts, type Part } from './MetroTrain'

const POOL = 26
const CAR_LEN = MODEL_CAR_PITCH_M
/** radius the marker geometry is authored at, in world units */
const MARKER_RADIUS = 4.2
/** how much of the viewport's height the marker disc should span, at any zoom */
const MARKER_SCREEN_FRAC = 0.022

function TrainModel({ parts }: { parts: Part[][] }) {
  return (
    <>
      <group name="car0">
        <CarModel slot={0} parts={parts} />
      </group>
      <group name="car1">
        <CarModel slot={1} parts={parts} />
      </group>
      <group name="car2">
        <CarModel slot={2} parts={parts} />
      </group>
    </>
  )
}

export function Trains() {
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const statesRef = useRef<TrainState[]>([])
  const select = useSimStore((s) => s.select)
  const camera = useThree((s) => s.camera)
  const carParts = useCarParts()

  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const lookTarget = useMemo(() => new THREE.Vector3(), [])

  // world units per metre of camera distance that keep the marker a fixed
  // fraction of screen height (MARKER_SCREEN_FRAC), whatever the zoom
  const markerScale = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera
    const fov = (cam.isPerspectiveCamera ? cam.fov : 50) * (Math.PI / 180)
    return (2 * Math.tan(fov / 2) * MARKER_SCREEN_FRAC) / MARKER_RADIUS
  }, [camera])

  useFrame(() => {
    const epochMs = useSimStore.getState().epochMs
    const states = liveTrainStates(epochMs)
    statesRef.current = states
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
      // position each car along the track so the trainset bends with curves
      for (let c = 0; c < 3; c++) {
        const car = g.children[c] as THREE.Group
        // car 0 leads in the direction of travel
        const offsetM = (1 - c) * CAR_LEN
        // offsetBy, not sKm arithmetic — the cars have a real length (see alignment.ts)
        const sCar = offsetBy(st.sKm, st.dir === 0 ? offsetM : -offsetM)
        poseAt(sCar, st.dir, pose)
        car.position.copy(pose.pos)
        lookTarget.copy(pose.pos).add(pose.heading)
        car.lookAt(lookTarget)
      }
      // floating marker above the middle car — always visible & clickable
      const marker = g.children[3] as THREE.Group
      const mid = g.children[1] as THREE.Group
      marker.position.set(mid.position.x, mid.position.y + 11, mid.position.z)
      marker.quaternion.copy(camera.quaternion)
      const markerMesh = marker.children[0] as THREE.Mesh
      markerMesh.material = st.dir === 0 ? mat.markerUp : mat.markerDown
      const sel = useSimStore.getState().selection
      const isSelected = sel?.kind === 'train' && sel.id === st.tripId
      // Hold a constant size on screen. A fixed world-space disc swamps the
      // train close up and disappears from across the city; this is a click
      // target, so what matters is how big it is under the cursor. Scale by
      // distance (and vertical FOV, so it survives a resize) to keep it there.
      const dist = camera.position.distanceTo(marker.position)
      marker.scale.setScalar(dist * markerScale * (isSelected ? 1.4 : 1))
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
            if (tripId) select({ kind: 'train', id: tripId })
          }}
        >
          <TrainModel parts={carParts} />
          {/* marker (children[3]): billboarded map-pin disc */}
          <group>
            <mesh>
              <circleGeometry args={[4.2, 24]} />
            </mesh>
            <mesh position={[0, 0, -0.1]} material={mat.markerRing}>
              <ringGeometry args={[4.2, 5.2, 24]} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}
