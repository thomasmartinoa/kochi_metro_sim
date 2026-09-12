/** Drive-mode session state: physics state + camera view + keyboard intents. */
import { create } from 'zustand'
import { ADHESION, newDrive, REAL_ENV, restartFromLastStop, setNotch, stepDrive, toggleDoors, withTraffic, type DriveState } from '../sim/drive'
import { liveTrainStates } from '../sim/engine'
import { occupiedBlocks, signalAhead } from '../sim/signals'
import { useSimStore } from './useSimStore'
import { VIEWS, type DriveView } from '../sim/driveCameras'

export type { DriveView }

/** cameras available while watching a replay; a subset of the drive views */
export type ReplayCam = 'trackside' | 'chase' | 'drone' | 'crash'
export const REPLAY_CAMS: readonly ReplayCam[] = ['trackside', 'chase', 'drone', 'crash']

interface DriveStore {
  drive: DriveState | null
  /** the timetable trip the player is standing in for, hidden for the run */
  takenOverTripId: string | null
  view: DriveView
  /** watching the crash replay (only reachable while derailed) */
  replaying: boolean
  replayCam: ReplayCam
  /** the driver's view before a crash, to return to on restart */
  viewBeforeCrash: DriveView
  start: (dir: 0 | 1) => void
  exit: () => void
  /** after a derailment: back to the last platform, run intact */
  restart: () => void
  nudgeNotch: (delta: number) => void
  /** absolute notch, for the cab lever */
  setNotch: (notch: number) => void
  emergency: () => void
  doors: () => void
  /** wall-clock ms the horn was last sounded; the scene plays it */
  hornAtMs: number
  horn: () => void
  headlights: boolean
  toggleHeadlights: () => void
  setView: (v: DriveView) => void
  /** step through VIEWS; from the crash view, from the view before it */
  cycleView: (delta?: number) => void
  enterReplay: () => void
  leaveReplay: () => void
  setReplayCam: (c: ReplayCam) => void
  /**
   * Advance physics. dt is derived internally from wall-clock so the step is
   * idempotent per animation frame — extra callers (StrictMode double mounts,
   * HMR leftovers) contribute ~0 additional sim time instead of doubling it.
   */
  tick: () => void
}

let lastTickMs = 0

/**
 * The line as it is this instant: the real alignment plus the timetable's
 * same-direction trains, which occupy blocks and can be run into.
 */
export function liveEnv(dir: 0 | 1) {
  const taken = useDriveStore.getState().takenOverTripId
  const trains = liveTrainStates(useSimStore.getState().epochMs)
    .filter((t) => t.dir === dir && t.tripId !== taken)
    .map((t) => ({ sKm: t.sKm, dir: t.dir }))
  return withTraffic(REAL_ENV, trains, { occupiedBlocks, signalAhead })
}

/** a scheduled train this close to the player's start is the one the player is driving */
const SLOT_M = 120

/**
 * The player's run takes over a real trip: whichever same-direction train
 * the timetable has standing at the start. Left in, it sat inside the
 * player's trainset, its cab drawn through ours, and when it pulled away
 * the contact rule dragged us back behind it.
 */
function tripAtStart(dir: 0 | 1, startG: number): string | null {
  let best: { tripId: string; d: number } | null = null
  for (const t of liveTrainStates(useSimStore.getState().epochMs)) {
    if (t.dir !== dir) continue
    const d = Math.abs(REAL_ENV.gAt(t.sKm) - startG)
    if (d < SLOT_M && (!best || d < best.d)) best = { tripId: t.tripId, d }
  }
  return best?.tripId ?? null
}

export const useDriveStore = create<DriveStore>((set, get) => ({
  drive: null,
  takenOverTripId: null,
  view: 'cockpit',
  viewBeforeCrash: 'cockpit',
  replaying: false,
  replayCam: 'trackside',
  start: (dir) => {
    lastTickMs = performance.now()
    const drive = newDrive(dir)
    set({
      drive,
      takenOverTripId: tripAtStart(dir, drive.gM),
      view: 'cockpit',
      viewBeforeCrash: 'cockpit',
      replaying: false,
    })
  },
  exit: () => set({ drive: null, takenOverTripId: null, replaying: false }),
  restart: () => {
    const d = get().drive
    if (d?.phase === 'derailed') {
      lastTickMs = performance.now()
      set((s) => ({ drive: restartFromLastStop(d), view: s.viewBeforeCrash, replaying: false }))
    }
  },
  enterReplay: () => {
    if (get().drive?.phase === 'derailed') set({ replaying: true, replayCam: 'trackside' })
  },
  leaveReplay: () => set({ replaying: false }),
  setReplayCam: (c) => set({ replayCam: c }),
  nudgeNotch: (delta) => {
    const d = get().drive
    if (d) set({ drive: setNotch(d, d.notch + delta) })
  },
  setNotch: (notch) => {
    const d = get().drive
    if (d) set({ drive: setNotch(d, notch) })
  },
  emergency: () => {
    const d = get().drive
    if (d) set({ drive: setNotch(d, -5) })
  },
  doors: () => {
    const d = get().drive
    if (d) set({ drive: toggleDoors(d) })
  },
  hornAtMs: 0,
  horn: () => set({ hornAtMs: performance.now() }),
  headlights: false,
  toggleHeadlights: () => set((s) => ({ headlights: !s.headlights })),
  setView: (v) =>
    set((s) => ({ view: v, viewBeforeCrash: v === 'crash' ? s.view : s.viewBeforeCrash })),
  cycleView: (delta = 1) =>
    set((s) => {
      const i = VIEWS.indexOf(s.view === 'crash' ? s.viewBeforeCrash : s.view)
      return { view: VIEWS[(i + delta + VIEWS.length) % VIEWS.length] }
    }),
  tick: () => {
    const now = performance.now()
    const dtSec = Math.min((now - lastTickMs) / 1000, 0.1)
    lastTickMs = now
    if (dtSec <= 0) return
    const d = get().drive
    if (d && d.phase !== 'done' && d.phase !== 'derailed') {
      const adhesion = ADHESION[useSimStore.getState().weather]
      set({ drive: stepDrive(d.adhesion === adhesion ? d : { ...d, adhesion }, dtSec, liveEnv(d.dir)) })
    }
  },
}))
