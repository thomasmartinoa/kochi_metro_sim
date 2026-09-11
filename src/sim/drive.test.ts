import { describe, expect, it } from 'vitest'
import { stations } from '../data/network'
import {
  brakingDistanceM,
  grade,
  newDrive,
  setNotch,
  stepDrive,
  type DriveEnv,
  type DriveState,
} from './drive'

/** Straight, flat synthetic line: 1 chainage-km is exactly 1000 m, no curves. */
const STRAIGHT: DriveEnv = {
  gAt: (s) => s * 1000,
  sAtG: (g) => g / 1000,
  curvatureAtG: () => 0,
  bufferG: [-60, stations[stations.length - 1].sKm * 1000 + 60],
}

function run(st: DriveState, seconds: number, env: DriveEnv = STRAIGHT, dt = 0.05): DriveState {
  let s = st
  for (let t = 0; t < seconds; t += dt) s = stepDrive(s, dt, env)
  return s
}

describe('drive physics', () => {
  it('moves in real metres: full power from rest covers ~½at² along the drawn line', () => {
    const start = newDrive(0, STRAIGHT)
    let st = setNotch(start, 4)
    st = run(st, 10)
    // a = 1.0 m/s² at notch 4, minus a little drag: 45-50 m in 10 s
    const travelled = st.gM - start.gM
    expect(travelled).toBeGreaterThan(44)
    expect(travelled).toBeLessThan(50)
    // chainage follows the environment's mapping
    expect(st.sKm).toBeCloseTo(st.gM / 1000, 6)
  })

  it('stays ready until first power notch', () => {
    let st = newDrive(0, STRAIGHT)
    st = run(st, 5)
    expect(st.phase).toBe('ready')
    expect(st.sKm).toBeCloseTo(stations[0].sKm, 5)
  })

  it('accelerates under power and moves toward the next station', () => {
    let st = setNotch(newDrive(0, STRAIGHT), 4)
    st = run(st, 20)
    expect(st.phase).toBe('run')
    expect(st.vMs).toBeGreaterThan(10)
    expect(st.sKm).toBeGreaterThan(stations[0].sKm)
  })

  it('caps at the penalty brake even when power is held', () => {
    let st = setNotch(newDrive(0, STRAIGHT), 4)
    for (let t = 0; t < 120; t += 0.05) {
      st = setNotch(st, 4) // driver keeps demanding full power
      st = stepDrive(st, 0.05, STRAIGHT)
      expect(st.vMs * 3.6).toBeLessThan(86)
    }
    expect(st.vMs * 3.6).toBeGreaterThan(30) // still rolling, not parked
  })

  it('scores a stop at the station mark', () => {
    let st = setNotch(newDrive(0, STRAIGHT), 4)
    // drive most of the way to Pulinchodu (1.76 km leg), then brake to a stop on the mark
    let guard = 0
    while (st.phase === 'run' || st.phase === 'ready') {
      const need = brakingDistanceM(st.vMs)
      st = setNotch(st, st.distToNextM <= need + 2 && st.phase === 'run' ? -4 : 4)
      st = stepDrive(st, 0.05, STRAIGHT)
      if (++guard > 20000) break
    }
    expect(st.phase).toBe('dwell')
    expect(st.stops).toHaveLength(1)
    expect(Math.abs(st.stops[0].errM)).toBeLessThan(5)
    expect(st.score).toBeGreaterThan(0)
    expect(st.nextStopOrder).toBe(2)
  })

  it('penalises passing a station without stopping', () => {
    let st = setNotch(newDrive(0, STRAIGHT), 4)
    for (let t = 0; t < 180 && !st.stops.length; t += 0.05) {
      st = setNotch(st, 4) // driver holds power straight through Pulinchodu
      st = stepDrive(st, 0.05, STRAIGHT)
    }
    expect(st.stops.some((s) => s.label === 'MISSED')).toBe(true)
    expect(st.score).toBeLessThan(0)
  })

  it('grades a run', () => {
    expect(grade(300 * 24, 24)).toMatch(/^S/)
    expect(grade(0, 24)).toMatch(/^D/)
  })

  it('down direction decreases sKm', () => {
    let st = setNotch(newDrive(1, STRAIGHT), 4)
    st = run(st, 15)
    expect(st.sKm).toBeLessThan(stations[stations.length - 1].sKm)
    expect(st.nextStopOrder).toBe(stations.length - 2)
  })
})
