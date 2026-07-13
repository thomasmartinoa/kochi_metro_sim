/**
 * Water Metro live panels: terminal next-sailings, or the selected boat's
 * route position, next terminal, ETA and loading.
 */
import { fmtTime } from '../../sim/clock'
import {
  boatStateById,
  routeById,
  terminalDeparturesAt,
  terminals,
} from '../../sim/waterEngine'
import { useSimStore } from '../../state/useSimStore'
import { fmtCountdown, useSimEpoch } from '../useSimClock'

function TerminalPanel({ id }: { id: string }) {
  const epoch = useSimEpoch()
  const idx = terminals.findIndex((t) => t.id === id)
  if (idx < 0) return null
  const term = terminals[idx]
  const deps = terminalDeparturesAt(epoch, idx, 6)

  return (
    <>
      <div className="border-b border-kmrl/20 px-4 py-3 leading-tight">
        <div className="font-display text-base font-semibold text-paper">{term.name}</div>
        <div className="font-ml text-sm text-paper-dim">{term.nameMl}</div>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="font-display text-[11px] font-semibold tracking-widest text-paper-dim">
          NEXT SAILINGS
        </div>
        {deps.length === 0 && (
          <div className="font-display text-sm text-paper-dim">No more sailings today</div>
        )}
        {deps.map((d) => (
          <div key={d.tripId} className="flex items-center gap-2.5">
            <span
              className="shrink-0 rounded px-1 font-mono text-[9px] font-bold text-ink"
              style={{ background: routeById.get(d.routeId)?.color }}
            >
              {d.routeId}
            </span>
            <span className="min-w-0 flex-1 truncate font-display text-[13px] text-paper">
              to {terminals[d.destTerm].name}
            </span>
            <span className="font-mono text-xs text-paper-dim">{fmtTime(d.depSec)}</span>
            <span className="w-12 text-right font-mono text-[13px] font-semibold text-kmrl">
              {fmtCountdown(d.inSec)}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function BoatPanel({ id }: { id: string }) {
  const epoch = useSimEpoch()
  const st = boatStateById(epoch, id)
  if (!st) {
    return <div className="px-4 py-3 font-display text-sm text-paper-dim">This sailing has ended.</div>
  }
  const route = routeById.get(st.routeId)!
  const next = terminals[st.nextTerm]

  return (
    <>
      <div className="border-b border-kmrl/20 px-4 py-3 leading-tight">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink"
            style={{ background: route.color }}
          >
            {route.id}
          </span>
          <div className="font-display text-base font-semibold text-paper">{route.name}</div>
        </div>
        <div className="mt-0.5 font-display text-[11px] text-paper-dim">
          electric catamaran · 100 pax
        </div>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[11px] tracking-wide text-paper-dim">
            {st.phase === 'dwell' ? 'AT TERMINAL' : 'NEXT TERMINAL'}
          </span>
          <span className="font-mono text-sm text-paper">{next.name}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[11px] tracking-wide text-paper-dim">ARRIVES</span>
          <span className="font-mono text-sm text-paper">
            {st.phase === 'dwell' ? 'boarding' : fmtCountdown(st.etaSec)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[11px] tracking-wide text-paper-dim">SPEED</span>
          <span className="font-mono text-sm text-paper">{Math.round(st.speedKmh)} km/h</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-[11px] tracking-wide text-paper-dim">LOADING</span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-panel">
            <div
              className={`h-full rounded-full ${st.occupancy > 0.7 ? 'bg-pinkline' : 'bg-kmrl'}`}
              style={{ width: `${Math.round(st.occupancy * 100)}%` }}
            />
          </div>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-panel">
          <div className="h-full" style={{ width: `${st.progress * 100}%`, background: route.color }} />
        </div>
      </div>
    </>
  )
}

export function WaterInfoPanel() {
  const selection = useSimStore((s) => s.selection)
  if (!selection || (selection.kind !== 'terminal' && selection.kind !== 'boat')) return null
  return (
    <div className="hud-panel pointer-events-auto w-72 overflow-hidden">
      {selection.kind === 'terminal' ? (
        <TerminalPanel id={selection.id} />
      ) : (
        <BoatPanel id={selection.id} />
      )}
    </div>
  )
}
