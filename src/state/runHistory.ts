/**
 * The runs you have driven, kept in this browser: the leaderboard and the
 * best tape per direction that the ghost plays back (src/sim/ghost.ts).
 */
import { create } from 'zustand'
import {
  addRecord,
  beatsBest,
  emptyHistory,
  parseHistory,
  serializeHistory,
  type GhostTape,
  type RunHistory,
  type RunRecord,
} from '../sim/ghost'

const KEY = 'kochi-metro:drive-runs'

function load(): RunHistory {
  try {
    return parseHistory(localStorage.getItem(KEY))
  } catch {
    return emptyHistory()
  }
}

function save(h: RunHistory): void {
  try {
    localStorage.setItem(KEY, serializeHistory(h))
  } catch {
    // private mode, full, or no storage: the run is still scored on screen
  }
}

interface RunHistoryStore {
  history: RunHistory
  /** Add a finished run; a completed run's tape replaces the direction's best if it scored higher. Returns whether it did. */
  record: (rec: RunRecord, tape: GhostTape) => boolean
  clear: () => void
}

export const useRunHistory = create<RunHistoryStore>((set, get) => ({
  history: load(),
  record: (rec, tape) => {
    const h = get().history
    // only a run that made it to the end can be the ghost: a crashed tape
    // would stop at the crash site and sit there
    const best = rec.outcome === 'done' && beatsBest(h.best[rec.dir], rec.score)
    const next: RunHistory = {
      v: 1,
      records: addRecord(h.records, rec),
      best: { ...h.best, [rec.dir]: best ? tape : h.best[rec.dir] },
    }
    save(next)
    set({ history: next })
    return best
  },
  clear: () => {
    const next = emptyHistory()
    save(next)
    set({ history: next })
  },
}))
