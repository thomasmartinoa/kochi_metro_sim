/** Poll the sim clock at a UI-friendly rate (panels don't need 60 fps). */
import { useEffect, useState } from 'react'
import { useSimStore } from '../state/useSimStore'

export function useSimEpoch(intervalMs = 500): number {
  const [epoch, setEpoch] = useState(() => useSimStore.getState().epochMs)
  useEffect(() => {
    const id = setInterval(() => setEpoch(useSimStore.getState().epochMs), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return epoch
}

export function fmtCountdown(sec: number): string {
  if (sec <= 30) return 'now'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m > 0 ? `${m} min` : `${s}s`
}
