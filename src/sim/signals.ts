/**
 * Fixed-block signalling for drive mode.
 *
 * The line is cut into blocks: one for each platform (300 m either side of
 * the stop mark) and one for each running stretch between them. A signal
 * stands at the entry to every block. Occupancy is whatever trains are in
 * the driver's direction at this instant -- the timetable's, by their
 * chainage -- so the aspects are deterministic, like everything the engine
 * produces. Nothing here stops the driver; passing a red is scored.
 *
 * Blocks live in geometric metres (gM), the sim's own coordinate, so
 * "300 m" is 300 m. Trains arrive in chainage and are converted at the edge.
 */
import { stations } from '../data/network'
import { gAt } from './alignment'

export type Aspect = 'green' | 'yellow' | 'red'

export interface Block {
  fromG: number
  toG: number
  /** the station order if this is a platform block, else null */
  station: number | null
}

/** half-length of a platform block, either side of the stop mark */
const PLATFORM_HALF_M = 300
/** run-out before the first and after the last platform block */
const END_PAD_M = 60

export const BLOCKS: readonly Block[] = (() => {
  const out: Block[] = []
  const marks = stations.map((s) => gAt(s.sKm))
  let cursor = marks[0] - PLATFORM_HALF_M - END_PAD_M
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i] - PLATFORM_HALF_M
    const b = marks[i] + PLATFORM_HALF_M
    if (a > cursor) out.push({ fromG: cursor, toG: a, station: null })
    out.push({ fromG: Math.max(cursor, a), toG: b, station: stations[i].order })
    cursor = b
  }
  out.push({ fromG: cursor, toG: cursor + END_PAD_M, station: null })
  return out
})()

/** Index of the block containing a chainage. Clamped to the ends. */
export function blockAt(sKm: number): number {
  return blockAtG(gAt(sKm))
}

export function blockAtG(gM: number): number {
  let lo = 0
  let hi = BLOCKS.length - 1
  if (gM <= BLOCKS[0].fromG) return 0
  if (gM >= BLOCKS[hi].toG) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (BLOCKS[mid].fromG <= gM) lo = mid
    else hi = mid
  }
  return BLOCKS[hi].fromG <= gM ? hi : lo
}

/** Blocks occupied by the given trains travelling in `dir`. */
export function occupiedBlocks(trains: { sKm: number; dir: 0 | 1 }[], dir: 0 | 1): Set<number> {
  const out = new Set<number>()
  for (const t of trains) if (t.dir === dir) out.add(blockAt(t.sKm))
  return out
}

/** The aspect of the signal at the entry to the block after `block`, travelling in `dir`. */
export function aspectAhead(block: number, dir: 0 | 1, occupied: Set<number>): Aspect {
  const step = dir === 0 ? 1 : -1
  const next = block + step
  const after = block + 2 * step
  if (occupied.has(next)) return 'red'
  if (occupied.has(after)) return 'yellow'
  return 'green'
}

export interface SignalAhead {
  /** index of the block the signal admits into */
  block: number
  /** metres along the line where it stands */
  gM: number
  /** chainage-km from the train to it (positive ahead) */
  distKm: number
  aspect: Aspect
}

/** The next signal ahead of a train at chainage `sKm`, or null at the end of the line. */
export function signalAhead(sKm: number, dir: 0 | 1, occupied: Set<number>): SignalAhead | null {
  const gM = gAt(sKm)
  const here = blockAtG(gM)
  const step = dir === 0 ? 1 : -1
  const next = here + step
  if (next < 0 || next >= BLOCKS.length) return null
  const at = dir === 0 ? BLOCKS[next].fromG : BLOCKS[next].toG
  // distance in the sim's metres, reported as km along the line
  const distM = dir === 0 ? at - gM : gM - at
  return { block: next, gM: at, distKm: distM / 1000, aspect: aspectAhead(here, dir, occupied) }
}
