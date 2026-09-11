/**
 * Explore's one piece of chrome: a strip of the 25 stations to jump between.
 * Tap one and the camera flies to it; tap a train in the world to ride along.
 * A single scrollable row, so it works the same on a phone as on a desktop.
 */
import { useEffect, useRef } from 'react'
import { stations } from '../data/network'
import { useSimStore } from '../state/useSimStore'

export function ExploreStrip() {
  const selection = useSimStore((s) => s.selection)
  const select = useSimStore((s) => s.select)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  // keep the selected station in view as the strip scrolls
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [selection])

  return (
    <div className="hud-panel pointer-events-auto flex w-full max-w-xl items-center gap-2 px-2 py-1.5">
      <span className="shrink-0 pl-1.5 font-display text-[10px] font-semibold tracking-widest text-paper-dim">
        JUMP TO
      </span>
      <div className="flex gap-1 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {stations.map((s) => {
          const active = selection?.kind === 'station' && selection.id === s.id
          return (
            <button
              key={s.id}
              ref={active ? activeRef : undefined}
              onClick={() => select(active ? null : { kind: 'station', id: s.id })}
              className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 font-display text-xs transition-colors ${
                active ? 'bg-kmrl text-ink' : 'text-paper-dim hover:bg-panel hover:text-paper'
              }`}
            >
              {s.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
