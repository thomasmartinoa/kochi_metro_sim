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
import { MODEL_CAR_PITCH_M, TRAINSET } from '../data/trainset'
import { curvatureAtG, gAt, sAtG } from './alignment'

export const NOTCH_MIN = -5 // -5 = emergency, -4..-1 service brake
export const NOTCH_MAX = 4 // 1..4 power
export const LINE_SPEED_KMH = 80
/** lateral acceleration (m/s²) at which the HUD warns and the cab alarms */
export const A_LAT_WARN = 1.6
/** lateral acceleration above which the train is derailing */
export const A_LAT_DERAIL = 2.6
/** it must stay above the limit this long — a blip at a curve entry is survivable with the brake */
export const DERAIL_HOLD_S = 0.6
/** derailing costs this on top of whatever the run had earned */
const DERAIL_PENALTY = 1000
const DWELL_SEC = 10
const STOP_TOLERANCE_M = 5
/** run-out past a terminal before the buffer stop */
const BUFFER_PAD_M = 60

/** The line as the sim sees it: chainage <-> metres, and how it bends. */
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
  /** the limit that was broken (curve limit, or BUFFER_KMH) */
  limitKmh: number
  /** curve radius in metres at the derail point; Infinity for the buffer */
  radiusM: number
  /** the last station the train stopped at, for the restart */
  lastStopOrder: number
}

export type DrivePhase = 'ready' | 'run' | 'dwell' | 'derailed' | 'done'

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
  /** lateral acceleration on the leading car right now, m/s² */
  lateralMs2: number
  /** seconds spent above A_LAT_DERAIL without relief */
  overLimitS: number
  derail: DerailRecord | null
  /** the last station the train stopped at (its start, until the first stop) */
  lastStopOrder: number
  startedAtMs: number | null
}

export function newDrive(dir: 0 | 1, env: DriveEnv = REAL_ENV): DriveState {
  const startOrder = dir === 0 ? 0 : stations.length - 1
  return {
    dir,
    gM: env.gAt(stations[startOrder].sKm),
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
    lateralMs2: 0,
    overLimitS: 0,
    derail: null,
    lastStopOrder: startOrder,
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

  if (st.phase === 'done' || st.phase === 'derailed') return st

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
  // Line speed is a rule, not a governor: the driver may break it, and the
  // score, the curves and the physics are the judge. Nothing here brakes.
  st.overspeed = kmh(st.vMs) > LINE_SPEED_KMH

  let a = 0
  if (st.notch > 0) a = (st.notch / NOTCH_MAX) * TRAINSET.accelMs2
  else if (st.notch === -5) a = -TRAINSET.emergencyBrakeMs2
  else if (st.notch < 0) a = (st.notch / 4) * TRAINSET.brakeMs2
  a -= 0.004 * st.vMs // rolling/air drag
  st.vMs = Math.max(0, st.vMs + a * dt)

  st.gM += st.dir === 0 ? st.vMs * dt : -st.vMs * dt
  st.sKm = env.sAtG(st.gM)

  // --- the curve rule ---
  // lateral acceleration on the leading car: v²·κ, with κ at the front of the
  // set, a car pitch ahead of the reference car
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

  // --- the end of the line ---
  // Checked before the stations: a train that has blown through the terminal
  // has no next stop, but it still has a buffer to hit.
  const [g0, g1] = env.bufferG
  if ((st.dir === 0 && st.gM > g1) || (st.dir === 1 && st.gM < g0)) {
    st.phase = 'done'
    st.vMs = 0
    return st
  }

  // --- station logic ---
  const target = stations[st.nextStopOrder]
  if (!target) {
    // past the last platform: roll on to the buffer, or come to rest
    if (st.vMs === 0) st.phase = 'done'
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
    st.lastStopOrder = target.order
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
    return st
  }

  return st
}

/** The moment it comes off: freeze the sim, take the penalty, write it up. */
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

export function setNotch(st: DriveState, notch: number): DriveState {
  return { ...st, notch: Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, notch)) }
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
