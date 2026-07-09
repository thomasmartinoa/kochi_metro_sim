/**
 * Camera behaviours driven by selection:
 * - station selected: one-shot fly-to framing the station
 * - train selected: continuous follow (orbit offset preserved)
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { stationById } from '../data/network'
import { poseAt, stationPoses } from '../sim/alignment'
import { trainStateById } from '../sim/engine'
import { useSimStore } from '../state/useSimStore'

interface ControlsLike {
  target: THREE.Vector3
  update: () => void
}

export function CameraRig() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null

  const flyGoal = useRef<{ cam: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const pose = useRef({ pos: new THREE.Vector3(), heading: new THREE.Vector3() })
  const tmp = useRef(new THREE.Vector3())

  // react to selection changes
  useEffect(
    () =>
      useSimStore.subscribe((state, prev) => {
        if (state.selection === prev.selection) return
        const sel = state.selection
        if (sel?.kind === 'station') {
          const st = stationById.get(sel.id)
          if (!st) return
          const { pos, tan } = stationPoses[st.order]
          // frame across the line: offset sideways from the track direction
          const side = new THREE.Vector3(tan.z, 0, -tan.x).multiplyScalar(150)
          flyGoal.current = {
            cam: pos.clone().add(side).add(new THREE.Vector3(0, 95, 0)),
            target: pos.clone().setY(14),
          }
        } else {
          flyGoal.current = null
        }
      }),
    [],
  )

  useFrame((_, dt) => {
    if (!controls) return
    const k = Math.min(1, dt * 3.2)
    const sel = useSimStore.getState().selection

    if (sel?.kind === 'train') {
      const st = trainStateById(useSimStore.getState().epochMs, sel.id)
      if (st) {
        poseAt(st.sKm, st.dir, pose.current)
        const trainPos = tmp.current.copy(pose.current.pos).setY(pose.current.pos.y + 2)
        const offset = camera.position.clone().sub(controls.target)
        // keep a sane follow distance the first time we latch on
        // (explore mode rides closer for immersion)
        const ride = useSimStore.getState().appMode === 'explore'
        const maxD = ride ? 320 : 900
        const snapD = ride ? 85 : 220
        if (offset.length() > maxD) offset.setLength(snapD)
        controls.target.lerp(trainPos, Math.min(1, dt * 6))
        camera.position.copy(controls.target).add(offset)
        controls.update()
      }
      return
    }

    if (flyGoal.current) {
      const g = flyGoal.current
      camera.position.lerp(g.cam, k)
      controls.target.lerp(g.target, k)
      controls.update()
      if (camera.position.distanceTo(g.cam) < 3) flyGoal.current = null
    }
  })

  return null
}
