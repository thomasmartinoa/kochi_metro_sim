# Drive 6a — Derailment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A train taken into a curve too fast, or into the buffer stop, derails: the rule is decided in the pure sim, the wreck is Rapier rigid bodies tumbling on the viaduct, with smoke, fire, shake, a crash panel and a restart from the last station; speed boards stand beside the track ahead of every curve restriction; the old auto penalty-brake is gone.

**Architecture:** `src/sim/drive.ts` moves onto geometric metres (`gM`) through an injectable `DriveEnv` (chainage↔geometry and curvature), so physics rates are real and tests run on synthetic track. On the derail frame the plain car meshes hide and a lazily-loaded `DriveWreck` spawns three dynamic Rapier bodies at the same transforms with the set's velocity, joined at the couplers, over generated deck/parapet/ground colliders. The sim decides; the scene shows.

**Tech Stack:** TypeScript, vitest, react-three-fiber 9, three 0.185, `@react-three/rapier` 2.x (lazy-loaded), drei `Text`.

**Spec:** `docs/superpowers/specs/2026-09-11-drive-game-design.md` — sections 3.1–3.3, 3.5 (camera follow of the wreck only), 3.7 (penalty-brake removal), 5 (phase 6a), 6 (tests).

## Global Constraints

- `src/sim/*` stays framework-free: no react, no r3f, no three components (three maths types are allowed, as `alignment.ts` already does).
- No `Co-Authored-By` or AI attribution trailers on commits (CLAUDE.md).
- Before claiming a task done: `npx tsc -b`, `npm test`, `npm run build` all clean. Scene tasks are verified with a Playwright screenshot from the dev server (`npm run dev`, port 5173); the composer must be stubbed for software rendering — see `~/.claude/projects/-mnt-ssd-sata-kochi-metro-sim/memory/headless-3d-verification.md`.
- Derail constants (spec 3.2): `A_LAT_WARN = 1.6`, `A_LAT_DERAIL = 2.6` m/s², `DERAIL_HOLD_S = 0.6`, `BUFFER_KMH = 15`. `curveLimitKmh(κ) = 3.6 · sqrt(A_LAT_DERAIL / |κ|)`.
- Speed limits are advisory: nothing in the game brakes for the driver.
- Rapier loads only after a derail (`React.lazy`), never for Tracker/Explore.

---

## File structure

| file | responsibility |
|---|---|
| `src/sim/drive.ts` (modify) | drive physics on geometric metres; `DriveEnv`; derail rule; buffer stop; restart; HUD lookahead |
| `src/sim/drive.test.ts` (modify) | synthetic-track tests for all of the above |
| `src/sim/speedLimits.ts` (create) | `curveRestrictions(env)` — contiguous stretches where the curve limit is under line speed |
| `src/sim/speedLimits.test.ts` (create) | tests on synthetic curvature |
| `src/state/useDriveStore.ts` (modify) | `restart`, `timeScale`, `derailedAtMs`; pass the real env to `stepDrive` |
| `src/scene/DriveTrain.tsx` (modify) | hides the plain cars once derailed; camera follows the wreck's lead car |
| `src/scene/drive/wreck.ts` (create) | module-level handoff: last car transforms + velocity at the derail frame; wreck lead position for the camera |
| `src/scene/drive/DriveWreck.tsx` (create) | lazy: Rapier `Physics`, dynamic cars, coupler joints, deck/parapet/ground colliders, manual stepping with slow-motion |
| `src/scene/drive/CrashFX.tsx` (create) | sparks, smoke, fire billboards, camera shake value |
| `src/scene/drive/SpeedBoards.tsx` (create) | boards beside the track from `curveRestrictions` |
| `src/scene/World.tsx` (modify) | mounts `SpeedBoards`; lazy `DriveWreck` while derailed |
| `src/ui/DrivePanel.tsx` (modify) | penalty-brake styling removed; curve lookahead row; crash panel |
| `package.json` (modify) | `@react-three/rapier` |

---

### Task 1: Drive sim on geometric metres with an injectable environment

**Files:**
- Modify: `src/sim/drive.ts` (whole file)
- Modify: `src/sim/drive.test.ts` (helper + existing tests)

**Interfaces:**
- Produces:
  ```ts
  export interface DriveEnv {
    /** chainage km -> metres along the drawn line */
    gAt(sKm: number): number
    /** metres along the drawn line -> chainage km */
    sAtG(gM: number): number
    /** signed curvature (1/m) at metres along the line */
    curvatureAtG(gM: number): number
    /** metres at which the buffer stops stand, [aluva end, tripunithura end] */
    bufferG: [number, number]
  }
  export const REAL_ENV: DriveEnv          // built from src/sim/alignment
  export interface DriveState { ...existing..., gM: number; distToNextM: number }
  export function newDrive(dir: 0 | 1, env?: DriveEnv): DriveState
  export function stepDrive(prev: DriveState, dtSec: number, env?: DriveEnv): DriveState
  ```
  `sKm` stays on the state, derived from `gM` every step, so every existing consumer keeps working. `vMs` is now real metres per second.

- [ ] **Step 1: Write the failing test** — replace the helper at the top of `src/sim/drive.test.ts` and add a synthetic env:

```ts
import { describe, expect, it } from 'vitest'
import { stations } from '../data/network'
import {
  brakingDistanceM,
  grade,
  newDrive,
  setNotch,
  stepDrive,
  type DriveEnv,
  type DriveState,
} from './drive'

/** Straight, flat synthetic line: 1 chainage-km is exactly 1000 m, no curves. */
const STRAIGHT: DriveEnv = {
  gAt: (s) => s * 1000,
  sAtG: (g) => g / 1000,
  curvatureAtG: () => 0,
  bufferG: [-60, stations[stations.length - 1].sKm * 1000 + 60],
}

function run(st: DriveState, seconds: number, env: DriveEnv = STRAIGHT, dt = 0.05): DriveState {
  let s = st
  for (let t = 0; t < seconds; t += dt) s = stepDrive(s, dt, env)
  return s
}

describe('drive physics', () => {
  it('moves in real metres: full power from rest covers ~½at² along the drawn line', () => {
    let st = setNotch(newDrive(0, STRAIGHT), 4)
    st = run(st, 10)
    // a = 1.0 m/s² at notch 4, minus a little drag: 45-50 m in 10 s
    expect(st.gM).toBeGreaterThan(44)
    expect(st.gM).toBeLessThan(50)
    // chainage follows the environment's mapping
    expect(st.sKm).toBeCloseTo(st.gM / 1000, 6)
  })
```

Keep every existing test below this, changing each `run(st, n)` call to pass `STRAIGHT` (the default) and each `newDrive(d)` to `newDrive(d, STRAIGHT)`. The old "down direction decreases sKm" test stays valid.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sim/drive.test.ts`
Expected: FAIL — `newDrive` takes one argument / `gM` undefined / `stepDrive` ignores env.

- [ ] **Step 3: Rewrite `src/sim/drive.ts`** — keep every rule, change the coordinate:

```ts
/**
 * Drive-a-train physics + scoring — pure functions, no three/react deps.
 * The player runs a special service: power/brake notches, stop at every
 * station on the mark, doors, scoring for accuracy + speed discipline.
 *
 * The sim moves in GEOMETRIC metres along the drawn line (`gM`), not in
 * timetable chainage: chainage runs 0.7-1.6x real distance locally (see
 * alignment.ts), and a physics rate in m/s² is only honest in real metres.
 * `sKm` is derived from `gM` every step for everything that speaks chainage.
 * The line itself comes in through `DriveEnv`, so tests run on synthetic
 * track and the real alignment is just one environment.
 */
import { stations } from '../data/network'
import { TRAINSET } from '../data/trainset'
import { curvatureAtG, gAt, sAtG } from './alignment'

export const NOTCH_MIN = -5 // -5 = emergency, -4..-1 service brake
export const NOTCH_MAX = 4 // 1..4 power
export const LINE_SPEED_KMH = 80
const DWELL_SEC = 10
const STOP_TOLERANCE_M = 5
/** run-out past a terminal before the buffer stop */
const BUFFER_PAD_M = 60

export interface DriveEnv {
  gAt(sKm: number): number
  sAtG(gM: number): number
  curvatureAtG(gM: number): number
  bufferG: [number, number]
}

/** The real Blue Line. */
export const REAL_ENV: DriveEnv = {
  gAt,
  sAtG,
  curvatureAtG,
  bufferG: [
    gAt(stations[0].sKm) - BUFFER_PAD_M,
    gAt(stations[stations.length - 1].sKm) + BUFFER_PAD_M,
  ],
}

export type DrivePhase = 'ready' | 'run' | 'dwell' | 'done'

export interface StopResult {
  stationOrder: number
  errM: number
  points: number
  label: string
}

export interface DriveState {
  dir: 0 | 1
  /** metres along the drawn line — the sim's own coordinate */
  gM: number
  /** chainage, derived from gM (same axis as the schedule engine) */
  sKm: number
  /** speed, m/s (always >= 0; direction handled by dir) */
  vMs: number
  notch: number
  phase: DrivePhase
  doorsOpen: boolean
  dwellRemainSec: number
  /** order index of the next station to stop at */
  nextStopOrder: number
  /** real metres to the next stop's mark (negative once passed) */
  distToNextM: number
  score: number
  stops: StopResult[]
  overspeed: boolean
  /** true while the overspeed penalty brake is latched */
  penaltyBrake: boolean
  startedAtMs: number | null
}

export function newDrive(dir: 0 | 1, env: DriveEnv = REAL_ENV): DriveState {
  const startOrder = dir === 0 ? 0 : stations.length - 1
  const gM = env.gAt(stations[startOrder].sKm)
  return {
    dir,
    gM,
    sKm: stations[startOrder].sKm,
    vMs: 0,
    notch: 0,
    phase: 'ready',
    doorsOpen: true,
    dwellRemainSec: 0,
    nextStopOrder: dir === 0 ? 1 : stations.length - 2,
    distToNextM: 0,
    score: 0,
    stops: [],
    overspeed: false,
    penaltyBrake: false,
    startedAtMs: null,
  }
}

const kmh = (ms: number) => ms * 3.6

function scoreStop(errM: number): { points: number; label: string } {
  const e = Math.abs(errM)
  if (e <= 0.5) return { points: 300, label: 'PERFECT' }
  if (e <= 2) return { points: 200, label: 'GREAT' }
  if (e <= STOP_TOLERANCE_M) return { points: 100, label: 'GOOD' }
  return { points: -100, label: 'OFF MARK' }
}

/** metres from the train to a station's mark, positive while still ahead */
function distTo(st: DriveState, order: number, env: DriveEnv): number {
  const g = env.gAt(stations[order].sKm)
  return st.dir === 0 ? g - st.gM : st.gM - g
}

/** advance the drive sim by dt seconds (mutates a copy, returns it) */
export function stepDrive(prev: DriveState, dtSec: number, env: DriveEnv = REAL_ENV): DriveState {
  const st = { ...prev }
  const dt = Math.min(dtSec, 0.1)

  if (st.phase === 'done') return st

  if (st.phase === 'dwell') {
    st.dwellRemainSec -= dt
    if (st.dwellRemainSec <= 0) {
      st.doorsOpen = false
      st.phase = 'run'
      st.notch = 0
    }
    return st
  }

  if (st.phase === 'ready') {
    // waiting for first power notch
    if (st.notch > 0) {
      st.phase = 'run'
      st.doorsOpen = false
      st.startedAtMs = Date.now()
    } else {
      return st
    }
  }

  // --- physics ---
  const vKmh = kmh(st.vMs)
  st.overspeed = vKmh > LINE_SPEED_KMH
  if (vKmh > 85) st.penaltyBrake = true
  if (st.penaltyBrake) {
    if (vKmh <= LINE_SPEED_KMH - 5) st.penaltyBrake = false
    else st.notch = Math.min(st.notch, -3)
  }

  let a = 0
  if (st.notch > 0) a = (st.notch / NOTCH_MAX) * TRAINSET.accelMs2
  else if (st.notch === -5) a = -TRAINSET.emergencyBrakeMs2
  else if (st.notch < 0) a = (st.notch / 4) * TRAINSET.brakeMs2
  a -= 0.004 * st.vMs // rolling/air drag
  st.vMs = Math.max(0, st.vMs + a * dt)

  st.gM += st.dir === 0 ? st.vMs * dt : -st.vMs * dt
  st.sKm = env.sAtG(st.gM)

  // --- station logic ---
  const target = stations[st.nextStopOrder]
  if (!target) {
    st.phase = 'done'
    return st
  }
  const distM = distTo(st, st.nextStopOrder, env)
  st.distToNextM = distM

  const isTerminal = st.nextStopOrder === (st.dir === 0 ? stations.length - 1 : 0)

  if (st.vMs === 0 && st.phase === 'run' && Math.abs(distM) <= 38 && prev.vMs > 0) {
    // came to a stop near the mark -> platform stop
    const { points, label } = scoreStop(distM)
    st.stops = [...st.stops, { stationOrder: target.order, errM: distM, points, label }]
    st.score += points
    if (isTerminal) {
      st.phase = 'done'
      st.doorsOpen = true
    } else {
      st.phase = 'dwell'
      st.doorsOpen = true
      st.dwellRemainSec = DWELL_SEC
      st.nextStopOrder += st.dir === 0 ? 1 : -1
    }
    return st
  }

  // passed the station without stopping (still rolling well beyond the platform)
  if (distM < -36 && st.vMs > 2) {
    st.stops = [
      ...st.stops,
      { stationOrder: target.order, errM: -distM, points: -200, label: 'MISSED' },
    ]
    st.score -= 200
    st.nextStopOrder += st.dir === 0 ? 1 : -1
    if (st.nextStopOrder < 0 || st.nextStopOrder >= stations.length) st.phase = 'done'
    return st
  }

  // ran past the end of the line
  const [g0, g1] = env.bufferG
  if ((st.dir === 0 && st.gM > g1) || (st.dir === 1 && st.gM < g0)) {
    st.phase = 'done'
    st.vMs = 0
  }
  return st
}

export function setNotch(st: DriveState, notch: number): DriveState {
  const clamped = Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, notch))
  if (st.penaltyBrake && clamped > -3) return { ...st, notch: -3 }
  return { ...st, notch: clamped }
}

/** braking distance from current speed at full service brake (for the HUD) */
export function brakingDistanceM(vMs: number): number {
  return (vMs * vMs) / (2 * TRAINSET.brakeMs2)
}

export function grade(score: number, nStops: number): string {
  const max = nStops * 300
  const r = max > 0 ? score / max : 0
  if (r >= 0.9) return 'S — Loco Pilot of the Month'
  if (r >= 0.75) return 'A — Smooth operator'
  if (r >= 0.55) return 'B — Getting there'
  if (r >= 0.35) return 'C — Passengers noticed'
  return 'D — Back to the simulator'
}
```

- [ ] **Step 4: Run the drive tests**

Run: `npx vitest run src/sim/drive.test.ts`
Expected: PASS (the new test and every existing one).

- [ ] **Step 5: Update the two scene consumers to the new units** — `src/ui/DrivePanel.tsx` computes `distM` from chainage; replace:

```ts
  const distM = target
    ? Math.abs((drive.dir === 0 ? target.sKm - drive.sKm : drive.sKm - target.sKm) * 1000)
    : 0
```
with
```ts
  const distM = target ? Math.abs(drive.distToNextM) : 0
```
`src/scene/DriveTrain.tsx` reads `d.sKm` for car and camera placement — unchanged, `sKm` is still on the state. `src/state/useDriveStore.ts` calls `stepDrive(d, dtSec)` — unchanged (defaults to `REAL_ENV`).

- [ ] **Step 6: Gate and commit**

Run: `npx tsc -b && npm test && npm run build`
Expected: all clean.

```bash
git add src/sim/drive.ts src/sim/drive.test.ts src/ui/DrivePanel.tsx
git commit -m "Drive sim moves in real metres, through an injectable line"
```

---

### Task 2: Remove the penalty brake — limits are advisory

**Files:**
- Modify: `src/sim/drive.ts` (`DriveState.penaltyBrake`, the physics block, `setNotch`)
- Modify: `src/sim/drive.test.ts` (replace the "caps at the penalty brake" test)
- Modify: `src/ui/DrivePanel.tsx` (speed colour)

**Interfaces:**
- Produces: `DriveState` no longer has `penaltyBrake`; `setNotch` never overrides the driver. `PENALTY_SPEED_KMH` is deleted.

- [ ] **Step 1: Write the failing test** — replace `it('caps at the penalty brake even when power is held', …)` with:

```ts
  it('never brakes for the driver: full power past 85 km/h keeps accelerating', () => {
    let st = setNotch(newDrive(0, STRAIGHT), 4)
    st = run(st, 30) // ~24 m/s = 86 km/h by now
    const before = st.vMs
    st = run(st, 5)
    expect(st.notch).toBe(4)
    expect(st.vMs).toBeGreaterThan(before)
    expect(st.overspeed).toBe(true)
    expect('penaltyBrake' in st).toBe(false)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sim/drive.test.ts -t "never brakes"`
Expected: FAIL — notch is −3 / `penaltyBrake` in state.

- [ ] **Step 3: Remove the brake** in `src/sim/drive.ts`:

Delete `export const PENALTY_SPEED_KMH = 85` if present, delete the `penaltyBrake` field from `DriveState` and `newDrive`, and replace the physics preamble

```ts
  const vKmh = kmh(st.vMs)
  st.overspeed = vKmh > LINE_SPEED_KMH
  if (vKmh > 85) st.penaltyBrake = true
  if (st.penaltyBrake) {
    if (vKmh <= LINE_SPEED_KMH - 5) st.penaltyBrake = false
    else st.notch = Math.min(st.notch, -3)
  }
```
with
```ts
  // Line speed is a rule, not a governor: the driver may break it, and the
  // score, the curves and the physics are the judge. Nothing here brakes.
  st.overspeed = kmh(st.vMs) > LINE_SPEED_KMH
```
and `setNotch` with
```ts
export function setNotch(st: DriveState, notch: number): DriveState {
  return { ...st, notch: Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, notch)) }
}
```

In `src/ui/DrivePanel.tsx` replace the speed class expression
```ts
                drive.penaltyBrake
                  ? 'text-pinkline'
                  : drive.overspeed
                    ? 'text-lemon'
                    : 'text-paper'
```
with
```ts
                drive.overspeed ? 'text-lemon' : 'text-paper'
```

- [ ] **Step 4: Run tests, gate, commit**

Run: `npx vitest run src/sim/drive.test.ts && npx tsc -b && npm test && npm run build`

```bash
git add src/sim/drive.ts src/sim/drive.test.ts src/ui/DrivePanel.tsx
git commit -m "No governor in drive mode: line speed is advisory"
```

---

### Task 3: The derail rule

**Files:**
- Modify: `src/sim/drive.ts`
- Modify: `src/sim/drive.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const A_LAT_WARN = 1.6
  export const A_LAT_DERAIL = 2.6
  export const DERAIL_HOLD_S = 0.6
  export function curveLimitKmh(kappa: number): number   // Infinity on the straight
  export interface DerailRecord {
    cause: 'curve' | 'buffer'
    gM: number
    sKm: number
    speedKmh: number
    /** the limit that was broken (curve limit, or BUFFER_KMH) */
    limitKmh: number
    /** curve radius in metres at the derail point; Infinity for the buffer */
    radiusM: number
    /** the last station the train stopped at, for the restart */
    lastStopOrder: number
  }
  export type DrivePhase = 'ready' | 'run' | 'dwell' | 'derailed' | 'done'
  export interface DriveState { ...; lateralMs2: number; overLimitS: number; derail: DerailRecord | null; lastStopOrder: number }
  ```

- [ ] **Step 1: Write the failing tests** — add a curved synthetic env and a new describe block to `src/sim/drive.test.ts`:

```ts
import { A_LAT_DERAIL, curveLimitKmh, DERAIL_HOLD_S } from './drive'

/** Straight from 0, then a constant 100 m radius curve from 1000 m on. */
const CURVE_100: DriveEnv = {
  ...STRAIGHT,
  curvatureAtG: (g) => (g >= 1000 ? 1 / 100 : 0),
}

describe('derailment', () => {
  it('limit on a 100 m curve is 58 km/h, and the straight has none', () => {
    expect(curveLimitKmh(1 / 100)).toBeCloseTo(3.6 * Math.sqrt(A_LAT_DERAIL * 100), 1)
    expect(Math.round(curveLimitKmh(1 / 100))).toBe(58)
    expect(curveLimitKmh(0)).toBe(Infinity)
  })

  it('a train under the limit takes the curve', () => {
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 14, CURVE_100) // ~14 m/s = 50 km/h, still on the straight
    st = setNotch(st, 0)
    st = run(st, 90, CURVE_100) // coasts round the bend
    expect(st.phase).not.toBe('derailed')
    expect(st.derail).toBeNull()
    expect(st.gM).toBeGreaterThan(1000)
  })

  it('a train over the limit for longer than the hold time derails, with the record', () => {
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 40, CURVE_100) // well over 58 km/h entering the curve at 1000 m
    expect(st.phase).toBe('derailed')
    expect(st.derail).not.toBeNull()
    expect(st.derail!.cause).toBe('curve')
    expect(st.derail!.radiusM).toBeCloseTo(100, 0)
    expect(Math.round(st.derail!.limitKmh)).toBe(58)
    expect(st.derail!.speedKmh).toBeGreaterThan(58)
    expect(st.derail!.lastStopOrder).toBe(0)
    // it derailed a little way INTO the curve, after the hold time, not at its mouth
    expect(st.derail!.gM).toBeGreaterThan(1000)
    expect(st.derail!.gM).toBeLessThan(1000 + 30 * DERAIL_HOLD_S * 1.5)
  })

  it('a brief excursion over the limit with the brake on survives', () => {
    // enter the curve just over the limit, emergency brake immediately
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 17, CURVE_100) // ~17 m/s = 61 km/h at g≈145 m
    st = setNotch(st, 0)
    // coast to the curve mouth
    while (st.gM < 995) st = stepDrive(st, 0.05, CURVE_100)
    st = setNotch(st, -5)
    st = run(st, 10, CURVE_100)
    expect(st.phase).not.toBe('derailed')
  })

  it('a derailed train no longer moves or scores', () => {
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 40, CURVE_100)
    const frozen = run(setNotch(st, 4), 5, CURVE_100)
    expect(frozen.gM).toBe(st.gM)
    expect(frozen.score).toBe(st.score)
    expect(st.score).toBeLessThanOrEqual(-1000)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sim/drive.test.ts -t derailment`
Expected: FAIL — `curveLimitKmh` not exported; phase never `'derailed'`.

- [ ] **Step 3: Implement** in `src/sim/drive.ts`:

Add after `LINE_SPEED_KMH`:
```ts
/** lateral acceleration (m/s²) at which the HUD warns and the cab alarms */
export const A_LAT_WARN = 1.6
/** lateral acceleration above which the train is derailing */
export const A_LAT_DERAIL = 2.6
/** it must stay above the limit this long — a blip at a curve entry is survivable with the brake */
export const DERAIL_HOLD_S = 0.6
/** derailing costs this on top of whatever the run had earned */
const DERAIL_PENALTY = 1000

/** The speed a curve of curvature kappa (1/m) can be taken at; Infinity on the straight. */
export function curveLimitKmh(kappa: number): number {
  const k = Math.abs(kappa)
  return k < 1e-6 ? Infinity : 3.6 * Math.sqrt(A_LAT_DERAIL / k)
}

export interface DerailRecord {
  cause: 'curve' | 'buffer'
  gM: number
  sKm: number
  speedKmh: number
  limitKmh: number
  radiusM: number
  lastStopOrder: number
}
```

Change `DrivePhase` to `'ready' | 'run' | 'dwell' | 'derailed' | 'done'`. Add to `DriveState`:
```ts
  /** lateral acceleration on the leading car right now, m/s² */
  lateralMs2: number
  /** seconds spent above A_LAT_DERAIL without relief */
  overLimitS: number
  derail: DerailRecord | null
  /** the last station the train stopped at (its start, until the first stop) */
  lastStopOrder: number
```
and in `newDrive`: `lateralMs2: 0, overLimitS: 0, derail: null, lastStopOrder: startOrder,`.

In `stepDrive`, first line after `const dt`: `if (st.phase === 'done' || st.phase === 'derailed') return st`. After the position update (`st.sKm = env.sAtG(st.gM)`), before station logic:

```ts
  // --- the curve rule ---
  // lateral acceleration on the leading car: v²·κ, with κ at the front of the
  // set, half a trainset ahead of the reference car
  const leadG = st.gM + (st.dir === 0 ? 1 : -1) * MODEL_CAR_PITCH_M
  const kappa = env.curvatureAtG(leadG)
  st.lateralMs2 = st.vMs * st.vMs * Math.abs(kappa)
  st.overLimitS = st.lateralMs2 > A_LAT_DERAIL ? st.overLimitS + dt : 0
  if (st.overLimitS >= DERAIL_HOLD_S) {
    return derailed(st, env, {
      cause: 'curve',
      limitKmh: curveLimitKmh(kappa),
      radiusM: 1 / Math.max(Math.abs(kappa), 1e-6),
    })
  }
```
Import `MODEL_CAR_PITCH_M` from `'../data/trainset'`. Add the helper:

```ts
function derailed(
  st: DriveState,
  env: DriveEnv,
  how: Pick<DerailRecord, 'cause' | 'limitKmh' | 'radiusM'>,
): DriveState {
  return {
    ...st,
    phase: 'derailed',
    notch: 0,
    score: st.score - DERAIL_PENALTY,
    derail: {
      ...how,
      gM: st.gM,
      sKm: env.sAtG(st.gM),
      speedKmh: kmh(st.vMs),
      lastStopOrder: st.lastStopOrder,
    },
  }
}
```
In the platform-stop branch, after `st.score += points`, add `st.lastStopOrder = target.order`.

- [ ] **Step 4: Run tests, gate, commit**

Run: `npx vitest run src/sim/drive.test.ts && npx tsc -b && npm test && npm run build`

```bash
git add src/sim/drive.ts src/sim/drive.test.ts
git commit -m "Derail on a curve taken too fast"
```

---

### Task 4: Buffer stop, and restarting from the last station

**Files:**
- Modify: `src/sim/drive.ts`
- Modify: `src/sim/drive.test.ts`
- Modify: `src/state/useDriveStore.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BUFFER_KMH = 15
  export function restartFromLastStop(st: DriveState, env?: DriveEnv): DriveState
  // useDriveStore: restart: () => void
  ```

- [ ] **Step 1: Write the failing tests** in `src/sim/drive.test.ts`:

```ts
import { BUFFER_KMH, restartFromLastStop } from './drive'

describe('buffer stop and restart', () => {
  it('hitting the buffer above 15 km/h derails; creeping in stops the run', () => {
    // start at the last station heading for the buffer 60 m past it
    const last = stations.length - 1
    let st = { ...newDrive(0, STRAIGHT), nextStopOrder: last, lastStopOrder: last - 1 }
    st = { ...st, gM: stations[last].sKm * 1000 + 10, phase: 'run' as const }
    st = run(setNotch(st, 4), 12) // ~40 km/h into the buffer
    expect(st.phase).toBe('derailed')
    expect(st.derail!.cause).toBe('buffer')
    expect(st.derail!.limitKmh).toBe(BUFFER_KMH)

    let slow = { ...newDrive(0, STRAIGHT), nextStopOrder: last, phase: 'run' as const }
    slow = { ...slow, gM: stations[last].sKm * 1000 + 55, vMs: 2 } // 7 km/h
    slow = run(slow, 5)
    expect(slow.phase).toBe('done')
    expect(slow.derail).toBeNull()
  })

  it('restarts at the last station with doors open, keeping the score and stops', () => {
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 40, CURVE_100)
    expect(st.phase).toBe('derailed')
    const again = restartFromLastStop(st, CURVE_100)
    expect(again.phase).toBe('ready')
    expect(again.doorsOpen).toBe(true)
    expect(again.vMs).toBe(0)
    expect(again.gM).toBe(CURVE_100.gAt(stations[0].sKm))
    expect(again.nextStopOrder).toBe(1)
    expect(again.score).toBe(st.score)
    expect(again.derail).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sim/drive.test.ts -t "buffer stop"`
Expected: FAIL — `BUFFER_KMH`/`restartFromLastStop` not exported.

- [ ] **Step 3: Implement** in `src/sim/drive.ts`. Add `export const BUFFER_KMH = 15` next to the derail constants. Replace the end-of-line block:

```ts
  // ran past the end of the line
  const [g0, g1] = env.bufferG
  if ((st.dir === 0 && st.gM > g1) || (st.dir === 1 && st.gM < g0)) {
    st.phase = 'done'
    st.vMs = 0
  }
  return st
```
with
```ts
  // the buffer stop at the end of the line
  const [g0, g1] = env.bufferG
  if ((st.dir === 0 && st.gM > g1) || (st.dir === 1 && st.gM < g0)) {
    if (kmh(st.vMs) > BUFFER_KMH) {
      return derailed(st, env, { cause: 'buffer', limitKmh: BUFFER_KMH, radiusM: Infinity })
    }
    st.phase = 'done'
    st.vMs = 0
  }
  return st
```
and add:
```ts
/** Back to the last platform the train stopped at, doors open, run intact. */
export function restartFromLastStop(st: DriveState, env: DriveEnv = REAL_ENV): DriveState {
  const order = st.lastStopOrder
  return {
    ...st,
    gM: env.gAt(stations[order].sKm),
    sKm: stations[order].sKm,
    vMs: 0,
    notch: 0,
    phase: 'ready',
    doorsOpen: true,
    dwellRemainSec: 0,
    nextStopOrder: order + (st.dir === 0 ? 1 : -1),
    distToNextM: 0,
    lateralMs2: 0,
    overLimitS: 0,
    derail: null,
  }
}
```

In `src/state/useDriveStore.ts` add to the interface `restart: () => void` and to the store:
```ts
  restart: () => {
    const d = get().drive
    if (d?.phase === 'derailed') {
      lastTickMs = performance.now()
      set({ drive: restartFromLastStop(d) })
    }
  },
```
importing `restartFromLastStop` from `'../sim/drive'`.

- [ ] **Step 4: Run tests, gate, commit**

Run: `npx vitest run src/sim/drive.test.ts && npx tsc -b && npm test && npm run build`

```bash
git add src/sim/drive.ts src/sim/drive.test.ts src/state/useDriveStore.ts
git commit -m "Buffer stop derails; restart from the last platform"
```

---

### Task 5: Curve lookahead for the HUD

**Files:**
- Modify: `src/sim/drive.ts`
- Modify: `src/sim/drive.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LOOKAHEAD_M = 400
  export interface Restriction { limitKmh: number; distM: number; radiusM: number }
  export interface DriveState { ...; ahead: Restriction | null }
  ```
  `ahead` is the tightest curve limit under `LINE_SPEED_KMH` within `LOOKAHEAD_M` of the leading car, and how far away it begins (0 while inside it).

- [ ] **Step 1: Write the failing test**:

```ts
import { LOOKAHEAD_M } from './drive'

describe('curve lookahead', () => {
  it('reports the tightest restriction ahead and its distance, or nothing on open track', () => {
    let st = newDrive(0, CURVE_100)
    st = { ...st, gM: 700, phase: 'run' as const, vMs: 10 }
    st = stepDrive(st, 0.05, CURVE_100)
    expect(st.ahead).not.toBeNull()
    expect(Math.round(st.ahead!.limitKmh)).toBe(58)
    // the curve starts at 1000 m; the leading car is a car pitch ahead of gM
    expect(st.ahead!.distM).toBeGreaterThan(260)
    expect(st.ahead!.distM).toBeLessThan(300)
    let open = { ...newDrive(0, CURVE_100), gM: 100, phase: 'run' as const, vMs: 10 }
    open = stepDrive(open, 0.05, CURVE_100)
    expect(open.ahead).toBeNull()
    let inside = { ...newDrive(0, CURVE_100), gM: 1200, phase: 'run' as const, vMs: 10 }
    inside = stepDrive(inside, 0.05, CURVE_100)
    expect(inside.ahead!.distM).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sim/drive.test.ts -t lookahead`
Expected: FAIL — `ahead` undefined.

- [ ] **Step 3: Implement** in `src/sim/drive.ts`:

```ts
/** how far ahead of the leading car the HUD looks for the next restriction */
export const LOOKAHEAD_M = 400
const LOOKAHEAD_STEP_M = 10

export interface Restriction {
  limitKmh: number
  /** metres from the leading car to where it begins; 0 while inside it */
  distM: number
  radiusM: number
}

/** The tightest curve under line speed within LOOKAHEAD_M of leadG, travelling in dir. */
function restrictionAhead(leadG: number, dir: 0 | 1, env: DriveEnv): Restriction | null {
  let best: Restriction | null = null
  for (let d = 0; d <= LOOKAHEAD_M; d += LOOKAHEAD_STEP_M) {
    const kappa = env.curvatureAtG(leadG + (dir === 0 ? d : -d))
    const limitKmh = curveLimitKmh(kappa)
    if (limitKmh >= LINE_SPEED_KMH) continue
    if (!best || limitKmh < best.limitKmh) {
      best = { limitKmh, distM: d, radiusM: 1 / Math.abs(kappa) }
    }
  }
  return best
}
```
Add `ahead: Restriction | null` to `DriveState` (`ahead: null` in `newDrive` and in `restartFromLastStop`), and in `stepDrive` right after `st.lateralMs2 = …`: `st.ahead = restrictionAhead(leadG, st.dir, env)`.

- [ ] **Step 4: Run tests, gate, commit**

```bash
npx vitest run src/sim/drive.test.ts && npx tsc -b && npm test && npm run build
git add src/sim/drive.ts src/sim/drive.test.ts
git commit -m "Look ahead for the next curve restriction"
```

---

### Task 6: Speed restrictions along the line, and the boards beside the track

**Files:**
- Create: `src/sim/speedLimits.ts`
- Create: `src/sim/speedLimits.test.ts`
- Create: `src/scene/drive/SpeedBoards.tsx`
- Modify: `src/scene/World.tsx` (mount)

**Interfaces:**
- Produces:
  ```ts
  // src/sim/speedLimits.ts
  export interface SpeedRestriction { fromG: number; toG: number; limitKmh: number; radiusM: number }
  export function curveRestrictions(env: DriveEnv, fromG: number, toG: number, lineKmh?: number): SpeedRestriction[]
  ```
  Limits are rounded DOWN to a multiple of 5; stretches under 40 m apart are merged; the limit of a merged stretch is its tightest.

- [ ] **Step 1: Write the failing test** `src/sim/speedLimits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DriveEnv } from './drive'
import { curveRestrictions } from './speedLimits'

// straight, then 100 m radius from 1000-1300 m, straight, then 200 m radius from 2000-2100 m
const ENV: DriveEnv = {
  gAt: (s) => s * 1000,
  sAtG: (g) => g / 1000,
  curvatureAtG: (g) => (g >= 1000 && g < 1300 ? 1 / 100 : g >= 2000 && g < 2100 ? 1 / 200 : 0),
  bufferG: [-60, 30000],
}

describe('curve restrictions', () => {
  it('finds each stretch under line speed with its limit rounded down to 5', () => {
    const r = curveRestrictions(ENV, 0, 3000)
    expect(r).toHaveLength(1) // the 200 m curve allows ~82 km/h: no restriction
    expect(r[0].fromG).toBeGreaterThanOrEqual(990)
    expect(r[0].fromG).toBeLessThanOrEqual(1010)
    expect(r[0].toG).toBeGreaterThanOrEqual(1290)
    expect(r[0].toG).toBeLessThanOrEqual(1310)
    expect(r[0].limitKmh).toBe(55)
    expect(r[0].radiusM).toBeCloseTo(100, 0)
  })

  it('merges two restrictions separated by a short straight', () => {
    const env: DriveEnv = { ...ENV, curvatureAtG: (g) => ((g >= 1000 && g < 1100) || (g >= 1120 && g < 1200) ? 1 / 100 : 0) }
    expect(curveRestrictions(env, 0, 2000)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sim/speedLimits.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/sim/speedLimits.ts`:

```ts
/**
 * Where the line is too curved for line speed, and how fast it may be taken.
 * The drive HUD looks ahead through DriveState.ahead; this is the same rule
 * applied once over the whole line so the boards can be planted.
 */
import { curveLimitKmh, LINE_SPEED_KMH, type DriveEnv } from './drive'

export interface SpeedRestriction {
  fromG: number
  toG: number
  /** rounded down to 5 km/h, as a board would read */
  limitKmh: number
  /** tightest radius in the stretch */
  radiusM: number
}

const STEP_M = 10
/** two restrictions closer than this are one board */
const MERGE_GAP_M = 40

export function curveRestrictions(
  env: DriveEnv,
  fromG: number,
  toG: number,
  lineKmh = LINE_SPEED_KMH,
): SpeedRestriction[] {
  const out: SpeedRestriction[] = []
  let open: SpeedRestriction | null = null
  for (let g = fromG; g <= toG; g += STEP_M) {
    const kappa = env.curvatureAtG(g)
    const limit = curveLimitKmh(kappa)
    if (limit < lineKmh) {
      const radiusM = 1 / Math.abs(kappa)
      if (open && g - open.toG <= MERGE_GAP_M) {
        open.toG = g
        open.limitKmh = Math.min(open.limitKmh, limit)
        open.radiusM = Math.min(open.radiusM, radiusM)
      } else {
        if (open) out.push(open)
        open = { fromG: g, toG: g, limitKmh: limit, radiusM }
      }
    }
  }
  if (open) out.push(open)
  for (const r of out) r.limitKmh = Math.floor(r.limitKmh / 5) * 5
  return out
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sim/speedLimits.test.ts`
Expected: PASS.

- [ ] **Step 5: The boards** — create `src/scene/drive/SpeedBoards.tsx`:

```tsx
/**
 * Speed boards beside the track: a yellow-rimmed disc with the limit, planted
 * BOARD_LEAD_M before each curve restriction on the driver's left, and a
 * "line speed" board where it ends. They are the rule made visible; nothing
 * enforces them.
 */
import { Text } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import labelFont from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff?url'
import { centerAtG, G_END, G_START, leftOf } from '../../sim/alignment'
import { LINE_SPEED_KMH, REAL_ENV } from '../../sim/drive'
import { curveRestrictions } from '../../sim/speedLimits'
import { TRACK_OFFSET_M } from '../../data/trainset'

/** how far before a restriction its board stands */
const BOARD_LEAD_M = 120
/** boards stand this far outside the outer rail */
const BOARD_OUT_M = TRACK_OFFSET_M + 2.6
const POST_H = 2.2

interface Board {
  pos: THREE.Vector3
  rotY: number
  text: string
  end: boolean
}

function useBoards(): Board[] {
  return useMemo(() => {
    const out: Board[] = []
    const plant = (g: number, dir: 0 | 1, text: string, end: boolean) => {
      const { pos, tan } = centerAtG(g)
      const travel = dir === 0 ? tan : tan.clone().negate()
      const side = leftOf(travel).multiplyScalar(BOARD_OUT_M)
      out.push({
        pos: pos.clone().add(side),
        rotY: Math.atan2(travel.x, travel.z) + Math.PI, // face oncoming drivers
        text,
        end,
      })
    }
    for (const r of curveRestrictions(REAL_ENV, G_START, G_END)) {
      // up direction reads it approaching from lower g; down from higher g
      plant(r.fromG - BOARD_LEAD_M, 0, String(r.limitKmh), false)
      plant(r.toG + 20, 0, String(LINE_SPEED_KMH), true)
      plant(r.toG + BOARD_LEAD_M, 1, String(r.limitKmh), false)
      plant(r.fromG - 20, 1, String(LINE_SPEED_KMH), true)
    }
    return out
  }, [])
}

export function SpeedBoards() {
  const boards = useBoards()
  return (
    <group>
      {boards.map((b, i) => (
        <group key={i} position={b.pos} rotation={[0, b.rotY, 0]}>
          <mesh position={[0, POST_H / 2, 0]}>
            <cylinderGeometry args={[0.06, 0.06, POST_H, 8]} />
            <meshStandardMaterial color="#8F9698" roughness={0.9} />
          </mesh>
          <mesh position={[0, POST_H + 0.45, 0]}>
            <circleGeometry args={[0.5, 32]} />
            <meshStandardMaterial color={b.end ? '#1E63C8' : '#F2C400'} roughness={0.6} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, POST_H + 0.45, 0.01]}>
            <circleGeometry args={[0.4, 32]} />
            <meshStandardMaterial color={b.end ? '#1E63C8' : '#F7F7F2'} roughness={0.6} />
          </mesh>
          <Text
            font={labelFont}
            position={[0, POST_H + 0.45, 0.02]}
            fontSize={b.end ? 0.28 : 0.42}
            color={b.end ? '#F7F7F2' : '#0A1620'}
            anchorX="center"
            anchorY="middle"
          >
            {b.text}
          </Text>
        </group>
      ))}
    </group>
  )
}
```

Mount it in `src/scene/World.tsx` inside the metro `<Suspense>` after `<DriveTrain />`:
```tsx
        <SpeedBoards />
```
with `import { SpeedBoards } from './drive/SpeedBoards'`.

- [ ] **Step 6: Verify in the browser** — with the dev server running, a Playwright script that frames the first restriction's board (find its world position from `curveRestrictions` via `window.__sAt` is not enough — instead traverse `window.__scene` for `Text` objects whose text is a two-digit number and frame the first one at 8 m, 2 m up, looking at it). Confirm a disc with a number on a post beside the deck. Save the screenshot.

- [ ] **Step 7: Gate and commit**

```bash
npx tsc -b && npm test && npm run build
git add src/sim/speedLimits.ts src/sim/speedLimits.test.ts src/scene/drive/SpeedBoards.tsx src/scene/World.tsx
git commit -m "Speed boards ahead of every curve restriction"
```

---

### Task 7: The desk shows the curve ahead; the crash panel

**Files:**
- Modify: `src/ui/DrivePanel.tsx`
- Modify: `src/state/useDriveStore.ts` (nothing new — `restart` from Task 4)

**Interfaces:**
- Consumes: `DriveState.ahead`, `DriveState.lateralMs2`, `DriveState.derail`, `DriveState.phase === 'derailed'`, `useDriveStore().restart`, `A_LAT_WARN`.

- [ ] **Step 1: Curve row** — in `DrivePanel`, after the NEXT STOP block, add:

```tsx
          {drive.ahead && (
            <div
              className={`flex items-baseline justify-between rounded-md px-3 py-1.5 ${
                drive.lateralMs2 > A_LAT_WARN ? 'bg-pinkline/25' : 'bg-lemon/15'
              }`}
            >
              <span className="font-display text-[11px] tracking-wide text-paper-dim">
                {drive.ahead.distM === 0 ? 'IN CURVE' : 'CURVE AHEAD'}
              </span>
              <span className="font-mono text-sm tabular-nums text-paper">
                <span className={drive.lateralMs2 > A_LAT_WARN ? 'text-pinkline' : 'text-lemon'}>
                  {Math.round(drive.ahead.limitKmh)} km/h
                </span>
                {drive.ahead.distM > 0 && (
                  <span className="text-paper-dim"> · {Math.round(drive.ahead.distM)} m</span>
                )}
              </span>
            </div>
          )}
```
Import `A_LAT_WARN` from `'../sim/drive'`.

- [ ] **Step 2: Crash panel** — at the top of the returned JSX, before the `drive.phase === 'done'` branch, add a `'derailed'` branch:

```tsx
      {drive.phase === 'derailed' && drive.derail ? (
        <>
          <div className="font-display text-sm font-semibold tracking-widest text-pinkline">
            DERAILED
          </div>
          <div className="font-display text-[13px] leading-snug text-paper">
            {drive.derail.cause === 'curve'
              ? `${Math.round(drive.derail.speedKmh)} km/h into a ${Math.round(drive.derail.radiusM)} m curve · limit ${Math.round(drive.derail.limitKmh)}`
              : `${Math.round(drive.derail.speedKmh)} km/h into the buffer stop · limit ${Math.round(drive.derail.limitKmh)}`}
          </div>
          <div className="font-mono text-3xl font-semibold text-pinkline">{drive.score}</div>
          <button
            onClick={restart}
            className="rounded-md bg-kmrl px-3 py-1.5 font-display text-sm font-semibold text-ink"
          >
            Restart from {stations[drive.derail.lastStopOrder].name}
          </button>
          <button
            onClick={exit}
            className="rounded px-2 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper"
          >
            exit
          </button>
        </>
      ) : drive.phase === 'done' ? (
```
and close the ternary chain accordingly (the existing `done` branch becomes the middle arm, the running desk the last). Read `restart` from the store next to `exit`: `const restart = useDriveStore((s) => s.restart)`.

Also change `nStops` for the grade so a derailed run grades as `'X — Derailed'`: in `grade()` in `src/sim/drive.ts` no change; in the panel the derailed branch does not call `grade`.

- [ ] **Step 3: Verify in the browser** — start a drive (Aluva → Tripunithura), hold notch 4 (`window.__driveNotch(4)`) until `useDriveStore` reports `phase === 'derailed'` (the first tight curve is south of Kalamassery; ~2–3 minutes of sim time — use the scrub speed or poll `window.__drive().phase`), screenshot the crash panel. Then click Restart and confirm `phase === 'ready'` at the last station.

- [ ] **Step 4: Gate and commit**

```bash
npx tsc -b && npm test && npm run build
git add src/ui/DrivePanel.tsx
git commit -m "Curve ahead on the desk; the crash panel"
```

---

### Task 8: The wreck — Rapier bodies from the derail frame

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/scene/drive/wreck.ts`
- Create: `src/scene/drive/DriveWreck.tsx`
- Modify: `src/scene/DriveTrain.tsx`
- Modify: `src/scene/World.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/scene/drive/wreck.ts — plain mutable handoff, no React
  export interface CarSnapshot { position: THREE.Vector3; quaternion: THREE.Quaternion }
  export const wreck: {
    /** the three cars' world transforms and the set's velocity on the derail frame */
    cars: CarSnapshot[]
    velocity: THREE.Vector3
    /** signed curvature at the derail point (outside of the curve = -sign(kappa) × left) */
    kappa: number
    /** lateral acceleration at the derail, m/s² */
    lateralMs2: number
    /** written every frame by DriveWreck: lead car position for the camera */
    lead: THREE.Vector3
    /** wall-clock ms of the derail frame */
    atMs: number
    ready: boolean
  }
  ```
- Consumes: `carPoseAt`, `trackOffsetBy`, `centerAtG`, `leftOf`, `curvatureAtG`, `gAt` from `src/sim/alignment`; `useCarParts`, `CarModel` from `src/scene/MetroTrain`.

- [ ] **Step 1: Install Rapier**

Run: `npm i @react-three/rapier@^2.2.0`
Expected: `package.json` gains `"@react-three/rapier": "^2.2.0"`; `npx tsc -b` still clean. Check `node_modules/@react-three/rapier/dist/declarations/src/hooks/hooks.d.ts` exports `useRapier` with a `step(deltaTime: number)` member; the plan relies on it for manual stepping.

- [ ] **Step 2: The handoff** — create `src/scene/drive/wreck.ts`:

```ts
/**
 * Hand-off from the rails to the physics on the derail frame.
 *
 * The sim decides the train has derailed; the plain car meshes hide; this
 * carries their last transforms and the set's velocity to DriveWreck, which
 * spawns rigid bodies in exactly those poses. Plain mutable, like firstLoad
 * and groundDim, so useFrame can read it with no React churn.
 */
import * as THREE from 'three'

export interface CarSnapshot {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

export const wreck = {
  cars: [] as CarSnapshot[],
  velocity: new THREE.Vector3(),
  kappa: 0,
  lateralMs2: 0,
  lead: new THREE.Vector3(),
  atMs: 0,
  ready: false,
}
```

- [ ] **Step 3: DriveTrain hands off and hides** — in `src/scene/DriveTrain.tsx`, import `{ wreck }` from `'./drive/wreck'`, `curvatureAtG, gAt` from `'../sim/alignment'`, and in the `useFrame` after `const d = useDriveStore.getState().drive; if (!d) return`, add:

```ts
    if (d.phase === 'derailed') {
      // first derailed frame: snapshot the cars for the wreck, then hide
      if (!wreck.ready) {
        wreck.cars = [0, 1, 2].map((c) => {
          const car = group.current!.children[c] as THREE.Group
          return { position: car.position.clone(), quaternion: car.quaternion.clone() }
        })
        const lead = group.current.children[0] as THREE.Group
        wreck.velocity.set(0, 0, 1).applyQuaternion(lead.quaternion).multiplyScalar(d.derail!.speedKmh / 3.6)
        wreck.kappa = curvatureAtG(gAt(d.sKm))
        wreck.lateralMs2 = d.lateralMs2
        wreck.lead.copy(lead.position)
        wreck.atMs = performance.now()
        wreck.ready = true
      }
      group.current.visible = false
    } else {
      wreck.ready = false
      group.current.visible = true
    }
```
Move the existing car-placement loop under `if (d.phase !== 'derailed') { … }`. Camera: in the camera block, when `d.phase === 'derailed'`, aim at `wreck.lead` instead of the rail pose:
```ts
      if (d.phase === 'derailed') {
        camGoal.copy(wreck.lead).add(tmp.set(60, 28, 60))
        lookGoal.copy(wreck.lead)
        camera.position.lerp(camGoal, Math.min(1, dt * 2))
        controls.target.lerp(lookGoal, Math.min(1, dt * 4))
        controls.update()
        return
      }
```
placed before the existing `poseAt(offsetBy(...))` camera line.

- [ ] **Step 4: The wreck** — create `src/scene/drive/DriveWreck.tsx`:

```tsx
/**
 * The derailed trainset as rigid bodies.
 *
 * Mounted (lazily — Rapier is ~700 KB and Tracker never needs it) only while
 * the drive is in the derailed phase. Three dynamic cuboids in the cars'
 * last on-rail poses, carrying the set's velocity plus a lateral kick and a
 * roll toward the outside of the curve, joined at the couplers so the set
 * jack-knifes rather than scatters; a strip of deck and parapet colliders
 * along the line around the derail point, and the ground. Stepped by hand
 * so the first moments run in slow motion.
 */
import { useFrame } from '@react-three/fiber'
import {
  CuboidCollider,
  Physics,
  RigidBody,
  useRapier,
  useSphericalJoint,
  type RapierRigidBody,
} from '@react-three/rapier'
import { createRef, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { MODEL_CAR_PITCH_M, TRAINSET } from '../../data/trainset'
import { centerAtG, gAt, leftOf } from '../../sim/alignment'
import { useDriveStore } from '../../state/useDriveStore'
import { CarModel, useCarParts } from '../MetroTrain'
import { wreck } from './wreck'

/** deck colliders this far either side of the derail point */
const DECK_REACH_M = 250
const DECK_STEP_M = 10
const DECK_W = 9
const DECK_T = 0.6
const PARAPET_H = 0.9
const PARAPET_T = 0.3
/** slow motion on the moment: time scale and how long it lasts */
const SLOW_SCALE = 0.35
const SLOW_MS = 1800
/** the wreck stops simulating after this and stays put */
const SETTLE_MS = 8000
/** lateral velocity per m/s² of excess lateral acceleration */
const KICK_PER_EXCESS = 1.6
/** roll rate per m/s² of excess */
const ROLL_PER_EXCESS = 0.55
const CAR_MASS_KG = 40000

function Deck({ gM }: { gM: number }) {
  const slabs = useMemo(() => {
    const out: { pos: THREE.Vector3; rotY: number }[] = []
    for (let g = gM - DECK_REACH_M; g <= gM + DECK_REACH_M; g += DECK_STEP_M) {
      const { pos, tan } = centerAtG(g)
      out.push({ pos: pos.clone().setY(pos.y - DECK_T / 2), rotY: Math.atan2(tan.x, tan.z) })
    }
    return out
  }, [gM])
  return (
    <>
      {slabs.map((s, i) => (
        <RigidBody key={i} type="fixed" position={s.pos} rotation={[0, s.rotY, 0]}>
          <CuboidCollider args={[DECK_W / 2, DECK_T / 2, DECK_STEP_M / 2]} />
          <CuboidCollider args={[PARAPET_T / 2, PARAPET_H / 2, DECK_STEP_M / 2]} position={[DECK_W / 2, DECK_T / 2 + PARAPET_H / 2, 0]} />
          <CuboidCollider args={[PARAPET_T / 2, PARAPET_H / 2, DECK_STEP_M / 2]} position={[-DECK_W / 2, DECK_T / 2 + PARAPET_H / 2, 0]} />
        </RigidBody>
      ))}
      {/* the ground, wide enough for anything that leaves the deck */}
      <RigidBody type="fixed" position={[slabs[Math.floor(slabs.length / 2)].pos.x, -0.5, slabs[Math.floor(slabs.length / 2)].pos.z]}>
        <CuboidCollider args={[600, 0.5, 600]} />
      </RigidBody>
    </>
  )
}

function Coupler({ a, b }: { a: RefObject<RapierRigidBody | null>; b: RefObject<RapierRigidBody | null> }) {
  // spherical joint at the shared coupler: half a car pitch behind a, ahead of b
  useSphericalJoint(a, b, [
    [0, 1.2, -MODEL_CAR_PITCH_M / 2],
    [0, 1.2, MODEL_CAR_PITCH_M / 2],
  ])
  return null
}

function Cars() {
  const parts = useCarParts()
  const refs = useMemo(() => [0, 1, 2].map(() => createRef<RapierRigidBody>()), [])
  const initial = useMemo(() => {
    const excess = Math.max(0, wreck.lateralMs2 - 2.6)
    const travel = wreck.velocity.clone().normalize()
    // outside of the curve: opposite the side it bends toward
    const outward = leftOf(travel).multiplyScalar(-Math.sign(wreck.kappa || 1))
    const lin = wreck.velocity.clone().addScaledVector(outward, KICK_PER_EXCESS * excess)
    // roll about the travel axis toward the outside
    const ang = travel.clone().multiplyScalar(-Math.sign(wreck.kappa || 1) * ROLL_PER_EXCESS * excess)
    return { lin, ang }
  }, [])
  return (
    <>
      {wreck.cars.map((c, i) => (
        <RigidBody
          key={i}
          ref={refs[i]}
          type="dynamic"
          position={c.position}
          quaternion={c.quaternion}
          linearVelocity={[initial.lin.x, initial.lin.y, initial.lin.z]}
          angularVelocity={[initial.ang.x, initial.ang.y, initial.ang.z]}
          linearDamping={0.15}
          angularDamping={0.6}
          colliders={false}
        >
          <CuboidCollider
            args={[TRAINSET.widthM / 2, TRAINSET.heightM / 2, MODEL_CAR_PITCH_M / 2]}
            position={[0, TRAINSET.heightM / 2, 0]}
            mass={CAR_MASS_KG}
            friction={0.7}
            restitution={0.05}
          />
          <CarModel slot={i as 0 | 1 | 2} parts={parts} />
        </RigidBody>
      ))}
      <Coupler a={refs[0]} b={refs[1]} />
      <Coupler a={refs[1]} b={refs[2]} />
      <LeadTracker body={refs[0]} />
    </>
  )
}

/** Steps the world by hand (slow motion first), publishes the lead car for the camera. */
function LeadTracker({ body }: { body: RefObject<RapierRigidBody | null> }) {
  const { step } = useRapier()
  const acc = useRef(0)
  useFrame((_, dt) => {
    const age = performance.now() - wreck.atMs
    if (age > SETTLE_MS) return
    const scale = age < SLOW_MS ? SLOW_SCALE : 1
    // fixed 1/60 steps, scaled: the accumulator keeps it frame-rate independent
    acc.current += Math.min(dt, 0.1) * scale
    while (acc.current >= 1 / 60) {
      step(1 / 60)
      acc.current -= 1 / 60
    }
    const t = body.current?.translation()
    if (t) wreck.lead.set(t.x, t.y, t.z)
  })
  return null
}

export default function DriveWreck() {
  const derail = useDriveStore((s) => s.drive?.derail ?? null)
  if (!derail || !wreck.ready) return null
  return (
    <Physics gravity={[0, -9.81, 0]} paused>
      <Deck gM={gAt(derail.sKm)} />
      <Cars />
    </Physics>
  )
}
```

- [ ] **Step 5: Mount lazily** in `src/scene/World.tsx`:

```tsx
import { lazy } from 'react'
const DriveWreck = lazy(() => import('./drive/DriveWreck'))

function WreckGate() {
  const derailed = useDriveStore((s) => s.drive?.phase === 'derailed')
  return derailed ? <DriveWreck /> : null
}
```
and inside the metro `<Suspense fallback={null}>`, after `<DriveTrain />`: `<WreckGate />`. Import `useDriveStore`.

`wreck.ready` is set by `DriveTrain` on the first derailed frame; `DriveWreck` reads it on mount — because `WreckGate` re-renders on the phase change in the same tick, mount can precede that frame. Make `DriveWreck` subscribe: replace `if (!derail || !wreck.ready) return null` with a small poll:
```tsx
  const [armed, setArmed] = useState(wreck.ready)
  useEffect(() => {
    if (armed) return
    const id = setInterval(() => { if (wreck.ready) { setArmed(true); clearInterval(id) } }, 16)
    return () => clearInterval(id)
  }, [armed])
  if (!derail || !armed) return null
```
(import `useEffect, useState` from react).

- [ ] **Step 6: Verify in the browser** — the same drive as Task 7 Step 3; after `phase === 'derailed'`, screenshot at 0.5 s, 2 s and 6 s (`window.__cam` at `wreck.lead` + (40, 18, 40)). Expect: cars leave the rails, roll outward, drag along the deck / go over the parapet, come to rest; no console errors; `document.querySelector('canvas')` still drawing. Then Restart and confirm the plain train is back on the rails and the wreck unmounted.

- [ ] **Step 7: Gate and commit**

```bash
npx tsc -b && npm test && npm run build
git add package.json package-lock.json src/scene/drive/wreck.ts src/scene/drive/DriveWreck.tsx src/scene/DriveTrain.tsx src/scene/World.tsx
git commit -m "The derailed set tumbles as rigid bodies on the viaduct"
```

---

### Task 9: Crash FX — sparks, smoke, fire, shake

**Files:**
- Create: `src/scene/drive/CrashFX.tsx`
- Modify: `src/scene/drive/DriveWreck.tsx` (mount `CrashFX` inside `Cars`)
- Modify: `src/scene/DriveTrain.tsx` (camera shake)

**Interfaces:**
- Produces: `export const shake = { value: 0 }` in `src/scene/drive/wreck.ts` — camera offset amplitude in metres, written by `CrashFX`, read by the drive camera.
- Consumes: `wreck.lead`, `wreck.atMs`.

- [ ] **Step 1: Add the shake value** to `src/scene/drive/wreck.ts`:
```ts
/** camera shake amplitude, metres; decays after the derail */
export const shake = { value: 0 }
```

- [ ] **Step 2: The effects** — create `src/scene/drive/CrashFX.tsx`:

```tsx
/**
 * What a derailment looks like: a burst of sparks at the moment, smoke that
 * keeps rising from the lead car, fire from a second and a half on, and the
 * camera shaking with the impact. Sprites and points only — nothing here is
 * simulated, so it costs the same on a phone.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { shake, wreck } from './wreck'

const SPARKS = 160
const SMOKE = 48
const FIRE_AFTER_MS = 1500
const SHAKE_M = 1.6
const SHAKE_DECAY_S = 1.4

function Sparks() {
  const ref = useRef<THREE.Points>(null)
  const { geo, vel } = useMemo(() => {
    const pos = new Float32Array(SPARKS * 3)
    const vel: THREE.Vector3[] = []
    for (let i = 0; i < SPARKS; i++) {
      pos.set([0, 0.4, 0], i * 3)
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 7 + 2, (Math.random() - 0.5) * 12))
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return { geo, vel }
  }, [])
  const origin = useMemo(() => wreck.lead.clone(), [])
  useFrame((_, dt) => {
    const p = ref.current
    if (!p) return
    const age = (performance.now() - wreck.atMs) / 1000
    const a = p.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < SPARKS; i++) {
      vel[i].y -= 9.81 * dt
      a.setXYZ(i, a.getX(i) + vel[i].x * dt, Math.max(0.05, a.getY(i) + vel[i].y * dt), a.getZ(i) + vel[i].z * dt)
    }
    a.needsUpdate = true
    ;(p.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 1.2)
    p.visible = age < 1.2
  })
  return (
    <points ref={ref} geometry={geo} position={origin}>
      <pointsMaterial color="#FFB347" size={0.18} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

function Smoke() {
  const group = useRef<THREE.Group>(null)
  const puffs = useMemo(
    () =>
      Array.from({ length: SMOKE }, (_, i) => ({
        seed: i / SMOKE,
        drift: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.2 + Math.random(), (Math.random() - 0.5) * 0.8),
      })),
    [],
  )
  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    const age = (performance.now() - wreck.atMs) / 1000
    g.position.copy(wreck.lead)
    g.children.forEach((c, i) => {
      const p = puffs[i]
      const t = (age * 0.5 + p.seed) % 1 // each puff on its own 2 s loop
      c.position.copy(p.drift).multiplyScalar(t * 6).add(new THREE.Vector3(0, 2.5, 0))
      c.scale.setScalar(1.5 + t * 5)
      c.quaternion.copy(camera.quaternion)
      ;((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - t) * Math.min(1, age / 0.5)
    })
  })
  return (
    <group ref={group}>
      {puffs.map((_, i) => (
        <mesh key={i}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="#3A3A3A" transparent depthWrite={false} opacity={0} />
        </mesh>
      ))}
    </group>
  )
}

function Fire() {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform float uTime; uniform float uAlpha; varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
          void main(){
            vec2 p = vUv; p.y -= uTime * 0.9;
            float n = noise(p * 4.0) * 0.6 + noise(p * 9.0 + 3.0) * 0.4;
            float flame = smoothstep(0.15, 0.9, n * (1.3 - vUv.y)) * (1.0 - abs(vUv.x - 0.5) * 2.0);
            vec3 col = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.3), flame);
            gl_FragColor = vec4(col, flame * uAlpha);
          }`,
      }),
    [],
  )
  useFrame(({ camera }) => {
    const m = ref.current
    if (!m) return
    const age = performance.now() - wreck.atMs
    mat.uniforms.uTime.value = age / 1000
    mat.uniforms.uAlpha.value = Math.min(1, Math.max(0, (age - FIRE_AFTER_MS) / 800))
    m.position.copy(wreck.lead).setY(wreck.lead.y + 3)
    m.quaternion.copy(camera.quaternion)
  })
  return (
    <mesh ref={ref} material={mat}>
      <planeGeometry args={[6, 8]} />
    </mesh>
  )
}

export function CrashFX() {
  useFrame(() => {
    const age = (performance.now() - wreck.atMs) / 1000
    shake.value = SHAKE_M * Math.max(0, 1 - age / SHAKE_DECAY_S)
  })
  return (
    <>
      <Sparks />
      <Smoke />
      <Fire />
    </>
  )
}
```

Mount `<CrashFX />` at the end of `Cars()` in `DriveWreck.tsx` (inside the fragment, after `<LeadTracker …/>`).

- [ ] **Step 3: Camera shake** — in `src/scene/DriveTrain.tsx`, import `{ shake }` and in the derailed camera branch, after the lerps:
```ts
        if (shake.value > 0) {
          camera.position.x += (Math.random() - 0.5) * shake.value
          camera.position.y += (Math.random() - 0.5) * shake.value * 0.6
        }
```

- [ ] **Step 4: Verify in the browser** — same derail run; frames at 0.3 s (sparks), 2.5 s (smoke, fire starting), 6 s (fire, wreck settled). No console errors.

- [ ] **Step 5: Gate and commit**

```bash
npx tsc -b && npm test && npm run build
git add src/scene/drive/CrashFX.tsx src/scene/drive/DriveWreck.tsx src/scene/drive/wreck.ts src/scene/DriveTrain.tsx
git commit -m "Sparks, smoke, fire and shake when a train comes off"
```

---

### Task 10: Spec note and final gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-11-drive-game-design.md` §3.1

- [ ] **Step 1: Record the simplification** — in §3.1 replace the "On rails … kinematic bodies" bullet with:

> - **On rails** the three cars are plain meshes posed from the alignment every frame, exactly as in Tracker. Rapier is not loaded and never moves a train that is on its rails.
> - **On derail** the plain cars hide and a lazily-loaded wreck spawns three dynamic bodies in their last poses …

(keep the rest of the bullet as written).

- [ ] **Step 2: Full gate, one last time**

Run: `npx tsc -b && npm test && npm run build`
Expected: clean; `npm test` shows the new `speedLimits.test.ts` and the derail/buffer/lookahead blocks passing.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-11-drive-game-design.md
git commit -m "Design: plain meshes on rails, bodies only for the wreck"
```

---

## Self-review

**Spec coverage (6a):** derail rule + constants (Task 3), penalty-brake removal (Task 2), speed boards (Task 6), Rapier world with kinematic→dynamic handoff (Task 8, as plain-mesh→dynamic per Task 10's note), deck/parapet/ground colliders (Task 8), crash FX incl. slow motion (Task 9 + manual stepping in Task 8), crash panel and restart from station (Tasks 4, 7), HUD lookahead (Tasks 5, 7), buffer stop (Task 4). Replay and "Watch replay" are phase 6c and deliberately absent. Camera views beyond following the wreck are 6b.

**Placeholders:** none — every code step is complete.

**Type consistency:** `DriveEnv` (Task 1) is used by Tasks 3–6 with the same four members; `DerailRecord.lastStopOrder` (Task 3) is what Task 4's `restartFromLastStop` and Task 7's panel read; `wreck.lead`/`wreck.atMs` (Task 8) are what Task 9 reads; `curveLimitKmh` (Task 3) is what Task 6's `speedLimits.ts` imports; `Restriction` (Task 5) and `SpeedRestriction` (Task 6) are distinct types on purpose (one is "what's ahead of me", the other "a stretch of the line").
