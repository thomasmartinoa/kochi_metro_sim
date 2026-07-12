/**
 * Live trains — a pooled set of 3-car Metropolis models driven by the engine
 * every frame from the shared sim clock. Pooling avoids React churn.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { TRAINSET } from '../data/trainset'
import { liveTrainStates, type TrainState } from '../sim/engine'
import { poseAt } from '../sim/alignment'
import { useSimStore } from '../state/useSimStore'
import { mat } from './materials'

const POOL = 26
const CAR_LEN = TRAINSET.lengthM / TRAINSET.cars // ~21.7 m
const CAR_GAP = 0.35

/** One car: body, windows band, doors band, and (optionally) a cab end. */
export function Car({ cabAt }: { cabAt: 'front' | 'back' | null }) {
  const L = CAR_LEN - CAR_GAP
  return (
    <group>
      <mesh material={mat.trainBody} position={[0, 2, 0]}>
        <boxGeometry args={[TRAINSET.widthM, TRAINSET.heightM - 0.6, L]} />
      </mesh>
      {/* window band */}
      <mesh material={mat.trainGlass} position={[0, 2.62, 0]}>
        <boxGeometry args={[TRAINSET.widthM + 0.04, 0.72, L * 0.9]} />
      </mesh>
      {/* turquoise skirt stripe */}
      <mesh material={mat.trainStripe} position={[0, 0.78, 0]}>
        <boxGeometry args={[TRAINSET.widthM + 0.04, 0.22, L * 0.98]} />
      </mesh>
      {cabAt && (
        <group position={[0, 0, cabAt === 'front' ? L / 2 : -L / 2]} scale={[1, 1, cabAt === 'front' ? 1 : -1]}>
          {/* curved turquoise cab cap */}
          <mesh material={mat.trainCap} position={[0, 1.9, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[TRAINSET.widthM / 2, TRAINSET.widthM / 2 - 0.3, 1.6, 18, 1, false, 0, Math.PI]} />
          </mesh>
          <mesh material={mat.trainCap} position={[0, 1.15, 0.5]}>
            <boxGeometry args={[TRAINSET.widthM - 0.2, 1.9, 1.0]} />
          </mesh>
          {/* windshield */}
          <mesh material={mat.trainGlass} position={[0, 2.6, 0.78]} rotation={[-0.35, 0, 0]}>
            <boxGeometry args={[TRAINSET.widthM - 0.9, 1.3, 0.18]} />
          </mesh>
          {/* elephant-tusk LED headlamps */}
          <mesh material={mat.led} position={[-0.85, 1.15, 1.02]} rotation={[0, 0, 0.5]}>
            <boxGeometry args={[0.14, 0.75, 0.12]} />
          </mesh>
          <mesh material={mat.led} position={[0.85, 1.15, 1.02]} rotation={[0, 0, -0.5]}>
            <boxGeometry args={[0.14, 0.75, 0.12]} />
          </mesh>
        </group>
      )}
    </group>
  )
}

function TrainModel() {
  return (
    <>
      <group name="car0">
        <Car cabAt="front" />
      </group>
      <group name="car1">
        <Car cabAt={null} />
      </group>
      <group name="car2">
        <Car cabAt="back" />
      </group>
    </>
  )
}

export function Trains() {
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const statesRef = useRef<TrainState[]>([])
  const select = useSimStore((s) => s.select)
  const camera = useThree((s) => s.camera)

  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const lookTarget = useMemo(() => new THREE.Vector3(), [])

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
        const sCar = st.sKm + (st.dir === 0 ? offsetM : -offsetM) / 1000
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
      marker.scale.setScalar(isSelected ? 1.5 : 1)
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
          <TrainModel />
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
