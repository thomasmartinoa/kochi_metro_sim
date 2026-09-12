import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { newCamMemory, replayTrackside, viewCamera, VIEWS, type Rig } from './driveCameras'

const rig = (over: Partial<Rig> = {}): Rig => ({
  pos: new Vector3(1000, 14.8, 2000),
  heading: new Vector3(0, 0, 1),
  speed: 15,
  wreckLead: null,
  ...over,
})
const finite = (v: Vector3) => [v.x, v.y, v.z].every(Number.isFinite)

describe('drive cameras', () => {
  it('every view yields a finite eye, target and fov', () => {
    for (const v of [...VIEWS, 'crash' as const]) {
      const p = viewCamera(v, rig({ wreckLead: new Vector3(1010, 15, 2020) }), newCamMemory(), 1 / 60)
      expect(finite(p.eye), v).toBe(true)
      expect(finite(p.target), v).toBe(true)
      expect(p.fov, v).toBeGreaterThan(20)
      expect(p.fov, v).toBeLessThan(120)
    }
  })

  it('chase sits behind and above, looking down the line of travel', () => {
    const p = viewCamera('chase', rig(), newCamMemory(), 1 / 60)
    expect(p.eye.z).toBeLessThan(2000) // behind, travel is +z
    expect(p.eye.y).toBeGreaterThan(14.8 + 10)
    expect(p.target.z).toBeGreaterThan(2000)
  })

  it('left and right are mirror images across the track', () => {
    const l = viewCamera('left', rig(), newCamMemory(), 1 / 60)
    const r = viewCamera('right', rig(), newCamMemory(), 1 / 60)
    expect(l.eye.x - 1000).toBeCloseTo(-(r.eye.x - 1000), 5)
    expect(Math.abs(l.eye.x - 1000)).toBeGreaterThan(5)
    expect(l.eye.y).toBeCloseTo(r.eye.y, 5)
    expect(l.eye.z).toBeCloseTo(r.eye.z, 5)
  })

  it('trackside plants a camera ahead and jumps to a new spot once the train has passed it', () => {
    const mem = newCamMemory()
    const first = viewCamera('trackside', rig(), mem, 1 / 60)
    expect(first.eye.z).toBeGreaterThan(2000) // ahead of the train
    const anchor = first.eye.clone()
    // not yet passed: the anchor stays put
    const held = viewCamera('trackside', rig({ pos: new Vector3(1000, 14.8, 2030) }), mem, 1 / 60)
    expect(held.eye.distanceTo(anchor)).toBe(0)
    // the train passes it by 60 m: re-planted ahead again
    const later = viewCamera('trackside', rig({ pos: new Vector3(1000, 14.8, anchor.z + 60) }), mem, 1 / 60)
    expect(later.eye.z).toBeGreaterThan(anchor.z + 60)
  })

  it('drone circles: the azimuth advances with time and never jumps on a slow frame', () => {
    const mem = newCamMemory()
    const p0 = viewCamera('drone', rig(), mem, 1 / 60)
    const az0 = mem.az
    viewCamera('drone', rig(), mem, 1 / 60)
    const perFrame = mem.az - az0
    expect(perFrame).toBeGreaterThan(0)
    const before = mem.az
    viewCamera('drone', rig(), mem, 0.5) // a half-second hitch
    expect(mem.az - before).toBeLessThanOrEqual(perFrame * 2 + 1e-9) // at most a 30 Hz step
    expect(p0.eye.y).toBeGreaterThan(14.8 + 80)
  })

  it('crash orbits the wreck lead, not the rail pose', () => {
    const mem = newCamMemory()
    const w = new Vector3(1200, 16, 2400)
    const p = viewCamera('crash', rig({ wreckLead: w }), mem, 1 / 60)
    expect(p.target.distanceTo(w)).toBeLessThan(3)
  })

  it('cab sits in the nose at driver height with a wide field of view', () => {
    const p = viewCamera('cab', rig(), newCamMemory(), 1 / 60)
    expect(p.eye.y).toBeGreaterThan(14.8 + 1.5)
    expect(p.eye.y).toBeLessThan(14.8 + 4)
    expect(p.fov).toBeGreaterThanOrEqual(60)
    // the rig is the lead car's CENTRE; the cab is at its far end, ~9 m ahead,
    // so the eye must be well forward of the centre -- not mid-saloon
    expect(p.eye.z - 2000).toBeGreaterThan(6)
    expect(p.eye.z - 2000).toBeLessThan(9.3)
  })

  it('the replay opens trackside with the train already in shot', () => {
    const p = replayTrackside(rig(), newCamMemory())
    const ahead = p.eye.z - 2000
    expect(ahead).toBeGreaterThan(20)
    expect(ahead).toBeLessThan(45) // closer than the driving trackside's 70 m
    expect(p.eye.distanceTo(rig().pos)).toBeLessThan(40)
  })
})
