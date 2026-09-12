/**
 * Global sim state — the single clock every experience reads.
 * mode 'live': clock follows real IST time. mode 'scrub': user-controlled, advances at `speed`.
 * `experience` picks the product surface (landing / metro / water); it is
 * synced with the URL hash (#/, #/metro, #/water) in App.tsx.
 */
import { create } from 'zustand'
import { WATER_METRO_ENABLED } from '../config'

export type Experience = 'landing' | 'metro' | 'water'
export type AppMode = 'tracker' | 'explore' | 'drive'
export type Weather = 'clear' | 'overcast' | 'rain' | 'monsoon' | 'fog'

export interface Selection {
  kind: 'train' | 'station' | 'boat' | 'terminal'
  id: string
}

interface SimStore {
  experience: Experience
  appMode: AppMode
  /** authoritative sim time as UTC epoch ms */
  epochMs: number
  clockMode: 'live' | 'scrub'
  /** sim seconds per real second while scrubbing/playing */
  speed: number
  selection: Selection | null
  weather: Weather

  setExperience: (e: Experience) => void
  setWeather: (w: Weather) => void
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
  experience: 'landing',
  appMode: 'tracker',
  epochMs: Date.now(),
  clockMode: 'live',
  speed: 1,
  selection: null,
  weather: 'clear',

  setWeather: (w) => set({ weather: w }),
  setExperience: (e) =>
    set((s) => {
      // Water Metro is "coming soon" until the flag is on — never enter it.
      const exp: Experience = e === 'water' && !WATER_METRO_ENABLED ? 'landing' : e
      return {
        experience: exp,
        selection: null,
        // drive mode is metro-only
        appMode: exp === 'water' && s.appMode === 'drive' ? 'tracker' : s.appMode,
      }
    }),
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
