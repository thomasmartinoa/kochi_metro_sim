import { describe, expect, it } from 'vitest'
import { stations } from '../data/network'
import { MODEL_CAR_PITCH_M } from '../data/trainset'
import {
  A_LAT_DERAIL,
  brakingDistanceM,
  BUFFER_KMH,
  curveLimitKmh,
  DERAIL_HOLD_S,
  grade,
  LOOKAHEAD_M,
  newDrive,
  restartFromLastStop,
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

/** Straight from 0, then a constant 100 m radius curve from 1000 m on. */
const CURVE_100: DriveEnv = {
  ...STRAIGHT,
  curvatureAtG: (g) => (g >= 1000 ? 1 / 100 : 0),
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

  it('never brakes for the driver: full power past 85 km/h keeps accelerating', () => {
    let st = setNotch(newDrive(0, STRAIGHT), 4)
    st = run(st, 30) // ~100 km/h by now on the synthetic straight
    expect(st.vMs * 3.6).toBeGreaterThan(85)
    const before = st.vMs
    st = run(st, 5)
    expect(st.notch).toBe(4)
    expect(st.vMs).toBeGreaterThan(before)
    expect(st.overspeed).toBe(true)
    expect('penaltyBrake' in st).toBe(false)
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

describe('derailment', () => {
  it('limit on a 100 m curve is 58 km/h, and the straight has none', () => {
    expect(curveLimitKmh(1 / 100)).toBeCloseTo(3.6 * Math.sqrt(A_LAT_DERAIL * 100), 1)
    expect(Math.round(curveLimitKmh(1 / 100))).toBe(58)
    expect(curveLimitKmh(0)).toBe(Infinity)
  })

  it('a train under the limit takes the curve', () => {
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 14, CURVE_100) // ~49 km/h, still on the straight
    st = setNotch(st, 0)
    st = run(st, 90, CURVE_100) // coasts round the bend
    expect(st.phase).not.toBe('derailed')
    expect(st.derail).toBeNull()
    expect(st.gM).toBeGreaterThan(1000)
  })

  it('a train over the limit for longer than the hold time derails, with the record', () => {
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 50, CURVE_100) // ~130 km/h into the curve at 1000 m
    expect(st.phase).toBe('derailed')
    expect(st.derail).not.toBeNull()
    const d = st.derail!
    expect(d.cause).toBe('curve')
    expect(d.radiusM).toBeCloseTo(100, 0)
    expect(Math.round(d.limitKmh)).toBe(58)
    expect(d.speedKmh).toBeGreaterThan(58)
    expect(d.lastStopOrder).toBe(0)
    // the leading car is a car pitch ahead of the reference; it derailed a
    // hold-time into the curve, not at its mouth
    expect(d.gM).toBeGreaterThan(1000 - MODEL_CAR_PITCH_M)
    expect(d.gM).toBeLessThan(1000 + (d.speedKmh / 3.6) * DERAIL_HOLD_S * 1.3)
  })

  it('a brief excursion over the limit with the brake on survives', () => {
    // hold just over the limit (16.3 m/s vs 16.1) to the curve mouth, then
    // emergency brake: a couple of tenths later the train is back under it
    let st = setNotch(newDrive(0, CURVE_100), 4)
    let guard = 0
    while (st.gM < 1000 - MODEL_CAR_PITCH_M - 5 && guard++ < 20000) {
      st = setNotch(st, st.vMs < 16.3 ? 2 : 0)
      st = stepDrive(st, 0.05, CURVE_100)
    }
    st = setNotch(st, -5)
    st = run(st, 10, CURVE_100)
    expect(st.phase).not.toBe('derailed')
    expect(st.gM).toBeGreaterThan(1000)
  })

  it('a derailed train no longer moves or scores', () => {
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 50, CURVE_100)
    expect(st.phase).toBe('derailed')
    const frozen = run(setNotch(st, 4), 5, CURVE_100)
    expect(frozen.gM).toBe(st.gM)
    expect(frozen.score).toBe(st.score)
    expect(st.score).toBeLessThanOrEqual(-1000)
  })
})

describe('buffer stop and restart', () => {
  it('hitting the buffer above 15 km/h derails; creeping in stops the run', () => {
    // blowing through Tripunithura: the terminal is the next stop, the train
    // is already 10 m past it under full power, the buffer is 60 m past it
    const last = stations.length - 1
    let st: DriveState = {
      ...newDrive(0, STRAIGHT),
      nextStopOrder: last,
      lastStopOrder: last - 1,
      gM: stations[last].sKm * 1000 + 10,
      phase: 'run',
      vMs: 8,
    }
    st = run(setNotch(st, 4), 12)
    expect(st.phase).toBe('derailed')
    expect(st.derail!.cause).toBe('buffer')
    expect(st.derail!.limitKmh).toBe(BUFFER_KMH)
    expect(st.derail!.lastStopOrder).toBe(last - 1)

    let slow: DriveState = {
      ...newDrive(0, STRAIGHT),
      nextStopOrder: last,
      gM: stations[last].sKm * 1000 + 55,
      phase: 'run',
      vMs: 2, // 7 km/h
    }
    slow = run(slow, 5)
    expect(slow.phase).toBe('done')
    expect(slow.derail).toBeNull()
  })

  it('restarts at the last station with doors open, keeping the score and stops', () => {
    let st = setNotch(newDrive(0, CURVE_100), 4)
    st = run(st, 50, CURVE_100)
    expect(st.phase).toBe('derailed')
    const again = restartFromLastStop(st, CURVE_100)
    expect(again.phase).toBe('ready')
    expect(again.doorsOpen).toBe(true)
    expect(again.vMs).toBe(0)
    expect(again.notch).toBe(0)
    expect(again.gM).toBe(CURVE_100.gAt(stations[0].sKm))
    expect(again.nextStopOrder).toBe(1)
    expect(again.score).toBe(st.score)
    expect(again.stops).toBe(st.stops)
    expect(again.derail).toBeNull()
    // and it can be driven again
    const moving = run(setNotch(again, 4), 5, CURVE_100)
    expect(moving.phase).toBe('run')
    expect(moving.gM).toBeGreaterThan(again.gM)
  })
})

describe('curve lookahead', () => {
  it('reports the tightest restriction ahead and its distance, or nothing on open track', () => {
    let st: DriveState = { ...newDrive(0, CURVE_100), gM: 700, phase: 'run', vMs: 10 }
    st = stepDrive(st, 0.05, CURVE_100)
    expect(st.ahead).not.toBeNull()
    expect(Math.round(st.ahead!.limitKmh)).toBe(58)
    // the curve starts at 1000 m; the leading car is a car pitch ahead of gM
    expect(st.ahead!.distM).toBeGreaterThan(1000 - 700 - MODEL_CAR_PITCH_M - 20)
    expect(st.ahead!.distM).toBeLessThan(1000 - 700 - MODEL_CAR_PITCH_M + 20)
    expect(st.ahead!.distM).toBeLessThanOrEqual(LOOKAHEAD_M)

    let open: DriveState = { ...newDrive(0, CURVE_100), gM: 100, phase: 'run', vMs: 10 }
    open = stepDrive(open, 0.05, CURVE_100)
    expect(open.ahead).toBeNull()

    let inside: DriveState = { ...newDrive(0, CURVE_100), gM: 1200, phase: 'run', vMs: 10 }
    inside = stepDrive(inside, 0.05, CURVE_100)
    expect(inside.ahead!.distM).toBe(0)
  })
})
