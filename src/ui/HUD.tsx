/**
 * HUD chrome over the 3D world: brand, mode switcher, station rail, live
 * panels, legend, clock deck. Explore mode trims the chrome for immersion.
 */
import { useSimStore } from '../state/useSimStore'
import { DrivePanel } from './DrivePanel'
import { InfoPanel } from './InfoPanel'
import { Legend } from './Legend'
import { ModeSwitcher } from './ModeSwitcher'
import { RoutePlanner } from './RoutePlanner'
import { StationList } from './StationList'
import { TimeControls } from './TimeControls'

function Brand() {
  return (
    <div className="hud-panel pointer-events-auto hidden items-center gap-3 px-4 py-2.5 sm:flex">
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
  const appMode = useSimStore((s) => s.appMode)
  const explore = appMode === 'explore'
  const drive = appMode === 'drive'
  const tracker = appMode === 'tracker'

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <div className="flex min-h-0 flex-1 items-start justify-between gap-4 pb-4">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <Brand />
          {tracker && (
            <div className="hidden min-h-0 md:block">
              <StationList />
            </div>
          )}
        </div>
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <ModeSwitcher />
        </div>
        <div className="flex max-h-full flex-col items-end gap-3 overflow-y-auto">
          {drive ? (
            <DrivePanel />
          ) : (
            <>
              <InfoPanel />
              {tracker && (
                <div className="hidden sm:block">
                  <RoutePlanner />
                </div>
              )}
              {(explore || tracker) && (
                <div className="hud-panel pointer-events-auto hidden px-3.5 py-2 font-display text-[11px] text-paper-dim sm:block">
                  <span className="font-mono text-kmrl">WASD</span> move ·{' '}
                  <span className="font-mono text-kmrl">Q/E</span> height ·{' '}
                  <span className="font-mono text-kmrl">Shift</span> fast
                  {explore && ' · click a train to ride along'}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="relative flex items-end justify-between gap-4">
        <div className="hidden lg:block">{tracker && <Legend />}</div>
        {!drive && (
          <div className="absolute left-1/2 bottom-0 w-full max-w-xl -translate-x-1/2">
            <TimeControls />
          </div>
        )}
        <div className="ml-auto self-end text-right font-display text-[10px] leading-tight tracking-wide text-paper-dim/70">
          Contains data provided by Kochi Metro Rail Limited
          <br />
          Map data © OpenStreetMap contributors · Imagery © Esri, Maxar
        </div>
      </div>
    </div>
  )
}
