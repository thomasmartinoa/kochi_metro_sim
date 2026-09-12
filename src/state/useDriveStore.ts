/** Drive-mode session state: physics state + camera view + keyboard intents. */
import { create } from 'zustand'
import { newDrive, restartFromLastStop, setNotch, stepDrive, type DriveState } from '../sim/drive'
import { VIEWS, type DriveView } from '../sim/driveCameras'

export type { DriveView }

interface DriveStore {
  drive: DriveState | null
  view: DriveView
  /** the driver's view before a crash, to return to on restart */
  viewBeforeCrash: DriveView
  start: (dir: 0 | 1) => void
  exit: () => void
  /** after a derailment: back to the last platform, run intact */
  restart: () => void
  nudgeNotch: (delta: number) => void
  emergency: () => void
  setView: (v: DriveView) => void
  /** step through VIEWS; from the crash view, from the view before it */
  cycleView: (delta?: number) => void
  /**
   * Advance physics. dt is derived internally from wall-clock so the step is
   * idempotent per animation frame — extra callers (StrictMode double mounts,
   * HMR leftovers) contribute ~0 additional sim time instead of doubling it.
   */
  tick: () => void
}

let lastTickMs = 0

export const useDriveStore = create<DriveStore>((set, get) => ({
  drive: null,
  view: 'cab',
  viewBeforeCrash: 'cab',
  start: (dir) => {
    lastTickMs = performance.now()
    set({ drive: newDrive(dir), view: 'cab', viewBeforeCrash: 'cab' })
  },
  exit: () => set({ drive: null }),
  restart: () => {
    const d = get().drive
    if (d?.phase === 'derailed') {
      lastTickMs = performance.now()
      set((s) => ({ drive: restartFromLastStop(d), view: s.viewBeforeCrash }))
    }
  },
  nudgeNotch: (delta) => {
    const d = get().drive
    if (d) set({ drive: setNotch(d, d.notch + delta) })
  },
  emergency: () => {
    const d = get().drive
    if (d) set({ drive: setNotch(d, -5) })
  },
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
    if (d && d.phase !== 'done' && d.phase !== 'derailed') set({ drive: stepDrive(d, dtSec) })
  },
}))
