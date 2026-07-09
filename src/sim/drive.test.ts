import { describe, expect, it } from 'vitest'
import { stations } from '../data/network'
import {
  brakingDistanceM,
  grade,
  newDrive,
  setNotch,
  stepDrive,
  type DriveState,
} from './drive'

function run(st: DriveState, seconds: number, dt = 0.05): DriveState {
  let s = st
  for (let t = 0; t < seconds; t += dt) s = stepDrive(s, dt)
  return s
}

describe('drive physics', () => {
  it('stays ready until first power notch', () => {
    let st = newDrive(0)
    st = run(st, 5)
    expect(st.phase).toBe('ready')
    expect(st.sKm).toBeCloseTo(stations[0].sKm, 5)
  })

  it('accelerates under power and moves toward the next station', () => {
    let st = setNotch(newDrive(0), 4)
    st = run(st, 20)
    expect(st.phase).toBe('run')
    expect(st.vMs).toBeGreaterThan(10)
    expect(st.sKm).toBeGreaterThan(stations[0].sKm)
  })

  it('caps at the penalty brake even when power is held', () => {
    let st = setNotch(newDrive(0), 4)
    for (let t = 0; t < 120; t += 0.05) {
      st = setNotch(st, 4) // driver keeps demanding full power
      st = stepDrive(st, 0.05)
      expect(st.vMs * 3.6).toBeLessThan(86)
    }
    expect(st.vMs * 3.6).toBeGreaterThan(30) // still rolling, not parked
  })

  it('scores a stop at the station mark', () => {
    let st = setNotch(newDrive(0), 4)
    // drive most of the way to Pulinchodu (1.76 km leg), then brake to a stop on the mark
    const target = stations[1].sKm
    let guard = 0
    while (st.phase === 'run' || st.phase === 'ready') {
      const distM = (target - st.sKm) * 1000
      const need = brakingDistanceM(st.vMs)
      st = setNotch(st, distM <= need + 2 ? -4 : 4)
      st = stepDrive(st, 0.05)
      if (++guard > 20000) break
    }
    expect(st.phase).toBe('dwell')
    expect(st.stops).toHaveLength(1)
    expect(Math.abs(st.stops[0].errM)).toBeLessThan(5)
    expect(st.score).toBeGreaterThan(0)
    expect(st.nextStopOrder).toBe(2)
  })

  it('penalises passing a station without stopping', () => {
    let st = setNotch(newDrive(0), 4)
    for (let t = 0; t < 180 && !st.stops.length; t += 0.05) {
      st = setNotch(st, 4) // driver holds power straight through Pulinchodu
      st = stepDrive(st, 0.05)
    }
    expect(st.stops.some((s) => s.label === 'MISSED')).toBe(true)
    expect(st.score).toBeLessThan(0)
  })

  it('grades a run', () => {
    expect(grade(300 * 24, 24)).toMatch(/^S/)
    expect(grade(0, 24)).toMatch(/^D/)
  })

  it('down direction decreases sKm', () => {
    let st = setNotch(newDrive(1), 4)
    st = run(st, 15)
    expect(st.sKm).toBeLessThan(stations[stations.length - 1].sKm)
    expect(st.nextStopOrder).toBe(stations.length - 2)
  })
})
