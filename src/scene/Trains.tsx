/**
 * Live trains — every scheduled trainset on the line, driven by the engine
 * each frame from the shared sim clock.
 *
 * Drawn in three tiers by distance from the camera, because 26 trainsets of
 * 400 k triangles each were most of what the GPU did every frame:
 *
 *   near  (< NEAR_M, at most NEAR_POOL of them)   the full model, one group
 *                                                 of meshes per train
 *   mid   (< FAR_M)                               the LOD model, instanced
 *   far                                           the LOD model without its
 *                                                 underframe detail (three
 *                                                 quarters of its triangles,
 *                                                 all of it hidden under the
 *                                                 car from anywhere you can
 *                                                 see a train 1 km away),
 *                                                 instanced
 *
 * Instancing means the mid and far tiers cost one draw call per part, not
 * one per part per train: ~200 calls for the whole fleet instead of ~3000.
 *
 * Each train also keeps three plain Object3Ds ("holders") carrying its cars'
 * poses whatever tier it is drawn in; the drive mode reads those for the
 * train ahead (traffic.ts).
 */
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MODEL_CAR_PITCH_M } from '../data/trainset'
import { liveTrainStates, type TrainState } from '../sim/engine'
import { carPoseAt, gAt, trackOffsetBy } from '../sim/alignment'
import { traffic, TRAFFIC_RANGE_M } from './drive/traffic'
import { wreck } from './drive/wreck'
import { useDriveStore } from '../state/useDriveStore'
import { useSimStore } from '../state/useSimStore'
import { mat } from './materials'
import { CarModel, SLOT_MODEL, useCarParts, type Part } from './MetroTrain'

const POOL = 26
const CAR_LEN = MODEL_CAR_PITCH_M
/** full detail inside this, for at most NEAR_POOL trains */
const NEAR_M = 320
const NEAR_POOL = 3
/** the LOD keeps its underframe inside this; beyond, the far tier */
const FAR_M = 1000
/** the LOD parts the far tier leaves out: pipework and brackets under the floor */
const FAR_DROPS = /^(M_Bogiebottom_metal|M_Bogiebottom_metal3|M_Bogiebottom_Rubber|M_Steel|M_kiran)$/
/** radius the marker geometry is authored at, in world units */
const MARKER_RADIUS = 4.2
/**
 * Marker radius as a fraction of viewport height, held constant at any zoom.
 * 0.0055 is ~8 px on a 1440-tall window: a 16 px dot, still an easy click
 * target, that reads as a pin over the train rather than a disc parked on it.
 * (It was twice this and swamped the trainset at street level.)
 */
const MARKER_SCREEN_FRAC = 0.0055


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

/** One instanced tier: for each car slot, an InstancedMesh per part of that slot's model. */
interface Tier {
  /** [slot][part] */
  meshes: THREE.InstancedMesh[][]
  /** pool indices drawn in this tier this frame, in instance order */
  members: number[]
}

function makeTier(parts: Part[][], lodOffset: number, drop?: RegExp): Tier {
  const meshes = [0, 1, 2].map((slot) =>
    parts[lodOffset + SLOT_MODEL[slot]]
      .filter((p) => !drop || !drop.test(p.material.name))
      .map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, POOL)
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        im.count = 0
        // the instances are spread over 27 km; a per-mesh sphere would be
        // wrong every frame and culling would cost more than it saved
        im.frustumCulled = false
        im.name = 'fleet'
        return im
      }),
  )
  return { meshes, members: [] }
}

export function Trains() {
  const nearRefs = useRef<(THREE.Group | null)[]>([])
  const statesRef = useRef<TrainState[]>([])
  const select = useSimStore((s) => s.select)
  const camera = useThree((s) => s.camera)
  const carParts = useCarParts()

  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const lookTarget = useMemo(() => new THREE.Vector3(), [])
  const m4 = useMemo(() => new THREE.Matrix4(), [])
  /** every train's three cars, posed each frame whatever tier draws it */
  const holders = useMemo(
    () => Array.from({ length: POOL }, () => [0, 1, 2].map(() => new THREE.Object3D())),
    [],
  )
  const tiers = useMemo(() => ({ mid: makeTier(carParts, 3), far: makeTier(carParts, 3, FAR_DROPS) }), [carParts])
  /** which pool index each near group is showing, kept stable between frames */
  const nearOf = useRef<number[]>(Array(NEAR_POOL).fill(-1))
  const markerRefs = useRef<(THREE.Group | null)[]>([])

  // world units per metre of camera distance that keep the marker a fixed
  // fraction of screen height (MARKER_SCREEN_FRAC), whatever the zoom
  const markerScale = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera
    const fov = (cam.isPerspectiveCamera ? cam.fov : 50) * (Math.PI / 180)
    return (2 * Math.tan(fov / 2) * MARKER_SCREEN_FRAC) / MARKER_RADIUS
  }, [camera])

  const pick = (i: number) => {
    const st = statesRef.current[i]
    if (st) select({ kind: 'train', id: st.tripId })
  }
  const onFleetClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const tier = e.object.userData.tier as Tier | undefined
    if (tier && e.instanceId !== undefined) {
      const i = tier.members[e.instanceId]
      if (i !== undefined) pick(i)
    }
  }

  useFrame(() => {
    const sim = useSimStore.getState()
    const states = liveTrainStates(sim.epochMs)
    statesRef.current = states
    // The timetable's trains run in both directions while the player drives:
    // the ones ahead are what the signals protect, and what a driver who
    // ignores them runs into.
    // a scheduled train the player has collided with is now part of the wreck
    const drive = sim.appMode === 'drive' ? useDriveStore.getState().drive : null
    const struckG = drive?.derail?.cause === 'collision' ? drive.derail.struckRearG : undefined
    // the trip the player is driving in place of
    const taken = drive ? useDriveStore.getState().takenOverTripId : null
    // the nearest same-direction train ahead of the player, for the tape and the wreck
    let aheadIdx = -1
    let aheadDist = TRAFFIC_RANGE_M
    if (drive && drive.phase !== 'derailed') {
      for (let i = 0; i < POOL; i++) {
        const st = states[i]
        if (!st || st.dir !== drive.dir || st.tripId === taken) continue
        const dist = (gAt(st.sKm) - drive.gM) * (drive.dir === 0 ? 1 : -1)
        if (dist > 0 && dist < aheadDist) {
          aheadDist = dist
          aheadIdx = i
        }
      }
    }
    // while derailed the last published train is the one being hit: keep it
    if (aheadIdx < 0 && !(drive && drive.phase === 'derailed')) traffic.ahead = null

    const sel = useSimStore.getState().selection
    const shown: boolean[] = []
    const dist: number[] = []
    for (let i = 0; i < POOL; i++) {
      const st = states[i]
      // the wreck draws the struck train where it was hit; the timetable's
      // copy would otherwise carry on down the line without its rear car
      const isStruck =
        struckG !== undefined &&
        st &&
        st.dir === drive!.dir &&
        (wreck.struck?.tripId
          ? st.tripId === wreck.struck.tripId
          : Math.abs(gAt(st.sKm) + (st.dir === 0 ? -1 : 1) * CAR_LEN - struckG) < 60)
      const marker = markerRefs.current[i]
      if (!st || isStruck || st.tripId === taken) {
        shown[i] = false
        dist[i] = Infinity
        if (marker) marker.visible = false
        continue
      }
      shown[i] = true
      // each car sits on its two bogies and chords the curve between them;
      // the cars are spaced along the rail they run on, not the centreline,
      // so the couplers meet round bends (see alignment.ts)
      const cars = holders[i]
      for (let c = 0; c < 3; c++) {
        // car 0 leads in the direction of travel
        const offsetM = (1 - c) * CAR_LEN
        const sCar = trackOffsetBy(st.sKm, st.dir === 0 ? offsetM : -offsetM, st.dir)
        carPoseAt(sCar, st.dir, pose)
        const car = cars[c]
        car.position.copy(pose.pos)
        lookTarget.copy(pose.pos).add(pose.heading)
        car.lookAt(lookTarget)
        car.updateMatrixWorld()
      }
      dist[i] = camera.position.distanceTo(cars[1].position)
      if (i === aheadIdx) traffic.ahead = { tripId: st.tripId, cars, speedMs: st.speedKmh / 3.6 }

      // floating marker above the middle car — always visible & clickable
      if (marker) {
        marker.visible = true
        marker.position.set(cars[1].position.x, cars[1].position.y + 9, cars[1].position.z)
        marker.quaternion.copy(camera.quaternion)
        const markerMesh = marker.children[0] as THREE.Mesh
        markerMesh.material = st.dir === 0 ? mat.markerUp : mat.markerDown
        const isSelected = sel?.kind === 'train' && sel.id === st.tripId
        // Hold a constant size on screen. A fixed world-space disc swamps the
        // train close up and disappears from across the city; this is a click
        // target, so what matters is how big it is under the cursor. Scale by
        // distance (and vertical FOV, so it survives a resize) to keep it there.
        marker.scale.setScalar(dist[i] * markerScale * (isSelected ? 1.5 : 1))
      }
    }

    // --- near tier: the closest few, full detail, assignments kept stable
    const near = nearOf.current
    const eligible = (i: number) => shown[i] && dist[i] < NEAR_M
    for (let k = 0; k < NEAR_POOL; k++) if (near[k] >= 0 && !eligible(near[k])) near[k] = -1
    const candidates = []
    for (let i = 0; i < POOL; i++) if (eligible(i) && !near.includes(i)) candidates.push(i)
    candidates.sort((a, b) => dist[a] - dist[b])
    for (let k = 0; k < NEAR_POOL && candidates.length; k++) if (near[k] < 0) near[k] = candidates.shift()!
    const isNear: boolean[] = []
    for (let k = 0; k < NEAR_POOL; k++) {
      const g = nearRefs.current[k]
      const i = near[k]
      if (!g) continue
      if (i < 0) {
        g.visible = false
        continue
      }
      isNear[i] = true
      g.visible = true
      g.userData.pool = i
      for (let c = 0; c < 3; c++) {
        const car = g.children[c] as THREE.Group
        car.position.copy(holders[i][c].position)
        car.quaternion.copy(holders[i][c].quaternion)
      }
    }

    // --- mid and far tiers: instanced, packed so only drawn trains cost vertices
    const place = (tier: Tier, want: (i: number) => boolean) => {
      tier.members.length = 0
      for (let i = 0; i < POOL; i++) if (shown[i] && !isNear[i] && want(i)) tier.members.push(i)
      const n = tier.members.length
      for (let slot = 0; slot < 3; slot++) {
        for (let k = 0; k < n; k++) {
          const h = holders[tier.members[k]][slot]
          m4.compose(h.position, h.quaternion, h.scale)
          for (const im of tier.meshes[slot]) im.setMatrixAt(k, m4)
        }
        for (const im of tier.meshes[slot]) {
          im.count = n
          if (n) im.instanceMatrix.needsUpdate = true
        }
      }
    }
    place(tiers.mid, (i) => dist[i] < FAR_M)
    place(tiers.far, (i) => dist[i] >= FAR_M)
  })

  return (
    <group>
      {/* near tier */}
      {Array.from({ length: NEAR_POOL }, (_, k) => (
        <group
          key={k}
          ref={(el) => {
            nearRefs.current[k] = el
          }}
          visible={false}
          onClick={(e) => {
            e.stopPropagation()
            const i = (e.eventObject as THREE.Group).userData.pool as number | undefined
            if (i !== undefined) pick(i)
          }}
        >
          <TrainModel parts={carParts} />
        </group>
      ))}
      {/* mid and far tiers */}
      {(['mid', 'far'] as const).map((name) =>
        tiers[name].meshes.map((slotMeshes, slot) =>
          slotMeshes.map((im, p) => {
            im.userData.tier = tiers[name]
            return <primitive key={`${name}-${slot}-${p}`} object={im} onClick={onFleetClick} />
          }),
        ),
      )}
      {/* markers: billboarded map-pin discs, one per train */}
      {Array.from({ length: POOL }, (_, i) => (
        <group
          key={`m${i}`}
          ref={(el) => {
            markerRefs.current[i] = el
          }}
          visible={false}
          onClick={(e) => {
            e.stopPropagation()
            pick(i)
          }}
        >
          <mesh>
            <circleGeometry args={[4.2, 24]} />
          </mesh>
          <mesh position={[0, 0, -0.1]} material={mat.markerRing}>
            <ringGeometry args={[4.2, 4.8, 24]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
