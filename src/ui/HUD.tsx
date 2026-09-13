/**
 * HUD chrome over the 3D world: brand, mode switcher, per-experience rails and
 * live panels, legend, clock deck. Explore mode trims the chrome for immersion.
 */
import { waterRoutes } from '../sim/waterEngine'
import { useSimStore } from '../state/useSimStore'
import { DrivePanel } from './DrivePanel'
import { ExploreStrip } from './ExploreStrip'
import { InfoPanel } from './InfoPanel'
import { Legend } from './Legend'
import { ModeSwitcher } from './ModeSwitcher'
import { RoutePlanner } from './RoutePlanner'
import { StationList } from './StationList'
import { TimeControls } from './TimeControls'
import { TouchControls } from './TouchControls'
import { LandscapeHint } from './LandscapeHint'
import { TOUCH_QUERY, useMediaQuery } from './useMediaQuery'
import { RoutesRail } from './water/RoutesRail'
import { WaterInfoPanel } from './water/WaterInfoPanel'
import { WaterPlanner } from './water/WaterPlanner'

function Brand({ water }: { water: boolean }) {
  const setExperience = useSimStore((s) => s.setExperience)
  return (
    <div className="hud-panel pointer-events-auto hidden items-center gap-3 px-4 py-2.5 sm:flex">
      <button
        onClick={() => setExperience('landing')}
        title="Back to landing"
        className="flex h-8 w-8 items-center justify-center rounded-md bg-kmrl font-display text-lg font-bold text-ink transition-transform hover:scale-105"
      >
        K
      </button>
      <div className="leading-tight">
        <div className="font-display text-sm font-semibold tracking-wide text-paper">
          {water ? (
            <>
              Kochi <span className="text-kmrl">Water Metro</span>
            </>
          ) : (
            <>
              Kochi Metro <span className="text-kmrl">Simulator</span>
            </>
          )}
        </div>
        <div className="font-ml text-[11px] text-paper-dim">
          {water ? 'ജല മെട്രോ · 4 routes' : 'കൊച്ചി മെട്രോ · Blue Line'}
        </div>
      </div>
    </div>
  )
}

function WaterLegend() {
  return (
    <div className="hud-panel pointer-events-auto flex flex-col gap-1.5 px-3.5 py-2.5 font-display text-[11px] text-paper-dim">
      {waterRoutes.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          <span className="h-1 w-5 rounded-full" style={{ background: r.color }} />
          <span>
            {r.id} · {r.name}
          </span>
        </div>
      ))}
    </div>
  )
}

export function HUD() {
  const appMode = useSimStore((s) => s.appMode)
  const experience = useSimStore((s) => s.experience)
  const water = experience === 'water'
  const explore = appMode === 'explore'
  const drive = appMode === 'drive' && !water
  const tracker = appMode === 'tracker' || (water && appMode === 'drive')
  const touch = useMediaQuery(TOUCH_QUERY)

  return (
    <div className="pointer-events-none absolute inset-0 flex select-none flex-col justify-between p-4 max-sm:p-3">
      <div className="flex min-h-0 flex-1 items-start justify-between gap-4 pb-4">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <Brand water={water} />
          {tracker && (
            <div className="hidden min-h-0 md:block">
              {water ? <RoutesRail /> : <StationList />}
            </div>
          )}
        </div>
        {/* the switcher sits above everything; below lg the panel column starts
            under it instead of sliding beneath it (which ate its clicks) */}
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 max-sm:top-3">
          <ModeSwitcher />
        </div>
        <div className="flex max-h-full max-w-full flex-col items-end gap-3 overflow-y-auto max-lg:pt-12">
          {drive ? (
            <DrivePanel compact={touch} />
          ) : (
            <>
              {water ? <WaterInfoPanel /> : <InfoPanel />}
              {tracker && (
                <div className="hidden sm:block">{water ? <WaterPlanner /> : <RoutePlanner />}</div>
              )}
              {(explore || tracker) && (
                <div className="hud-panel pointer-events-auto hidden px-3.5 py-2 font-display text-[11px] text-paper-dim sm:block">
                  <span className="font-mono text-kmrl">WASD</span> move ·{' '}
                  <span className="font-mono text-kmrl">Q/E</span> height ·{' '}
                  <span className="font-mono text-kmrl">Shift</span> fast
                  {explore && (water ? ' · click a boat to ride along' : ' · click a train to ride along')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {drive && touch && <TouchControls />}
      {drive && <LandscapeHint />}
      <div className="relative flex items-end justify-between gap-4">
        <div className="hidden lg:block">{tracker && (water ? <WaterLegend /> : <Legend />)}</div>
        {!drive && (
          <div className="absolute left-1/2 bottom-0 flex w-full max-w-xl -translate-x-1/2 flex-col items-center gap-2">
            {explore && !water && <ExploreStrip />}
            <div className="w-full">
              <TimeControls />
            </div>
          </div>
        )}
        <div className={`ml-auto self-end text-right font-display text-[10px] leading-tight tracking-wide text-paper-dim/70 ${drive && touch ? 'hidden' : ''}`}>
          Contains data provided by Kochi Metro Rail Limited
          <br />
          Map data © OpenStreetMap contributors
          <br />
          Imagery: Powered by Esri · Maxar, Earthstar Geographics
        </div>
      </div>
    </div>
  )
}
