import { describe, expect, it } from 'vitest'
import { fareById, fareByOrder } from '../data/fares'
import { stations, trips } from '../data/network'
import { istDayTime, serviceForDow } from './clock'
import {
  departuresFrom,
  planJourney,
  serviceStatusAt,
  trainStatesAt,
  tripStateAt,
} from './engine'

/** UTC epoch ms for a given IST clock time on a fixed reference day. */
function istEpoch(dow: 'wed' | 'sun', h: number, m = 0): number {
  // 2026-07-08 is a Wednesday, 2026-07-12 a Sunday
  const date = dow === 'wed' ? '2026-07-08' : '2026-07-12'
  return Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`)
}

describe('data layer', () => {
  it('has all 25 Blue Line stations in order', () => {
    expect(stations).toHaveLength(25)
    expect(stations[0].id).toBe('ALVA')
    expect(stations[24].id).toBe('TPHT')
    for (let i = 1; i < stations.length; i++) {
      expect(stations[i].sKm).toBeGreaterThan(stations[i - 1].sKm)
    }
  })

  it('has Malayalam names from translations', () => {
    expect(stations[0].nameMl).toBe('ആലുവ')
  })

  it('fares match the KMRL chart', () => {
    expect(fareById('ALVA', 'TPHT')).toBe(60)
    expect(fareById('TPHT', 'ALVA')).toBe(60)
    expect(fareById('ALVA', 'PNCU')).toBe(10) // adjacent
    expect(fareByOrder(0, 0)).toBe(0)
    // symmetric matrix
    for (let o = 0; o < 25; o += 6)
      for (let d = 0; d < 25; d += 6) expect(fareByOrder(o, d)).toBe(fareByOrder(d, o))
  })
})

describe('clock', () => {
  it('converts UTC epoch to IST day time and day-of-week', () => {
    const { daySec, dow } = istDayTime(istEpoch('wed', 8, 30))
    expect(daySec).toBe(8.5 * 3600)
    expect(dow).toBe(3) // Wednesday
    expect(serviceForDow(dow)).toBe('WK')
    expect(serviceForDow(istDayTime(istEpoch('sun', 9)).dow)).toBe('WE')
  })
})

describe('engine', () => {
  it('a train dwells exactly at its scheduled station', () => {
    const trip = trips.find((t) => t.service === 'WK' && t.stops.length === 25)!
    const [order, arr, dep] = trip.stops[5]
    const mid = (arr + dep) / 2
    const st = tripStateAt(trip, mid)!
    expect(st.phase).toBe('dwell')
    expect(st.doorsOpen).toBe(true)
    expect(st.sKm).toBeCloseTo(stations[order].sKm, 5)
  })

  it('interpolates between stations while running', () => {
    const trip = trips.find((t) => t.service === 'WK' && t.dir === 0 && t.stops.length === 25)!
    const [aOrder, , aDep] = trip.stops[3]
    const [bOrder, bArr] = trip.stops[4]
    const st = tripStateAt(trip, (aDep + bArr) / 2)!
    expect(st.phase).toBe('run')
    expect(st.sKm).toBeGreaterThan(stations[aOrder].sKm)
    expect(st.sKm).toBeLessThan(stations[bOrder].sKm)
    expect(st.speedKmh).toBeGreaterThan(20)
    expect(st.speedKmh).toBeLessThan(90) // never above line limit + easing overshoot
  })

  it('peak weekday morning has a realistic active fleet in both directions', () => {
    const states = trainStatesAt(8.5 * 3600, 'WK')
    expect(states.length).toBeGreaterThanOrEqual(8)
    expect(states.length).toBeLessThanOrEqual(22)
    expect(states.some((s) => s.dir === 0)).toBe(true)
    expect(states.some((s) => s.dir === 1)).toBe(true)
    for (const s of states) {
      expect(s.sKm).toBeGreaterThanOrEqual(0)
      expect(s.sKm).toBeLessThanOrEqual(28.8)
    }
  })

  it('end-to-end scheduled run is ~54 minutes', () => {
    const trip = trips.find((t) => t.service === 'WK' && t.stops.length === 25)!
    const dur = (trip.stops[24][1] - trip.stops[0][2]) / 60
    expect(dur).toBeGreaterThan(48)
    expect(dur).toBeLessThan(60)
  })

  it('service is closed at 03:00 with next train at opening', () => {
    const status = serviceStatusAt(istEpoch('wed', 3))
    expect(status.open).toBe(false)
    expect(status.nextTrainSec).toBeDefined()
    expect(status.nextTrainSec! / 3600).toBeGreaterThanOrEqual(4.5)
    expect(status.nextTrainSec! / 3600).toBeLessThanOrEqual(7)
  })

  it('service is open on a weekday morning', () => {
    expect(serviceStatusAt(istEpoch('wed', 9)).open).toBe(true)
  })

  it('plans a full-line journey from the real timetable', () => {
    const j = planJourney(0, 24, 8 * 3600, 'WK')!
    expect(j).not.toBeNull()
    expect(j.departSec).toBeGreaterThanOrEqual(8 * 3600)
    const durMin = (j.arriveSec - j.departSec) / 60
    expect(durMin).toBeGreaterThan(45)
    expect(durMin).toBeLessThan(62)
  })

  it('lists sorted upcoming departures from M.G. Road', () => {
    const mg = stations.find((s) => s.name.includes('MG') || s.name.includes('M.G'))!
    const deps = departuresFrom(mg.order, 9 * 3600, 'WK')
    expect(deps.length).toBeGreaterThan(0)
    for (let i = 1; i < deps.length; i++) expect(deps[i].depSec).toBeGreaterThanOrEqual(deps[i - 1].depSec)
    expect(deps.some((d) => d.dir === 0) || deps.some((d) => d.dir === 1)).toBe(true)
  })

  it('peak headway between consecutive same-direction departures is ~6-10 min', () => {
    const deps = departuresFrom(12, 9 * 3600, 'WK', 6).filter((d) => d.dir === 0)
    expect(deps.length).toBeGreaterThanOrEqual(2)
    const gapMin = (deps[1].depSec - deps[0].depSec) / 60
    expect(gapMin).toBeGreaterThan(3)
    expect(gapMin).toBeLessThan(14)
  })
})
