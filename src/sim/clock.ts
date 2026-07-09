/**
 * Simulation clock helpers. All schedule times are IST (Asia/Kolkata, UTC+5:30, no DST)
 * seconds since service-day midnight. GTFS times may exceed 24h for post-midnight arrivals.
 */
import type { ServiceId } from '../data/types'

export const IST_OFFSET_SEC = 5.5 * 3600
export const DAY_SEC = 86_400

/** IST seconds-of-day + IST day-of-week (0=Sun..6=Sat) for a UTC epoch ms. */
export function istDayTime(epochMs: number): { daySec: number; dow: number } {
  const istSec = Math.floor(epochMs / 1000) + IST_OFFSET_SEC
  const daySec = ((istSec % DAY_SEC) + DAY_SEC) % DAY_SEC
  // 1970-01-01 was a Thursday (dow 4)
  const dow = (Math.floor(istSec / DAY_SEC) + 4) % 7
  return { daySec, dow }
}

/** KMRL calendar: WE runs Sundays, WK runs Mon–Sat. */
export function serviceForDow(dow: number): ServiceId {
  return dow === 0 ? 'WE' : 'WK'
}

export function fmtTime(daySec: number): string {
  const s = ((daySec % DAY_SEC) + DAY_SEC) % DAY_SEC
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function fmtClock(daySec: number): string {
  const s = ((daySec % DAY_SEC) + DAY_SEC) % DAY_SEC
  const sec = Math.floor(s % 60)
  return `${fmtTime(s)}:${String(sec).padStart(2, '0')}`
}
