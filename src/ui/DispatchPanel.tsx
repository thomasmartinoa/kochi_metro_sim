/**
 * Dispatch mode UI: the controller's desk. Service quality KPIs, live train
 * list with delays and holds, incident feed.
 */
import { useEffect, useState } from 'react'
import { stations } from '../data/network'
import { headwayStats } from '../sim/dispatch'
import type { TrainState } from '../sim/engine'
import { useDispatchStore } from '../state/useDispatchStore'
import { useSimStore } from '../state/useSimStore'

function StartScreen() {
  const start = useDispatchStore((s) => s.start)
  const setSpeed = useSimStore((s) => s.setSpeed)
  return (
    <div className="hud-panel pointer-events-auto flex w-80 flex-col gap-3 px-5 py-4">
      <div className="font-display text-sm font-semibold tracking-widest text-paper-dim">
        OPERATIONS CONTROL CENTRE
      </div>
      <p className="font-display text-[13px] leading-snug text-paper">
        Run the line, Muttom OCC style. Incidents will strike random trains —
        hold others to keep the gaps even and the service quality high.
      </p>
      <button
        onClick={() => {
          start()
          setSpeed(15)
        }}
        className="rounded-md bg-kmrl px-3 py-2 font-display text-sm font-semibold text-ink hover:bg-kmrl/85"
      >
        Take the desk (runs at 15×)
      </button>
      <div className="font-mono text-[11px] leading-relaxed text-paper-dim">
        HOLD keeps a train at its next platform.
        <br />
        Release it once the gap ahead has opened.
      </div>
    </div>
  )
}

export function DispatchPanel() {
  const session = useDispatchStore((s) => s.session)
  const quality = useDispatchStore((s) => s.quality)
  const scoreAvg = useDispatchStore((s) => s.scoreAvg)
  const incidents = useDispatchStore((s) => s.incidents)
  const resolvedCount = useDispatchStore((s) => s.resolvedCount)
  const delays = useDispatchStore((s) => s.delays)
  const holds = useDispatchStore((s) => s.holds)
  const toggleHold = useDispatchStore((s) => s.toggleHold)
  const stop = useDispatchStore((s) => s.stop)
  const select = useSimStore((s) => s.select)

  const [states, setStates] = useState<TrainState[]>([])
  useEffect(() => {
    if (!session) return
    const id = setInterval(() => {
      const { epochMs } = useSimStore.getState()
      setStates(useDispatchStore.getState().statesAt(epochMs))
    }, 500)
    return () => clearInterval(id)
  }, [session])

  if (!session) return <StartScreen />

  const up = headwayStats(states, 0)
  const down = headwayStats(states, 1)
  const totalDelay = Object.values(delays).reduce((a, b) => a + b, 0)
  const sorted = [...states].sort(
    (a, b) => (delays[b.tripId] ?? 0) - (delays[a.tripId] ?? 0) || a.sKm - b.sKm,
  )

  return (
    <div className="hud-panel pointer-events-auto flex max-h-[80vh] w-96 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-kmrl/20 px-4 py-2.5">
        <span className="font-display text-xs font-semibold tracking-widest text-paper-dim">
          SERVICE QUALITY
        </span>
        <span
          className={`font-mono text-2xl font-semibold ${
            quality >= 75 ? 'text-kmrl' : quality >= 45 ? 'text-lemon' : 'text-pinkline'
          }`}
        >
          {quality}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1 border-b border-kmrl/20 px-4 py-2 font-mono text-[11px] text-paper-dim">
        <div>
          <div className="text-paper">{(up.cv * 100).toFixed(0)}%</div>
          <div>gap var ↑</div>
        </div>
        <div>
          <div className="text-paper">{(down.cv * 100).toFixed(0)}%</div>
          <div>gap var ↓</div>
        </div>
        <div>
          <div className="text-paper">{Math.round(totalDelay)}s</div>
          <div>delay</div>
        </div>
        <div>
          <div className="text-paper">
            {resolvedCount}/{resolvedCount + incidents.length}
          </div>
          <div>incidents</div>
        </div>
      </div>

      {incidents.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-pinkline/30 bg-pinkline/10 px-4 py-2">
          {incidents.map((inc) => (
            <div key={inc.id} className="flex items-center justify-between">
              <span className="font-display text-[12px] font-semibold text-pinkline">
                {inc.kind} · {inc.tripId}
              </span>
              <span className="font-mono text-[11px] text-paper-dim">
                clearing {Math.ceil(inc.remainSec)}s
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {sorted.map((s) => {
          const delay = Math.round(delays[s.tripId] ?? 0)
          const held = !!holds[s.tripId]
          const inc = incidents.some((i) => i.tripId === s.tripId)
          return (
            <div
              key={s.tripId}
              className={`flex items-center gap-2 px-4 py-1 ${inc ? 'bg-pinkline/10' : ''}`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  inc ? 'bg-pinkline' : s.dir === 0 ? 'bg-kmrl' : 'bg-lemon'
                }`}
              />
              <button
                onClick={() => select({ kind: 'train', id: s.tripId })}
                className="w-16 shrink-0 text-left font-mono text-[11px] text-paper hover:text-kmrl"
              >
                {s.tripId}
              </button>
              <span className="min-w-0 flex-1 truncate font-display text-[11px] text-paper-dim">
                {s.phase === 'dwell' ? 'at' : '→'} {stations[s.nextStationOrder].name}
              </span>
              <span
                className={`w-10 shrink-0 text-right font-mono text-[11px] ${
                  delay > 60 ? 'text-pinkline' : delay > 0 ? 'text-lemon' : 'text-paper-dim'
                }`}
              >
                {delay > 0 ? `+${delay}s` : '·'}
              </span>
              <button
                onClick={() => toggleHold(s.tripId)}
                className={`w-14 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  held
                    ? 'bg-lemon text-ink'
                    : 'bg-panel text-paper-dim hover:bg-kmrl/20 hover:text-kmrl'
                }`}
              >
                {held ? 'HELD' : 'HOLD'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-kmrl/20 px-4 py-2">
        <span className="font-mono text-[11px] text-paper-dim">
          session avg {Math.round(scoreAvg)}
        </span>
        <button
          onClick={stop}
          className="rounded px-2 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper"
        >
          leave desk
        </button>
      </div>
    </div>
  )
}
