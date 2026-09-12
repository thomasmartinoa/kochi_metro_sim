# Drive 6b — Camera Rig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ten camera views for drive mode — cab, chase, chase-far, left, right, nose, roof, trackside, drone, and the crash drone — as pure, tested camera maths, driven by one component that owns the camera in drive mode, cycled with C / picked with 1–9 / a HUD strip.

**Architecture:** `src/sim/driveCameras.ts` holds each view as a pure function `(rig, dt, state) → {eye, target, fov}` over a `Rig` (lead-car pose, heading, speed, wreck lead). `DriveCamera.tsx` is the single writer of the camera in drive mode; `DriveTrain.tsx` stops touching the camera and just publishes the rig. The crash drone from 6a becomes one view among the others.

**Tech Stack:** TypeScript, vitest, react-three-fiber 9, three 0.185.

**Spec:** `docs/superpowers/specs/2026-09-11-drive-game-design.md` §3.5.

## Global Constraints

- `src/sim/*` stays framework-free (three maths types allowed, as alignment.ts does).
- No `Co-Authored-By` trailers (CLAUDE.md).
- Gate before claiming done: `npx tsc -b`, `npm test`, `npm run build`; scene work verified with a Playwright screenshot per view.
- Every per-frame camera motion uses a **clamped dt** (≤ 1/30 s) so a hitch never teleports the camera (the 6a lesson).
- Cockpit view is 6g; the default view stays `cab` until then.

---

## File structure

| file | responsibility |
|---|---|
| `src/sim/driveCameras.ts` (create) | `Rig`, `DriveView`, `VIEWS` order, one pure function per view, `viewCamera(view, rig, prev, dt)` |
| `src/sim/driveCameras.test.ts` (create) | per-view invariants |
| `src/state/useDriveStore.ts` (modify) | `view: DriveView`, `setView`, `cycleView` (replaces `cam`/`toggleCam`) |
| `src/scene/drive/rig.ts` (create) | the mutable `Rig` the train publishes every frame |
| `src/scene/drive/DriveCamera.tsx` (create) | owns the camera in drive mode; smoothing; mouse-look in cab; shake |
| `src/scene/DriveTrain.tsx` (modify) | publishes the rig; no camera code; keys C and 1–9 |
| `src/ui/DrivePanel.tsx` (modify) | camera strip replaces `view: chase` |
| `src/scene/World.tsx` (modify) | mounts `DriveCamera` |

---

### Task 1: The rig and the view maths

**Files:**
- Create: `src/sim/driveCameras.ts`
- Create: `src/sim/driveCameras.test.ts`

**Interfaces:**
```ts
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
  | 'cab' | 'chase' | 'chase-far' | 'left' | 'right' | 'nose' | 'roof' | 'trackside' | 'drone' | 'crash'
/** cycle order for C; 'crash' is not in it (it is chosen by the derail) */
export const VIEWS: readonly DriveView[]
export interface CamPose { eye: Vector3; target: Vector3; fov: number }
export interface CamMemory { az: number; r: number; h: number; anchor: Vector3 | null; init: boolean }
export function newCamMemory(): CamMemory
/** dt is clamped inside; `mem` is per-view persistent state (orbit angle, trackside anchor) */
export function viewCamera(view: DriveView, rig: Rig, mem: CamMemory, dt: number): CamPose
```

- [ ] **Step 1: Write the failing tests** `src/sim/driveCameras.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { newCamMemory, viewCamera, VIEWS, type Rig } from './driveCameras'

const rig = (over: Partial<Rig> = {}): Rig => ({
  pos: new Vector3(1000, 14.8, 2000),
  heading: new Vector3(0, 0, 1),
  speed: 15,
  wreckLead: null,
  ...over,
})
const finite = (v: Vector3) => [v.x, v.y, v.z].every(Number.isFinite)

describe('drive cameras', () => {
  it('every view yields a finite eye, target and fov', () => {
    for (const v of [...VIEWS, 'crash' as const]) {
      const p = viewCamera(v, rig({ wreckLead: new Vector3(1010, 15, 2020) }), newCamMemory(), 1 / 60)
      expect(finite(p.eye), v).toBe(true)
      expect(finite(p.target), v).toBe(true)
      expect(p.fov, v).toBeGreaterThan(20)
      expect(p.fov, v).toBeLessThan(120)
    }
  })

  it('chase sits behind and above, looking down the line of travel', () => {
    const p = viewCamera('chase', rig(), newCamMemory(), 1 / 60)
    expect(p.eye.z).toBeLessThan(1000 + 2000 - 1000) // behind along +z travel: z < pos.z
    expect(p.eye.z).toBeLessThan(2000)
    expect(p.eye.y).toBeGreaterThan(14.8 + 10)
    expect(p.target.z).toBeGreaterThan(2000)
  })

  it('left and right are mirror images across the track', () => {
    const l = viewCamera('left', rig(), newCamMemory(), 1 / 60)
    const r = viewCamera('right', rig(), newCamMemory(), 1 / 60)
    expect(l.eye.x).toBeCloseTo(-r.eye.x + 2000, 5) // symmetric about x = 1000
    expect(l.eye.y).toBeCloseTo(r.eye.y, 5)
    expect(l.eye.z).toBeCloseTo(r.eye.z, 5)
  })

  it('trackside plants a camera ahead and jumps to a new spot once the train has passed it', () => {
    const mem = newCamMemory()
    const first = viewCamera('trackside', rig(), mem, 1 / 60)
    expect(first.eye.z).toBeGreaterThan(2000) // ahead of the train
    const anchor = first.eye.clone()
    // the train passes it by 60 m
    const later = viewCamera('trackside', rig({ pos: new Vector3(1000, 14.8, anchor.z + 60) }), mem, 1 / 60)
    expect(later.eye.z).toBeGreaterThan(anchor.z + 60) // re-planted ahead again
    // and while it has not been passed, the anchor stays put
    const mem2 = newCamMemory()
    const a = viewCamera('trackside', rig(), mem2, 1 / 60).eye.clone()
    const b = viewCamera('trackside', rig({ pos: new Vector3(1000, 14.8, 2030) }), mem2, 1 / 60).eye
    expect(b.distanceTo(a)).toBe(0)
  })

  it('drone circles: the azimuth advances with time and never jumps on a slow frame', () => {
    const mem = newCamMemory()
    const p0 = viewCamera('drone', rig(), mem, 1 / 60)
    const az0 = mem.az
    viewCamera('drone', rig(), mem, 1 / 60)
    const perFrame = mem.az - az0
    expect(perFrame).toBeGreaterThan(0)
    const before = mem.az
    viewCamera('drone', rig(), mem, 0.5) // a half-second hitch
    expect(mem.az - before).toBeLessThanOrEqual(perFrame * 2 + 1e-9) // clamped to a 30 Hz step at most
    expect(p0.eye.y).toBeGreaterThan(14.8 + 80)
  })

  it('crash orbits the wreck lead, not the rail pose', () => {
    const mem = newCamMemory()
    const w = new Vector3(1200, 16, 2400)
    const p = viewCamera('crash', rig({ wreckLead: w }), mem, 1 / 60)
    expect(p.target.distanceTo(w)).toBeLessThan(3)
  })

  it('cab sits in the nose at driver height with a wide field of view', () => {
    const p = viewCamera('cab', rig(), newCamMemory(), 1 / 60)
    expect(p.eye.y).toBeGreaterThan(14.8 + 1.5)
    expect(p.eye.y).toBeLessThan(14.8 + 4)
    expect(p.fov).toBeGreaterThanOrEqual(60)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/sim/driveCameras.test.ts` → module not found.

- [ ] **Step 3: Implement** `src/sim/driveCameras.ts`:

```ts
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
  pos: Vector3
  heading: Vector3
  speed: number
  wreckLead: Vector3 | null
}

export type DriveView =
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
  cab: 'Cab',
  chase: 'Chase',
  'chase-far': 'Chase · far',
  left: 'Left',
  right: 'Right',
  nose: 'Nose cam',
  roof: 'Roof cam',
  trackside: 'Trackside',
  drone: 'Drone',
  crash: 'Crash',
}

export interface CamPose {
  eye: Vector3
  target: Vector3
  fov: number
}

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

const CAB = { ahead: 2.6, up: 3.1, look: 80, lookUp: 1.0, fov: 62 }
const CHASE = { back: 85, up: 32, look: 40, fov: DEFAULT_FOV }
const CHASE_FAR = { back: 220, up: 90, look: 60, fov: DEFAULT_FOV }
const SIDE = { out: 22, up: 3, ahead: 6, fov: 55 }
const NOSE = { ahead: 9.2, up: 1.6, look: 120, fov: 80 }
const ROOF = { back: 2, up: 4.4, look: 90, fov: 78 }
const TRACKSIDE = { plantAhead: 70, passedBy: 40, out: 9, up: 2.2, fov: 45 }
const DRONE = { r: 60, h: 150, rate: 0.12, fov: 55 }
const CRASH = { r: 34, h: 13, rate: 0.2, ease: 0.8, fov: DEFAULT_FOV }

function cab(rig: Rig): CamPose {
  return {
    eye: rig.pos.clone().addScaledVector(rig.heading, CAB.ahead).setY(rig.pos.y + CAB.up),
    target: rig.pos.clone().addScaledVector(rig.heading, CAB.look).setY(rig.pos.y + CAB.lookUp),
    fov: CAB.fov,
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
  return {
    eye: rig.pos.clone().add(out).addScaledVector(rig.heading, SIDE.ahead).setY(rig.pos.y + SIDE.up),
    target: rig.pos.clone().addScaledVector(rig.heading, SIDE.ahead).setY(rig.pos.y + 1.5),
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

/** A static camera beside the track ahead; when the train has passed it, plant the next one. */
function trackside(rig: Rig, mem: CamMemory): CamPose {
  const along = (p: Vector3) => p.clone().sub(rig.pos).dot(rig.heading)
  if (!mem.anchor || along(mem.anchor) < -TRACKSIDE.passedBy) {
    const out = leftOf(rig.heading).multiplyScalar(TRACKSIDE.out)
    mem.anchor = rig.pos
      .clone()
      .addScaledVector(rig.heading, TRACKSIDE.plantAhead)
      .add(out)
      .setY(rig.pos.y + TRACKSIDE.up)
  }
  return { eye: mem.anchor.clone(), target: rig.pos.clone().setY(rig.pos.y + 1.8), fov: TRACKSIDE.fov }
}

/** Slow circle high above the train. */
function drone(rig: Rig, mem: CamMemory, dt: number): CamPose {
  if (!mem.init) {
    mem.az = Math.atan2(-rig.heading.z, -rig.heading.x) // start behind
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

/**
 * The crash drone: picks its orbit up from wherever the camera was (the
 * caller seeds mem.az/r/h from the live camera on the first frame) and eases
 * in to a close orbit of the wreck's lead car.
 */
function crash(rig: Rig, mem: CamMemory, dt: number): CamPose {
  const centre = rig.wreckLead ?? rig.pos
  if (!mem.init) {
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
    eye: new Vector3(centre.x + Math.cos(mem.az) * mem.r, centre.y + mem.h, centre.z + Math.sin(mem.az) * mem.r),
    target: centre.clone().setY(centre.y + 1.5),
    fov: CRASH.fov,
  }
}

export function viewCamera(view: DriveView, rig: Rig, mem: CamMemory, dtRaw: number): CamPose {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_DT)
  switch (view) {
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

/** Seed the crash orbit from a live camera position so the cut is invisible. */
export function seedCrashFrom(mem: CamMemory, eye: Vector3, centre: Vector3): void {
  const d = eye.clone().sub(centre)
  mem.az = Math.atan2(d.z, d.x)
  mem.r = Math.hypot(d.x, d.z)
  mem.h = d.y
  mem.init = true
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/sim/driveCameras.test.ts` → PASS (fix the chase test's first line if it reads oddly: it should assert `p.eye.z < 2000`).

- [ ] **Step 5: Gate and commit**
```bash
npx tsc -b && npm test && npm run build
git add src/sim/driveCameras.ts src/sim/driveCameras.test.ts
git commit -m "Drive camera views as pure maths"
```

---

### Task 2: Store: a view instead of a toggle

**Files:**
- Modify: `src/state/useDriveStore.ts`

**Interfaces:**
```ts
export type { DriveView } from '../sim/driveCameras'
// store: view: DriveView; setView(v): void; cycleView(delta = 1): void
// start() sets view to 'cab'; on derail the scene sets 'crash'; restart() returns to the view used before the crash
```

- [ ] **Step 1: Replace** `cam`/`toggleCam`/`DriveCam` with:

```ts
import { VIEWS, type DriveView } from '../sim/driveCameras'
export type { DriveView }
// in the interface:
  view: DriveView
  /** the driver's view before a crash, to return to on restart */
  viewBeforeCrash: DriveView
  setView: (v: DriveView) => void
  cycleView: (delta?: number) => void
// in the store:
  view: 'cab',
  viewBeforeCrash: 'cab',
  start: (dir) => {
    lastTickMs = performance.now()
    set({ drive: newDrive(dir), view: 'cab', viewBeforeCrash: 'cab' })
  },
  setView: (v) => set((s) => ({ view: v, viewBeforeCrash: v === 'crash' ? s.view : s.viewBeforeCrash })),
  cycleView: (delta = 1) =>
    set((s) => {
      const i = VIEWS.indexOf(s.view === 'crash' ? s.viewBeforeCrash : s.view)
      return { view: VIEWS[(i + delta + VIEWS.length) % VIEWS.length] }
    }),
  restart: () => {
    const d = get().drive
    if (d?.phase === 'derailed') {
      lastTickMs = performance.now()
      set((s) => ({ drive: restartFromLastStop(d), view: s.viewBeforeCrash }))
    }
  },
```
Update every reference: `DriveTrain.tsx` (`toggleCam` → `cycleView`), `DrivePanel.tsx` (`cam`/`toggleCam` → `view`/`setView`/`cycleView`).

- [ ] **Step 2: Gate and commit**
```bash
npx tsc -b && npm test && npm run build
git add src/state/useDriveStore.ts src/scene/DriveTrain.tsx src/ui/DrivePanel.tsx
git commit -m "Drive store holds a view, not a toggle"
```

---

### Task 3: DriveCamera owns the camera; DriveTrain publishes the rig

**Files:**
- Create: `src/scene/drive/rig.ts`
- Create: `src/scene/drive/DriveCamera.tsx`
- Modify: `src/scene/DriveTrain.tsx` (remove all camera code; publish the rig; keys)
- Modify: `src/scene/World.tsx` (mount)

**Interfaces:**
```ts
// rig.ts
export const rig: Rig & { valid: boolean }   // written by DriveTrain every frame
```

- [ ] **Step 1: The rig** — `src/scene/drive/rig.ts`:
```ts
/** The lead car's pose, published by DriveTrain every frame for the camera. Plain mutable like wreck/firstLoad. */
import * as THREE from 'three'
import type { Rig } from '../../sim/driveCameras'
export const rig: Rig & { valid: boolean } = {
  pos: new THREE.Vector3(),
  heading: new THREE.Vector3(0, 0, 1),
  speed: 0,
  wreckLead: null,
  valid: false,
}
```

- [ ] **Step 2: DriveTrain publishes** — after `placeCars()`/the derailed branch, before the old `// camera` block, add:
```ts
    // publish the rig: lead car pose, for DriveCamera
    const lead = group.current.children[0] as THREE.Group
    rig.pos.copy(lead.position)
    rig.heading.set(0, 0, 1).applyQuaternion(lead.quaternion).setY(0).normalize()
    rig.speed = d.vMs
    rig.wreckLead = d.phase === 'derailed' && wreck.ready ? wreck.lead : null
    rig.valid = true
```
Delete the whole `if (controls) { … }` camera block, the `camGoal`/`lookGoal`/`drone` refs, the `DRONE_*` constants, the `controls` from `useThree`, and the `shake` import. On the derail frame (inside `if (!wreck.ready) { … }`) add `useDriveStore.getState().setView('crash')`. Keys: replace the `case 'c'` block with:
```ts
        case 'c':
        case 'C':
          cycleView(1)
          break
        case 'v':
        case 'V':
          cycleView(-1)
          break
        default:
          if (/^[1-9]$/.test(e.key)) {
            const v = VIEWS[Number(e.key) - 1]
            if (v) setView(v)
          }
```
with `cycleView`, `setView` pulled from the store and `VIEWS` imported from `../sim/driveCameras`. Key handling must skip when a form field is focused (copy `formFocused()` from CameraController or inline the same three `instanceof` checks).

- [ ] **Step 3: DriveCamera** — `src/scene/drive/DriveCamera.tsx`:
```tsx
/**
 * The one owner of the camera in drive mode. Reads the rig DriveTrain
 * publishes, asks the pure view maths where the camera should be, and eases
 * the real camera there. Cab view adds mouse-look; the crash view adds shake.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { newCamMemory, seedCrashFrom, viewCamera, type DriveView } from '../../sim/driveCameras'
import { useDriveStore } from '../../state/useDriveStore'
import { useSimStore } from '../../state/useSimStore'
import { rig } from './rig'
import { shake, wreck } from './wreck'

const MAX_DT = 1 / 30
/** how hard each view eases toward its goal, per second (higher = stiffer) */
const STIFF: Record<DriveView, number> = {
  cab: 14, chase: 4, 'chase-far': 3, left: 10, right: 10, nose: 20, roof: 20,
  trackside: 30, drone: 3, crash: 3,
}
/** cab mouse-look limits, radians */
const LOOK_YAW = 1.2
const LOOK_PITCH = 0.5
const LOOK_RETURN = 2.5

export function DriveCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void; enabled: boolean } | null
  const mem = useRef(newCamMemory())
  const lastView = useRef<DriveView | null>(null)
  const look = useRef({ yaw: 0, pitch: 0, dragging: false })
  const v = useMemo(() => ({ eye: new THREE.Vector3(), target: new THREE.Vector3(), tmp: new THREE.Vector3() }), [])
  const baseFov = useRef(camera.fov)

  // cab mouse-look: drag to look around, springs back when released
  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => { if (useDriveStore.getState().view === 'cab') { look.current.dragging = true; e.preventDefault() } }
    const move = (e: PointerEvent) => {
      if (!look.current.dragging) return
      look.current.yaw = THREE.MathUtils.clamp(look.current.yaw - e.movementX * 0.004, -LOOK_YAW, LOOK_YAW)
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - e.movementY * 0.003, -LOOK_PITCH, LOOK_PITCH)
    }
    const up = () => { look.current.dragging = false }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [gl])

  useFrame((_, dtRaw) => {
    const driving = useSimStore.getState().appMode === 'drive' && !!useDriveStore.getState().drive
    if (!driving || !rig.valid || !controls) {
      if (lastView.current !== null) { camera.fov = baseFov.current; camera.updateProjectionMatrix(); lastView.current = null }
      return
    }
    // OrbitControls must not fight us: it is off for the whole drive
    controls.enabled = false
    const dt = Math.min(dtRaw, MAX_DT)
    const view = useDriveStore.getState().view
    if (view !== lastView.current) {
      mem.current = newCamMemory()
      // the crash drone picks its orbit up from where the camera IS: no cut
      if (view === 'crash') seedCrashFrom(mem.current, camera.position, rig.wreckLead ?? rig.pos)
      lastView.current = view
    }
    const pose = viewCamera(view, rig, mem.current, dt)

    // cab: mouse-look about the eye, springing back when not dragging
    if (view === 'cab') {
      if (!look.current.dragging) {
        look.current.yaw *= Math.max(0, 1 - dt * LOOK_RETURN)
        look.current.pitch *= Math.max(0, 1 - dt * LOOK_RETURN)
      }
      v.tmp.copy(pose.target).sub(pose.eye)
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), look.current.yaw)
      v.tmp.applyQuaternion(yawQ)
      const right = new THREE.Vector3().crossVectors(v.tmp, new THREE.Vector3(0, 1, 0)).normalize()
      v.tmp.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right, look.current.pitch))
      pose.target.copy(pose.eye).add(v.tmp)
    }

    // ease toward the pose; the stiffer the view, the tighter it tracks
    const k = Math.min(1, dt * STIFF[view])
    // trackside and the on-body cams snap: they are rigidly mounted
    if (view === 'trackside' || view === 'nose' || view === 'roof' || view === 'cab') {
      camera.position.copy(pose.eye)
      controls.target.copy(pose.target)
    } else if (view === 'crash') {
      camera.position.copy(pose.eye) // already eased inside the view maths
      controls.target.lerp(pose.target, Math.min(1, dt * 8))
    } else {
      camera.position.lerp(pose.eye, k)
      controls.target.lerp(pose.target, k)
    }
    if (view === 'crash' && shake.value > 0) {
      camera.position.x += (Math.random() - 0.5) * shake.value
      camera.position.y += (Math.random() - 0.5) * shake.value * 0.6
    }
    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov += (pose.fov - camera.fov) * Math.min(1, dt * 6)
      camera.updateProjectionMatrix()
    }
    camera.lookAt(controls.target)
  })
  return null
}
```
Mount in `World.tsx` next to `<DriveTrain />`: `<DriveCamera />` (import from `./drive/DriveCamera`). Re-enable OrbitControls when leaving drive: in `CameraController`'s useFrame, the `if (store.appMode === 'drive') return` line becomes
```ts
    if (store.appMode === 'drive') return
    controls.enabled = true
```
(one assignment per frame is fine).

- [ ] **Step 4: Verify in the browser** — a script that starts a drive, sets each view via `window.__driveView(v)` (add the dev hook in World.tsx: `w.__driveView = (v) => useDriveStore.getState().setView(v)`), waits 3 s, screenshots the canvas: `cam-<view>.png` for all nine plus, after a scripted derail, `cam-crash.png`. Check each reads as its name.

- [ ] **Step 5: Gate and commit**
```bash
npx tsc -b && npm test && npm run build
git add src/scene/drive/rig.ts src/scene/drive/DriveCamera.tsx src/scene/DriveTrain.tsx src/scene/CameraController.tsx src/scene/World.tsx
git commit -m "One camera owner for drive mode, ten views"
```

---

### Task 4: The camera strip on the desk

**Files:**
- Modify: `src/ui/DrivePanel.tsx`

- [ ] **Step 1: Replace** the `view: {cam}` button with a strip. Import `VIEWS, VIEW_LABEL` from `'../sim/driveCameras'`, read `view`/`setView` from the store, and render, where the old button was:

```tsx
          <div className="flex flex-wrap gap-1">
            {VIEWS.map((v, i) => (
              <button
                key={v}
                onClick={() => setView(v)}
                title={`${VIEW_LABEL[v]} (${i + 1})`}
                className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                  view === v ? 'bg-kmrl text-ink' : 'text-paper-dim hover:bg-panel hover:text-paper'
                }`}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
```
keep `exit` on its own line below. Update the start screen's key hint: `C / V next / previous view · 1-9 pick a view`.

- [ ] **Step 2: Verify** — screenshot the desk with the strip; click `Drone` and confirm the view changes (`window.__drive` unaffected; camera y > rail + 80).

- [ ] **Step 3: Gate and commit**
```bash
npx tsc -b && npm test && npm run build
git add src/ui/DrivePanel.tsx
git commit -m "Camera strip on the drive desk"
```

---

## Self-review

**Spec §3.5 coverage:** cockpit (deferred to 6g, noted), cab, chase, chase-far, left/right, nose/roof, trackside with re-plant, drone, C cycles, 1–9 direct, HUD strip — all in Tasks 1–4. Crash view carried over from 6a as one view among the others (Task 1 `crash`, Task 3 seeding). Mouse-look in cab (Task 3).

**Types:** `Rig`, `CamMemory`, `viewCamera`, `seedCrashFrom`, `VIEWS`, `VIEW_LABEL` defined in Task 1 and used with the same names in Tasks 2–4. `rig.valid` defined in Task 3's `rig.ts` and read in `DriveCamera`.

**Placeholders:** none.
