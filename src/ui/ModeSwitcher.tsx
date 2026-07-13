/** Top-centre mode chips: Tracker (live ops) / Explore (free fly & ride). */
import type { AppMode } from '../state/useSimStore'
import { useSimStore } from '../state/useSimStore'

const MODES: { id: AppMode; label: string; ready: boolean }[] = [
  { id: 'tracker', label: 'Tracker', ready: true },
  { id: 'explore', label: 'Explore', ready: true },
  { id: 'drive', label: 'Drive', ready: true },
]

export function ModeSwitcher() {
  const appMode = useSimStore((s) => s.appMode)
  const setAppMode = useSimStore((s) => s.setAppMode)
  const experience = useSimStore((s) => s.experience)
  const modes = experience === 'water' ? MODES.filter((m) => m.id !== 'drive') : MODES
  return (
    <div className="hud-panel pointer-events-auto flex items-center gap-1 px-1.5 py-1.5">
      {modes.map((m) =>
        m.ready ? (
          <button
            key={m.id}
            onClick={() => setAppMode(m.id)}
            className={`rounded-md px-3 py-1 font-display text-xs font-semibold tracking-wide transition-colors ${
              appMode === m.id ? 'bg-kmrl text-ink' : 'text-paper-dim hover:bg-panel hover:text-paper'
            }`}
          >
            {m.label}
          </button>
        ) : (
          <span
            key={m.id}
            title="Coming soon"
            className="cursor-not-allowed rounded-md px-3 py-1 font-display text-xs text-paper-dim/40"
          >
            {m.label}
          </span>
        ),
      )}
    </div>
  )
}
