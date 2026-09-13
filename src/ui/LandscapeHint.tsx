/**
 * A one-time nudge on a phone held upright: the drive HUD wants width. Not
 * enforced; dismissed once, it stays dismissed (localStorage).
 */
import { useState } from 'react'
import { PORTRAIT_PHONE_QUERY, useMediaQuery } from './useMediaQuery'

const KEY = 'kochi-metro:landscape-hint'

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function LandscapeHint() {
  const portrait = useMediaQuery(PORTRAIT_PHONE_QUERY)
  const [dismissed, setDismissed] = useState(seen)
  if (!portrait || dismissed) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // no storage: it will show again next time, which is fine
    }
  }
  return (
    <div className="hud-panel pointer-events-auto absolute left-1/2 top-16 z-20 flex -translate-x-1/2 items-center gap-3 px-3 py-2">
      <span className="text-lg">📱↻</span>
      <span className="font-display text-[12px] leading-snug text-paper">
        Turn your phone sideways: the cab and the desk fit better in landscape.
      </span>
      <button onClick={dismiss} className="rounded px-2 py-1 font-mono text-[11px] text-paper-dim hover:text-paper">
        ok
      </button>
    </div>
  )
}
