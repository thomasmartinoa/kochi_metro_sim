/**
 * Landing experience: the living city drifts behind glass portal cards for
 * Metro and Water Metro, each showing what's running right now.
 */
import { useEffect, useState } from 'react'
import { fmtTime } from '../sim/clock'
import { liveTrainStates, serviceStatusAt } from '../sim/engine'
import { liveBoatStates, waterServiceStatusAt } from '../sim/waterEngine'
import { useSimStore, type Experience } from '../state/useSimStore'

function TrainGlyph() {
  return (
    <svg viewBox="0 0 64 28" className="h-7 w-16">
      <rect x="2" y="4" width="60" height="16" rx="6" fill="#F2F4F5" />
      <rect x="2" y="4" width="60" height="16" rx="6" fill="none" stroke="#0A1620" strokeOpacity="0.15" />
      <rect x="6" y="8" width="52" height="5" rx="2" fill="#35505E" />
      <path d="M2 15 h60 v3 a6 6 0 0 1 -6 6 h-48 a6 6 0 0 1 -6 -6 z" fill="#12B3A6" />
      <circle cx="16" cy="24" r="2.4" fill="#0A1620" />
      <circle cx="48" cy="24" r="2.4" fill="#0A1620" />
    </svg>
  )
}

function BoatGlyph() {
  return (
    <svg viewBox="0 0 64 28" className="h-7 w-16">
      <rect x="14" y="2" width="36" height="9" rx="3" fill="#F2F4F5" />
      <rect x="17" y="4" width="30" height="4" rx="1.5" fill="#35505E" />
      <path d="M8 13 h48 l-5 8 h-38 z" fill="#F2F4F5" />
      <path d="M8 13 h48 l-1.4 2.4 h-45.2 z" fill="#22D3EE" />
      <path d="M2 25 q6 -4 12 0 t12 0 t12 0 t12 0 t12 0" fill="none" stroke="#22D3EE" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    </svg>
  )
}

function useLiveCounts() {
  const [counts, setCounts] = useState({ trains: 0, boats: 0, trainNext: 0, boatNext: 0 })
  useEffect(() => {
    const update = () => {
      const epoch = useSimStore.getState().epochMs
      const ts = serviceStatusAt(epoch)
      const ws = waterServiceStatusAt(epoch)
      setCounts({
        trains: liveTrainStates(epoch).length,
        boats: liveBoatStates(epoch).length,
        trainNext: ts.open ? 0 : (ts.nextTrainSec ?? 0),
        boatNext: ws.open ? 0 : (ws.nextSailSec ?? 0),
      })
    }
    update()
    const id = setInterval(update, 2000)
    return () => clearInterval(id)
  }, [])
  return counts
}

function PortalCard({
  exp,
  accent,
  glyph,
  title,
  titleMl,
  facts,
  liveLine,
}: {
  exp: Experience
  accent: string
  glyph: React.ReactNode
  title: string
  titleMl: string
  facts: string
  liveLine: React.ReactNode
}) {
  const setExperience = useSimStore((s) => s.setExperience)
  return (
    <button
      onClick={() => setExperience(exp)}
      className="hud-panel group pointer-events-auto flex w-[19rem] flex-col gap-2 px-5 py-4 text-left transition-all hover:-translate-y-1 max-sm:w-full"
      style={{ boxShadow: '0 4px 24px rgb(0 0 0 / 0.35)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = accent)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
    >
      <div className="flex items-center justify-between">
        {glyph}
        <span
          className="font-display text-xs font-semibold tracking-widest opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: accent }}
        >
          ENTER →
        </span>
      </div>
      <div className="leading-tight">
        <div className="font-display text-lg font-bold text-paper">{title}</div>
        <div className="font-ml text-xs text-paper-dim">{titleMl}</div>
      </div>
      <div className="font-display text-[11px] text-paper-dim">{facts}</div>
      <div className="flex items-center gap-1.5 font-mono text-[11px]" style={{ color: accent }}>
        {liveLine}
      </div>
    </button>
  )
}

export function Landing() {
  const { trains, boats, trainNext, boatNext } = useLiveCounts()
  const [about, setAbout] = useState(false)

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      {/* readability gradients */}
      <div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-ink/80 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-ink/85 to-transparent" />

      {/* lockup */}
      <div className="relative mt-14 flex flex-col items-center gap-2 px-4 text-center">
        <div className="font-ml text-lg tracking-wide text-kmrl">കൊച്ചി</div>
        <h1 className="font-display text-5xl font-bold tracking-tight text-paper max-sm:text-3xl">
          Kochi in Transit
        </h1>
        <p className="max-w-xl font-display text-sm text-paper-dim">
          A living 3D simulation of the city's metro and water metro — every train and boat
          moving on the real published timetables, over the real map.
        </p>
      </div>

      {/* portals */}
      <div className="relative mt-auto mb-16 flex items-end justify-center gap-6 px-4 max-sm:flex-col max-sm:items-center">
        <PortalCard
          exp="metro"
          accent="#12B3A6"
          glyph={<TrainGlyph />}
          title="Kochi Metro"
          titleMl="കൊച്ചി മെട്രോ"
          facts="Blue Line · 25 stations · Aluva ⇄ Tripunithura"
          liveLine={
            trains > 0 ? (
              <>
                <span className="live-dot inline-block h-2 w-2 rounded-full bg-kmrl" />
                {trains} trains running now
              </>
            ) : (
              <>service closed · first train {fmtTime(trainNext)}</>
            )
          }
        />
        <PortalCard
          exp="water"
          accent="#22D3EE"
          glyph={<BoatGlyph />}
          title="Water Metro"
          titleMl="ജല മെട്രോ"
          facts="4 routes · 11 terminals · electric catamarans"
          liveLine={
            boats > 0 ? (
              <>
                <span className="live-dot inline-block h-2 w-2 rounded-full" style={{ background: '#22D3EE' }} />
                {boats} boats sailing now
              </>
            ) : (
              <>service closed · first sailing {fmtTime(boatNext)}</>
            )
          }
        />
      </div>

      {/* footer */}
      <div className="relative mb-4 flex flex-col items-center gap-1 px-4 text-center">
        <button
          onClick={() => setAbout(!about)}
          className="pointer-events-auto font-display text-[11px] tracking-wide text-paper-dim underline-offset-2 hover:text-paper hover:underline"
        >
          {about ? 'hide' : 'what is this?'}
        </button>
        {about && (
          <div className="hud-panel pointer-events-auto max-w-lg px-4 py-3 text-left font-display text-[11px] leading-relaxed text-paper-dim">
            A fan-made simulator, not affiliated with KMRL. Metro positions are interpolated
            from the official KMRL GTFS timetable; Water Metro sailings are synthesised from
            the published service pattern. Track every vehicle live, free-fly with WASD, ride
            along, or drive a Metropolis train yourself. Built with react-three-fiber on real
            OpenStreetMap geometry.
          </div>
        )}
        <div className="font-display text-[10px] tracking-wide text-paper-dim/70">
          Contains data provided by Kochi Metro Rail Limited · Map data © OpenStreetMap
          contributors · aerial imagery via Blosm
        </div>
      </div>
    </div>
  )
}
