/**
 * Drive-mode camera views as pure maths: each is a function of where the
 * lead car is and how it is moving. No three components, no React — the
 * scene's DriveCamera applies the result. Per-view state that has to
 * persist between frames (an orbit angle, a trackside anchor) lives in a
 * CamMemory the caller keeps.
 *
 * Every motion here runs on a dt clamped to a 30 Hz frame: a slow frame
 * moves a camera the same small amount a smooth one would, just later.
 * (The 6a crash camera taught that lesson at 54 m per hitch.)
 */
import { Vector3 } from 'three'

export interface Rig {
  /** lead car centre, world */
  pos: Vector3
  /** unit travel heading, horizontal */
  heading: Vector3
  /** m/s */
  speed: number
  /** the wreck's lead car while derailed, else null */
  wreckLead: Vector3 | null
}

export type DriveView =
  | 'cockpit'
  | 'cab'
  | 'chase'
  | 'chase-far'
  | 'left'
  | 'right'
  | 'nose'
  | 'roof'
  | 'trackside'
  | 'drone'
  | 'crash'

/** what C cycles through; 'crash' is chosen by a derailment, not the driver */
export const VIEWS: readonly DriveView[] = [
  'cockpit',
  'cab',
  'chase',
  'chase-far',
  'left',
  'right',
  'nose',
  'roof',
  'trackside',
  'drone',
]

export const VIEW_LABEL: Record<DriveView, string> = {
  cockpit: 'Cockpit',
  cab: 'Cab',
  chase: 'Chase',
  'chase-far': 'Far',
  left: 'Left',
  right: 'Right',
  nose: 'Nose',
  roof: 'Roof',
  trackside: 'Trackside',
  drone: 'Drone',
  crash: 'Crash',
}

export interface CamPose {
  eye: Vector3
  target: Vector3
  fov: number
}

/** per-view state that persists between frames */
export interface CamMemory {
  az: number
  r: number
  h: number
  anchor: Vector3 | null
  init: boolean
}

export function newCamMemory(): CamMemory {
  return { az: 0, r: 0, h: 0, anchor: null, init: false }
}

const MAX_DT = 1 / 30
const DEFAULT_FOV = 50

/** left-hand unit vector for a heading (rotate +90° about Y) */
const leftOf = (h: Vector3) => new Vector3(h.z, 0, -h.x)

// --- the views ------------------------------------------------------------

/**
 * The rig's `pos` is the LEAD CAR'S CENTRE; the cab is at its far end, half a
 * car (9.3 m) ahead. Every on-body view measures from there. (The first cut
 * measured from the centre and looked down the saloon at the gangway.)
 */
const NOSE_AHEAD_M = 9.3
const CAB = { ahead: NOSE_AHEAD_M - 1.4, up: 3.1, look: 80, lookUp: 1.0, fov: 62 }
/**
 * The driver's eye in the modelled cab: on the seat (7.6 m ahead of the car's
 * centre, cushion at 1.7 m), gaze dipped ~14° so the desk and the lever sit
 * in the lower third with the line above them, the way a driver actually
 * looks at the road.
 */
const COCKPIT = { ahead: 7.55, up: 2.5, look: 30, lookUp: -3.1, fov: 72 }
const CHASE = { back: 85, up: 32, look: 40, fov: DEFAULT_FOV }
const CHASE_FAR = { back: 220, up: 90, look: 60, fov: DEFAULT_FOV }
/** a dolly pacing the train beside the track, the "GoPro on a car alongside" shot */
const SIDE = { out: 22, up: 3, ahead: 6, fov: 55 }
const NOSE = { ahead: NOSE_AHEAD_M + 0.3, up: 1.6, look: 120, fov: 80 }
const ROOF = { back: -NOSE_AHEAD_M + 4, up: 4.4, look: 90, fov: 78 }
/** a static camera planted ahead beside the track; re-planted once the train has passed it */
const TRACKSIDE = { plantAhead: 70, passedBy: 40, out: 9, up: 2.2, fov: 45 }
/**
 * The replay opens on trackside, and must open WITH the train in shot: plant
 * closer, and a little higher, so the first frame is the set bearing down on
 * the camera rather than a speck 70 m off.
 */
const TRACKSIDE_REPLAY = { plantAhead: 34, passedBy: 30, out: 11, up: 3.2, fov: 50 }
const DRONE = { r: 60, h: 150, rate: 0.12, fov: 55 }
/** eases in from wherever the camera was to a close orbit of the wreck */
const CRASH = { r: 34, h: 13, rate: 0.2, ease: 0.8, fov: DEFAULT_FOV }

function cab(rig: Rig, c: typeof CAB = CAB): CamPose {
  return {
    eye: rig.pos.clone().addScaledVector(rig.heading, c.ahead).setY(rig.pos.y + c.up),
    target: rig.pos.clone().addScaledVector(rig.heading, c.look).setY(rig.pos.y + c.lookUp),
    fov: c.fov,
  }
}

function chase(rig: Rig, c: typeof CHASE): CamPose {
  return {
    eye: rig.pos.clone().addScaledVector(rig.heading, -c.back).setY(rig.pos.y + c.up),
    target: rig.pos.clone().addScaledVector(rig.heading, c.look).setY(rig.pos.y),
    fov: c.fov,
  }
}

function side(rig: Rig, sign: 1 | -1): CamPose {
  const out = leftOf(rig.heading).multiplyScalar(sign * SIDE.out)
  const along = rig.pos.clone().addScaledVector(rig.heading, SIDE.ahead)
  return {
    eye: along.clone().add(out).setY(rig.pos.y + SIDE.up),
    target: along.setY(rig.pos.y + 1.5),
    fov: SIDE.fov,
  }
}

function nose(rig: Rig): CamPose {
  return {
    eye: rig.pos.clone().addScaledVector(rig.heading, NOSE.ahead).setY(rig.pos.y + NOSE.up),
    target: rig.pos.clone().addScaledVector(rig.heading, NOSE.look).setY(rig.pos.y + NOSE.up),
    fov: NOSE.fov,
  }
}

function roof(rig: Rig): CamPose {
  return {
    eye: rig.pos.clone().addScaledVector(rig.heading, -ROOF.back).setY(rig.pos.y + ROOF.up),
    target: rig.pos.clone().addScaledVector(rig.heading, ROOF.look).setY(rig.pos.y + 2),
    fov: ROOF.fov,
  }
}

function trackside(rig: Rig, mem: CamMemory, c: typeof TRACKSIDE = TRACKSIDE): CamPose {
  const along = mem.anchor ? mem.anchor.clone().sub(rig.pos).dot(rig.heading) : -Infinity
  if (!mem.anchor || along < -c.passedBy) {
    const out = leftOf(rig.heading).multiplyScalar(c.out)
    mem.anchor = rig.pos.clone().addScaledVector(rig.heading, c.plantAhead).add(out).setY(rig.pos.y + c.up)
  }
  return { eye: mem.anchor.clone(), target: rig.pos.clone().setY(rig.pos.y + 1.8), fov: c.fov }
}

/** Trackside as the replay opens it: the train already in shot. */
export function replayTrackside(rig: Rig, mem: CamMemory): CamPose {
  return trackside(rig, mem, TRACKSIDE_REPLAY)
}

function drone(rig: Rig, mem: CamMemory, dt: number): CamPose {
  if (!mem.init) {
    mem.az = Math.atan2(-rig.heading.z, -rig.heading.x) // start behind the train
    mem.init = true
  }
  mem.az += DRONE.rate * dt
  return {
    eye: new Vector3(
      rig.pos.x + Math.cos(mem.az) * DRONE.r,
      rig.pos.y + DRONE.h,
      rig.pos.z + Math.sin(mem.az) * DRONE.r,
    ),
    target: rig.pos.clone(),
    fov: DRONE.fov,
  }
}

function crash(rig: Rig, mem: CamMemory, dt: number): CamPose {
  const centre = rig.wreckLead ?? rig.pos
  if (!mem.init) {
    // unseeded: start from the chase pose
    mem.az = Math.atan2(-rig.heading.z, -rig.heading.x)
    mem.r = CHASE.back
    mem.h = CHASE.up
    mem.init = true
  }
  mem.az += CRASH.rate * dt
  const k = dt * CRASH.ease
  mem.r += (CRASH.r - mem.r) * k
  mem.h += (CRASH.h - mem.h) * k
  return {
    eye: new Vector3(
      centre.x + Math.cos(mem.az) * mem.r,
      centre.y + mem.h,
      centre.z + Math.sin(mem.az) * mem.r,
    ),
    target: centre.clone().setY(centre.y + 1.5),
    fov: CRASH.fov,
  }
}

/** Where the camera should be for `view` this frame. `mem` is that view's persistent state. */
export function viewCamera(view: DriveView, rig: Rig, mem: CamMemory, dtRaw: number): CamPose {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_DT)
  switch (view) {
    case 'cockpit':
      return cab(rig, COCKPIT)
    case 'cab':
      return cab(rig)
    case 'chase':
      return chase(rig, CHASE)
    case 'chase-far':
      return chase(rig, CHASE_FAR)
    case 'left':
      return side(rig, 1)
    case 'right':
      return side(rig, -1)
    case 'nose':
      return nose(rig)
    case 'roof':
      return roof(rig)
    case 'trackside':
      return trackside(rig, mem)
    case 'drone':
      return drone(rig, mem, dt)
    case 'crash':
      return crash(rig, mem, dt)
  }
}

/** Seed the crash orbit from a live camera position so the switch is invisible. */
export function seedCrashFrom(mem: CamMemory, eye: Vector3, centre: Vector3): void {
  const d = eye.clone().sub(centre)
  mem.az = Math.atan2(d.z, d.x)
  mem.r = Math.hypot(d.x, d.z)
  mem.h = d.y
  mem.init = true
}
