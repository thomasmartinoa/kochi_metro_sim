/**
 * Water Metro timetable engine — the boat twin of engine.ts.
 * Deterministic: same clock in => same boat states out. Schedules are
 * synthesised from published service patterns (scripts/gen-water-schedule.mjs)
 * because KMRL publishes no GTFS for the Water Metro. Runs daily (no WK/WE).
 */
import waterRaw from '../data/water.json'
import { DAY_SEC, istDayTime } from './clock'

export interface WaterTerminal {
  id: string
  name: string
  nameMl: string
  lat: number
  lon: number
}

export interface WaterTrip {
  id: string
  dir: 0 | 1
  /** [terminalIndex (into water.terminals), arrSec, depSec] */
  stops: [number, number, number][]
}

export interface WaterRoute {
  id: string
  name: string
  color: string
  speedKmh: number
  /** [lat, lon, cumulative km] */
  path: [number, number, number][]
  stops: { term: number; km: number }[]
  lengthKm: number
  window: [number, number]
  trips: WaterTrip[]
}

interface WaterBundle {
  meta: { note: string; attribution: string }
  terminals: WaterTerminal[]
  routes: WaterRoute[]
}

export const water = waterRaw as unknown as WaterBundle
export const terminals = water.terminals
export const waterRoutes = water.routes
export const routeById = new Map(water.routes.map((r) => [r.id, r]))

export interface BoatState {
  tripId: string
  routeId: string
  dir: 0 | 1
  phase: 'dwell' | 'run'
  /** distance along the route path, km */
  sKm: number
  speedKmh: number
  /** terminal indices into water.terminals */
  prevTerm: number
  nextTerm: number
  etaSec: number
  occupancy: number
  progress: number
}

const ease = (f: number) => f * f * (3 - 2 * f)
const easeD = (f: number) => 6 * f * (1 - f)

/** Midday-tourism + commute blend; boats are busiest on sunny afternoons. */
function occupancyAt(daySec: number, routeId: string): number {
  const h = daySec / 3600
  const commute = Math.exp(-((h - 8.75) ** 2) / 2.5) + Math.exp(-((h - 17.75) ** 2) / 3)
  const tourist = Math.exp(-((h - 13) ** 2) / 8)
  const mix = routeId === 'W2' || routeId === 'W3' ? commute * 0.75 + tourist * 0.2 : tourist * 0.6 + commute * 0.35
  return Math.max(0.08, Math.min(1, 0.25 + mix * 0.6))
}

function stopKm(route: WaterRoute, termIndex: number): number {
  const s = route.stops.find((x) => x.term === termIndex)
  return s ? s.km : 0
}

export function tripStateAt(route: WaterRoute, trip: WaterTrip, t: number): BoatState | null {
  const stops = trip.stops
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (t < first[1] || t > last[2]) return null
  const total = last[1] - first[2] || 1
  const base = {
    tripId: trip.id,
    routeId: route.id,
    dir: trip.dir,
    occupancy: occupancyAt(t, route.id),
    progress: Math.max(0, Math.min(1, (t - first[2]) / total)),
  }
  for (let i = 0; i < stops.length; i++) {
    const [term, arr, dep] = stops[i]
    if (t >= arr && t <= dep) {
      return {
        ...base,
        phase: 'dwell',
        sKm: stopKm(route, term),
        speedKmh: 0,
        prevTerm: term,
        nextTerm: i + 1 < stops.length ? stops[i + 1][0] : term,
        etaSec: 0,
      }
    }
    if (i + 1 < stops.length) {
      const [nTerm, nArr] = stops[i + 1]
      if (t > dep && t < nArr) {
        const f = (t - dep) / (nArr - dep)
        const sA = stopKm(route, term)
        const sB = stopKm(route, nTerm)
        const s = sA + (sB - sA) * ease(f)
        return {
          ...base,
          phase: 'run',
          sKm: s,
          speedKmh: (Math.abs(sB - sA) * easeD(f) * 3600) / (nArr - dep),
          prevTerm: term,
          nextTerm: nTerm,
          etaSec: nArr - t,
        }
      }
    }
  }
  return null
}

/** All boats on all routes at service-day second t. */
export function boatStatesAt(t: number): BoatState[] {
  const out: BoatState[] = []
  for (const r of water.routes) {
    for (const trip of r.trips) {
      const st = tripStateAt(r, trip, t)
      if (st) out.push(st)
    }
  }
  return out
}

/** Live boats for a real UTC epoch (IST-aware; water metro runs daily). */
export function liveBoatStates(epochMs: number): BoatState[] {
  return boatStatesAt(istDayTime(epochMs).daySec)
}

export function boatStateById(epochMs: number, tripId: string): BoatState | null {
  const routeId = tripId.split('_')[0]
  const r = routeById.get(routeId)
  if (!r) return null
  const trip = r.trips.find((tr) => tr.id === tripId)
  if (!trip) return null
  return tripStateAt(r, trip, istDayTime(epochMs).daySec)
}

/** Fare by scheduled sailing time — ₹20 / ₹30 / ₹40 bands (watermetro.co.in). */
export function waterFare(durationSec: number): number {
  const min = durationSec / 60
  if (min <= 12) return 20
  if (min <= 35) return 30
  return 40
}

export interface WaterDeparture {
  tripId: string
  routeId: string
  dir: 0 | 1
  depSec: number
  inSec: number
  destTerm: number
}

export function terminalDeparturesAt(epochMs: number, term: number, limit = 6): WaterDeparture[] {
  const { daySec } = istDayTime(epochMs)
  const deps: WaterDeparture[] = []
  for (const r of water.routes) {
    for (const trip of r.trips) {
      for (let i = 0; i < trip.stops.length - 1; i++) {
        const [t, , dep] = trip.stops[i]
        if (t === term && dep >= daySec) {
          deps.push({
            tripId: trip.id,
            routeId: r.id,
            dir: trip.dir,
            depSec: dep,
            inSec: dep - daySec,
            destTerm: trip.stops[trip.stops.length - 1][0],
          })
          break
        }
      }
    }
  }
  deps.sort((a, b) => a.depSec - b.depSec)
  return deps.slice(0, limit)
}

export interface WaterJourney {
  routeId: string
  tripId: string
  departSec: number
  arriveSec: number
  waitSec: number
  fare: number
}

/** Next single-route sailing between two terminals (interchange not planned). */
export function planWaterJourneyAt(epochMs: number, fromTerm: number, toTerm: number): WaterJourney | null {
  const { daySec } = istDayTime(epochMs)
  let best: WaterJourney | null = null
  for (const r of water.routes) {
    for (const trip of r.trips) {
      let dep = -1
      let arr = -1
      for (const [term, a, d] of trip.stops) {
        if (term === fromTerm && dep < 0) dep = d
        if (term === toTerm && dep >= 0) {
          arr = a
          break
        }
      }
      if (dep >= daySec && arr > dep && (!best || dep < best.departSec)) {
        best = {
          routeId: r.id,
          tripId: trip.id,
          departSec: dep,
          arriveSec: arr,
          waitSec: dep - daySec,
          fare: waterFare(arr - dep),
        }
      }
    }
  }
  return best
}

export interface WaterServiceStatus {
  open: boolean
  nextSailSec?: number
  activeCount: number
}

export function waterServiceStatusAt(epochMs: number): WaterServiceStatus {
  const active = liveBoatStates(epochMs)
  if (active.length > 0) return { open: true, activeCount: active.length }
  const { daySec } = istDayTime(epochMs)
  let next = Infinity
  for (const r of water.routes) {
    for (const trip of r.trips) {
      const dep = trip.stops[0][2]
      if (dep >= daySec && dep < next) next = dep
    }
  }
  if (next === Infinity) {
    // service done for today — first sailing tomorrow
    for (const r of water.routes) {
      for (const trip of r.trips) {
        const dep = trip.stops[0][2] + DAY_SEC
        if (dep < next) next = dep
      }
    }
  }
  return { open: false, nextSailSec: next, activeCount: 0 }
}
