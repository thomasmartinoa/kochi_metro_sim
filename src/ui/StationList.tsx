/**
 * Left rail: all 25 stations as a tappable line diagram (English + Malayalam).
 */
import { stations } from '../data/network'
import { useSimStore } from '../state/useSimStore'

const INTERCHANGE: Record<string, string> = {
  ALVA: 'Terminal',
  KLMT: 'Indian Railways',
  TNHL: 'Indian Railways',
  ERSH: 'Indian Railways',
  VYTA: 'Water Metro',
  JLSD: 'Pink Line 2027',
  TPHT: 'Terminal · IR',
}

export function StationList() {
  const selection = useSimStore((s) => s.selection)
  const select = useSimStore((s) => s.select)

  return (
    <div className="hud-panel pointer-events-auto flex max-h-[62vh] w-60 flex-col overflow-hidden">
      <div className="border-b border-kmrl/20 px-4 py-2.5 font-display text-xs font-semibold tracking-widest text-paper-dim">
        BLUE LINE · ALUVA → TRIPUNITHURA
      </div>
      <div className="overflow-y-auto py-1">
        {stations.map((s, i) => {
          const active = selection?.kind === 'station' && selection.id === s.id
          const badge = INTERCHANGE[s.id]
          return (
            <button
              key={s.id}
              onClick={() => select(active ? null : { kind: 'station', id: s.id })}
              className={`group flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors ${
                active ? 'bg-kmrl/15' : 'hover:bg-panel'
              }`}
            >
              <span className="relative flex h-full w-3 flex-col items-center self-stretch">
                {i > 0 && <span className="absolute -top-1.5 h-1/2 w-0.5 bg-blueline" />}
                {i < stations.length - 1 && (
                  <span className="absolute top-1/2 -bottom-1.5 w-0.5 bg-blueline" />
                )}
                <span
                  className={`relative top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 ${
                    active ? 'border-lemon bg-lemon' : 'border-blueline bg-ink group-hover:bg-blueline'
                  }`}
                />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span
                  className={`block truncate font-display text-[13px] ${active ? 'font-semibold text-lemon' : 'text-paper'}`}
                >
                  {s.name}
                </span>
                <span className="block truncate font-ml text-[11px] text-paper-dim">{s.nameMl}</span>
              </span>
              {badge && (
                <span className="shrink-0 rounded bg-kmrl/15 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-kmrl">
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
