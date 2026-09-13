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
import { stations, trips } from '../data/network'
import { MODEL_CAR_PITCH_M, TRAINSET } from '../data/trainset'
import { curvatureAtG, gAt, sAtG } from './alignment'

export const NOTCH_MIN = -5 // -5 = emergency, -4..-1 service brake
export const NOTCH_MAX = 4 // 1..4 power
export const LINE_SPEED_KMH = 80
/**
 * What the motors can do: full effort up to the fade, nothing left at the
 * design speed. The Metropolis is built for 90 km/h and run at 80; on the
 * flat it will still creep past the line limit, and into the first curve
 * it meets too fast.
 */
export const TRACTION_FADE_KMH = 55
export const DESIGN_KMH = 92
/** lateral acceleration (m/s²) at which the HUD warns and the cab alarms */
export const A_LAT_WARN = 1.6
/**
 * What a posted restriction allows: railways sign curves for about 1 m/s²
 * of unbalanced lateral acceleration (cant deficiency of ~100 mm on
 * standard gauge, a little more for a metro), which passengers just notice.
 * The board is therefore well inside the overturning speed: a 40 km/h curve
 * overturns at about 59.
 */
export const A_LAT_POSTED = 1.2
/** lateral acceleration above which the train is derailing (overturning the outer wheels) */
export const A_LAT_DERAIL = 2.6
/** it must stay above the limit this long — a blip at a curve entry is survivable with the brake */
export const DERAIL_HOLD_S = 0.6
/** hitting the terminal buffer stop faster than this derails too */
export const BUFFER_KMH = 15
/** running into the train ahead faster than this is a collision; slower, a bump */
export const COLLIDE_KMH = 10
const SPAD_PENALTY = 300
const BUMP_PENALTY = 100
/**
 * A set's reference (gM, or a scheduled train's sKm) is its middle car's
 * centre; its nose and its tail are a car and a half from there. Contact is
 * nose to tail, not centre to centre.
 */
const HALF_TRAIN_M = MODEL_CAR_PITCH_M * 1.5
/** the gap left between the player's nose and the train ahead's rear when they touch */
const COUPLER_GAP_M = 1.0
/** derailing costs this on top of whatever the run had earned */
const DERAIL_PENALTY = 1000
/** how far ahead of the leading car the HUD looks for the next restriction */
export const LOOKAHEAD_M = 400
const LOOKAHEAD_STEP_M = 10
const STOP_TOLERANCE_M = 5
/** passengers through one door per second, alighting or boarding */
const DOOR_RATE_PPS = 1.4
/** points per passenger left on the platform when the doors close early */
const STRANDED_PENALTY = 20
/** a full train is this much slower to accelerate than an empty one */
const LOAD_ACCEL_PENALTY = 0.12
/**
 * Comfort lost per notch step changed while moving, at line speed. Sized so
 * a careful driver -- four or five lever moves a station, ~100 over the
 * line -- ends with most of the 100, and one who hunts the lever every
 * second does not.
 */
const JERK_COST = 0.5
/** comfort lost per second per m/s² of lateral acceleration above the warning band */
const LATERAL_COST_PER_S = 8
/** punctuality: points at the mark for on time, falling to zero at this many seconds off */
const PUNCTUAL_MAX = 100
const PUNCTUAL_ZERO_S = 90
/**
 * Rail adhesion by weather: the fraction of the trainset's dry braking and
 * traction the wheels can actually put down. Demand more than that and they
 * slip -- the brake gives a slide, the motors give wheelspin -- so a driver
 * in the rain uses lower notches and longer braking distances.
 */
export const ADHESION: Record<Weather, number> = {
  clear: 1.0,
  overcast: 1.0,
  rain: 0.75,
  monsoon: 0.6,
  fog: 0.85,
}
/** while slipping the wheels deliver this share of what adhesion allows */
const SLIP_EFFICIENCY = 0.7
/** run-out past a terminal before the buffer stop */
const BUFFER_PAD_M = 60

export type Weather = 'clear' | 'overcast' | 'rain' | 'monsoon' | 'fog'
export const WEATHERS: readonly Weather[] = ['clear', 'overcast', 'rain', 'monsoon', 'fog']

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
  /** the next signal ahead of gM in dir, if the line is signalled */
  signalAt?(gM: number, dir: 0 | 1): { gM: number; aspect: 'green' | 'yellow' | 'red' } | null
  /** metres along the line of the rear of the nearest train ahead in dir, if any */
  trainAheadG?(gM: number, dir: 0 | 1): number | null
}

/**
 * The real Blue Line. Signals and the train ahead are not here: they depend
 * on the timetable at THIS instant, which the pure sim does not know. The
 * store composes them on each tick with `withTraffic`.
 */
export const REAL_ENV: DriveEnv = {
  gAt,
  sAtG,
  curvatureAtG,
  bufferG: [
    gAt(stations[0].sKm) - BUFFER_PAD_M,
    gAt(stations[stations.length - 1].sKm) + BUFFER_PAD_M,
  ],
}

/**
 * The posted speed for a curve of curvature kappa (1/m): the restriction a
 * board would carry, from the unbalanced lateral acceleration a railway
 * signs for (A_LAT_POSTED). Infinity on the straight.
 */
export function curveLimitKmh(kappa: number): number {
  const k = Math.abs(kappa)
  return k < 1e-6 ? Infinity : 3.6 * Math.sqrt(A_LAT_POSTED / k)
}

/** The speed at which the same curve overturns the set (A_LAT_DERAIL). */
export function curveDerailKmh(kappa: number): number {
  const k = Math.abs(kappa)
  return k < 1e-6 ? Infinity : 3.6 * Math.sqrt(A_LAT_DERAIL / k)
}

export interface DerailRecord {
  cause: 'curve' | 'buffer' | 'collision'
  /** for a collision: the rear of the train that was hit, metres along the line */
  struckRearG?: number
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
    if (limitKmh >= LINE_SPEED_KMH - 10) continue // as speedLimits: only signed curves
    if (!best || limitKmh < best.limitKmh) {
      best = { limitKmh, distM: d, radiusM: 1 / Math.abs(kappa) }
    }
  }
  return best
}

/**
 * The real line plus the trains on it right now: signal aspects from block
 * occupancy, and the rear of the nearest scheduled train ahead. `trains` are
 * same-direction scheduled trains as (chainage, direction).
 */
export function withTraffic(
  base: DriveEnv,
  trains: { sKm: number; dir: 0 | 1 }[],
  signals: {
    occupiedBlocks(trains: { sKm: number; dir: 0 | 1 }[], dir: 0 | 1): Set<number>
    signalAhead(sKm: number, dir: 0 | 1, occ: Set<number>): { gM: number; aspect: 'green' | 'yellow' | 'red' } | null
  },
): DriveEnv {
  const occ = [signals.occupiedBlocks(trains, 0), signals.occupiedBlocks(trains, 1)]
  return {
    ...base,
    signalAt: (gM, dir) => signals.signalAhead(base.sAtG(gM), dir, occ[dir]),
    trainAheadG: (gM, dir) => {
      // the rear of the nearest train ahead: its reference is its centre, so
      // its rear end is a car and a half behind that
      let best: number | null = null
      for (const t of trains) {
        if (t.dir !== dir) continue
        const centre = base.gAt(t.sKm)
        const rear = centre + (dir === 0 ? -1 : 1) * HALF_TRAIN_M
        const ahead = dir === 0 ? rear > gM : rear < gM
        if (!ahead) continue
        if (best === null || (dir === 0 ? rear < best : rear > best)) best = rear
      }
      return best
    },
  }
}

export type DrivePhase = 'ready' | 'run' | 'dwell' | 'derailed' | 'done'

export interface StopResult {
  stationOrder: number
  errM: number
  points: number
  label: string
  /** seconds late against the run's schedule (negative = early) */
  lateSec?: number
  punctualityPoints?: number
}

/** The platform exchange while the doors are open. */
export interface Boarding {
  /** still to get off */
  alighting: number
  /** still to get on */
  waiting: number
  /** alighting + waiting when the doors opened, for a progress bar */
  total: number
  done: boolean
  /** left behind when the doors closed early */
  stranded: number
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
  /** seconds the doors have been open at this platform */
  dwellRemainSec: number
  boarding: Boarding | null
  /** true for the one step on which boarding completed (the cab chime) */
  chime: boolean
  /** 0..1 how full the train is */
  load: number
  /** 0..100, passengers' ride comfort so far */
  comfort: number
  /** schedule for this run: arrival at each station order, seconds after first power */
  schedule: Record<number, number> | null
  /** seconds since first power, the run's clock */
  runS: number
  /** runS at the last notch change, for the jerk rule */
  lastNotchAtS: number
  /** signals passed at danger this run */
  spads: number
  /** metres of the last signal charged as a SPAD, so it is charged once */
  lastSpadG: number | null
  /** low-speed contacts with the train ahead */
  bumps: number
  /** the next signal ahead, for the HUD */
  signal: { gM: number; distM: number; aspect: 'green' | 'yellow' | 'red' } | null
  /** rail adhesion, 0..1 -- see ADHESION */
  adhesion: number
  /** the wheels are slipping: braking or traction demanded beyond what adhesion allows */
  slipping: boolean
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
  /** the next curve restriction within LOOKAHEAD_M, for the HUD */
  ahead: Restriction | null
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
    boarding: null,
    chime: false,
    load: 0.35,
    comfort: 100,
    schedule: null,
    runS: 0,
    lastNotchAtS: -1,
    spads: 0,
    lastSpadG: null,
    bumps: 0,
    signal: null,
    adhesion: 1,
    slipping: false,
    nextStopOrder: dir === 0 ? 1 : stations.length - 2,
    distToNextM: 0,
    score: 0,
    stops: [],
    overspeed: false,
    lateralMs2: 0,
    overLimitS: 0,
    ahead: null,
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

  st.chime = false
  if (st.phase === 'dwell' || st.phase === 'ready') {
    if (st.startedAtMs !== null) st.runS += dt
    if (st.doorsOpen) {
      // the platform exchange, at DOOR_RATE_PPS per door; alight first, then board
      st.dwellRemainSec += dt
      if (st.boarding && !st.boarding.done) {
        const b = { ...st.boarding }
        let budget = DOOR_RATE_PPS * TRAINSET.doorsPerSidePerCar * TRAINSET.cars * dt
        const off = Math.min(b.alighting, budget)
        b.alighting -= off
        budget -= off
        const on = Math.min(b.waiting, budget)
        b.waiting -= on
        if (b.alighting < 1e-6 && b.waiting < 1e-6) {
          b.alighting = 0
          b.waiting = 0
          b.done = true
          st.chime = true
        }
        st.boarding = b
      }
      // doors open: no traction, whatever the notch says
      return st
    }
    // doors closed and a power notch: away we go
    if (st.notch > 0) {
      if (st.phase === 'ready') {
        st.startedAtMs = Date.now()
        st.schedule = scheduleFor(st.dir, st.lastStopOrder)
        st.runS = 0
      }
      st.phase = 'run'
      st.boarding = null
    } else {
      return st
    }
  }
  st.runS += dt

  // --- physics ---
  // Line speed is a rule, not a governor: the driver may break it, and the
  // score, the curves and the physics are the judge. Nothing here brakes.
  st.overspeed = kmh(st.vMs) > LINE_SPEED_KMH

  let a = 0
  // a full train is a heavier one: a shade slower to pull away
  const massFactor = 1 - LOAD_ACCEL_PENALTY * st.load
  if (st.notch > 0) {
    a = (st.notch / NOTCH_MAX) * TRAINSET.accelMs2 * massFactor
    // the traction curve: full pull to TRACTION_FADE_KMH, then the motors
    // run out of tractive effort and the set tops out at DESIGN_KMH. The
    // line limit is still the driver's to keep; this is what the train can do.
    const v = kmh(st.vMs)
    if (v > TRACTION_FADE_KMH) a *= Math.max(0, (DESIGN_KMH - v) / (DESIGN_KMH - TRACTION_FADE_KMH))
  } else if (st.notch === -5) a = -TRAINSET.emergencyBrakeMs2
  else if (st.notch < 0) a = (st.notch / 4) * TRAINSET.brakeMs2
  // Adhesion: the rail will only take so much. Ask for more and the wheels
  // slip -- a slide under the brake, wheelspin under power -- and deliver
  // less than the limit, not more. Dry rail takes everything the set has.
  const limit = TRAINSET.emergencyBrakeMs2 * st.adhesion
  st.slipping = st.vMs > 0.1 && st.adhesion < 1 && Math.abs(a) > limit
  if (st.slipping) a = Math.sign(a) * limit * SLIP_EFFICIENCY
  a -= 0.004 * st.vMs // rolling/air drag
  st.vMs = Math.max(0, st.vMs + a * dt)

  const prevG = st.gM
  st.gM += st.dir === 0 ? st.vMs * dt : -st.vMs * dt

  // --- the train ahead ---
  // Contact is at the nose, a car pitch ahead of the reference. Fast, and it
  // is a collision -- the wreck takes over; slow, a bump that stops the train
  // against the one in front, which then sits there until it moves off.
  const aheadG = env.trainAheadG?.(st.gM, st.dir) ?? null
  if (aheadG !== null) {
    const noseG = st.gM + (st.dir === 0 ? 1 : -1) * HALF_TRAIN_M
    const gap = st.dir === 0 ? aheadG - noseG : noseG - aheadG
    if (gap <= COUPLER_GAP_M) {
      if (kmh(st.vMs) > COLLIDE_KMH) {
        st.sKm = env.sAtG(st.gM)
        const rec = derailed(st, env, { cause: 'collision', limitKmh: COLLIDE_KMH, radiusM: Infinity })
        rec.derail!.struckRearG = aheadG
        return rec
      }
      // held against the train ahead
      st.gM = st.dir === 0 ? aheadG - COUPLER_GAP_M - HALF_TRAIN_M : aheadG + COUPLER_GAP_M + HALF_TRAIN_M
      if (prev.vMs > 0 && st.vMs > 0) {
        st.bumps += 1
        st.score -= BUMP_PENALTY
      }
      st.vMs = 0
    }
  }
  st.sKm = env.sAtG(st.gM)

  // --- signals ---
  // A SPAD is judged against the signal that was ahead BEFORE this step: once
  // the train is past a block entry, "the signal ahead" is already the next
  // one, so the crossing has to be caught on the way in, not looked up after.
  const was = prev.signal
  if (was && was.aspect === 'red') {
    const crossed = st.dir === 0 ? prevG < was.gM && st.gM >= was.gM : prevG > was.gM && st.gM <= was.gM
    if (crossed && st.lastSpadG !== was.gM) {
      st.spads += 1
      st.lastSpadG = was.gM
      st.score -= SPAD_PENALTY
    }
  }
  const sig = env.signalAt?.(st.gM, st.dir) ?? null
  st.signal = sig ? { gM: sig.gM, distM: st.dir === 0 ? sig.gM - st.gM : st.gM - sig.gM, aspect: sig.aspect } : null

  // --- the curve rule ---
  // lateral acceleration on the leading car: v²·κ, with κ at the front of the
  // set, a car pitch ahead of the reference car
  const leadG = st.gM + (st.dir === 0 ? 1 : -1) * MODEL_CAR_PITCH_M
  const kappa = env.curvatureAtG(leadG)
  st.lateralMs2 = st.vMs * st.vMs * Math.abs(kappa)
  st.ahead = restrictionAhead(leadG, st.dir, env)
  // riding a curve in the warning band is uncomfortable, and stays so
  if (st.lateralMs2 > A_LAT_WARN) {
    st.comfort = Math.max(0, st.comfort - LATERAL_COST_PER_S * (st.lateralMs2 - A_LAT_WARN) * dt)
  }
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
    if (kmh(st.vMs) > BUFFER_KMH) {
      return derailed(st, env, { cause: 'buffer', limitKmh: BUFFER_KMH, radiusM: Infinity })
    }
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
    const due = st.schedule?.[target.order]
    const lateSec = due === undefined ? undefined : st.runS - due
    const punctualityPoints =
      lateSec === undefined
        ? 0
        : Math.round(PUNCTUAL_MAX * Math.max(0, 1 - Math.abs(lateSec) / PUNCTUAL_ZERO_S))
    st.stops = [
      ...st.stops,
      { stationOrder: target.order, errM: distM, points, label, lateSec, punctualityPoints },
    ]
    st.score += points + punctualityPoints
    st.lastStopOrder = target.order
    st.doorsOpen = true
    st.dwellRemainSec = 0
    st.boarding = exchangeAt(target.order, st.load)
    // the exchange sets the new load: everyone waiting will get on
    st.load = Math.min(
      1,
      Math.max(0.05, st.load - st.boarding.alighting / TRAINSET.capacity + st.boarding.waiting / TRAINSET.capacity),
    )
    if (isTerminal) {
      st.phase = 'done'
    } else {
      st.phase = 'dwell'
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
    boarding: null,
    chime: false,
    slipping: false,
    nextStopOrder: order + (st.dir === 0 ? 1 : -1),
    distToNextM: 0,
    lateralMs2: 0,
    overLimitS: 0,
    ahead: null,
    derail: null,
  }
}

/** notch changes closer together than this are one lever movement, charged once */
const LEVER_MOVE_S = 0.4

export function setNotch(st: DriveState, notch: number): DriveState {
  const next = Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, notch))
  if (next === st.notch) return st
  // a notch change while moving is a jerk the passengers feel, more at speed;
  // a lever swept through several notches in one go is one jerk, not several
  const steps = Math.abs(next - st.notch)
  const atSpeed = st.vMs > 0.5 ? Math.min(1, kmh(st.vMs) / LINE_SPEED_KMH) : 0
  const sameMove = st.runS - st.lastNotchAtS < LEVER_MOVE_S
  const comfort = sameMove ? st.comfort : Math.max(0, st.comfort - JERK_COST * steps * atSpeed)
  return { ...st, notch: next, comfort, lastNotchAtS: st.runS }
}

/** Open or close the doors. Only at rest; closing early strands whoever is still on the platform. */
export function toggleDoors(st: DriveState): DriveState {
  if (st.vMs > 0 || (st.phase !== 'dwell' && st.phase !== 'ready' && st.phase !== 'done')) return st
  if (st.doorsOpen) {
    const b = st.boarding
    const stranded = b && !b.done ? Math.ceil(b.waiting) : 0
    return {
      ...st,
      doorsOpen: false,
      score: st.score - STRANDED_PENALTY * stranded,
      boarding: b ? { ...b, alighting: 0, waiting: 0, done: true, stranded } : null,
    }
  }
  return { ...st, doorsOpen: true }
}

/**
 * Who gets off and who is waiting at a platform, from the engine's occupancy
 * shape: busiest around the city centre, and the platform has been filling
 * since the last train.
 */
function exchangeAt(order: number, load: number): Boarding {
  const s = stations[order].sKm
  const centre = 1 - Math.abs(s - 16) / 22 // same shape as the engine's occupancyAt
  const cap = TRAINSET.capacity
  const alighting = Math.round(load * cap * (0.25 + 0.35 * centre))
  const waiting = Math.round(cap * 0.12 * (0.4 + centre))
  return { alighting, waiting, total: alighting + waiting, done: false, stranded: 0 }
}

/**
 * The run's schedule: the real timetable's inter-station running times for
 * this direction, rebased so each station is due the timetable's run time
 * after the moment power is first applied at `fromOrder`. Keyed by station
 * order, seconds since first power.
 */
function scheduleFor(dir: 0 | 1, fromOrder: number): Record<number, number> {
  const trip =
    trips.find((t) => t.dir === dir && t.stops.length === stations.length) ??
    trips.find((t) => t.dir === dir)
  const out: Record<number, number> = {}
  if (!trip) return out
  const at = trip.stops.find(([o]) => o === fromOrder)
  if (!at) return out
  const dep0 = at[2]
  for (const [o, arr] of trip.stops) {
    const ahead = dir === 0 ? o > fromOrder : o < fromOrder
    if (ahead) out[o] = arr - dep0
  }
  return out
}

/** braking distance from current speed at full service brake (for the HUD), on rail of this adhesion */
export function brakingDistanceM(vMs: number, adhesion = 1): number {
  const b = Math.min(TRAINSET.brakeMs2, TRAINSET.emergencyBrakeMs2 * adhesion)
  return (vMs * vMs) / (2 * b)
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
