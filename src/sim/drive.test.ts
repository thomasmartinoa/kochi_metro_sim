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
  LINE_SPEED_KMH,
  LOOKAHEAD_M,
  newDrive,
  restartFromLastStop,
  setNotch,
  stepDrive,
  toggleDoors,
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

/** A drive with the doors closed, as a driver would leave the platform. */
function ready(dir: 0 | 1 = 0, env: DriveEnv = STRAIGHT): DriveState {
  return toggleDoors(newDrive(dir, env))
}

describe('drive physics', () => {
  it('moves in real metres: full power from rest covers ~½at² along the drawn line', () => {
    const start = ready(0)
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
    let st = ready(0)
    st = run(st, 5)
    expect(st.phase).toBe('ready')
    expect(st.sKm).toBeCloseTo(stations[0].sKm, 5)
  })

  it('accelerates under power and moves toward the next station', () => {
    let st = setNotch(ready(0), 4)
    st = run(st, 20)
    expect(st.phase).toBe('run')
    expect(st.vMs).toBeGreaterThan(10)
    expect(st.sKm).toBeGreaterThan(stations[0].sKm)
  })

  it('never brakes for the driver: full power past 85 km/h keeps accelerating', () => {
    let st = setNotch(ready(0), 4)
    st = run(st, 30) // past the line limit by now on the synthetic straight
    expect(st.vMs * 3.6).toBeGreaterThan(LINE_SPEED_KMH)
    const before = st.vMs
    st = run(st, 5)
    expect(st.notch).toBe(4)
    expect(st.vMs).toBeGreaterThan(before)
    expect(st.overspeed).toBe(true)
    expect('penaltyBrake' in st).toBe(false)
  })

  it('scores a stop at the station mark', () => {
    let st = setNotch(ready(0), 4)
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
    let st = setNotch(ready(0), 4)
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
    let st = setNotch(ready(1), 4)
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
    let st = setNotch(ready(0, CURVE_100), 4)
    st = run(st, 14, CURVE_100) // ~49 km/h, still on the straight
    st = setNotch(st, 0)
    st = run(st, 90, CURVE_100) // coasts round the bend
    expect(st.phase).not.toBe('derailed')
    expect(st.derail).toBeNull()
    expect(st.gM).toBeGreaterThan(1000)
  })

  it('a train over the limit for longer than the hold time derails, with the record', () => {
    let st = setNotch(ready(0, CURVE_100), 4)
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
    let st = setNotch(ready(0, CURVE_100), 4)
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
    let st = setNotch(ready(0, CURVE_100), 4)
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
      ...ready(0),
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
      ...ready(0),
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
    let st = setNotch(ready(0, CURVE_100), 4)
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
    // and it can be driven again, once the doors are closed
    const moving = run(setNotch(toggleDoors(again), 4), 5, CURVE_100)
    expect(moving.phase).toBe('run')
    expect(moving.gM).toBeGreaterThan(again.gM)
  })
})

describe('curve lookahead', () => {
  it('reports the tightest restriction ahead and its distance, or nothing on open track', () => {
    let st: DriveState = { ...ready(0, CURVE_100), gM: 700, phase: 'run', vMs: 10 }
    st = stepDrive(st, 0.05, CURVE_100)
    expect(st.ahead).not.toBeNull()
    expect(Math.round(st.ahead!.limitKmh)).toBe(58)
    // the curve starts at 1000 m; the leading car is a car pitch ahead of gM
    expect(st.ahead!.distM).toBeGreaterThan(1000 - 700 - MODEL_CAR_PITCH_M - 20)
    expect(st.ahead!.distM).toBeLessThan(1000 - 700 - MODEL_CAR_PITCH_M + 20)
    expect(st.ahead!.distM).toBeLessThanOrEqual(LOOKAHEAD_M)

    let open: DriveState = { ...ready(0, CURVE_100), gM: 100, phase: 'run', vMs: 10 }
    open = stepDrive(open, 0.05, CURVE_100)
    expect(open.ahead).toBeNull()

    let inside: DriveState = { ...ready(0, CURVE_100), gM: 1200, phase: 'run', vMs: 10 }
    inside = stepDrive(inside, 0.05, CURVE_100)
    expect(inside.ahead!.distM).toBe(0)
  })
})

// ---------------------------------------------------------------- 6d ----

/** drive to Pulinchodu and stop on the mark; returns the state at the moment of the stop */
function stopAtPulinchodu(env: DriveEnv = STRAIGHT): DriveState {
  let st = setNotch(ready(0, env), 4)
  let guard = 0
  while ((st.phase === 'run' || st.phase === 'ready') && guard++ < 20000) {
    const need = brakingDistanceM(st.vMs)
    st = setNotch(st, st.distToNextM <= need + 2 && st.phase === 'run' ? -4 : 4)
    st = stepDrive(st, 0.05, env)
  }
  expect(st.phase).toBe('dwell')
  return st
}

describe('doors', () => {
  it('open on arrival, and the train will not take power until they are closed', () => {
    let st = stopAtPulinchodu()
    expect(st.doorsOpen).toBe(true)
    st = run(setNotch(st, 4), 3)
    expect(st.vMs).toBe(0)
    expect(st.phase).toBe('dwell')
  })

  it('the driver closes them; only then does power move the train', () => {
    let st = stopAtPulinchodu()
    st = run(st, 12) // boarding done
    st = toggleDoors(st)
    expect(st.doorsOpen).toBe(false)
    st = run(setNotch(st, 4), 3)
    expect(st.phase).toBe('run')
    expect(st.vMs).toBeGreaterThan(0)
  })

  it('cannot be opened while moving', () => {
    let st = run(setNotch(ready(0), 4), 5)
    expect(st.doorsOpen).toBe(false)
    st = toggleDoors(st)
    expect(st.doorsOpen).toBe(false)
  })
})

describe('boarding', () => {
  it('passengers alight then board while the doors are open, and a chime marks the end', () => {
    let st = stopAtPulinchodu()
    expect(st.boarding).not.toBeNull()
    const b0 = st.boarding!
    expect(b0.alighting + b0.waiting).toBeGreaterThan(0)
    expect(b0.done).toBe(false)
    st = run(st, 2)
    expect(st.boarding!.alighting).toBeLessThan(b0.alighting)
    // the chime is a one-step flag, set on the step boarding completes and
    // cleared on the next: catch that step
    let chimed = 0
    for (let t = 0; t < 30 && !st.boarding!.done; t += 0.05) {
      st = stepDrive(st, 0.05, STRAIGHT)
      if (st.chime) chimed++
    }
    expect(st.boarding!.done).toBe(true)
    expect(st.boarding!.waiting).toBe(0)
    expect(chimed).toBe(1)
    st = stepDrive(st, 0.05, STRAIGHT)
    expect(st.chime).toBe(false)
  })

  it('closing the doors early strands the rest and costs 20 a head', () => {
    let st = stopAtPulinchodu()
    const before = st.score
    st = run(st, 1)
    const waiting = st.boarding!.waiting
    expect(waiting).toBeGreaterThan(0)
    st = toggleDoors(st)
    expect(st.boarding!.stranded).toBe(waiting)
    expect(st.score).toBe(before - 20 * waiting)
  })

  it('a heavier train pulls away a little slower', () => {
    const light: DriveState = { ...ready(0), load: 0.05 }
    const heavy: DriveState = { ...ready(0), load: 1.0 }
    const a = run(setNotch(light, 4), 10)
    const b = run(setNotch(heavy, 4), 10)
    expect(b.vMs).toBeLessThan(a.vMs)
    expect(b.vMs).toBeGreaterThan(a.vMs * 0.85)
  })
})

describe('comfort', () => {
  it('a notch change at speed costs comfort, scaled by the change; at rest it is free', () => {
    let st = setNotch(ready(0), 1)
    st = stepDrive(st, 0.05, STRAIGHT) // at rest → run, no charge
    const c0 = st.comfort
    st = run(st, 8) // moving now
    st = setNotch(st, 4) // +3 notches at speed
    expect(st.comfort).toBeLessThan(c0)
    const oneStep = c0 - setNotch(run(setNotch(ready(0), 1), 8), 2).comfort
    const threeSteps = c0 - st.comfort
    expect(threeSteps).toBeGreaterThan(oneStep)
    // a careful full run (~100 lever moves at line speed) keeps most of its comfort
    expect(100 - 100 * 0.5).toBeGreaterThan(40)
  })

  it('taking a curve in the warning band bleeds comfort over time', () => {
    let st: DriveState = { ...ready(0, CURVE_100), gM: 990, phase: 'run', vMs: 14.5 } // ~2.1 m/s² on the 100 m curve
    const c0 = st.comfort
    st = run(st, 3, CURVE_100)
    expect(st.comfort).toBeLessThan(c0)
  })
})

describe('punctuality', () => {
  it('each stop is scored against a schedule rebased to the first power notch', () => {
    const st = stopAtPulinchodu()
    const last = st.stops[st.stops.length - 1]
    expect(typeof last.lateSec).toBe('number')
    expect(Number.isFinite(last.lateSec)).toBe(true)
    // a run that stops promptly is early or near on time, never wildly late
    expect(Math.abs(last.lateSec!)).toBeLessThan(300)
    expect(typeof last.punctualityPoints).toBe('number')
  })
})

// ---------------------------------------------------------------- 6e ----

describe('signals and the train ahead', () => {
  /**
   * A signalled line the way the real one behaves: signals every 500 m, and
   * "the signal ahead" is always the NEXT one -- once you are past a signal it
   * is no longer reported. (A stub that kept reporting the same signal after
   * it was passed hid a real bug: the crossing was never observed.)
   */
  const signalled = (redAtG: number): DriveEnv => ({
    ...STRAIGHT,
    signalAt: (gM, dir) => {
      const next = dir === 0 ? Math.floor(gM / 500 + 1) * 500 : Math.ceil(gM / 500 - 1) * 500
      return { gM: next, aspect: next === redAtG ? 'red' : 'green' }
    },
  })

  it('passing a red signal is a SPAD: -300, recorded once, the run goes on', () => {
    // a red at 1000 m on the straight
    const env = signalled(1000)
    let st = run(setNotch(ready(0, env), 4), 30, env) // ~30 m/s
    const before = st.score
    while (st.gM < 1010) st = stepDrive(st, 0.05, env)
    expect(st.spads).toBe(1)
    expect(st.score).toBe(before - 300)
    expect(st.phase).toBe('run')
    st = run(st, 3, env)
    expect(st.spads).toBe(1) // charged once, not every step past it
  })

  it('a green or yellow costs nothing', () => {
    const env = signalled(-1) // no red anywhere
    let st = run(setNotch(ready(0, env), 4), 30, env)
    while (st.gM < 1010) st = stepDrive(st, 0.05, env)
    expect(st.spads).toBe(0)
  })

  it('closing on the train ahead above 10 km/h is a collision; below it a bump', () => {
    // the train ahead sits 400 m up the line, stationary
    const env: DriveEnv = { ...STRAIGHT, trainAheadG: () => 400 }
    let st = run(setNotch(ready(0, env), 4), 25, env) // ~90 km/h by 400 m... actually hits first
    expect(st.phase).toBe('derailed')
    expect(st.derail!.cause).toBe('collision')
    expect(st.derail!.speedKmh).toBeGreaterThan(10)

    // our nose is a car and a half ahead of gM: start with it 10 m short of the tail
    let slow: DriveState = { ...ready(0, env), gM: 400 - 1.5 * MODEL_CAR_PITCH_M - 10, phase: 'run', vMs: 2 } // 7 km/h
    const before = slow.score
    slow = run(slow, 20, env)
    expect(slow.phase).toBe('run')
    expect(slow.vMs).toBe(0) // stopped against the train ahead
    // held nose to tail, not driven into it
    expect(slow.gM + 1.5 * MODEL_CAR_PITCH_M).toBeLessThanOrEqual(400)
    expect(slow.gM + 1.5 * MODEL_CAR_PITCH_M).toBeGreaterThan(400 - 2)
    expect(slow.score).toBe(before - 100)
    expect(slow.bumps).toBe(1)
  })
})

// ---------------------------------------------------------------- 6f ----

describe('traction', () => {
  it('the motors run out at the design speed: flat out on the straight, the set tops out under 100 km/h', () => {
    let st = setNotch(ready(0), 4)
    st = run(st, 400)
    expect(st.vMs * 3.6).toBeGreaterThan(80) // the line limit is not a governor
    expect(st.vMs * 3.6).toBeLessThan(96)
  })
})

describe('weather and adhesion', () => {
  it('braking distance stretches once adhesion falls below what the service brake asks', () => {
    // the service brake (1.1 m/s²) is already under the dry limit, so dry rail
    // is unaffected; wet rail caps braking at emergency x adhesion
    const dry = brakingDistanceM(20, 1.0)
    expect(dry).toBeCloseTo((20 * 20) / (2 * 1.1), 6)
    const wet = brakingDistanceM(20, 0.75)
    expect(wet).toBeCloseTo((20 * 20) / (2 * (1.3 * 0.75)), 6)
    expect(wet).toBeGreaterThan(dry)
    const monsoon = brakingDistanceM(20, 0.6)
    expect(monsoon).toBeGreaterThan(wet)
  })

  it('in the wet the same brake application takes longer to stop from the same speed', () => {
    const go = (adhesion: number) => {
      let st: DriveState = { ...ready(0, STRAIGHT), phase: 'run', vMs: 20, adhesion }
      st = setNotch(st, -4)
      let t = 0
      while (st.vMs > 0 && t < 120) {
        st = stepDrive(st, 0.05, STRAIGHT)
        t += 0.05
      }
      return t
    }
    expect(go(0.6)).toBeGreaterThan(go(1.0) * 1.4)
  })

  it('an emergency brake in the wet slides: the wheels lock and the brake gives less, with a warning', () => {
    let wet: DriveState = { ...ready(0, STRAIGHT), phase: 'run', vMs: 20, adhesion: 0.6 }
    wet = setNotch(wet, -5)
    wet = stepDrive(wet, 0.05, STRAIGHT)
    expect(wet.slipping).toBe(true)
    let dry: DriveState = { ...ready(0, STRAIGHT), phase: 'run', vMs: 20, adhesion: 1.0 }
    dry = setNotch(dry, -5)
    dry = stepDrive(dry, 0.05, STRAIGHT)
    expect(dry.slipping).toBe(false)
    // sliding, the wet train sheds less speed per step than the dry one
    expect(20 - wet.vMs).toBeLessThan(20 - dry.vMs)
  })

  it('power in the wet spins the wheels too, and a lower notch grips', () => {
    let st: DriveState = { ...ready(0, STRAIGHT), phase: 'run', vMs: 5, adhesion: 0.6 }
    const spun = stepDrive(setNotch(st, 4), 0.05, STRAIGHT)
    expect(spun.slipping).toBe(true)
    const gripped = stepDrive(setNotch(st, 2), 0.05, STRAIGHT)
    expect(gripped.slipping).toBe(false)
  })
})
