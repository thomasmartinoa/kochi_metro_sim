/**
 * Camera behaviours driven by selection:
 * - station/terminal selected: one-shot fly-to framing it
 * - train/boat selected: continuous follow (orbit offset preserved)
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { stationById } from '../data/network'
import { poseAt, stationPoses } from '../sim/alignment'
import { trainStateById } from '../sim/engine'
import { poseAtWater, terminalPoses } from '../sim/waterAlignment'
import { boatStateById, terminals } from '../sim/waterEngine'
import { useSimStore } from '../state/useSimStore'

interface ControlsLike {
  target: THREE.Vector3
  update: () => void
}

// harbour focus for the landing drift: boats below, viaduct on the skyline
const LANDING_FOCUS = (() => {
  const hc = terminalPoses[0]?.pos ?? new THREE.Vector3()
  return new THREE.Vector3(hc.x + 250, 0, hc.z + 150)
})()

export function CameraRig() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null

  const flyGoal = useRef<{ cam: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const pose = useRef({ pos: new THREE.Vector3(), heading: new THREE.Vector3() })
  const tmp = useRef(new THREE.Vector3())

  // react to experience + selection changes
  useEffect(
    () =>
      useSimStore.subscribe((state, prev) => {
        if (state.experience !== prev.experience) {
          // fly into the chosen system's home view
          if (state.experience === 'metro') {
            const { pos } = stationPoses[15] // Ernakulam core
            flyGoal.current = {
              cam: pos.clone().add(new THREE.Vector3(210, 130, 310)),
              target: pos.clone().setY(20),
            }
          } else if (state.experience === 'water') {
            // frame the W1 harbour crossing: midpoint HC<->Vypin, camera SE over the city shore
            const hc = terminalPoses[0].pos
            const vy = terminalPoses[1].pos
            const mid = hc.clone().add(vy).multiplyScalar(0.5)
            flyGoal.current = {
              cam: mid.clone().add(new THREE.Vector3(520, 300, 420)),
              target: mid.setY(2),
            }
          }
          return
        }
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
        } else if (sel?.kind === 'terminal') {
          const idx = terminals.findIndex((t) => t.id === sel.id)
          if (idx < 0) return
          const { pos, tan } = terminalPoses[idx]
          const side = new THREE.Vector3(tan.z, 0, -tan.x).multiplyScalar(120)
          flyGoal.current = {
            cam: pos.clone().add(side).add(new THREE.Vector3(0, 70, 0)),
            target: pos.clone().setY(3),
          }
        } else {
          flyGoal.current = null
        }
      }),
    [],
  )

  useFrame((state, dt) => {
    if (!controls) return
    const store = useSimStore.getState()
    // landing: slow cinematic drift over the harbour where both systems meet
    if (store.experience === 'landing') {
      const t = state.clock.elapsedTime * 0.045
      const cx = LANDING_FOCUS.x + Math.cos(t) * 950
      const cz = LANDING_FOCUS.z + Math.sin(t) * 950
      camera.position.lerp(tmp.current.set(cx, 330, cz), Math.min(1, dt * 1.2))
      controls.target.lerp(LANDING_FOCUS, Math.min(1, dt * 1.2))
      controls.update()
      return
    }
    // drive mode owns the camera (see DriveTrain)
    if (store.appMode === 'drive') return
    const k = Math.min(1, dt * 3.2)
    const sel = store.selection

    if (sel?.kind === 'train' || sel?.kind === 'boat') {
      let vehiclePos: THREE.Vector3 | null = null
      if (sel.kind === 'train') {
        const st = trainStateById(useSimStore.getState().epochMs, sel.id)
        if (st) {
          poseAt(st.sKm, st.dir, pose.current)
          vehiclePos = tmp.current.copy(pose.current.pos).setY(pose.current.pos.y + 2)
        }
      } else {
        const st = boatStateById(useSimStore.getState().epochMs, sel.id)
        if (st) {
          poseAtWater(st.routeId, st.sKm, st.dir, pose.current)
          vehiclePos = tmp.current.copy(pose.current.pos).setY(pose.current.pos.y + 3)
        }
      }
      if (vehiclePos) {
        const offset = camera.position.clone().sub(controls.target)
        // keep a sane follow distance the first time we latch on
        // (explore mode rides closer for immersion)
        const ride = useSimStore.getState().appMode === 'explore'
        const maxD = ride ? 320 : 900
        const snapD = ride ? 85 : 220
        if (offset.length() > maxD) offset.setLength(snapD)
        controls.target.lerp(vehiclePos, Math.min(1, dt * 6))
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
