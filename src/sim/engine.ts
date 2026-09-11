/**
 * Timetable-driven position engine — the shared core of tracker and game.
 * Deterministic: same clock time in => same train states out.
 * Positions interpolate the REAL KMRL stop_times along the real track distance axis.
 */
import { stations, trips } from '../data/network'
import { TRAINSET } from '../data/trainset'
import type { ServiceId, TripData } from '../data/types'
import { DAY_SEC, istDayTime, serviceForDow } from './clock'

export type RunPhase = 'dwell' | 'run'

export interface TrainState {
  tripId: string
  dir: 0 | 1
  phase: RunPhase
  /** distance along the up axis, km */
  sKm: number
  speedKmh: number
  doorsOpen: boolean
  prevStationOrder: number
  nextStationOrder: number
  /** seconds until arrival at next station (0 while dwelling) */
  etaSec: number
  /** 0..1 estimated loading */
  occupancy: number
  /** 0..1 completion of the whole trip */
  progress: number
}

const sKmOf = (order: number) => stations[order].sKm

const ACCEL = TRAINSET.accelMs2
const BRAKE = TRAINSET.brakeMs2

/**
 * Where a train is, and how fast, `t` seconds into a run of `distM` metres
 * that the timetable gives `durS` seconds.
 *
 * A trapezoid: pull away at the trainset's service acceleration, hold a
 * cruise, brake at its service deceleration onto the mark. The cruise speed
 * is whatever makes the run land exactly on the timetable — solve
 * distM = v*durS - v^2*(1/a + 1/b)/2 for the smaller root, so there is always
 * a cruise phase. (An ease curve was used before. Its speed peaks mid-run and
 * is still climbing a third of the way in, so a train never visibly pulled
 * away or braked; it drifted between stations at what read as one speed.)
 *
 * Distance here is timetable chainage, not ground metres — the engine speaks
 * only sKm (see alignment.ts) — so the rates are exact in that axis.
 */
function runAt(distM: number, durS: number, t: number): { frac: number; vMs: number } {
  if (distM <= 0 || durS <= 0) return { frac: 0, vMs: 0 }
  const k = (1 / ACCEL + 1 / BRAKE) / 2
  const disc = durS * durS - 4 * k * distM
  let v: number
  let ta: number
  let tb: number
  if (disc >= 0) {
    v = (durS - Math.sqrt(disc)) / (2 * k)
    ta = v / ACCEL
    tb = v / BRAKE
  } else {
    // the timetable is tighter than the rates allow: no cruise, and the
    // accelerate/brake split keeps their ratio while both scale up to fit
    v = (2 * distM) / durS
    ta = (durS * BRAKE) / (ACCEL + BRAKE)
    tb = durS - ta
  }
  const tc = durS - ta - tb
  if (t <= ta) {
    const a = v / ta
    return { frac: (0.5 * a * t * t) / distM, vMs: a * t }
  }
  if (t <= ta + tc) {
    return { frac: (0.5 * v * ta + v * (t - ta)) / distM, vMs: v }
  }
  const r = Math.max(0, durS - t)
  const b = v / tb
  return { frac: (distM - 0.5 * b * r * r) / distM, vMs: b * r }
}

/** Occupancy heuristic: peaks in commute hours and toward the city centre. */
function occupancyAt(daySec: number, sKm: number, service: ServiceId): number {
  const h = daySec / 3600
  const peak =
    Math.exp(-((h - 8.75) ** 2) / 2.2) + Math.exp(-((h - 18) ** 2) / 3.0) + 0.25
  const centre = 1 - Math.abs(sKm - 16) / 22 // busiest around Ernakulam core
  const dayFactor = service === 'WE' ? 0.7 : 1
  return Math.max(0.05, Math.min(1, 0.55 * peak * centre * dayFactor))
}

/** State of a single trip at service-day second t, or null if not active. */
export function tripStateAt(trip: TripData, t: number): TrainState | null {
  const stops = trip.stops
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (t < first[1] || t > last[2]) return null

  const total = last[1] - first[2] || 1
  const base = {
    tripId: trip.id,
    dir: trip.dir,
    occupancy: 0,
    progress: Math.max(0, Math.min(1, (t - first[2]) / total)),
  }

  for (let i = 0; i < stops.length; i++) {
    const [order, arr, dep] = stops[i]
    if (t >= arr && t <= dep) {
      // dwelling at a station
      const s = sKmOf(order)
      return {
        ...base,
        phase: 'dwell',
        sKm: s,
        speedKmh: 0,
        doorsOpen: true,
        prevStationOrder: order,
        nextStationOrder: i + 1 < stops.length ? stops[i + 1][0] : order,
        etaSec: 0,
        occupancy: occupancyAt(t, s, trip.service),
      }
    }
    if (i + 1 < stops.length) {
      const [nOrder, nArr] = stops[i + 1]
      if (t > dep && t < nArr) {
        // running between stops i and i+1
        const sA = sKmOf(order)
        const sB = sKmOf(nOrder)
        const { frac, vMs } = runAt(Math.abs(sB - sA) * 1000, nArr - dep, t - dep)
        const s = sA + (sB - sA) * frac
        return {
          ...base,
          phase: 'run',
          sKm: s,
          speedKmh: vMs * 3.6,
          doorsOpen: false,
          prevStationOrder: order,
          nextStationOrder: nOrder,
          etaSec: nArr - t,
          occupancy: occupancyAt(t, s, trip.service),
        }
      }
    }
  }
  return null
}

/** All train states for a given service id at service-day second t (t may exceed 24h). */
export function trainStatesAt(t: number, service: ServiceId): TrainState[] {
  const out: TrainState[] = []
  for (const trip of trips) {
    if (trip.service !== service) continue
    const st = tripStateAt(trip, t)
    if (st) out.push(st)
  }
  return out
}

/**
 * Live states for a real UTC epoch (ms), IST-aware.
 * Also includes yesterday's post-midnight tail trips (times > 24h in GTFS).
 */
export function liveTrainStates(epochMs: number): TrainState[] {
  const { daySec, dow } = istDayTime(epochMs)
  const today = trainStatesAt(daySec, serviceForDow(dow))
  const yesterdayTail = trainStatesAt(daySec + DAY_SEC, serviceForDow((dow + 6) % 7))
  return [...today, ...yesterdayTail]
}

/** Live state of one trip by id (or null if not running now). */
export function trainStateById(epochMs: number, tripId: string): TrainState | null {
  const trip = trips.find((t) => t.id === tripId)
  if (!trip) return null
  const { daySec, dow } = istDayTime(epochMs)
  if (trip.service === serviceForDow(dow)) {
    const st = tripStateAt(trip, daySec)
    if (st) return st
  }
  if (trip.service === serviceForDow((dow + 6) % 7)) {
    return tripStateAt(trip, daySec + DAY_SEC)
  }
  return null
}

/** Upcoming departures from a station for a real epoch (IST + service aware). */
export function departuresAt(
  epochMs: number,
  stationOrder: number,
  limit = 4,
): { tripId: string; dir: 0 | 1; depSec: number; destOrder: number; inSec: number }[] {
  const { daySec, dow } = istDayTime(epochMs)
  return departuresFrom(stationOrder, daySec, serviceForDow(dow), limit).map((d) => ({
    ...d,
    inSec: d.depSec - daySec,
  }))
}

/** Journey plan for a real epoch (IST + service aware). */
export function planJourneyAt(
  epochMs: number,
  fromOrder: number,
  toOrder: number,
): { departSec: number; arriveSec: number; tripId: string; waitSec: number } | null {
  const { daySec, dow } = istDayTime(epochMs)
  const j = planJourney(fromOrder, toOrder, daySec, serviceForDow(dow))
  return j ? { ...j, waitSec: j.departSec - daySec } : null
}

export interface ServiceStatus {
  open: boolean
  /** next first-departure daySec if closed */
  nextTrainSec?: number
  activeCount: number
}

/** Is the network in service at this moment; if not, when is the next train? */
export function serviceStatusAt(epochMs: number): ServiceStatus {
  const active = liveTrainStates(epochMs)
  if (active.length > 0) return { open: true, activeCount: active.length }
  const { daySec, dow } = istDayTime(epochMs)
  const todayService = serviceForDow(dow)
  const todayFirst = Math.min(
    ...trips.filter((tr) => tr.service === todayService).map((tr) => tr.stops[0][2]),
  )
  if (daySec < todayFirst) return { open: false, nextTrainSec: todayFirst, activeCount: 0 }
  const tmrwService = serviceForDow((dow + 1) % 7)
  const tmrwFirst = Math.min(
    ...trips.filter((tr) => tr.service === tmrwService).map((tr) => tr.stops[0][2]),
  )
  return { open: false, nextTrainSec: tmrwFirst + DAY_SEC, activeCount: 0 }
}

/** Upcoming departures from a station (by order) after daySec, both directions. */
export function departuresFrom(
  stationOrder: number,
  t: number,
  service: ServiceId,
  limit = 4,
): { tripId: string; dir: 0 | 1; depSec: number; destOrder: number }[] {
  const deps: { tripId: string; dir: 0 | 1; depSec: number; destOrder: number }[] = []
  for (const trip of trips) {
    if (trip.service !== service) continue
    for (let i = 0; i < trip.stops.length - 1; i++) {
      const [order, , dep] = trip.stops[i]
      if (order === stationOrder && dep >= t) {
        deps.push({
          tripId: trip.id,
          dir: trip.dir,
          depSec: dep,
          destOrder: trip.stops[trip.stops.length - 1][0],
        })
        break
      }
    }
  }
  deps.sort((a, b) => a.depSec - b.depSec)
  return deps.slice(0, limit)
}

/** Scheduled journey between two stations: next trip, duration; from real stop_times. */
export function planJourney(
  fromOrder: number,
  toOrder: number,
  t: number,
  service: ServiceId,
): { departSec: number; arriveSec: number; tripId: string } | null {
  const wantDir: 0 | 1 = toOrder > fromOrder ? 0 : 1
  let best: { departSec: number; arriveSec: number; tripId: string } | null = null
  for (const trip of trips) {
    if (trip.service !== service || trip.dir !== wantDir) continue
    let dep = -1
    let arr = -1
    for (const [order, a, d] of trip.stops) {
      if (order === fromOrder) dep = d
      if (order === toOrder) arr = a
    }
    if (dep >= t && arr > dep && (!best || dep < best.departSec)) {
      best = { departSec: dep, arriveSec: arr, tripId: trip.id }
    }
  }
  return best
}
