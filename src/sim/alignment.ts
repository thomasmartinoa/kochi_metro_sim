/**
 * Track alignment in world space — built from the REAL GTFS shape polyline.
 * Maps distance-along-line (sKm, the engine's axis) to 3D position + heading.
 * World: +x east, +z south, +y up. Rail level at RAIL_LEVEL_M.
 */
import { Vector3 } from 'three'
import { gtfs, stations } from '../data/network'
import { RAIL_LEVEL_M } from '../data/trainset'
import { project } from './projection'

interface AlignmentPoint {
  pos: Vector3
  /** unit tangent pointing toward increasing s */
  tan: Vector3
  sKm: number
}

function buildPoints(): AlignmentPoint[] {
  const raw = gtfs.shapeUp.map(([lat, lon, d]) => {
    const { x, z } = project(lat, lon)
    return { pos: new Vector3(x, RAIL_LEVEL_M, z), sKm: d }
  })
  // light smoothing pass to soften polyline corners (keeps endpoints)
  for (let iter = 0; iter < 2; iter++) {
    const smoothed = raw.map((p, i) => {
      if (i === 0 || i === raw.length - 1) return p.pos.clone()
      const avg = raw[i - 1].pos.clone().add(raw[i + 1].pos).multiplyScalar(0.5)
      return avg.lerp(p.pos, 0.5)
    })
    smoothed.forEach((v, i) => raw[i].pos.copy(v))
  }
  return raw.map((p, i) => {
    const a = raw[Math.max(0, i - 1)].pos
    const b = raw[Math.min(raw.length - 1, i + 1)].pos
    const tan = b.clone().sub(a).setY(0).normalize()
    return { pos: p.pos, tan, sKm: p.sKm }
  })
}

export const alignment: AlignmentPoint[] = buildPoints()
export const S_MIN = alignment[0].sKm
export const S_MAX = alignment[alignment.length - 1].sKm

/** Left-hand unit vector for a travel tangent (rotate +90° around Y). */
export function leftOf(tan: Vector3): Vector3 {
  return new Vector3(tan.z, 0, -tan.x)
}

/** Binary search the alignment for a distance (km). */
function seg(sKm: number): { i: number; f: number } {
  const s = Math.min(Math.max(sKm, S_MIN), S_MAX)
  let lo = 0
  let hi = alignment.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (alignment[mid].sKm <= s) lo = mid
    else hi = mid
  }
  const a = alignment[lo]
  const b = alignment[hi]
  const f = b.sKm === a.sKm ? 0 : (s - a.sKm) / (b.sKm - a.sKm)
  return { i: lo, f }
}

const _tmpA = new Vector3()
const _tmpB = new Vector3()

/**
 * Position + travel heading at sKm for a direction.
 * dir 0 travels toward increasing s (Aluva -> Tripunithura).
 * Trains run left-hand: each direction is offset onto its own track.
 */
export function poseAt(
  sKm: number,
  dir: 0 | 1,
  out: { pos: Vector3; heading: Vector3 },
  trackOffsetM = 2.1,
): void {
  const { i, f } = seg(sKm)
  const a = alignment[i]
  const b = alignment[i + 1]
  out.pos.lerpVectors(a.pos, b.pos, f)
  _tmpA.lerpVectors(a.tan, b.tan, f).normalize()
  const travel = dir === 0 ? _tmpA : _tmpB.copy(_tmpA).negate()
  // left-hand running: offset each direction to the left of its travel
  const left = leftOf(travel)
  out.pos.addScaledVector(left, trackOffsetM)
  out.heading.copy(travel)
}

/** Centreline pose (no track offset) — for viaduct/stations/cameras. */
export function centerAt(sKm: number): { pos: Vector3; tan: Vector3 } {
  const { i, f } = seg(sKm)
  const a = alignment[i]
  const b = alignment[i + 1]
  return {
    pos: new Vector3().lerpVectors(a.pos, b.pos, f),
    tan: new Vector3().lerpVectors(a.tan, b.tan, f).normalize(),
  }
}

/** Station world poses on the centreline (platforms flank the tracks). */
export const stationPoses = stations.map((s) => ({
  station: s,
  ...centerAt(s.sKm),
}))
