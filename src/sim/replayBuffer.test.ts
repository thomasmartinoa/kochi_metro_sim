import { describe, expect, it } from 'vitest'
import { ReplayBuffer, type ReplayFrame } from './replayBuffer'

const frame = (t: number, x = t): ReplayFrame => ({
  t,
  cars: [
    { p: [x, 0, 0], q: [0, 0, 0, 1] },
    { p: [x - 18, 0, 0], q: [0, 0, 0, 1] },
    { p: [x - 36, 0, 0], q: [0, 0, 0, 1] },
  ],
  speedKmh: 50,
  notch: 2,
  doorsOpen: false,
})

describe('replay buffer', () => {
  it('keeps only the last WINDOW seconds, oldest first', () => {
    const b = new ReplayBuffer(15)
    for (let t = 0; t <= 40; t += 0.5) b.push(frame(t))
    expect(b.first!.t).toBeGreaterThanOrEqual(40 - 15)
    expect(b.last!.t).toBe(40)
    expect(b.durationS).toBeLessThanOrEqual(15 + 1e-9)
    expect(b.durationS).toBeGreaterThan(14)
  })

  it('drops frames that arrive faster than the sample rate', () => {
    const b = new ReplayBuffer(15, 30)
    for (let t = 0; t < 1; t += 1 / 240) b.push(frame(t))
    expect(b.length).toBeLessThanOrEqual(31)
    expect(b.length).toBeGreaterThanOrEqual(29)
  })

  it('interpolates a pose between two recorded frames', () => {
    const b = new ReplayBuffer(15)
    b.push(frame(0, 0))
    b.push(frame(1, 10))
    const s = b.sampleAt(0.25)!
    expect(s.cars[0].p[0]).toBeCloseTo(2.5, 6)
    expect(s.speedKmh).toBe(50)
  })

  it('clamps sampling to the recorded range', () => {
    const b = new ReplayBuffer(15)
    b.push(frame(5, 100))
    b.push(frame(6, 110))
    expect(b.sampleAt(-3)!.cars[0].p[0]).toBe(100)
    expect(b.sampleAt(99)!.cars[0].p[0]).toBe(110)
    expect(new ReplayBuffer(15).sampleAt(0)).toBeNull()
  })

  it('freezes: once frozen, pushes are ignored and the window is kept whole', () => {
    const b = new ReplayBuffer(15)
    for (let t = 0; t <= 20; t += 0.5) b.push(frame(t))
    b.freeze()
    const len = b.length
    b.push(frame(21))
    expect(b.length).toBe(len)
    expect(b.last!.t).toBe(20)
  })

  it('a frozen buffer can be extended for the dynamic phase, then frozen again', () => {
    const b = new ReplayBuffer(15)
    for (let t = 0; t <= 20; t += 0.5) b.push(frame(t))
    b.freeze()
    b.extend()
    for (let t = 20.5; t <= 28; t += 0.5) b.push(frame(t))
    expect(b.last!.t).toBe(28)
    // the extension does not evict the pre-crash window
    expect(b.first!.t).toBeLessThanOrEqual(20 - 14)
    b.freeze()
    b.push(frame(30))
    expect(b.last!.t).toBe(28)
  })
})
