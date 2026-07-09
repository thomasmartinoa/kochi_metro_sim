/** Drive-mode session state: physics state + camera choice + keyboard intents. */
import { create } from 'zustand'
import { newDrive, setNotch, stepDrive, type DriveState } from '../sim/drive'

export type DriveCam = 'cab' | 'chase'

interface DriveStore {
  drive: DriveState | null
  cam: DriveCam
  start: (dir: 0 | 1) => void
  exit: () => void
  nudgeNotch: (delta: number) => void
  emergency: () => void
  toggleCam: () => void
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
  cam: 'chase',
  start: (dir) => {
    lastTickMs = performance.now()
    set({ drive: newDrive(dir), cam: 'chase' })
  },
  exit: () => set({ drive: null }),
  nudgeNotch: (delta) => {
    const d = get().drive
    if (d) set({ drive: setNotch(d, d.notch + delta) })
  },
  emergency: () => {
    const d = get().drive
    if (d) set({ drive: setNotch(d, -5) })
  },
  toggleCam: () => set((s) => ({ cam: s.cam === 'cab' ? 'chase' : 'cab' })),
  tick: () => {
    const now = performance.now()
    const dtSec = Math.min((now - lastTickMs) / 1000, 0.1)
    lastTickMs = now
    if (dtSec <= 0) return
    const d = get().drive
    if (d && d.phase !== 'done') set({ drive: stepDrive(d, dtSec) })
  },
}))
