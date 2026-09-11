import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { stations } from '../data/network'
import { MODEL_CAR_PITCH_M } from '../data/trainset'
import { alignment, carPoseAt, centerAt, S_MAX, S_MIN, trackOffsetBy } from './alignment'
import { project } from './projection'

describe('alignment geometry', () => {
  it('is smooth: the heading turns less than 1.5 degrees between samples', () => {
    let worst = 0
    for (let i = 1; i < alignment.length; i++) {
      const dot = alignment[i - 1].tan.dot(alignment[i].tan)
      const deg = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
      worst = Math.max(worst, deg)
    }
    expect(worst).toBeLessThan(1.5)
  })

  it('stops every train exactly at its platform: no along-track station error', () => {
    // the stop coordinate sits platform-side of the track centreline, so some
    // lateral offset is real; what must be zero is the error along the track
    for (const s of stations) {
      const real = project(s.lat, s.lon)
      const { pos, tan } = centerAt(s.sKm)
      const along = Math.abs((real.x - pos.x) * tan.x + (real.z - pos.z) * tan.z)
      expect(along, s.name).toBeLessThan(1)
    }
  })

  it('keeps adjacent cars coupled around every curve', () => {
    // car c sits (1 - c) * pitch ahead of the train's chainage, as the scene
    // lays them out; the rear coupler of one must meet the front coupler of
    // the next to within a hand's width, however tight the curve
    const a = { pos: new Vector3(), heading: new Vector3() }
    const b = { pos: new Vector3(), heading: new Vector3() }
    const half = MODEL_CAR_PITCH_M / 2
    let worst = 0
    for (let s = S_MIN + 0.3; s < S_MAX - 0.3; s += 0.005) {
      carPoseAt(s, 0, a)
      carPoseAt(trackOffsetBy(s, -MODEL_CAR_PITCH_M, 0), 0, b)
      const rearOfA = a.pos.clone().addScaledVector(a.heading, -half)
      const frontOfB = b.pos.clone().addScaledVector(b.heading, half)
      worst = Math.max(worst, rearOfA.distanceTo(frontOfB))
    }
    expect(worst).toBeLessThan(0.4)
  })
})
