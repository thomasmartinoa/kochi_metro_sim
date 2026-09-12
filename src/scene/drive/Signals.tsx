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

export function Signals() {
  const masts = useMasts()
  const lamps = useRef<(THREE.Mesh | null)[]>([])
  const colours = useMemo(
    () => ({ on: Object.fromEntries(Object.entries(COLOUR).map(([k, v]) => [k, new THREE.Color(v)])) as Record<Aspect, THREE.Color>, off: new THREE.Color(OFF) }),
    [],
  )
  const every = useRef(0)

  useFrame(() => {
    // aspects change slowly; evaluate a few times a second, not every frame
    if (every.current++ % 6 !== 0) return
    const epochMs = useSimStore.getState().epochMs
    const trains = liveTrainStates(epochMs).map((t) => ({ sKm: t.sKm, dir: t.dir }))
    const drive = useDriveStore.getState().drive
    const occ: [Set<number>, Set<number>] = [occupiedBlocks(trains, 0), occupiedBlocks(trains, 1)]
    // the player's own train occupies a block too, for the signals behind it
    if (drive && drive.phase !== 'derailed') occ[drive.dir].add(blockAtG(drive.gM))
    masts.forEach((m, i) => {
      // the signal at the entry to block m.block shows the state of m.block and the one beyond
      const from = m.block - (m.dir === 0 ? 1 : -1)
      const aspect = aspectAhead(from, m.dir, occ[m.dir])
      for (let k = 0; k < 3; k++) {
        const lamp = lamps.current[i * 3 + k]
        if (!lamp) continue
        const mat = lamp.material as THREE.MeshStandardMaterial
        const lit = (k === 0 && aspect === 'red') || (k === 1 && aspect === 'yellow') || (k === 2 && aspect === 'green')
        const c = lit ? colours.on[aspect] : colours.off
        if (!mat.emissive.equals(c)) {
          mat.emissive.copy(c)
          mat.color.copy(lit ? c : colours.off)
          mat.emissiveIntensity = lit ? 2.2 : 0
        }
      }
    })
  })

  return (
    <group>
      {masts.map((m, i) => (
        <group key={i} position={m.pos} rotation={[0, m.rotY, 0]}>
          <mesh position={[0, MAST_H / 2, 0]}>
            <cylinderGeometry args={[0.07, 0.09, MAST_H, 8]} />
            <meshStandardMaterial color="#8F9698" roughness={0.9} />
          </mesh>
          {/* the head: a black plate with red over yellow over green */}
          <mesh position={[0, MAST_H + HEAD_H / 2, 0]}>
            <boxGeometry args={[0.46, HEAD_H, 0.18]} />
            <meshStandardMaterial color="#111517" roughness={0.7} />
          </mesh>
          {[0, 1, 2].map((k) => (
            <mesh
              key={k}
              position={[0, MAST_H + HEAD_H - 0.2 - k * LAMP_GAP, 0.1]}
              ref={(el) => {
                lamps.current[i * 3 + k] = el
              }}
            >
              <circleGeometry args={[LAMP_R, 16]} />
              <meshStandardMaterial color={OFF} emissive={OFF} emissiveIntensity={0} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}
