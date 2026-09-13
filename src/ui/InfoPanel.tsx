/**
 * Right panel: live details for the selected station (next departures)
 * or train (next stop, ETA, speed, occupancy) — refreshed from the sim clock.
 */
import { stationById, stations } from '../data/network'
import { fmtTime } from '../sim/clock'
import { departuresAt, trainStateById } from '../sim/engine'
import { useSimStore } from '../state/useSimStore'
import { fmtCountdown, useSimEpoch } from './useSimClock'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-display text-[11px] tracking-wide text-paper-dim">{label}</span>
      <span className="font-mono text-sm text-paper">{value}</span>
    </div>
  )
}

function StationPanel({ id }: { id: string }) {
  const epoch = useSimEpoch()
  const station = stationById.get(id)
  if (!station) return null
  const deps = departuresAt(epoch, station.order, 6)

  return (
    <>
      <div className="border-b border-kmrl/20 px-4 py-3 leading-tight">
        <div className="font-display text-base font-semibold text-paper">{station.name}</div>
        <div className="font-ml text-sm text-paper-dim">{station.nameMl}</div>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="font-display text-[11px] font-semibold tracking-widest text-paper-dim">
          NEXT DEPARTURES
        </div>
        {deps.length === 0 && (
          <div className="font-display text-sm text-paper-dim">No more trains today</div>
        )}
        {deps.map((d) => (
          <div key={d.tripId} className="flex items-center gap-2.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${d.dir === 0 ? 'bg-kmrl' : 'bg-lemon'}`}
            />
            <span className="min-w-0 flex-1 truncate font-display text-[13px] text-paper">
              to {stations[d.destOrder].name}
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

function TrainPanel({ id }: { id: string }) {
  const epoch = useSimEpoch()
  const st = trainStateById(epoch, id)
  if (!st) {
    return (
      <div className="px-4 py-3 font-display text-sm text-paper-dim">
        This trip has ended.
      </div>
    )
  }
  // while dwelling, nextStationOrder is already the one AFTER this platform;
  // the station the train is standing in is prevStationOrder
  const at = stations[st.phase === 'dwell' ? st.prevStationOrder : st.nextStationOrder]
  const dest = st.dir === 0 ? stations[stations.length - 1] : stations[0]

  return (
    <>
      <div className="border-b border-kmrl/20 px-4 py-3 leading-tight">
        <div className="font-display text-base font-semibold text-paper">
          Train {id} <span className="text-paper-dim">→ {dest.name}</span>
        </div>
        <div className="font-ml text-sm text-paper-dim">{dest.nameMl} വരെ</div>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <Row
          label={st.phase === 'dwell' ? 'AT STATION' : 'NEXT STATION'}
          value={at.name}
        />
        <Row
          label="ARRIVES"
          value={st.phase === 'dwell' ? 'doors open' : fmtCountdown(st.etaSec)}
        />
        <Row label="SPEED" value={`${Math.round(st.speedKmh)} km/h`} />
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
          <div className="h-full bg-blueline" style={{ width: `${st.progress * 100}%` }} />
        </div>
        <div className="flex justify-between font-mono text-[10px] text-paper-dim">
          <span>{st.dir === 0 ? 'Aluva' : 'Tripunithura'}</span>
          <span>{dest.name}</span>
        </div>
      </div>
    </>
  )
}

export function InfoPanel() {
  const selection = useSimStore((s) => s.selection)
  if (!selection) return null
  return (
    <div className="hud-panel pointer-events-auto w-72 overflow-hidden">
      {selection.kind === 'station' ? (
        <StationPanel id={selection.id} />
      ) : (
        <TrainPanel id={selection.id} />
      )}
    </div>
  )
}
