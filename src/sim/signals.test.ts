import { describe, expect, it } from 'vitest'
import { stations } from '../data/network'
import {
  aspectAhead,
  blockAt,
  BLOCKS,
  occupiedBlocks,
  signalAhead,
  type Aspect,
} from './signals'

describe('blocks', () => {
  it('divides the line into blocks split 300 m either side of each platform, in order', () => {
    expect(BLOCKS.length).toBeGreaterThan(stations.length)
    for (let i = 1; i < BLOCKS.length; i++) {
      expect(BLOCKS[i].fromG).toBeCloseTo(BLOCKS[i - 1].toG, 6)
      expect(BLOCKS[i].toG).toBeGreaterThan(BLOCKS[i].fromG)
    }
    // every station sits inside a block of its own (its platform block)
    for (const s of stations) {
      const b = BLOCKS[blockAt(s.sKm)]
      expect(b.station).toBe(s.order)
    }
  })

  it('maps a chainage to the block containing it', () => {
    const i = blockAt(stations[5].sKm)
    expect(BLOCKS[i].station).toBe(5)
    // just past the platform block's end: the running block toward station 6
    const j = blockAt(stations[5].sKm + 0.5)
    expect(j).toBeGreaterThan(i)
    expect(BLOCKS[j].station).toBeNull()
  })
})

describe('aspects', () => {
  it('green with two clear blocks ahead, yellow with one, red with none', () => {
    const at = 10
    const occ = (blocks: number[]) => new Set(blocks)
    expect(aspectAhead(at, 0, occ([]))).toBe<Aspect>('green')
    expect(aspectAhead(at, 0, occ([at + 2]))).toBe<Aspect>('yellow')
    expect(aspectAhead(at, 0, occ([at + 1]))).toBe<Aspect>('red')
    // the down direction looks the other way
    expect(aspectAhead(at, 1, occ([at - 1]))).toBe<Aspect>('red')
    expect(aspectAhead(at, 1, occ([at + 1]))).toBe<Aspect>('green')
  })

  it('occupancy comes from the scheduled trains in the same direction, by their chainage', () => {
    const occ = occupiedBlocks(
      [
        { sKm: stations[3].sKm, dir: 0 },
        { sKm: stations[7].sKm, dir: 1 }, // other direction: ignored
      ],
      0,
    )
    expect(occ.has(blockAt(stations[3].sKm))).toBe(true)
    expect(occ.has(blockAt(stations[7].sKm))).toBe(false)
  })

  it('reports the next signal ahead: its block entry, distance and aspect', () => {
    // player mid-way between station 4 and 5, up direction, a train sitting at station 5
    const gPlayer = (stations[4].sKm + stations[5].sKm) / 2
    const occ = occupiedBlocks([{ sKm: stations[5].sKm, dir: 0 }], 0)
    const sig = signalAhead(gPlayer, 0, occ)
    expect(sig).not.toBeNull()
    expect(sig!.distKm).toBeGreaterThan(0)
    expect(sig!.distKm).toBeLessThan(stations[5].sKm - gPlayer)
    // the signal guards entry to the platform block, which is occupied: red
    expect(sig!.aspect).toBe<Aspect>('red')
  })
})
