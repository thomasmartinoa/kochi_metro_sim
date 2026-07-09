/**
 * Global sim state — the single clock both tracker and game read.
 * mode 'live': clock follows real IST time. mode 'scrub': user-controlled, advances at `speed`.
 */
import { create } from 'zustand'

export type AppMode = 'tracker' | 'explore' | 'drive' | 'dispatch'

export interface Selection {
  kind: 'train' | 'station'
  id: string
}

interface SimStore {
  appMode: AppMode
  /** authoritative sim time as UTC epoch ms */
  epochMs: number
  clockMode: 'live' | 'scrub'
  /** sim seconds per real second while scrubbing/playing */
  speed: number
  selection: Selection | null

  setAppMode: (m: AppMode) => void
  goLive: () => void
  /** jump the clock so IST time-of-day becomes daySec (stays on today) */
  scrubToDaySec: (daySec: number) => void
  setSpeed: (n: number) => void
  select: (sel: Selection | null) => void
  /** advance the clock by real dt (called once per frame) */
  tick: (dtMs: number) => void
}

const IST_OFFSET_MS = 5.5 * 3600 * 1000
const DAY_MS = 86_400_000

export const useSimStore = create<SimStore>((set, get) => ({
  appMode: 'tracker',
  epochMs: Date.now(),
  clockMode: 'live',
  speed: 1,
  selection: null,

  setAppMode: (m) => set({ appMode: m }),
  goLive: () => set({ clockMode: 'live', speed: 1, epochMs: Date.now() }),
  scrubToDaySec: (daySec) => {
    const { epochMs } = get()
    const istMs = epochMs + IST_OFFSET_MS
    const dayStart = Math.floor(istMs / DAY_MS) * DAY_MS
    set({ clockMode: 'scrub', epochMs: dayStart + daySec * 1000 - IST_OFFSET_MS })
  },
  setSpeed: (n) => set({ speed: n, clockMode: 'scrub' }),
  select: (sel) => set({ selection: sel }),
  tick: (dtMs) => {
    const { clockMode, speed } = get()
    if (clockMode === 'live') set({ epochMs: Date.now() })
    else set((s) => ({ epochMs: s.epochMs + dtMs * speed }))
  },
}))
