/**
 * The single owner of the camera outside drive mode.
 *
 * This replaces three components that each wrote camera.position, each wrote
 * controls.target, and each called controls.update() in the same frame. With
 * damping on, OrbitControls integrates once per update() call, so running it
 * three or four times a frame made every motion jittery and order-dependent;
 * and because the fly-to only ended once the camera got within 3 m of its goal,
 * dragging during a flight meant it never converged and never let go — the
 * camera kept hauling itself back to the station you had clicked.
 *
 * The rules here:
 *   - Exactly one useFrame writes the camera, and calls controls.update() once.
 *   - Automated motion is a fixed-duration tween. It always ends, on time,
 *     whatever the user does meanwhile.
 *   - Direct input outranks automation. Grabbing the mouse cancels a flight
 *     immediately; driving with WASD also drops a follow.
 *   - Following translates the whole rig rigidly, so the orbit offset the user
 *     chose — their angle, their zoom — survives untouched while the train
 *     moves, and they can keep orbiting it as it goes.
 *
 * Priorities stay at 0: EffectComposer owns rendering at priority 1, and giving
 * anything here a priority would take the render loop away from it.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import overlayMeta from '../data/kochi-overlay-meta.json'
import { stationById } from '../data/network'
import { poseAt, stationPoses } from '../sim/alignment'
import { trainStateById } from '../sim/engine'
import { project } from '../sim/projection'
import { poseAtWater, terminalPoses } from '../sim/waterAlignment'
import { boatStateById, terminals } from '../sim/waterEngine'
import { useSimStore } from '../state/useSimStore'
import { firstLoad } from './firstLoad'

interface ControlsLike {
  target: THREE.Vector3
  update: () => void
}

/* ============================================================================
 * CAMERA LIMITS — adjust to taste.
 *   MIN_CAM_Y   : lowest the eye may sit (m). Stops going under the map.
 *   MAX_CAM_Y   : highest the eye may sit (m). Ceiling for Q/E climbing.
 *   MAP_INSET_M : how far INSIDE the aerial sheet's edge the camera must stay.
 * ==========================================================================*/
const MIN_CAM_Y = 8
const MAX_CAM_Y = 2600
const MAP_INSET_M = 1500

/** every automated move takes this long, then hands control back */
const FLY_MS = 1100
/** how hard the follow anchor chases the vehicle (per second) */
const FOLLOW_LERP = 5
/** a follow starts with a flight if the vehicle is further than this off-screen */
const FLY_TO_FOLLOW_M = 400
/**
 * Explore's ride-along. Following a train there is a shot, not a tool: the
 * camera settles to a low three-quarter framing and circles the train slowly
 * as it runs, until the user takes the mouse — then it is theirs, rigidly
 * following as in Tracker. Radians per second; a full circle in about a minute.
 */
const RIDE_ORBIT_RATE = 0.1
const RIDE_DIST_M = 62
const RIDE_HEIGHT_M = 16
const RIDE_SETTLE = 0.6

const MAP_BOUNDS = (() => {
  const nw = project(overlayMeta.north, overlayMeta.west)
  const se = project(overlayMeta.south, overlayMeta.east)
  return {
    minX: Math.min(nw.x, se.x) + MAP_INSET_M,
    maxX: Math.max(nw.x, se.x) - MAP_INSET_M,
    minZ: Math.min(nw.z, se.z) + MAP_INSET_M,
    maxZ: Math.max(nw.z, se.z) - MAP_INSET_M,
  }
})()

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
/** easeInOutQuad — no overshoot, symmetric, ends flat */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'KeyC'])

function formFocused(): boolean {
  const el = document.activeElement
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  )
}

// harbour focus for the landing drift: boats below, viaduct on the skyline
const LANDING_FOCUS = (() => {
  const hc = terminalPoses[0]?.pos ?? new THREE.Vector3()
  return new THREE.Vector3(hc.x + 250, 0, hc.z + 150)
})()

interface Fly {
  fromPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toPos: THREE.Vector3
  toTarget: THREE.Vector3
  t0: number
}

export function CameraController() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null

  const fly = useRef<Fly | null>(null)
  const follow = useRef<{ kind: 'train' | 'boat'; id: string } | null>(null)
  const anchor = useRef(new THREE.Vector3())
  const anchored = useRef(false)
  const keys = useRef<Set<string>>(new Set())
  const shift = useRef(false)
  const landingT0 = useRef(0)
  /** the user has grabbed the camera since this follow began */
  const held = useRef(false)

  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const v = useMemo(
    () => ({
      fwd: new THREE.Vector3(),
      right: new THREE.Vector3(),
      move: new THREE.Vector3(),
      delta: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
    }),
    [],
  )

  /** Begin a timed flight from wherever we are now to a framing pose. */
  const startFly = useMemo(
    () => (toPos: THREE.Vector3, toTarget: THREE.Vector3) => {
      if (!controls) return
      fly.current = {
        fromPos: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPos,
        toTarget,
        t0: performance.now(),
      }
    },
    [camera, controls],
  )

  // --- direct input always outranks automation -----------------------------
  useEffect(() => {
    const el = gl.domElement
    const grab = () => {
      fly.current = null // let go the instant the user takes hold
      held.current = true // and the ride-along stops circling for them
    }
    const down = (e: KeyboardEvent) => {
      shift.current = e.shiftKey
      if (!MOVE_KEYS.has(e.code) || formFocused()) return
      if (useSimStore.getState().appMode === 'drive') return
      if (e.code === 'Space') e.preventDefault()
      if (!e.repeat) keys.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => {
      shift.current = e.shiftKey
      keys.current.delete(e.code)
    }
    const blur = () => keys.current.clear()
    el.addEventListener('pointerdown', grab)
    el.addEventListener('wheel', grab, { passive: true })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      el.removeEventListener('pointerdown', grab)
      el.removeEventListener('wheel', grab)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [gl])

  // --- react to experience + selection changes -----------------------------
  useEffect(
    () =>
      useSimStore.subscribe((state, prev) => {
        if (state.experience !== prev.experience) {
          follow.current = null
          if (state.experience === 'metro') {
            const { pos } = stationPoses[15] // Ernakulam core
            startFly(pos.clone().add(new THREE.Vector3(210, 130, 310)), pos.clone().setY(20))
          } else if (state.experience === 'water') {
            const mid = terminalPoses[0].pos.clone().add(terminalPoses[1].pos).multiplyScalar(0.5)
            startFly(mid.clone().add(new THREE.Vector3(520, 300, 420)), mid.clone().setY(2))
          }
          return
        }
        if (state.selection === prev.selection) return
        const sel = state.selection

        if (sel?.kind === 'train' || sel?.kind === 'boat') {
          follow.current = { kind: sel.kind, id: sel.id }
          anchored.current = false
          held.current = false
          return
        }
        follow.current = null

        if (sel?.kind === 'station') {
          const st = stationById.get(sel.id)
          if (!st) return
          const { pos, tan } = stationPoses[st.order]
          // frame across the line so the platform reads side-on, not end-on
          const side = new THREE.Vector3(tan.z, 0, -tan.x).multiplyScalar(150)
          startFly(pos.clone().add(side).add(new THREE.Vector3(0, 95, 0)), pos.clone().setY(14))
        } else if (sel?.kind === 'terminal') {
          const idx = terminals.findIndex((t) => t.id === sel.id)
          if (idx < 0) return
          const { pos, tan } = terminalPoses[idx]
          const side = new THREE.Vector3(tan.z, 0, -tan.x).multiplyScalar(120)
          startFly(pos.clone().add(side).add(new THREE.Vector3(0, 70, 0)), pos.clone().setY(3))
        }
      }),
    [startFly],
  )

  /** Where is the followed vehicle right now? */
  const vehiclePos = (out: THREE.Vector3): boolean => {
    const f = follow.current
    if (!f) return false
    const epochMs = useSimStore.getState().epochMs
    if (f.kind === 'train') {
      const st = trainStateById(epochMs, f.id)
      if (!st) return false
      poseAt(st.sKm, st.dir, pose)
      out.copy(pose.pos).setY(pose.pos.y + 2)
      return true
    }
    const st = boatStateById(epochMs, f.id)
    if (!st) return false
    poseAtWater(st.routeId, st.sKm, st.dir, pose)
    out.copy(pose.pos).setY(pose.pos.y + 3)
    return true
  }

  useFrame((state, dt) => {
    if (!controls) return
    const store = useSimStore.getState()

    // --- landing: slow cinematic drift over the harbour --------------------
    if (store.experience === 'landing') {
      // hold dead still until the opening view has streamed in, so the tiles
      // resolve for exactly this pose behind the loader
      if (!firstLoad.ready) {
        landingT0.current = state.clock.elapsedTime
        camera.position.set(LANDING_FOCUS.x + 950, 330, LANDING_FOCUS.z)
        controls.target.copy(LANDING_FOCUS)
        controls.update()
        return
      }
      const t = (state.clock.elapsedTime - landingT0.current) * 0.045
      v.tmp.set(LANDING_FOCUS.x + Math.cos(t) * 950, 330, LANDING_FOCUS.z + Math.sin(t) * 950)
      camera.position.lerp(v.tmp, Math.min(1, dt * 1.2))
      controls.target.lerp(LANDING_FOCUS, Math.min(1, dt * 1.2))
      controls.update()
      return
    }

    // drive mode owns the camera (see DriveTrain)
    if (store.appMode === 'drive') return

    // --- 1. keyboard flight, which overrides everything automated ----------
    if (keys.current.size > 0) {
      camera.getWorldDirection(v.fwd)
      v.fwd.y = 0
      if (v.fwd.lengthSq() < 1e-6) v.fwd.set(0, 0, -1)
      v.fwd.normalize()
      v.right.set(-v.fwd.z, 0, v.fwd.x)
      v.move.set(0, 0, 0)
      if (keys.current.has('KeyW')) v.move.add(v.fwd)
      if (keys.current.has('KeyS')) v.move.sub(v.fwd)
      if (keys.current.has('KeyD')) v.move.add(v.right)
      if (keys.current.has('KeyA')) v.move.sub(v.right)
      let dy = 0
      if (keys.current.has('KeyE') || keys.current.has('Space')) dy += 1
      if (keys.current.has('KeyQ') || keys.current.has('KeyC')) dy -= 1
      if (v.move.lengthSq() > 0 || dy !== 0) {
        // flying by hand means you want out of any automated move
        fly.current = null
        if (follow.current) {
          follow.current = null
          store.select(null)
        }
        if (v.move.lengthSq() > 0) v.move.normalize()
        // altitude-scaled: ~40 m/s near ground, ~2 km/s from 5 km up
        const alt = Math.max(10, camera.position.y)
        let speed = 30 + alt * 0.38
        if (shift.current) speed *= 3.5
        const step = speed * Math.min(dt, 0.1)
        v.move.multiplyScalar(step)
        v.move.y = dy * step * 0.7
        camera.position.add(v.move)
        controls.target.add(v.move)
      }
    } else if (fly.current) {
      // --- 2. timed flight ------------------------------------------------
      const f = fly.current
      const e = ease(clamp((performance.now() - f.t0) / FLY_MS, 0, 1))
      camera.position.lerpVectors(f.fromPos, f.toPos, e)
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e)
      if (e >= 1) fly.current = null
    } else if (follow.current) {
      // --- 3. follow: translate the whole rig, never re-aim it -------------
      if (vehiclePos(v.tmp)) {
        if (!anchored.current) {
          anchor.current.copy(v.tmp)
          anchored.current = true
          // if the vehicle is somewhere else entirely, fly to it first
          if (controls.target.distanceTo(v.tmp) > FLY_TO_FOLLOW_M) {
            const back = camera.position.clone().sub(controls.target).setLength(140)
            back.y = Math.max(back.y, 55)
            startFly(v.tmp.clone().add(back), v.tmp.clone())
          }
        }
        anchor.current.lerp(v.tmp, Math.min(1, dt * FOLLOW_LERP))
        v.delta.copy(anchor.current).sub(controls.target)
        controls.target.add(v.delta)
        camera.position.add(v.delta)
        // Explore: circle the train cinematically until the user takes hold
        if (store.appMode === 'explore' && !held.current) {
          v.tmp.copy(camera.position).sub(controls.target)
          const horiz = Math.hypot(v.tmp.x, v.tmp.z)
          const ang = Math.atan2(v.tmp.z, v.tmp.x) + RIDE_ORBIT_RATE * dt
          const k = Math.min(1, dt * RIDE_SETTLE)
          const r = horiz + (RIDE_DIST_M - horiz) * k
          const h = v.tmp.y + (RIDE_HEIGHT_M - v.tmp.y) * k
          camera.position.set(
            controls.target.x + Math.cos(ang) * r,
            controls.target.y + h,
            controls.target.z + Math.sin(ang) * r,
          )
        }
      } else {
        follow.current = null
      }
    }

    // --- 4. keep the rig inside the map, then commit once ------------------
    const p = camera.position
    const nx = clamp(p.x, MAP_BOUNDS.minX, MAP_BOUNDS.maxX)
    const ny = clamp(p.y, MIN_CAM_Y, MAX_CAM_Y)
    const nz = clamp(p.z, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ)
    if (nx !== p.x || ny !== p.y || nz !== p.z) {
      // move the target with the eye so the view direction never snaps
      controls.target.add(v.tmp.set(nx - p.x, ny - p.y, nz - p.z))
      p.set(nx, ny, nz)
    }
    controls.update()
  })

  return null
}
