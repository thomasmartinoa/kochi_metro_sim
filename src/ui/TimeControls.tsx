/**
 * The clock deck: LIVE badge, scrubber across the service day, speed presets.
 */
import { useEffect, useState } from 'react'
import { fmtClock, istDayTime } from '../sim/clock'
import { serviceStatusAt } from '../sim/engine'
import { fmtTime } from '../sim/clock'
import { useSimStore } from '../state/useSimStore'

const SPEEDS = [1, 5, 15, 60, 300]

export function TimeControls() {
  const clockMode = useSimStore((s) => s.clockMode)
  const speed = useSimStore((s) => s.speed)
  const goLive = useSimStore((s) => s.goLive)
  const setSpeed = useSimStore((s) => s.setSpeed)
  const scrubToDaySec = useSimStore((s) => s.scrubToDaySec)

  const [daySec, setDaySec] = useState(() => istDayTime(useSimStore.getState().epochMs).daySec)
  const [status, setStatus] = useState(() => serviceStatusAt(useSimStore.getState().epochMs))

  useEffect(() => {
    const id = setInterval(() => {
      const epoch = useSimStore.getState().epochMs
      setDaySec(istDayTime(epoch).daySec)
      setStatus(serviceStatusAt(epoch))
    }, 250)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="hud-panel pointer-events-auto flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={goLive}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-display text-xs font-semibold tracking-widest transition-colors ${
            clockMode === 'live'
              ? 'bg-kmrl/20 text-kmrl'
              : 'bg-panel text-paper-dim hover:text-paper'
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              clockMode === 'live' ? 'live-dot bg-kmrl' : 'bg-paper-dim'
            }`}
          />
          LIVE
        </button>
        <span className="font-mono text-2xl font-semibold tabular-nums text-paper">
          {fmtClock(daySec)}
        </span>
        <span className="font-display text-[11px] tracking-widest text-paper-dim">IST</span>
        <div className="ml-auto flex items-center gap-1">
          {SPEEDS.map((n) => (
            <button
              key={n}
              onClick={() => setSpeed(n)}
              className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                clockMode === 'scrub' && speed === n
                  ? 'bg-lemon/90 font-semibold text-ink'
                  : 'text-paper-dim hover:bg-panel hover:text-paper'
              }`}
            >
              {n}×
            </button>
          ))}
        </div>
      </div>
      <input
        type="range"
        className="scrubber w-full"
        min={0}
        max={86399}
        step={30}
        value={Math.floor(daySec)}
        onChange={(e) => scrubToDaySec(+e.target.value)}
        aria-label="Time of day"
      />
      <div className="flex items-center justify-between font-mono text-[11px] text-paper-dim">
        <span>00:00</span>
        {!status.open && status.nextTrainSec != null && (
          <span className="text-lemon">
            Service closed — next train {fmtTime(status.nextTrainSec)}
          </span>
        )}
        {status.open && <span className="text-kmrl">{status.activeCount} trains in service</span>}
        <span>24:00</span>
      </div>
    </div>
  )
}
