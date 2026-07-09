/**
 * Journey planner: origin/destination -> real fare, next scheduled train,
 * journey time from the actual timetable.
 */
import { useState } from 'react'
import { fareByOrder } from '../data/fares'
import { stations } from '../data/network'
import { fmtTime } from '../sim/clock'
import { planJourneyAt } from '../sim/engine'
import { fmtCountdown, useSimEpoch } from './useSimClock'

function StationSelect({
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
        {stations.map((s) => (
          <option key={s.id} value={s.order}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function RoutePlanner() {
  const epoch = useSimEpoch(1000)
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(stations.length - 1)

  const fare = fareByOrder(from, to)
  const journey = from !== to ? planJourneyAt(epoch, from, to) : null
  const nStops = Math.abs(to - from)
  const distKm = Math.abs(stations[to].sKm - stations[from].sKm)

  return (
    <div className="hud-panel pointer-events-auto w-72 overflow-hidden">
      <div className="border-b border-kmrl/20 px-4 py-2.5 font-display text-xs font-semibold tracking-widest text-paper-dim">
        PLAN A JOURNEY
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <StationSelect label="FROM" value={from} onChange={setFrom} />
          <StationSelect label="TO" value={to} onChange={setTo} />
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
          <div className="font-display text-sm text-paper-dim">Pick two different stations.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[11px] tracking-wide text-paper-dim">FARE</span>
              <span className="font-mono text-xl font-semibold text-lemon">₹{fare}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[11px] tracking-wide text-paper-dim">
                {nStops} stops · {distKm.toFixed(1)} km
              </span>
              {journey && (
                <span className="font-mono text-sm text-paper">
                  {Math.round((journey.arriveSec - journey.departSec) / 60)} min
                </span>
              )}
            </div>
            {journey ? (
              <div className="mt-1 rounded-md bg-kmrl/10 px-2.5 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-[11px] text-paper-dim">Next train</span>
                  <span className="font-mono text-sm font-semibold text-kmrl">
                    {fmtCountdown(journey.waitSec)}
                  </span>
                </div>
                <div className="mt-0.5 flex justify-between font-mono text-[11px] text-paper-dim">
                  <span>dep {fmtTime(journey.departSec)}</span>
                  <span>arr {fmtTime(journey.arriveSec)}</span>
                </div>
              </div>
            ) : (
              <div className="font-display text-sm text-paper-dim">No more trains today.</div>
            )}
            <div className="font-display text-[10px] text-paper-dim/70">
              Single ticket valid 90 min · smart card fares may differ
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
