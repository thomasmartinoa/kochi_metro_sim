import { describe, expect, it } from 'vitest'
import { delayedTrainStates, headwayStats, serviceQuality } from './dispatch'
import { liveTrainStates } from './engine'

// Wednesday 09:00 IST — busy morning service
const EPOCH = Date.parse('2026-07-08T09:00:00+05:30')

describe('dispatch overlay', () => {
  it('with no delays matches the live schedule', () => {
    const a = liveTrainStates(EPOCH)
    const b = delayedTrainStates(EPOCH, {})
    expect(b.map((s) => s.tripId).sort()).toEqual(a.map((s) => s.tripId).sort())
  })

  it('a delayed trip runs behind its schedule', () => {
    const base = liveTrainStates(EPOCH)
    const victim = base.find((s) => s.phase === 'run' && s.dir === 0)!
    const delayed = delayedTrainStates(EPOCH, { [victim.tripId]: 120 })
    const after = delayed.find((s) => s.tripId === victim.tripId)!
    // dir 0 moves toward increasing sKm, so 2 min of delay puts it further back
    expect(after.sKm).toBeLessThan(victim.sKm)
  })

  it('headway stats detect bunching', () => {
    const even = headwayStats(
      [2, 6, 10, 14, 18, 22].map((sKm) => ({ sKm, dir: 0 as const }) as never),
      0,
    )
    const bunched = headwayStats(
      [2, 2.5, 3, 14, 18, 22].map((sKm) => ({ sKm, dir: 0 as const }) as never),
      0,
    )
    expect(even.cv).toBeLessThan(0.05)
    expect(bunched.cv).toBeGreaterThan(even.cv + 0.3)
  })

  it('service quality drops with uneven gaps and delay', () => {
    expect(serviceQuality(0.05, 0.05, 0)).toBeGreaterThan(90)
    expect(serviceQuality(0.6, 0.6, 600)).toBeLessThan(40)
  })
})
