/**
 * Drive mode UI: start screen (pick direction), then the cab desk —
 * speedometer, notch bar, next-stop distance, doors, score, results.
 */
import { useEffect, useState } from 'react'
import { stations } from '../data/network'
import { A_LAT_WARN, brakingDistanceM, grade, LINE_SPEED_KMH, NOTCH_MAX, NOTCH_MIN, WEATHERS, type Weather } from '../sim/drive'
import { useSimStore } from '../state/useSimStore'
import { VIEW_LABEL, VIEWS } from '../sim/driveCameras'
import { useDriveStore } from '../state/useDriveStore'
import { useRunHistory } from '../state/runHistory'
import { ReplayBar } from './ReplayBar'
import { TOUCH_QUERY, useMediaQuery } from './useMediaQuery'

const WEATHER_LABEL: Record<Weather, string> = {
  clear: 'Clear',
  overcast: 'Overcast',
  rain: 'Rain',
  monsoon: 'Monsoon',
  fog: 'Fog',
}

function StartScreen() {
  const start = useDriveStore((s) => s.start)
  const weather = useSimStore((s) => s.weather)
  const setWeather = useSimStore((s) => s.setWeather)
  const touch = useMediaQuery(TOUCH_QUERY)
  return (
    <div className="hud-panel pointer-events-auto flex w-80 max-w-full flex-col gap-3 px-5 py-4 max-sm:gap-2 max-sm:px-3 max-sm:py-3">
      <div className="font-display text-sm font-semibold tracking-widest text-paper-dim">
        DRIVE A METROPOLIS
      </div>
      <p className="font-display text-[13px] leading-snug text-paper">
        Take a 3-car trainset down the Blue Line. Stop on the mark at all 25
        stations. Mind the 80 km/h limit.
      </p>
      <div className="flex flex-col gap-1">
        <div className="font-display text-[10px] font-semibold tracking-widest text-paper-dim">WEATHER</div>
        <div className="flex flex-wrap gap-1">
          {WEATHERS.map((w) => (
            <button
              key={w}
              onClick={() => setWeather(w)}
              className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                weather === w ? 'bg-kmrl text-ink' : 'text-paper-dim hover:bg-panel hover:text-paper'
              }`}
            >
              {WEATHER_LABEL[w]}
            </button>
          ))}
          <button
            onClick={() => setWeather(WEATHERS[Math.floor(Math.random() * WEATHERS.length)])}
            className="rounded px-2 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper"
          >
            Random
          </button>
        </div>
        {weather !== 'clear' && weather !== 'overcast' && (
          <div className="font-mono text-[10px] text-lemon">
            wet rail · braking distances stretch · ease off the notches
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => start(0)}
          className="rounded-md bg-kmrl px-3 py-2 text-left font-display text-sm font-semibold text-ink hover:bg-kmrl/85"
        >
          Aluva → Tripunithura
        </button>
        <button
          onClick={() => start(1)}
          className="rounded-md bg-lemon px-3 py-2 text-left font-display text-sm font-semibold text-ink hover:bg-lemon/85"
        >
          Tripunithura → Aluva
        </button>
      </div>
      {touch ? (
        <div className="font-mono text-[11px] leading-relaxed text-paper-dim">
          Drag the lever on the left for power and brake · buttons below for doors, horn, camera and
          the emergency stop
        </div>
      ) : (
        <div className="font-mono text-[11px] leading-relaxed text-paper-dim">
          W / ↑ power · S / ↓ brake · Space emergency
          <br />
          O doors · H horn · L headlights
          <br />
          C / V next / previous view · 1-0 pick a view · drag the lever, click the buttons
        </div>
      )}
      <Leaderboard />
    </div>
  )
}

const DIR_SHORT = ['ALV → TPN', 'TPN → ALV']

function fmtWhen(at: number): string {
  const d = new Date(at)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Your runs in this browser, and which of them is the ghost. */
function Leaderboard() {
  const history = useRunHistory((s) => s.history)
  const clear = useRunHistory((s) => s.clear)
  const records = history.records
  if (records.length === 0) {
    return (
      <div className="font-mono text-[10px] text-paper-dim">
        Finish a run and it goes on the board here; your best becomes a ghost to race.
      </div>
    )
  }
  const best = [history.best[0], history.best[1]]
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <div className="font-display text-[10px] font-semibold tracking-widest text-paper-dim">YOUR RUNS</div>
        <button onClick={clear} className="font-mono text-[10px] text-paper-dim hover:text-pinkline">
          clear
        </button>
      </div>
      <div className="font-mono text-[10px] text-paper-dim">
        ghost · {best[0] ? `${best[0].score} pts ${DIR_SHORT[0]}` : `no ${DIR_SHORT[0]} run yet`}
        {' · '}
        {best[1] ? `${best[1].score} pts ${DIR_SHORT[1]}` : `no ${DIR_SHORT[1]} run yet`}
      </div>
      <div className="max-h-32 overflow-y-auto font-mono text-[11px] leading-relaxed">
        {records.map((r) => {
          const isGhost = best[r.dir]?.at === r.at
          return (
            <div key={r.at} className="flex items-baseline justify-between gap-2">
              <span className="shrink-0 text-paper-dim">{fmtWhen(r.at)}</span>
              <span className="shrink-0 text-paper-dim">{DIR_SHORT[r.dir]}</span>
              <span className="min-w-0 flex-1 truncate text-paper-dim">
                {r.outcome === 'derailed' ? 'crashed' : `${r.goodStops}/${r.stops} stops · ${r.onTime} on time`}
              </span>
              <span className={`shrink-0 font-semibold ${r.outcome === 'derailed' ? 'text-pinkline' : 'text-lemon'}`}>
                {r.score}
                {isGhost ? ' ◆' : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** `compact`: the touch layout -- the lever and buttons live in TouchControls, so the desk is just the readouts */
export function DrivePanel({ compact = false }: { compact?: boolean }) {
  const drive = useDriveStore((s) => s.drive)
  const exit = useDriveStore((s) => s.exit)
  const restart = useDriveStore((s) => s.restart)
  const enterReplay = useDriveStore((s) => s.enterReplay)
  const replaying = useDriveStore((s) => s.replaying)
  const newBest = useDriveStore((s) => s.newBest)
  const nudgeNotch = useDriveStore((s) => s.nudgeNotch)
  const view = useDriveStore((s) => s.view)
  const setView = useDriveStore((s) => s.setView)
  const doors = useDriveStore((s) => s.doors)
  const horn = useDriveStore((s) => s.horn)

  // rerender at 10 Hz while driving (physics lives outside react)
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])

  if (!drive) return <StartScreen />
  if (replaying) return <ReplayBar />

  const vKmh = drive.vMs * 3.6
  const target = stations[drive.nextStopOrder]
  const distM = target ? Math.abs(drive.distToNextM) : 0
  const brakeNeed = brakingDistanceM(drive.vMs, drive.adhesion)
  const lastStop = drive.stops[drive.stops.length - 1]
  const nStops = drive.dir === 0 ? stations.length - 1 : stations.length - 1

  return (
    <div
      className={`hud-panel pointer-events-auto flex max-w-full flex-col ${
        compact ? 'w-64 gap-1.5 px-3 py-2' : 'w-80 gap-2.5 px-5 py-4'
      }`}
    >
      {drive.phase === 'derailed' && drive.derail ? (
        <>
          <div className="font-display text-sm font-semibold tracking-widest text-pinkline">
            {drive.derail.cause === 'collision' ? 'COLLISION' : 'DERAILED'}
          </div>
          <div className="font-display text-[13px] leading-snug text-paper">
            {drive.derail.cause === 'curve'
              ? `${Math.round(drive.derail.speedKmh)} km/h into a ${Math.round(drive.derail.radiusM)} m curve · limit ${Math.round(drive.derail.limitKmh)}`
              : drive.derail.cause === 'collision'
                ? `Collided with the train ahead at ${Math.round(drive.derail.speedKmh)} km/h${drive.spads ? ` · passed ${drive.spads} red` : ''}`
                : `${Math.round(drive.derail.speedKmh)} km/h into the buffer stop · limit ${Math.round(drive.derail.limitKmh)}`}
          </div>
          <div className="font-mono text-3xl font-semibold text-pinkline">{drive.score}</div>
          <button
            onClick={enterReplay}
            className="rounded-md bg-lemon px-3 py-1.5 font-display text-sm font-semibold text-ink"
          >
            Watch replay
          </button>
          <button
            onClick={restart}
            className="rounded-md bg-kmrl px-3 py-1.5 font-display text-sm font-semibold text-ink"
          >
            Restart from {stations[drive.derail.lastStopOrder].name}
          </button>
          <button
            onClick={exit}
            className="rounded px-2 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper"
          >
            exit
          </button>
        </>
      ) : drive.phase === 'done' ? (
        <>
          <div className="font-display text-sm font-semibold tracking-widest text-paper-dim">
            RUN COMPLETE
          </div>
          <div className="font-mono text-3xl font-semibold text-lemon">{drive.score}</div>
          <div className="font-display text-sm text-paper">{grade(drive.score, nStops)}</div>
          {newBest && (
            <div className="font-display text-[12px] font-semibold text-kmrl">
              ◆ NEW BEST · this run is your ghost next time
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div className="rounded-md bg-panel/70 px-2 py-1.5">
              <div className="text-paper-dim">STOPS</div>
              <div className="text-sm text-paper">
                {drive.stops.reduce((a, s) => a + s.points, 0)}
              </div>
            </div>
            <div className="rounded-md bg-panel/70 px-2 py-1.5">
              <div className="text-paper-dim">ON TIME</div>
              <div className="text-sm text-paper">
                {drive.stops.reduce((a, s) => a + (s.punctualityPoints ?? 0), 0)}
              </div>
            </div>
            <div className="rounded-md bg-panel/70 px-2 py-1.5">
              <div className="text-paper-dim">COMFORT</div>
              <div className="text-sm text-paper">{Math.round(drive.comfort)}%</div>
            </div>
          </div>
          <div className="max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed text-paper-dim">
            {drive.stops.map((s, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="truncate">{stations[s.stationOrder].name}</span>
                <span className="shrink-0">
                  <span className={s.points > 0 ? 'text-kmrl' : 'text-pinkline'}>
                    {s.label} {s.points > 0 ? '+' : ''}
                    {s.points}
                  </span>
                  {s.lateSec !== undefined && (
                    <span className={Math.abs(s.lateSec) <= 30 ? 'text-paper-dim' : 'text-lemon'}>
                      {' '}
                      · {s.lateSec > 0 ? '+' : ''}
                      {Math.round(s.lateSec)}s
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={exit}
            className="rounded-md bg-kmrl px-3 py-1.5 font-display text-sm font-semibold text-ink"
          >
            Drive again
          </button>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <span
              className={`font-mono font-semibold tabular-nums ${compact ? 'text-3xl' : 'text-4xl'} ${
                drive.overspeed ? 'text-lemon' : 'text-paper'
              }`}
            >
              {Math.round(vKmh)}
            </span>
            <span className="font-display text-[11px] text-paper-dim">
              {drive.slipping ? (
                <span className="font-semibold text-pinkline">WHEEL SLIP</span>
              ) : (
                <>km/h · limit {LINE_SPEED_KMH}</>
              )}
            </span>
          </div>

          {/* notch bar */}
          <div className="flex items-center gap-1">
            {Array.from({ length: NOTCH_MAX - NOTCH_MIN + 1 }, (_, i) => {
              const n = NOTCH_MIN + i
              const active = drive.notch === n
              return (
                <span
                  key={n}
                  className={`h-3 flex-1 rounded-sm ${
                    active
                      ? n > 0
                        ? 'bg-kmrl'
                        : n < 0
                          ? n === -5
                            ? 'bg-pinkline'
                            : 'bg-lemon'
                          : 'bg-paper'
                      : 'bg-panel'
                  }`}
                />
              )
            })}
          </div>
          <div className={`flex justify-between font-mono text-[10px] text-paper-dim ${compact ? 'hidden' : ''}`}>
            <span>EB</span>
            <span>BRAKE</span>
            <span>N</span>
            <span>POWER</span>
          </div>

          {/* mouse controls; a phone gets the lever in TouchControls instead */}
          <div className={`flex gap-2 ${compact ? 'hidden' : ''}`}>
            <button
              onClick={() => nudgeNotch(-1)}
              className="flex-1 rounded-md bg-lemon/85 py-1.5 font-display text-sm font-bold text-ink"
            >
              − BRAKE
            </button>
            <button
              onClick={() => nudgeNotch(1)}
              className="flex-1 rounded-md bg-kmrl py-1.5 font-display text-sm font-bold text-ink"
            >
              + POWER
            </button>
          </div>

          {target && (
            <div className={`rounded-md bg-panel/70 px-3 ${compact ? 'py-1' : 'py-2'}`}>
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[11px] tracking-wide text-paper-dim">
                  NEXT STOP
                </span>
                <span className="font-display text-sm font-semibold text-paper">
                  {target.name}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-lg tabular-nums text-paper">
                  {distM > 1000 ? `${(distM / 1000).toFixed(2)} km` : `${Math.round(distM)} m`}
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    distM > 0 && brakeNeed >= distM - 20 && vKmh > 5 ? 'text-lemon' : 'text-paper-dim'
                  }`}
                >
                  brake point {Math.round(brakeNeed)} m
                </span>
              </div>
            </div>
          )}

          {drive.signal && (
            <div className={`flex items-baseline justify-between rounded-md bg-panel/70 px-3 ${compact ? 'py-0.5' : 'py-1.5'}`}>
              <span className="flex items-center gap-2 font-display text-[11px] tracking-wide text-paper-dim">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    drive.signal.aspect === 'red'
                      ? 'bg-[#FF3B3B]'
                      : drive.signal.aspect === 'yellow'
                        ? 'bg-[#FFC93C]'
                        : 'bg-[#22E36A]'
                  }`}
                />
                SIGNAL {drive.signal.aspect.toUpperCase()}
                {drive.spads > 0 && <span className="text-pinkline"> · SPAD ×{drive.spads}</span>}
              </span>
              <span className="font-mono text-sm tabular-nums text-paper">
                {Math.max(0, Math.round(drive.signal.distM))} m
              </span>
            </div>
          )}

          {drive.ahead && (
            <div
              className={`flex items-baseline justify-between rounded-md px-3 py-1.5 ${
                drive.lateralMs2 > A_LAT_WARN ? 'bg-pinkline/25' : 'bg-lemon/15'
              }`}
            >
              <span className="font-display text-[11px] tracking-wide text-paper-dim">
                {drive.ahead.distM === 0 ? 'IN CURVE' : 'CURVE AHEAD'}
              </span>
              <span className="font-mono text-sm tabular-nums text-paper">
                <span className={drive.lateralMs2 > A_LAT_WARN ? 'text-pinkline' : 'text-lemon'}>
                  {Math.round(drive.ahead.limitKmh)} km/h
                </span>
                {drive.ahead.distM > 0 && (
                  <span className="text-paper-dim"> · {Math.round(drive.ahead.distM)} m</span>
                )}
              </span>
            </div>
          )}

          {drive.doorsOpen && (
            <div className="rounded-md bg-panel/70 px-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[11px] tracking-wide text-paper-dim">
                  DOORS OPEN · {Math.floor(drive.dwellRemainSec)}s
                </span>
                <span className="font-mono text-[11px] text-paper-dim">
                  {drive.boarding
                    ? drive.boarding.done
                      ? 'boarding complete'
                      : drive.boarding.alighting > 0
                        ? `${Math.ceil(drive.boarding.alighting)} alighting`
                        : `${Math.ceil(drive.boarding.waiting)} boarding`
                    : 'ready to depart'}
                </span>
              </div>
              {drive.boarding && !drive.boarding.done && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-panel">
                  <div
                    className="h-full rounded-full bg-kmrl transition-[width] duration-200"
                    style={{
                      width: `${Math.round(
                        100 * (1 - (drive.boarding.alighting + drive.boarding.waiting) / Math.max(1, drive.boarding.total)),
                      )}%`,
                    }}
                  />
                </div>
              )}
              <button
                onClick={doors}
                className={`mt-2 w-full rounded-md py-1.5 font-display text-sm font-bold ${
                  drive.boarding?.done !== false ? 'bg-kmrl text-ink' : 'bg-lemon/85 text-ink'
                }`}
              >
                {drive.boarding?.done !== false ? 'CLOSE DOORS · O' : 'CLOSE DOORS EARLY · O'}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="font-display text-[11px] text-paper-dim">
              {drive.doorsOpen ? '' : drive.phase === 'ready' ? 'APPLY POWER TO DEPART' : ''}
              {!drive.doorsOpen && drive.phase === 'dwell' ? 'DOORS CLOSED · APPLY POWER' : ''}
            </span>
            <span className="flex items-center gap-3">
              <button
                onClick={horn}
                title="Horn (H)"
                className={`rounded px-2 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper ${compact ? 'hidden' : ''}`}
              >
                horn
              </button>
              <span className="font-mono text-[11px] text-paper-dim" title="Passenger comfort">
                {Math.round(drive.comfort)}%
              </span>
              <span className="font-mono text-sm font-semibold text-lemon">{drive.score}</span>
            </span>
          </div>

          {lastStop && drive.phase === 'dwell' && (
            <div
              className={`rounded-md px-3 py-1.5 text-center font-display text-sm font-bold ${
                lastStop.points > 0 ? 'bg-kmrl/20 text-kmrl' : 'bg-pinkline/20 text-pinkline'
              }`}
            >
              {lastStop.label} · {lastStop.errM > 0 ? '+' : ''}
              {lastStop.errM.toFixed(1)} m · {lastStop.points > 0 ? '+' : ''}
              {lastStop.points}
            </div>
          )}

          <div className={`flex flex-wrap gap-1 ${compact ? 'hidden' : ''}`}>
            {VIEWS.map((v, i) => (
              <button
                key={v}
                onClick={() => setView(v)}
                title={`${VIEW_LABEL[v]} (${i + 1})`}
                className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                  view === v ? 'bg-kmrl text-ink' : 'text-paper-dim hover:bg-panel hover:text-paper'
                }`}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={exit}
              className="rounded px-2 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper"
            >
              exit
            </button>
          </div>
        </>
      )}
    </div>
  )
}
