/**
 * Your best run, racing you: the ghost trainset.
 *
 * Plays the best tape for this direction (src/sim/ghost.ts) on the run's own
 * clock, so it sets off the moment you first apply power and is exactly as
 * far along as you were then. Posed on the same rail from `gM` alone; it is
 * not in the sim, so nothing collides with it and the signals ignore it.
 * Drawn as a translucent, unlit teal so it reads as a ghost at any hour and
 * never hides what is behind it.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MODEL_CAR_PITCH_M } from '../../data/trainset'
import { carPoseAt, sAtG, trackOffsetBy } from '../../sim/alignment'
import { ghostGAt } from '../../sim/ghost'
import { useDriveStore } from '../../state/useDriveStore'
import { useRunHistory } from '../../state/runHistory'
import { useCarParts } from '../MetroTrain'

/** slot 0 leads the train, slot 2 trails it -> model index (as MetroTrain) */
const SLOT_MODEL = [2, 1, 0] as const
const CAR_LEN = MODEL_CAR_PITCH_M
/** the ghost is hidden while it sits inside the player's set */
const HIDE_WITHIN_M = 4

export function GhostTrain() {
  const parts = useCarParts()
  const group = useRef<THREE.Group>(null)
  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#5FE8D2',
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    [],
  )

  useFrame(() => {
    const g = group.current
    if (!g) return
    const d = useDriveStore.getState().drive
    const tape = d ? useRunHistory.getState().history.best[d.dir] : null
    const ghostG = d && tape && d.startedAtMs !== null ? ghostGAt(tape.samples, d.runS) : null
    if (!d || ghostG === null || d.phase === 'derailed' || d.phase === 'done' || Math.abs(ghostG - d.gM) < HIDE_WITHIN_M) {
      g.visible = false
      return
    }
    g.visible = true
    const sKm = sAtG(ghostG)
    for (let c = 0; c < 3; c++) {
      const car = g.children[c] as THREE.Group
      const offsetM = (1 - c) * CAR_LEN
      const sCar = trackOffsetBy(sKm, d.dir === 0 ? offsetM : -offsetM, d.dir)
      carPoseAt(sCar, d.dir, pose)
      car.position.copy(pose.pos)
      tmp.copy(pose.pos).add(pose.heading)
      car.lookAt(tmp)
    }
  })

  return (
    <group ref={group} name="ghost-train" visible={false}>
      {[0, 1, 2].map((slot) => (
        <group key={slot}>
          {/* the distant LOD is light enough for a ghost, and has no cab to see through */}
          {parts[3 + SLOT_MODEL[slot]].map((p, i) => (
            <mesh key={i} geometry={p.geometry} material={material} />
          ))}
        </group>
      ))}
    </group>
  )
}
