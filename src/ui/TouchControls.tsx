/**
 * Driving with a thumb: a lever you drag and the four buttons that matter.
 *
 * Shows when the pointer is coarse or the viewport is narrow (TOUCH_QUERY).
 * The lever is a vertical track with a detent per notch: drag anywhere on it
 * and the notch follows your finger, snapping to the nearest detent; the
 * handle is drawn from the store, so a key press or the cab lever moves it
 * too. Emergency is the bottom detent and its own red button.
 */
import { useRef } from 'react'
import { NOTCH_MAX, NOTCH_MIN } from '../sim/drive'
import { useDriveStore } from '../state/useDriveStore'

const NOTCHES = NOTCH_MAX - NOTCH_MIN + 1

function notchAtY(el: HTMLElement, clientY: number): number {
  const r = el.getBoundingClientRect()
  // top = full power, bottom = emergency
  const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height))
  return Math.round(NOTCH_MAX - f * (NOTCHES - 1))
}

function Lever() {
  const notch = useDriveStore((s) => s.drive?.notch ?? 0)
  const setNotch = useDriveStore((s) => s.setNotch)
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    setNotch(notchAtY(e.currentTarget, e.clientY))
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    setNotch(notchAtY(e.currentTarget, e.clientY))
  }
  const onUp = () => {
    dragging.current = false
  }
  const f = (NOTCH_MAX - notch) / (NOTCHES - 1)
  return (
    <div className="hud-panel pointer-events-auto flex flex-col items-center gap-1 px-2 py-2">
      <span className="font-display text-[9px] font-semibold tracking-widest text-kmrl">POWER</span>
      <div
        ref={track}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative h-44 w-10 touch-none select-none rounded-md bg-panel"
      >
        {Array.from({ length: NOTCHES }, (_, i) => {
          const n = NOTCH_MAX - i
          return (
            <span
              key={n}
              className={`absolute left-1/2 h-px w-5 -translate-x-1/2 ${
                n === 0 ? 'bg-paper/70' : n === NOTCH_MIN ? 'bg-pinkline' : 'bg-paper-dim/40'
              }`}
              style={{ top: `${(i / (NOTCHES - 1)) * 100}%` }}
            />
          )
        })}
        <div
          className={`absolute left-1/2 h-7 w-9 -translate-x-1/2 -translate-y-1/2 rounded-md border border-ink/40 shadow-md transition-[top] duration-100 ${
            notch > 0 ? 'bg-kmrl' : notch === NOTCH_MIN ? 'bg-pinkline' : notch < 0 ? 'bg-lemon' : 'bg-paper'
          }`}
          style={{ top: `${f * 100}%` }}
        >
          <div className="mx-auto mt-3 h-px w-5 bg-ink/40" />
        </div>
      </div>
      <span className="font-display text-[9px] font-semibold tracking-widest text-lemon">BRAKE</span>
      <span className="font-mono text-[11px] font-semibold text-paper">
        {notch === NOTCH_MIN ? 'EMERG' : notch > 0 ? `P${notch}` : notch < 0 ? `B${-notch}` : 'N'}
      </span>
    </div>
  )
}

export function TouchControls() {
  const drive = useDriveStore((s) => s.drive)
  const doors = useDriveStore((s) => s.doors)
  const horn = useDriveStore((s) => s.horn)
  const emergency = useDriveStore((s) => s.emergency)
  const cycleView = useDriveStore((s) => s.cycleView)
  if (!drive || drive.phase === 'done' || drive.phase === 'derailed') return null
  const btn = 'pointer-events-auto rounded-md px-3 py-2 font-display text-xs font-bold select-none touch-none'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
      <Lever />
      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={() => cycleView(1)} className={`${btn} hud-panel text-paper`}>
          CAM
        </button>
        <button onClick={horn} className={`${btn} hud-panel text-paper`}>
          HORN
        </button>
        <button
          onClick={doors}
          className={`${btn} ${drive.doorsOpen ? 'bg-lemon text-ink' : 'hud-panel text-paper'}`}
        >
          DOORS
        </button>
        <button onClick={emergency} className={`${btn} bg-pinkline text-paper`}>
          E-STOP
        </button>
      </div>
    </div>
  )
}
