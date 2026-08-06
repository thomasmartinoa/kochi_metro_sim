/**
 * Branded loading overlay while the city (GLB + satellite) streams in.
 * Metro gets a sliding Metropolis trainset, Water Metro a catamaran bobbing
 * over waves — both pure SVG/CSS, driven by drei's global load progress and
 * the first batch of streaming map tiles (so the low-res -> high-res pop-in
 * isn't visible on first paint).
 */
import { useProgress } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { useSimStore } from '../state/useSimStore'
import { firstLoad } from '../scene/firstLoad'
import { tilesSettled } from '../scene/TileGround'

/** Hard cap so a slow/offline tile network never keeps the loader up forever.
 *  Generous because the landing panorama is wide (many tiles) and the camera is
 *  held still until they settle — the cap is only a dead-network guard. */
const TILE_WAIT_MS = 14000
/** Absolute ceiling: never hold the veil longer than this, whatever stalls. */
const HARD_CAP_MS = 30000

function TrainLoader() {
  return (
    <svg viewBox="0 0 360 90" className="w-72" aria-hidden>
      {/* trainset */}
      <g className="loader-slide">
        {[0, 1, 2].map((c) => (
          <g key={c} transform={`translate(${c * 104}, 18)`}>
            <rect x="4" y="0" width="96" height="34" rx="7" fill="#F2F4F5" />
            <rect x="4" y="24" width="96" height="6" rx="3" fill="#12B3A6" />
            <rect x="12" y="8" width="80" height="10" rx="2" fill="#1E2A30" />
            {c === 0 && <path d="M4 0 q-10 17 0 34 z" fill="#12B3A6" />}
            {c === 2 && <path d="M100 0 q10 17 0 34 z" fill="#12B3A6" />}
          </g>
        ))}
      </g>
      {/* track */}
      <line x1="0" y1="62" x2="360" y2="62" stroke="#2A4750" strokeWidth="3" strokeDasharray="14 10" className="loader-track" />
    </svg>
  )
}

function BoatLoader() {
  return (
    <svg viewBox="0 0 360 110" className="w-72" aria-hidden>
      <g className="loader-bob">
        {/* twin hulls */}
        <rect x="120" y="52" width="120" height="10" rx="5" fill="#F2F4F5" />
        <rect x="126" y="60" width="26" height="8" rx="4" fill="#F2F4F5" />
        <rect x="208" y="60" width="26" height="8" rx="4" fill="#F2F4F5" />
        {/* cabin */}
        <rect x="132" y="30" width="96" height="24" rx="6" fill="#F2F4F5" />
        <rect x="138" y="36" width="84" height="9" rx="2" fill="#1E2A30" />
        <rect x="132" y="50" width="96" height="5" rx="2.5" fill="#12B3A6" />
        {/* mast light */}
        <circle cx="180" cy="24" r="3" fill="#D6E64B" />
        <line x1="180" y1="27" x2="180" y2="30" stroke="#9AA4A6" strokeWidth="2" />
      </g>
      {/* waves */}
      <path
        d="M0 78 q15 -8 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0"
        fill="none"
        stroke="#22D3EE"
        strokeWidth="3"
        className="loader-wave"
      />
      <path
        d="M-15 90 q15 -7 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0"
        fill="none"
        stroke="#12B3A6"
        strokeWidth="2.5"
        opacity="0.6"
        className="loader-wave-slow"
      />
    </svg>
  )
}

export function Loader() {
  const { active, progress } = useProgress()
  const experience = useSimStore((s) => s.experience)
  const [done, setDone] = useState(false)
  const [gone, setGone] = useState(false)

  // drei's progress is read through a ref, not the effect deps: geo-three keeps
  // pushing tile textures through the default LoadingManager for as long as the
  // camera moves, so `active`/`progress` never settle. Re-running the effect on
  // each change would reset t0 every tick and neither timeout could ever fire.
  const state = useRef({ active, progress })
  state.current = { active, progress }

  // Hold the overlay until BOTH the GLB/textures (drei) and the first tile
  // batch are in — or the tile timeout elapses (offline/slow → fall back to
  // the static overlay). Polled because tilesSettled() isn't reactive.
  useEffect(() => {
    const t0 = performance.now()
    const id = setInterval(() => {
      const waited = performance.now() - t0
      // progress can come back non-finite once the manager's item count is out
      // of step (the endless tile stream does exactly that); treat it as "done"
      // rather than trapping the user behind the veil
      const p = state.current.progress
      const glbReady = !state.current.active && (p >= 100 || !Number.isFinite(p))
      const groundReady = tilesSettled() || waited > TILE_WAIT_MS
      if ((glbReady && groundReady) || waited > HARD_CAP_MS) {
        clearInterval(id)
        // release the landing camera drift and reveal in one go
        firstLoad.ready = true
        setDone(true)
        setTimeout(() => setGone(true), 700)
      }
    }, 200)
    return () => clearInterval(id)
  }, [])

  const pinned = import.meta.env.DEV && window.location.search.includes('loader')
  if (gone && !pinned) return null
  const water = pinned
    ? window.location.search.includes('loader=water')
    : experience === 'water'
  // guard the same non-finite progress the effect tolerates — "Infinity%" on the
  // veil is worse than an honest 100
  const shown = Number.isFinite(progress) ? Math.min(100, Math.round(progress)) : 100
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-ink transition-opacity duration-700 ${
        done && !pinned ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      {water ? <BoatLoader /> : <TrainLoader />}
      <div className="flex flex-col items-center gap-1.5">
        <div className="font-display text-sm font-semibold tracking-wide text-paper">
          {water ? 'Kochi Water Metro' : 'Kochi Metro'}
        </div>
        <div className="font-ml text-xs text-paper-dim">
          {water ? 'ജല മെട്രോ' : 'കൊച്ചി മെട്രോ'}
        </div>
      </div>
      <div className="h-1 w-56 overflow-hidden rounded-full bg-panel">
        <div
          className="h-full rounded-full bg-kmrl transition-[width] duration-300"
          style={{ width: `${shown}%` }}
        />
      </div>
      <div className="font-mono text-[11px] tabular-nums text-paper-dim">
        {shown}% · loading the city
      </div>
    </div>
  )
}
