/**
 * The last few seconds of a drive, for the crash replay.
 *
 * Records what the scene drew — the three cars' world transforms, the speed,
 * notch and doors — so a replay is playback of what happened, never a second
 * simulation. That is what makes it deterministic and cheap: the wreck's
 * rigid-body poses go in like any other frame, and the replay just draws
 * them again.
 *
 * A ring over a window of WINDOW seconds while driving. On a derail the
 * caller freezes it (the pre-crash window is now fixed) and extends it for
 * the dynamic phase, which is appended without evicting anything, then
 * freezes it again. Pure: no three, no React.
 */

export interface CarTransform {
  /** world position */
  p: [number, number, number]
  /** world quaternion, xyzw */
  q: [number, number, number, number]
}

export interface ReplayFrame {
  /** seconds on the replay's own clock */
  t: number
  cars: [CarTransform, CarTransform, CarTransform]
  speedKmh: number
  notch: number
  doorsOpen: boolean
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f

function slerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  f: number,
): [number, number, number, number] {
  // shortest arc; nlerp is plenty at replay frame spacing
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const s = dot < 0 ? -1 : 1
  dot *= s
  const x = lerp(a[0], b[0] * s, f)
  const y = lerp(a[1], b[1] * s, f)
  const z = lerp(a[2], b[2] * s, f)
  const w = lerp(a[3], b[3] * s, f)
  const n = Math.hypot(x, y, z, w) || 1
  return [x / n, y / n, z / n, w / n]
}

export class ReplayBuffer {
  private frames: ReplayFrame[] = []
  private frozen = false
  /** while extending, frames are appended without eviction */
  private extending = false
  private lastPushT = -Infinity

  /** seconds kept while recording */
  readonly windowS: number
  /** at most this many frames per second are kept */
  readonly rateHz: number

  constructor(windowS = 15, rateHz = 30) {
    this.windowS = windowS
    this.rateHz = rateHz
  }

  get length(): number {
    return this.frames.length
  }
  get first(): ReplayFrame | null {
    return this.frames[0] ?? null
  }
  get last(): ReplayFrame | null {
    return this.frames[this.frames.length - 1] ?? null
  }
  get durationS(): number {
    return this.frames.length ? this.last!.t - this.first!.t : 0
  }
  get isFrozen(): boolean {
    return this.frozen
  }

  push(f: ReplayFrame): void {
    if (this.frozen) return
    if (f.t - this.lastPushT < 1 / this.rateHz - 1e-9) return
    this.lastPushT = f.t
    this.frames.push(f)
    if (!this.extending) {
      const cutoff = f.t - this.windowS
      while (this.frames.length > 1 && this.frames[0].t < cutoff) this.frames.shift()
    }
  }

  /** Stop recording; the frames are now the replay. */
  freeze(): void {
    this.frozen = true
    this.extending = false
  }

  /** Resume recording after a freeze, appending without evicting the window. */
  extend(): void {
    this.frozen = false
    this.extending = true
  }

  reset(): void {
    this.frames = []
    this.frozen = false
    this.extending = false
    this.lastPushT = -Infinity
  }

  /** The frame at replay time t, interpolated; clamped to the recorded range. */
  sampleAt(t: number): ReplayFrame | null {
    const fr = this.frames
    if (!fr.length) return null
    if (t <= fr[0].t) return fr[0]
    if (t >= fr[fr.length - 1].t) return fr[fr.length - 1]
    let lo = 0
    let hi = fr.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (fr[mid].t <= t) lo = mid
      else hi = mid
    }
    const a = fr[lo]
    const b = fr[hi]
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
    return {
      t,
      cars: [0, 1, 2].map((i) => ({
        p: [lerp(a.cars[i].p[0], b.cars[i].p[0], f), lerp(a.cars[i].p[1], b.cars[i].p[1], f), lerp(a.cars[i].p[2], b.cars[i].p[2], f)],
        q: slerp(a.cars[i].q, b.cars[i].q, f),
      })) as ReplayFrame['cars'],
      speedKmh: lerp(a.speedKmh, b.speedKmh, f),
      notch: f < 0.5 ? a.notch : b.notch,
      doorsOpen: f < 0.5 ? a.doorsOpen : b.doorsOpen,
    }
  }
}
