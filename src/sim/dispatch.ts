/**
 * Dispatch (controller) mode — a delay overlay on the deterministic schedule.
 * Each trip can carry a delay; its position is simply the scheduled position
 * at (now - delay). Pure helpers here; session state lives in the store.
 */
import { trips } from '../data/network'
import { DAY_SEC, istDayTime, serviceForDow } from './clock'
import { tripStateAt, type TrainState } from './engine'

export interface DispatchTrainState extends TrainState {
  delaySec: number
  held: boolean
  incident: boolean
}

export type DelayMap = Record<string, number>

/** Train states with per-trip delays applied (delayed trains run "behind"). */
export function delayedTrainStates(epochMs: number, delays: DelayMap): TrainState[] {
  const { daySec, dow } = istDayTime(epochMs)
  const out: TrainState[] = []
  const services = [serviceForDow(dow), serviceForDow((dow + 6) % 7)]
  for (const trip of trips) {
    const delay = delays[trip.id] ?? 0
    let st: TrainState | null = null
    if (trip.service === services[0]) st = tripStateAt(trip, daySec - delay)
    if (!st && trip.service === services[1]) st = tripStateAt(trip, daySec + DAY_SEC - delay)
    if (st) out.push(st)
  }
  return out
}

export interface HeadwayStats {
  /** mean gap between same-direction trains, km */
  meanKm: number
  /** coefficient of variation (std/mean); lower = more even service */
  cv: number
  count: number
}

/** Spatial headway evenness for one direction (the core dispatch KPI). */
export function headwayStats(states: TrainState[], dir: 0 | 1): HeadwayStats {
  const s = states
    .filter((t) => t.dir === dir)
    .map((t) => t.sKm)
    .sort((a, b) => a - b)
  if (s.length < 3) return { meanKm: 0, cv: 0, count: s.length }
  const gaps: number[] = []
  for (let i = 1; i < s.length; i++) gaps.push(s[i] - s[i - 1])
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const varc = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length
  return { meanKm: mean, cv: mean > 0 ? Math.sqrt(varc) / mean : 0, count: s.length }
}

/** 0-100 service quality from headway evenness + accumulated delay. */
export function serviceQuality(cvUp: number, cvDown: number, totalDelaySec: number): number {
  const cvPenalty = ((cvUp + cvDown) / 2) * 90 // cv 0.5 -> -45
  const delayPenalty = Math.min(40, totalDelaySec / 30)
  return Math.max(0, Math.min(100, Math.round(100 - cvPenalty - delayPenalty)))
}

export interface Incident {
  id: number
  tripId: string
  kind: string
  remainSec: number
  totalSec: number
}

export const INCIDENT_KINDS = [
  'Door fault',
  'Signal check',
  'Medical assistance',
  'Track inspection',
  'Power fluctuation',
]
