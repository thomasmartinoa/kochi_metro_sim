/**
 * The ghost and the leaderboard: racing yourself without a server.
 *
 * A run is summarised two ways. The **tape** is where the train was along
 * the line at each moment of the run's own clock (runS, seconds since first
 * power), sampled every SAMPLE_S; the best-scoring tape per direction is the
 * ghost the next run races against, posed on the same rail from `gM` alone.
 * The **record** is one line of the leaderboard: score, grade, how the stops
 * went, and how it ended.
 *
 * Pure: recording, interpolation and the (de)serialisation of what goes to
 * localStorage live here; the browser side is src/state/runHistory.ts.
 */

export interface GhostSample {
  /** seconds since first power */
  t: number
  /** metres along the drawn line */
  gM: number
}

export interface GhostTape {
  dir: 0 | 1
  score: number
  /** epoch ms when the run ended */
  at: number
  samples: GhostSample[]
}

export interface RunRecord {
  /** epoch ms when the run ended */
  at: number
  dir: 0 | 1
  score: number
  grade: string
  /** stops made, and how many were on the mark and on time */
  stops: number
  goodStops: number
  onTime: number
  outcome: 'done' | 'derailed'
  /** seconds since first power when it ended */
  durationS: number
}

/** seconds between ghost samples; a 40-minute run is ~5000 samples */
export const SAMPLE_S = 0.5
/** leaderboard length */
export const LEADERBOARD_N = 20
/** a stop is "on time" within this many seconds of the schedule */
export const ON_TIME_S = 30

export class GhostRecorder {
  readonly samples: GhostSample[] = []
  private lastT = -Infinity

  /** Add the train's place at this moment; ignored until SAMPLE_S has passed. */
  push(t: number, gM: number): void {
    // a run's clock never runs backwards; a smaller t is a new run
    if (t < this.lastT) this.samples.length = 0
    else if (t - this.lastT < SAMPLE_S) return
    this.samples.push({ t, gM })
    this.lastT = t
  }

  reset(): void {
    this.samples.length = 0
    this.lastT = -Infinity
  }
}

/**
 * Where the ghost is at t seconds into its run: linear between samples,
 * held at the ends. Null for an empty tape.
 */
export function ghostGAt(samples: readonly GhostSample[], t: number): number | null {
  const n = samples.length
  if (n === 0) return null
  if (t <= samples[0].t) return samples[0].gM
  if (t >= samples[n - 1].t) return samples[n - 1].gM
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
  return a.gM + (b.gM - a.gM) * f
}

/** True when `score` beats the tape on file (or there is none). */
export function beatsBest(best: GhostTape | null | undefined, score: number): boolean {
  return !best || score > best.score
}

/** Newest first, capped at LEADERBOARD_N. */
export function addRecord(records: readonly RunRecord[], rec: RunRecord): RunRecord[] {
  return [rec, ...records].sort((a, b) => b.at - a.at).slice(0, LEADERBOARD_N)
}

// --- storage format -------------------------------------------------------

export interface RunHistory {
  v: 1
  records: RunRecord[]
  /** best tape per direction */
  best: { 0: GhostTape | null; 1: GhostTape | null }
}

export function emptyHistory(): RunHistory {
  return { v: 1, records: [], best: { 0: null, 1: null } }
}

/** Parse what was stored; anything unexpected yields an empty history. */
export function parseHistory(text: string | null | undefined): RunHistory {
  if (!text) return emptyHistory()
  try {
    const h = JSON.parse(text) as Partial<RunHistory>
    if (!h || h.v !== 1 || !Array.isArray(h.records) || !h.best) return emptyHistory()
    const tape = (t: unknown): GhostTape | null => {
      const g = t as GhostTape | null
      if (!g || !Array.isArray(g.samples) || typeof g.score !== 'number') return null
      return g
    }
    return {
      v: 1,
      records: h.records.filter((r) => r && typeof r.score === 'number' && typeof r.at === 'number'),
      best: { 0: tape(h.best[0]), 1: tape(h.best[1]) },
    }
  } catch {
    return emptyHistory()
  }
}

export function serializeHistory(h: RunHistory): string {
  return JSON.stringify(h)
}
