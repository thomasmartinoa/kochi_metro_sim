/**
 * Water journey planner: terminal to terminal on one route — real fare bands,
 * next sailing from the synthesised timetable.
 */
import { useState } from 'react'
import { fmtTime } from '../../sim/clock'
import { planWaterJourneyAt, routeById, terminals } from '../../sim/waterEngine'
import { fmtCountdown, useSimEpoch } from '../useSimClock'

function TerminalSelect({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (n: number) => void
  label: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-display text-[10px] font-semibold tracking-widest text-paper-dim">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="rounded-md border border-kmrl/25 bg-panel px-2 py-1.5 font-display text-[13px] text-paper outline-none focus:border-kmrl"
      >
        {terminals.map((t, i) => (
          <option key={t.id} value={i}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function WaterPlanner() {
  const epoch = useSimEpoch(1000)
  const [from, setFrom] = useState(0) // High Court
  const [to, setTo] = useState(1) // Vypin

  const journey = from !== to ? planWaterJourneyAt(epoch, from, to) : null

  return (
    <div className="hud-panel pointer-events-auto w-72 overflow-hidden">
      <div className="border-b border-kmrl/20 px-4 py-2.5 font-display text-xs font-semibold tracking-widest text-paper-dim">
        PLAN A CROSSING
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <TerminalSelect label="FROM" value={from} onChange={setFrom} />
          <TerminalSelect label="TO" value={to} onChange={setTo} />
        </div>
        <button
          onClick={() => {
            setFrom(to)
            setTo(from)
          }}
          className="self-start rounded px-1.5 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper"
        >
          ⇅ swap
        </button>
        {from === to ? (
          <div className="font-display text-sm text-paper-dim">Pick two different terminals.</div>
        ) : journey ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[11px] tracking-wide text-paper-dim">FARE</span>
              <span className="font-mono text-xl font-semibold text-lemon">₹{journey.fare}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="flex items-center gap-1.5 font-display text-[11px] tracking-wide text-paper-dim">
                <span
                  className="rounded px-1 font-mono text-[9px] font-bold text-ink"
                  style={{ background: routeById.get(journey.routeId)?.color }}
                >
                  {journey.routeId}
                </span>
                {routeById.get(journey.routeId)?.name}
              </span>
              <span className="font-mono text-sm text-paper">
                {Math.round((journey.arriveSec - journey.departSec) / 60)} min
              </span>
            </div>
            <div className="mt-1 rounded-md bg-kmrl/10 px-2.5 py-2">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[11px] text-paper-dim">Next sailing</span>
                <span className="font-mono text-sm font-semibold text-kmrl">
                  {fmtCountdown(journey.waitSec)}
                </span>
              </div>
              <div className="mt-0.5 flex justify-between font-mono text-[11px] text-paper-dim">
                <span>dep {fmtTime(journey.departSec)}</span>
                <span>arr {fmtTime(journey.arriveSec)}</span>
              </div>
            </div>
            <div className="font-display text-[10px] text-paper-dim/70">
              Kochi1 card: 20% off · timetable synthesised from published service
            </div>
          </div>
        ) : (
          <div className="font-display text-sm text-paper-dim">
            No single-route sailing links these terminals — change at High Court.
          </div>
        )}
      </div>
    </div>
  )
}
