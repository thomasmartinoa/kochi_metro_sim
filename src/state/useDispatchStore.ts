/**
 * Dispatch session state: holds, incidents, delays, KPIs.
 * tick() derives sim-dt from the shared clock epoch, so it is idempotent
 * per frame regardless of how many components call it.
 */
import { create } from 'zustand'
import {
  delayedTrainStates,
  headwayStats,
  INCIDENT_KINDS,
  serviceQuality,
  type DelayMap,
  type Incident,
} from '../sim/dispatch'
import type { TrainState } from '../sim/engine'

interface DispatchStore {
  session: boolean
  delays: DelayMap
  holds: Record<string, boolean>
  incidents: Incident[]
  resolvedCount: number
  quality: number
  /** rolling session score (quality integrated over time) */
  scoreAvg: number
  start: () => void
  stop: () => void
  toggleHold: (tripId: string) => void
  /** current adjusted states (also refreshes KPIs opportunistically) */
  statesAt: (epochMs: number) => TrainState[]
  tick: (epochMs: number) => void
}

let lastEpochMs = 0
let nextIncidentInSec = 45
let incidentSeq = 1
let qualitySamples = 0

export const useDispatchStore = create<DispatchStore>((set, get) => ({
  session: false,
  delays: {},
  holds: {},
  incidents: [],
  resolvedCount: 0,
  quality: 100,
  scoreAvg: 100,

  start: () => {
    lastEpochMs = 0
    nextIncidentInSec = 30
    qualitySamples = 0
    set({
      session: true,
      delays: {},
      holds: {},
      incidents: [],
      resolvedCount: 0,
      quality: 100,
      scoreAvg: 100,
    })
  },
  stop: () => set({ session: false }),

  toggleHold: (tripId) =>
    set((s) => ({ holds: { ...s.holds, [tripId]: !s.holds[tripId] } })),

  statesAt: (epochMs) => delayedTrainStates(epochMs, get().delays),

  tick: (epochMs) => {
    const st = get()
    if (!st.session) return
    if (lastEpochMs === 0) lastEpochMs = epochMs
    const dt = Math.max(0, Math.min((epochMs - lastEpochMs) / 1000, 5))
    lastEpochMs = epochMs
    if (dt === 0) return

    const states = delayedTrainStates(epochMs, st.delays)
    const byTrip = new Map(states.map((s) => [s.tripId, s]))

    const delays: DelayMap = { ...st.delays }
    let incidents = st.incidents
    let resolved = st.resolvedCount

    // held trains accumulate delay while dwelling at a platform
    for (const [tripId, held] of Object.entries(st.holds)) {
      if (!held) continue
      const s = byTrip.get(tripId)
      if (s && s.phase === 'dwell') delays[tripId] = (delays[tripId] ?? 0) + dt
    }

    // incidents freeze their train (delay grows as fast as time passes)
    if (incidents.length > 0) {
      incidents = incidents
        .map((inc) => {
          if (byTrip.has(inc.tripId)) delays[inc.tripId] = (delays[inc.tripId] ?? 0) + dt
          return { ...inc, remainSec: inc.remainSec - dt }
        })
        .filter((inc) => {
          if (inc.remainSec <= 0) {
            resolved++
            return false
          }
          return true
        })
    }

    // spawn a new incident on a random running train
    nextIncidentInSec -= dt
    if (nextIncidentInSec <= 0) {
      nextIncidentInSec = 40 + Math.random() * 50
      const candidates = states.filter(
        (s) => !incidents.some((i) => i.tripId === s.tripId) && s.phase === 'run',
      )
      if (candidates.length > 0) {
        const victim = candidates[Math.floor(Math.random() * candidates.length)]
        const dur = 20 + Math.random() * 30
        incidents = [
          ...incidents,
          {
            id: incidentSeq++,
            tripId: victim.tripId,
            kind: INCIDENT_KINDS[Math.floor(Math.random() * INCIDENT_KINDS.length)],
            remainSec: dur,
            totalSec: dur,
          },
        ]
      }
    }

    // drop delays for trips no longer active (their day is over)
    for (const id of Object.keys(delays)) {
      if (!byTrip.has(id)) delete delays[id]
    }

    // KPIs
    const up = headwayStats(states, 0)
    const down = headwayStats(states, 1)
    const totalDelay = Object.values(delays).reduce((a, b) => a + b, 0)
    const quality = serviceQuality(up.cv, down.cv, totalDelay)
    qualitySamples++
    const scoreAvg = st.scoreAvg + (quality - st.scoreAvg) / Math.min(qualitySamples, 600)

    set({ delays, incidents, resolvedCount: resolved, quality, scoreAvg })
  },
}))
