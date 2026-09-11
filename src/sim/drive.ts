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
export const PENALTY_SPEED_KMH = 85
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
  if (vKmh > PENALTY_SPEED_KMH) st.penaltyBrake = true
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
