import { describe, expect, it } from 'vitest'
import {
  addRecord,
  beatsBest,
  emptyHistory,
  ghostGAt,
  GhostRecorder,
  LEADERBOARD_N,
  parseHistory,
  SAMPLE_S,
  serializeHistory,
  type RunRecord,
} from './ghost'

const rec = (at: number, score = 100): RunRecord => ({
  at,
  dir: 0,
  score,
  grade: 'B',
  stops: 3,
  goodStops: 2,
  onTime: 1,
  outcome: 'done',
  durationS: 300,
})

describe('ghost tape', () => {
  it('samples no closer than SAMPLE_S and starts over when the clock restarts', () => {
    const r = new GhostRecorder()
    for (let t = 0; t < 2; t += 0.1) r.push(t, t * 10)
    expect(r.samples.length).toBe(Math.floor(2 / SAMPLE_S))
    expect(r.samples[1].t).toBeCloseTo(SAMPLE_S, 5)
    r.push(0, 0) // a new run
    expect(r.samples).toEqual([{ t: 0, gM: 0 }])
  })

  it('interpolates between samples and holds at the ends', () => {
    const tape = [
      { t: 0, gM: 100 },
      { t: 1, gM: 110 },
      { t: 3, gM: 150 },
    ]
    expect(ghostGAt(tape, -5)).toBe(100)
    expect(ghostGAt(tape, 0.5)).toBeCloseTo(105)
    expect(ghostGAt(tape, 2)).toBeCloseTo(130)
    expect(ghostGAt(tape, 99)).toBe(150)
    expect(ghostGAt([], 1)).toBeNull()
  })

  it('a better score replaces the best; a worse one does not', () => {
    const best = { dir: 0 as const, score: 500, at: 1, samples: [] }
    expect(beatsBest(null, 1)).toBe(true)
    expect(beatsBest(best, 501)).toBe(true)
    expect(beatsBest(best, 500)).toBe(false)
  })
})

describe('leaderboard', () => {
  it('keeps the newest LEADERBOARD_N runs, newest first', () => {
    let records: RunRecord[] = []
    for (let i = 0; i < LEADERBOARD_N + 5; i++) records = addRecord(records, rec(i))
    expect(records.length).toBe(LEADERBOARD_N)
    expect(records[0].at).toBe(LEADERBOARD_N + 4)
    expect(records[LEADERBOARD_N - 1].at).toBe(5)
  })

  it('round-trips through storage and shrugs off junk', () => {
    const h = emptyHistory()
    h.records = [rec(1)]
    h.best[1] = { dir: 1, score: 42, at: 1, samples: [{ t: 0, gM: 1 }] }
    const back = parseHistory(serializeHistory(h))
    expect(back).toEqual(h)
    expect(parseHistory(null)).toEqual(emptyHistory())
    expect(parseHistory('not json')).toEqual(emptyHistory())
    expect(parseHistory('{"v":7}')).toEqual(emptyHistory())
    expect(parseHistory('{"v":1,"records":[{"score":"x"}],"best":{"0":{"score":1},"1":null}}')).toEqual(
      emptyHistory(),
    )
  })
})
