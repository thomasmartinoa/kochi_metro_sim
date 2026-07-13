import { describe, expect, it } from 'vitest'
import {
  boatStatesAt,
  liveBoatStates,
  planWaterJourneyAt,
  terminalDeparturesAt,
  terminals,
  waterFare,
  waterRoutes,
  waterServiceStatusAt,
} from './waterEngine'

const istEpoch = (h: number, m = 0) =>
  Date.parse(`2026-07-08T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`)

const termIdx = (id: string) => terminals.findIndex((t) => t.id === id)

describe('water data', () => {
  it('has 11 terminals and 4 routes', () => {
    expect(terminals).toHaveLength(11)
    expect(waterRoutes.map((r) => r.id)).toEqual(['W1', 'W2', 'W3', 'W4'])
  })

  it('route path distances are monotonic and lengths sane', () => {
    const bounds: Record<string, [number, number]> = {
      W1: [1, 2.5],
      W2: [5, 9],
      W3: [12, 21],
      W4: [8, 13],
    }
    for (const r of waterRoutes) {
      for (let i = 1; i < r.path.length; i++) {
        expect(r.path[i][2]).toBeGreaterThanOrEqual(r.path[i - 1][2])
      }
      const [lo, hi] = bounds[r.id]
      expect(r.lengthKm).toBeGreaterThan(lo)
      expect(r.lengthKm).toBeLessThan(hi)
    }
  })

  it('trip stop times are monotonic and stops lie on the route', () => {
    for (const r of waterRoutes) {
      const stopTerms = new Set(r.stops.map((s) => s.term))
      for (const trip of r.trips) {
        let prev = -1
        for (const [term, arr, dep] of trip.stops) {
          expect(stopTerms.has(term)).toBe(true)
          expect(arr).toBeGreaterThan(prev)
          expect(dep).toBeGreaterThanOrEqual(arr)
          prev = dep
        }
      }
    }
  })
})

describe('water engine', () => {
  it('no boats sail at 04:00', () => {
    expect(boatStatesAt(4 * 3600)).toHaveLength(0)
  })

  it('a realistic fleet is out at 09:00', () => {
    const states = boatStatesAt(9 * 3600)
    expect(states.length).toBeGreaterThanOrEqual(4)
    expect(states.length).toBeLessThanOrEqual(20)
    for (const s of states) {
      const r = waterRoutes.find((x) => x.id === s.routeId)!
      expect(s.sKm).toBeGreaterThanOrEqual(0)
      expect(s.sKm).toBeLessThanOrEqual(r.lengthKm + 0.01)
      expect(s.speedKmh).toBeLessThan(25)
    }
  })

  it('liveBoatStates maps epoch to IST day seconds', () => {
    expect(liveBoatStates(istEpoch(9)).length).toBeGreaterThan(0)
    expect(liveBoatStates(istEpoch(3)).length).toBe(0)
  })

  it('fares follow the published bands', () => {
    expect(waterFare(6 * 60)).toBe(20)
    expect(waterFare(25 * 60)).toBe(30)
    expect(waterFare(45 * 60)).toBe(40)
  })

  it('plans High Court -> Vypin for Rs.20', () => {
    const j = planWaterJourneyAt(istEpoch(9), termIdx('HICT'), termIdx('VYPN'))!
    expect(j).not.toBeNull()
    expect(j.routeId).toBe('W1')
    expect(j.fare).toBe(20)
    expect(j.arriveSec).toBeGreaterThan(j.departSec)
  })

  it('plans Vyttila -> Kakkanad on W2', () => {
    const j = planWaterJourneyAt(istEpoch(9), termIdx('VYTL'), termIdx('KKND'))!
    expect(j.routeId).toBe('W2')
    expect(j.fare).toBe(30)
  })

  it('returns null for terminals not joined by one route', () => {
    expect(planWaterJourneyAt(istEpoch(9), termIdx('VYPN'), termIdx('KKND'))).toBeNull()
  })

  it('lists sorted upcoming departures at High Court', () => {
    const deps = terminalDeparturesAt(istEpoch(9), termIdx('HICT'))
    expect(deps.length).toBeGreaterThan(0)
    for (let i = 1; i < deps.length; i++) {
      expect(deps[i].depSec).toBeGreaterThanOrEqual(deps[i - 1].depSec)
    }
    // W1 peak headway ~15 min: next Vypin boat within 20 min
    const w1 = deps.find((d) => d.routeId === 'W1')
    expect(w1).toBeDefined()
    expect(w1!.inSec).toBeLessThan(21 * 60)
  })

  it('reports closed service with next sailing overnight', () => {
    const s = waterServiceStatusAt(istEpoch(2))
    expect(s.open).toBe(false)
    expect(s.nextSailSec).toBeDefined()
    expect(s.nextSailSec! / 3600).toBeGreaterThanOrEqual(6)
  })
})
