/**
 * The cab's sounds, synthesised: a two-tone air horn and the boarding chime.
 * Nothing to download, and they play the instant the driver asks. WebAudio
 * needs a user gesture before it will make a sound; the first key or click
 * in Drive mode is that gesture, so the context is created lazily.
 */

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** A Metropolis-style two-tone horn: a fifth apart, with a little breath on the attack. */
export function playHorn(durationS = 0.9): void {
  const ac = audio()
  if (!ac) return
  const t0 = ac.currentTime
  const out = ac.createGain()
  out.gain.setValueAtTime(0, t0)
  out.gain.linearRampToValueAtTime(0.35, t0 + 0.06)
  out.gain.setValueAtTime(0.35, t0 + durationS - 0.12)
  out.gain.linearRampToValueAtTime(0, t0 + durationS)
  out.connect(ac.destination)
  for (const hz of [311, 466]) {
    const o = ac.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = hz
    const f = ac.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 1400
    o.connect(f)
    f.connect(out)
    o.start(t0)
    o.stop(t0 + durationS)
  }
}

/** The soft two-note chime that marks the end of boarding. */
export function playChime(): void {
  const ac = audio()
  if (!ac) return
  const t0 = ac.currentTime
  for (const [hz, at] of [
    [880, 0],
    [1174.7, 0.18],
  ] as const) {
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.value = hz
    const g = ac.createGain()
    g.gain.setValueAtTime(0, t0 + at)
    g.gain.linearRampToValueAtTime(0.22, t0 + at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.6)
    o.connect(g)
    g.connect(ac.destination)
    o.start(t0 + at)
    o.stop(t0 + at + 0.65)
  }
}
