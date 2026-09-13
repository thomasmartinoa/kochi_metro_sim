/**
 * Signal masts at the entry to every block, one per direction on its own
 * side, with a live three-aspect head. Aspects come from the same rule the
 * drive sim scores against, evaluated once a frame against the timetable's
 * trains -- so what the driver sees and what the score sees agree.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { TRACK_OFFSET_M } from '../../data/trainset'
import { centerAtG, leftOf } from '../../sim/alignment'
import { liveTrainStates } from '../../sim/engine'
import { aspectAhead, BLOCKS, blockAtG, occupiedBlocks, type Aspect } from '../../sim/signals'
import { useDriveStore } from '../../state/useDriveStore'
import { useSimStore } from '../../state/useSimStore'

const MAST_OUT_M = TRACK_OFFSET_M + 2.0
const MAST_H = 4.6
const HEAD_H = 1.1
const LAMP_R = 0.16
const LAMP_GAP = 0.36
const COLOUR: Record<Aspect, string> = { green: '#22E36A', yellow: '#FFC93C', red: '#FF3B3B' }
const OFF = '#1A1F22'

interface Mast {
  pos: THREE.Vector3
  rotY: number
  /** the block this signal admits into */
  block: number
  dir: 0 | 1
}

function useMasts(): Mast[] {
  return useMemo(() => {
    const out: Mast[] = []
    for (let i = 1; i < BLOCKS.length - 1; i++) {
      for (const dir of [0, 1] as const) {
        // up direction enters block i at its start; down enters at its end
        const g = dir === 0 ? BLOCKS[i].fromG : BLOCKS[i].toG
        const { pos, tan } = centerAtG(g)
        const travel = dir === 0 ? tan : tan.clone().negate()
        const side = leftOf(travel).multiplyScalar(MAST_OUT_M)
        out.push({
          pos: pos.clone().add(side),
          rotY: Math.atan2(-travel.x, -travel.z),
          block: dir === 0 ? i : i, // the signal at block i's entry admits into block i
          dir,
        })
      }
    }
    return out
  }, [])
}

/**
 * Three instanced meshes for the whole line -- posts, heads, lamps -- instead
 * of five meshes and five materials per mast: 96 masts were ~500 draw calls
 * a frame. The lamps are unlit with a per-instance colour; a lit one is
 * pushed past white so the bloom picks it up.
 */
const LIT_BOOST = 2.2

export function Signals() {
  const masts = useMasts()
  const lampMesh = useRef<THREE.InstancedMesh>(null)
  const colours = useMemo(
    () => ({
      on: Object.fromEntries(Object.entries(COLOUR).map(([k, v]) => [k, new THREE.Color(v).multiplyScalar(LIT_BOOST)])) as Record<Aspect, THREE.Color>,
      off: new THREE.Color(OFF),
    }),
    [],
  )
  const every = useRef(0)
  const lastAspect = useRef<Aspect[]>([])
  const geo = useMemo(
    () => ({
      post: new THREE.CylinderGeometry(0.07, 0.09, MAST_H, 8),
      head: new THREE.BoxGeometry(0.46, HEAD_H, 0.18),
      lamp: new THREE.CircleGeometry(LAMP_R, 16),
    }),
    [],
  )
  const mats = useMemo(
    () => ({
      post: new THREE.MeshStandardMaterial({ color: '#8F9698', roughness: 0.9 }),
      head: new THREE.MeshStandardMaterial({ color: '#111517', roughness: 0.7 }),
      lamp: new THREE.MeshBasicMaterial({ color: '#FFFFFF', toneMapped: false }),
    }),
    [],
  )
  // the static instance transforms, laid once
  const instances = useMemo(() => {
    const post = new THREE.InstancedMesh(geo.post, mats.post, masts.length)
    const head = new THREE.InstancedMesh(geo.head, mats.head, masts.length)
    const lamp = new THREE.InstancedMesh(geo.lamp, mats.lamp, masts.length * 3)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    masts.forEach((mast, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), mast.rotY)
      const at = (lx: number, ly: number, lz: number) => p.set(lx, ly, lz).applyQuaternion(q).add(mast.pos)
      post.setMatrixAt(i, m.compose(at(0, MAST_H / 2, 0), q, one))
      head.setMatrixAt(i, m.compose(at(0, MAST_H + HEAD_H / 2, 0), q, one))
      for (let k = 0; k < 3; k++) {
        lamp.setMatrixAt(i * 3 + k, m.compose(at(0, MAST_H + HEAD_H - 0.2 - k * LAMP_GAP, 0.1), q, one))
        lamp.setColorAt(i * 3 + k, colours.off)
      }
    })
    for (const im of [post, head, lamp]) {
      im.instanceMatrix.needsUpdate = true
      im.frustumCulled = false
    }
    return { post, head, lamp }
  }, [masts, geo, mats, colours])

  useFrame(() => {
    // aspects change slowly; evaluate a few times a second, not every frame
    if (every.current++ % 6 !== 0) return
    const lamp = lampMesh.current
    if (!lamp) return
    const epochMs = useSimStore.getState().epochMs
    const trains = liveTrainStates(epochMs).map((t) => ({ sKm: t.sKm, dir: t.dir }))
    const drive = useDriveStore.getState().drive
    const occ: [Set<number>, Set<number>] = [occupiedBlocks(trains, 0), occupiedBlocks(trains, 1)]
    // the player's own train occupies a block too, for the signals behind it
    if (drive && drive.phase !== 'derailed') occ[drive.dir].add(blockAtG(drive.gM))
    let changed = false
    masts.forEach((m, i) => {
      // the signal at the entry to block m.block shows the state of m.block and the one beyond
      const from = m.block - (m.dir === 0 ? 1 : -1)
      const aspect = aspectAhead(from, m.dir, occ[m.dir])
      if (lastAspect.current[i] === aspect) return
      lastAspect.current[i] = aspect
      changed = true
      for (let k = 0; k < 3; k++) {
        const lit = (k === 0 && aspect === 'red') || (k === 1 && aspect === 'yellow') || (k === 2 && aspect === 'green')
        lamp.setColorAt(i * 3 + k, lit ? colours.on[aspect] : colours.off)
      }
    })
    if (changed && lamp.instanceColor) lamp.instanceColor.needsUpdate = true
  })

  return (
    <group>
      <primitive object={instances.post} />
      <primitive object={instances.head} />
      <primitive object={instances.lamp} ref={lampMesh} />
    </group>
  )
}
