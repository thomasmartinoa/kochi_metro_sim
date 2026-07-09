/**
 * HUD chrome over the 3D world: brand bar, selection chip, clock deck, attribution.
 */
import { stationById } from '../data/network'
import { useSimStore } from '../state/useSimStore'
import { TimeControls } from './TimeControls'

function Brand() {
  return (
    <div className="hud-panel pointer-events-auto flex items-center gap-3 px-4 py-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-kmrl font-display text-lg font-bold text-ink">
        K
      </div>
      <div className="leading-tight">
        <div className="font-display text-sm font-semibold tracking-wide text-paper">
          Kochi Metro <span className="text-kmrl">Simulator</span>
        </div>
        <div className="font-ml text-[11px] text-paper-dim">കൊച്ചി മെട്രോ · Blue Line</div>
      </div>
    </div>
  )
}

function SelectionChip() {
  const selection = useSimStore((s) => s.selection)
  const select = useSimStore((s) => s.select)
  if (!selection) return null
  const label =
    selection.kind === 'station'
      ? (stationById.get(selection.id)?.name ?? selection.id)
      : `Train ${selection.id}`
  const ml = selection.kind === 'station' ? stationById.get(selection.id)?.nameMl : undefined
  return (
    <div className="hud-panel pointer-events-auto flex items-center gap-3 px-4 py-2">
      <span
        className={`h-2.5 w-2.5 rounded-full ${selection.kind === 'station' ? 'bg-blueline' : 'bg-lemon'}`}
      />
      <div className="leading-tight">
        <div className="font-display text-sm font-semibold">{label}</div>
        {ml && <div className="font-ml text-xs text-paper-dim">{ml}</div>}
      </div>
      <button
        onClick={() => select(null)}
        className="ml-2 rounded px-1.5 text-paper-dim hover:bg-panel hover:text-paper"
        aria-label="Clear selection"
      >
        ×
      </button>
    </div>
  )
}

export function HUD() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-4">
        <Brand />
        <SelectionChip />
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="w-full max-w-xl">
          <TimeControls />
        </div>
        <div className="font-display text-[10px] tracking-wide text-paper-dim/70">
          Contains data provided by Kochi Metro Rail Limited
        </div>
      </div>
    </div>
  )
}
