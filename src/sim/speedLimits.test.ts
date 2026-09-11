import { describe, expect, it } from 'vitest'
import type { DriveEnv } from './drive'
import { curveRestrictions } from './speedLimits'

// straight, then 100 m radius from 1000-1300 m, straight, then 200 m radius from 2000-2100 m
const ENV: DriveEnv = {
  gAt: (s) => s * 1000,
  sAtG: (g) => g / 1000,
  curvatureAtG: (g) => (g >= 1000 && g < 1300 ? 1 / 100 : g >= 2000 && g < 2100 ? 1 / 200 : 0),
  bufferG: [-60, 30000],
}

describe('curve restrictions', () => {
  it('finds each stretch under line speed with its limit rounded down to 5', () => {
    const r = curveRestrictions(ENV, 0, 3000)
    expect(r).toHaveLength(1) // the 200 m curve allows ~82 km/h: no restriction
    expect(r[0].fromG).toBeGreaterThanOrEqual(990)
    expect(r[0].fromG).toBeLessThanOrEqual(1010)
    expect(r[0].toG).toBeGreaterThanOrEqual(1290)
    expect(r[0].toG).toBeLessThanOrEqual(1310)
    expect(r[0].limitKmh).toBe(55)
    expect(r[0].radiusM).toBeCloseTo(100, 0)
  })

  it('merges two restrictions separated by a short straight', () => {
    const env: DriveEnv = {
      ...ENV,
      curvatureAtG: (g) => ((g >= 1000 && g < 1100) || (g >= 1120 && g < 1200) ? 1 / 100 : 0),
    }
    expect(curveRestrictions(env, 0, 2000)).toHaveLength(1)
  })

  it('ignores a blip shorter than a board is worth', () => {
    // a 10 m flicker of curvature is a sample, not a bend nobody would sign
    const env: DriveEnv = { ...ENV, curvatureAtG: (g) => (g >= 1000 && g < 1010 ? 1 / 100 : 0) }
    expect(curveRestrictions(env, 0, 2000)).toHaveLength(0)
  })

  it('finds nothing on a straight line', () => {
    expect(curveRestrictions({ ...ENV, curvatureAtG: () => 0 }, 0, 3000)).toHaveLength(0)
  })
})
