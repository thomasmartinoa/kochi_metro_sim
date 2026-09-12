/**
 * The one owner of the camera in drive mode. Reads the rig DriveTrain
 * publishes, asks the pure view maths where the camera should be, and eases
 * the real camera there. Cab view adds mouse-look; the crash view adds shake.
 * OrbitControls is switched off for the whole drive so it never fights this.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { newCamMemory, seedCrashFrom, viewCamera, type DriveView } from '../../sim/driveCameras'
import { useDriveStore } from '../../state/useDriveStore'
import { useSimStore } from '../../state/useSimStore'
import { rig } from './rig'
import { cockpitGrab } from './Cockpit'
import { shake } from './wreck'

const MAX_DT = 1 / 30
/** how hard each eased view pulls toward its goal, per second */
const STIFF: Record<DriveView, number> = {
  cockpit: 14,
  cab: 14,
  chase: 4,
  'chase-far': 3,
  left: 10,
  right: 10,
  nose: 20,
  roof: 20,
  trackside: 30,
  drone: 3,
  crash: 3,
}
/** views rigidly mounted to the train or the ground: no easing at all */
const SNAP = new Set<DriveView>(['cockpit', 'cab', 'nose', 'roof', 'trackside'])
/** the views with mouse-look */
const LOOK = new Set<DriveView>(['cockpit', 'cab'])
/**
 * An eased view further than this from its goal is not lagging, it is lost --
 * the run just started, the train was teleported, the view was switched from
 * across the map -- and easing in from there is a minutes-long crawl. Snap
 * to the goal instead, and ease from then on.
 */
const LOST_M = 400
/** cab mouse-look limits (radians) and how fast it springs back */
const LOOK_YAW = 1.2
const LOOK_PITCH = 0.5
const LOOK_RETURN = 2.5
/** near plane while seated in the cab, metres */
const COCKPIT_NEAR = 0.08

interface ControlsLike {
  target: THREE.Vector3
  update: () => void
  enabled: boolean
}

export function DriveCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const mem = useRef(newCamMemory())
  const lastView = useRef<DriveView | null>(null)
  const look = useRef({ yaw: 0, pitch: 0, dragging: false })
  const baseFov = useRef(camera.fov)
  const baseNear = useRef(camera.near)
  const v = useMemo(
    () => ({
      dir: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      q: new THREE.Quaternion(),
    }),
    [],
  )

  // cab mouse-look: drag to look around, springs back when released
  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      if (useSimStore.getState().appMode !== 'drive') return
      if (!LOOK.has(useDriveStore.getState().view)) return
      // a hand on the lever is not a look around
      if (cockpitGrab.active) return
      look.current.dragging = true
      e.preventDefault()
    }
    const move = (e: PointerEvent) => {
      if (!look.current.dragging || cockpitGrab.active) return
      look.current.yaw = THREE.MathUtils.clamp(look.current.yaw - e.movementX * 0.004, -LOOK_YAW, LOOK_YAW)
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - e.movementY * 0.003, -LOOK_PITCH, LOOK_PITCH)
    }
    const up = () => {
      look.current.dragging = false
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [gl])

  useFrame((_, dtRaw) => {
    const st = useDriveStore.getState()
    const driving = useSimStore.getState().appMode === 'drive' && !!st.drive
    // while a replay plays, ReplayTrain owns the camera
    if (!driving || !rig.valid || !controls || st.replaying) {
      if (lastView.current !== null && !st.replaying) {
        // leaving drive: hand the camera back with its usual field of view
        camera.fov = baseFov.current
        camera.near = baseNear.current
        camera.updateProjectionMatrix()
        lastView.current = null
      }
      // coming back from a replay, re-seed the crash orbit from where the
      // replay camera left us rather than jumping
      if (!st.replaying && lastView.current === 'crash') lastView.current = null
      return
    }
    controls.enabled = false
    const dt = Math.min(dtRaw, MAX_DT)
    const view = useDriveStore.getState().view
    const switched = view !== lastView.current
    if (switched) {
      mem.current = newCamMemory()
      // the crash drone picks its orbit up from where the camera IS: no cut
      // (unless the camera is lost, in which case the view maths starts it
      // from the chase pose itself)
      const centre = rig.wreckLead ?? rig.pos
      if (view === 'crash' && camera.position.distanceTo(centre) < LOST_M) {
        seedCrashFrom(mem.current, camera.position, centre)
      }
      lastView.current = view
    }
    const pose = viewCamera(view, rig, mem.current, dt)
    const lost = camera.position.distanceTo(pose.eye) > LOST_M

    if (LOOK.has(view)) {
      if (!look.current.dragging) {
        const decay = Math.max(0, 1 - dt * LOOK_RETURN)
        look.current.yaw *= decay
        look.current.pitch *= decay
      }
      // yaw about vertical, pitch about the resulting right vector
      v.dir.copy(pose.target).sub(pose.eye)
      v.dir.applyQuaternion(v.q.setFromAxisAngle(v.up, look.current.yaw))
      v.right.crossVectors(v.dir, v.up).normalize()
      v.dir.applyQuaternion(v.q.setFromAxisAngle(v.right, look.current.pitch))
      pose.target.copy(pose.eye).add(v.dir)
    }

    if (SNAP.has(view) || lost) {
      camera.position.copy(pose.eye)
      controls.target.copy(pose.target)
    } else if (view === 'crash') {
      camera.position.copy(pose.eye) // eased inside the view maths
      controls.target.lerp(pose.target, Math.min(1, dt * 8))
      if (shake.value > 0) {
        camera.position.x += (Math.random() - 0.5) * shake.value
        camera.position.y += (Math.random() - 0.5) * shake.value * 0.6
      }
    } else {
      const k = Math.min(1, dt * STIFF[view])
      camera.position.lerp(pose.eye, k)
      controls.target.lerp(pose.target, k)
    }
    // the desk is 0.6 m from the driver's eye, inside the scene's 1 m near
    // plane; the cockpit view pulls the plane in (the log depth buffer copes)
    const near = view === 'cockpit' ? COCKPIT_NEAR : baseNear.current
    if (camera.near !== near) {
      camera.near = near
      camera.updateProjectionMatrix()
    }
    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov += (pose.fov - camera.fov) * Math.min(1, dt * 6)
      camera.updateProjectionMatrix()
    }
    camera.lookAt(controls.target)
  })
  return null
}
