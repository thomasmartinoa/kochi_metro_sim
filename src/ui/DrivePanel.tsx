/**
 * Drive mode UI: start screen (pick direction), then the cab desk —
 * speedometer, notch bar, next-stop distance, doors, score, results.
 */
import { useEffect, useState } from 'react'
import { stations } from '../data/network'
import { A_LAT_WARN, brakingDistanceM, grade, LINE_SPEED_KMH, NOTCH_MAX, NOTCH_MIN } from '../sim/drive'
import { useDriveStore } from '../state/useDriveStore'

function StartScreen() {
  const start = useDriveStore((s) => s.start)
  return (
    <div className="hud-panel pointer-events-auto flex w-80 flex-col gap-3 px-5 py-4">
      <div className="font-display text-sm font-semibold tracking-widest text-paper-dim">
        DRIVE A METROPOLIS
      </div>
      <p className="font-display text-[13px] leading-snug text-paper">
        Take a 3-car trainset down the Blue Line. Stop on the mark at all 25
        stations. Mind the 80 km/h limit.
      </p>
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
      <div className="font-mono text-[11px] leading-relaxed text-paper-dim">
        W / ↑ power · S / ↓ brake
        <br />
        Space emergency · C cab / chase view
      </div>
    </div>
  )
}

export function DrivePanel() {
  const drive = useDriveStore((s) => s.drive)
  const exit = useDriveStore((s) => s.exit)
  const restart = useDriveStore((s) => s.restart)
  const nudgeNotch = useDriveStore((s) => s.nudgeNotch)
  const toggleCam = useDriveStore((s) => s.toggleCam)
  const cam = useDriveStore((s) => s.cam)

  // rerender at 10 Hz while driving (physics lives outside react)
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])

  if (!drive) return <StartScreen />

  const vKmh = drive.vMs * 3.6
  const target = stations[drive.nextStopOrder]
  const distM = target ? Math.abs(drive.distToNextM) : 0
  const brakeNeed = brakingDistanceM(drive.vMs)
  const lastStop = drive.stops[drive.stops.length - 1]
  const nStops = drive.dir === 0 ? stations.length - 1 : stations.length - 1

  return (
    <div className="hud-panel pointer-events-auto flex w-80 flex-col gap-2.5 px-5 py-4">
      {drive.phase === 'derailed' && drive.derail ? (
        <>
          <div className="font-display text-sm font-semibold tracking-widest text-pinkline">
            DERAILED
          </div>
          <div className="font-display text-[13px] leading-snug text-paper">
            {drive.derail.cause === 'curve'
              ? `${Math.round(drive.derail.speedKmh)} km/h into a ${Math.round(drive.derail.radiusM)} m curve · limit ${Math.round(drive.derail.limitKmh)}`
              : `${Math.round(drive.derail.speedKmh)} km/h into the buffer stop · limit ${Math.round(drive.derail.limitKmh)}`}
          </div>
          <div className="font-mono text-3xl font-semibold text-pinkline">{drive.score}</div>
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
          <div className="max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed text-paper-dim">
            {drive.stops.map((s, i) => (
              <div key={i} className="flex justify-between">
                <span>{stations[s.stationOrder].name}</span>
                <span className={s.points > 0 ? 'text-kmrl' : 'text-pinkline'}>
                  {s.label} {s.points > 0 ? '+' : ''}
                  {s.points}
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
              className={`font-mono text-4xl font-semibold tabular-nums ${
                drive.overspeed ? 'text-lemon' : 'text-paper'
              }`}
            >
              {Math.round(vKmh)}
            </span>
            <span className="font-display text-[11px] text-paper-dim">
              km/h · limit {LINE_SPEED_KMH}
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
          <div className="flex justify-between font-mono text-[10px] text-paper-dim">
            <span>EB</span>
            <span>BRAKE</span>
            <span>N</span>
            <span>POWER</span>
          </div>

          {/* touch controls */}
          <div className="flex gap-2">
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
            <div className="rounded-md bg-panel/70 px-3 py-2">
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

          <div className="flex items-center justify-between">
            <span className="font-display text-[11px] text-paper-dim">
              {drive.doorsOpen
                ? `DOORS OPEN ${Math.ceil(drive.dwellRemainSec)}s`
                : drive.phase === 'ready'
                  ? 'APPLY POWER TO DEPART'
                  : ''}
            </span>
            <span className="font-mono text-sm font-semibold text-lemon">{drive.score}</span>
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

          <div className="flex justify-between">
            <button
              onClick={toggleCam}
              className="rounded px-2 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper"
            >
              view: {cam}
            </button>
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
