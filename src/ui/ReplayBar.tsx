/**
 * Replay controls over the crash tape: play/pause, scrub, speed, camera.
 * The tape itself lives in scene/drive/replay; this only moves its head.
 */
import { useEffect, useState } from 'react'
import { VIEW_LABEL } from '../sim/driveCameras'
import { REPLAY_CAMS, useDriveStore } from '../state/useDriveStore'
import { replay } from '../scene/drive/replay'

const RATES = [0.25, 0.5, 1] as const

export function ReplayBar() {
  const leave = useDriveStore((s) => s.leaveReplay)
  const cam = useDriveStore((s) => s.replayCam)
  const setCam = useDriveStore((s) => s.setReplayCam)
  // the head moves outside React; poll it for the scrubber
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])
  const start = replay.buffer.first?.t ?? 0
  const end = replay.buffer.last?.t ?? 0
  const at = replay.head - start
  const len = Math.max(0.001, end - start)

  return (
    <div className="hud-panel pointer-events-auto flex w-[min(92vw,40rem)] flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (!replay.playing && replay.head >= end) replay.head = start
            replay.playing = !replay.playing
          }}
          className="rounded-md bg-kmrl px-3 py-1 font-display text-xs font-semibold text-ink"
        >
          {replay.playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          className="scrubber w-full"
          min={0}
          max={len}
          step={0.05}
          value={at}
          onChange={(e) => {
            replay.head = start + +e.target.value
            replay.playing = false
          }}
          aria-label="Replay position"
        />
        <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-paper-dim">
          {at.toFixed(1)} / {len.toFixed(1)} s
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {RATES.map((r) => (
            <button
              key={r}
              onClick={() => {
                replay.rate = r
              }}
              className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                replay.rate === r ? 'bg-kmrl text-ink' : 'text-paper-dim hover:bg-panel hover:text-paper'
              }`}
            >
              {r}×
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {REPLAY_CAMS.map((c) => (
            <button
              key={c}
              onClick={() => setCam(c)}
              className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                cam === c ? 'bg-kmrl text-ink' : 'text-paper-dim hover:bg-panel hover:text-paper'
              }`}
            >
              {VIEW_LABEL[c]}
            </button>
          ))}
        </div>
        <button
          onClick={leave}
          className="rounded px-2 py-0.5 font-mono text-[11px] text-paper-dim hover:bg-panel hover:text-paper"
        >
          back to the wreck
        </button>
      </div>
    </div>
  )
}
