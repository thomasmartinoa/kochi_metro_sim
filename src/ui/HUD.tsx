/**
 * HUD chrome over the 3D world: brand, station rail, live panels, clock deck.
 */
import { InfoPanel } from './InfoPanel'
import { RoutePlanner } from './RoutePlanner'
import { StationList } from './StationList'
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

export function HUD() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <div className="flex min-h-0 flex-1 items-start justify-between gap-4 pb-4">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <Brand />
          <div className="hidden min-h-0 md:block">
            <StationList />
          </div>
        </div>
        <div className="flex max-h-full flex-col items-end gap-3 overflow-y-auto">
          <InfoPanel />
          <div className="hidden sm:block">
            <RoutePlanner />
          </div>
        </div>
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
