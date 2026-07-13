/**
 * Left rail for the Water Metro: the four routes with their terminals.
 * Tapping a terminal selects it (departures panel + camera fly-to).
 */
import { terminals, waterRoutes } from '../../sim/waterEngine'
import { useSimStore } from '../../state/useSimStore'

export function RoutesRail() {
  const selection = useSimStore((s) => s.selection)
  const select = useSimStore((s) => s.select)

  return (
    <div className="hud-panel pointer-events-auto flex max-h-[62vh] w-64 flex-col overflow-hidden">
      <div className="border-b border-kmrl/20 px-4 py-2.5 font-display text-xs font-semibold tracking-widest text-paper-dim">
        WATER METRO · 4 ROUTES
      </div>
      <div className="overflow-y-auto py-1">
        {waterRoutes.map((r) => (
          <div key={r.id} className="px-2 py-1">
            <div className="flex items-center gap-2 px-2 py-1">
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink"
                style={{ background: r.color }}
              >
                {r.id}
              </span>
              <span className="truncate font-display text-[12px] font-semibold text-paper">
                {r.name}
              </span>
            </div>
            <div className="ml-3 border-l-2 pl-3" style={{ borderColor: r.color }}>
              {r.stops.map((s) => {
                const t = terminals[s.term]
                const active = selection?.kind === 'terminal' && selection.id === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => select(active ? null : { kind: 'terminal', id: t.id })}
                    className={`block w-full rounded px-2 py-1 text-left leading-tight transition-colors ${
                      active ? 'bg-kmrl/15' : 'hover:bg-panel'
                    }`}
                  >
                    <span
                      className={`block truncate font-display text-[12px] ${active ? 'font-semibold text-lemon' : 'text-paper'}`}
                    >
                      {t.name}
                    </span>
                    <span className="block truncate font-ml text-[10px] text-paper-dim">
                      {t.nameMl}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
