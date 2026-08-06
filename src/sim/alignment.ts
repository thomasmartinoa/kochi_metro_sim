/**
 * Track alignment in world space — KMRL's official GTFS shape (true WGS84).
 *
 * This used to read shape-corrected.json, a copy laterally "snapped" to OSM
 * road medians inside Blender. That snapping was chasing a phantom: the GTFS
 * shape had been loaded into the Blender scene with the wrong metres-per-degree
 * (110574 instead of Blosm's spherical-mercator 111319.49), so it sat up to
 * ~100 m off the roads before any snapping happened, and converting back baked
 * that error into the file. The official shape in true WGS84 lands on the real
 * viaduct in the satellite imagery, so we use it directly.
 * World: +x east, +z south, +y up. Rail level at RAIL_LEVEL_M.
 */
import { Vector3 } from 'three'
import { gtfs, stations } from '../data/network'
import { RAIL_LEVEL_M, TRACK_OFFSET_M } from '../data/trainset'
import { project } from './projection'

interface AlignmentPoint {
  pos: Vector3
  /** unit tangent pointing toward increasing s */
  tan: Vector3
  /** GTFS chainage (km) — the timetable's coordinate */
  sKm: number
  /** cumulative length along the projected polyline (m) — the world's coordinate */
  gM: number
}

function buildPoints(): AlignmentPoint[] {
  const raw = (gtfs.shapeUp as unknown as [number, number, number][]).map(([lat, lon, d]) => {
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
  let gM = 0
  return raw.map((p, i) => {
    const a = raw[Math.max(0, i - 1)].pos
    const b = raw[Math.min(raw.length - 1, i + 1)].pos
    const tan = b.clone().sub(a).setY(0).normalize()
    if (i > 0) gM += p.pos.distanceTo(raw[i - 1].pos)
    return { pos: p.pos, tan, sKm: p.sKm, gM }
  })
}

export const alignment: AlignmentPoint[] = buildPoints()
export const S_MIN = alignment[0].sKm
export const S_MAX = alignment[alignment.length - 1].sKm
/** Length of the drawn alignment in real world metres. */
export const G_MAX = alignment[alignment.length - 1].gM

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

/** Binary search the alignment for a geometric distance (m). */
function segG(gM: number): { i: number; f: number } {
  const g = Math.min(Math.max(gM, 0), G_MAX)
  let lo = 0
  let hi = alignment.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (alignment[mid].gM <= g) lo = mid
    else hi = mid
  }
  const a = alignment[lo]
  const b = alignment[hi]
  const f = b.gM === a.gM ? 0 : (g - a.gM) / (b.gM - a.gM)
  return { i: lo, f }
}

/** Chainage (km) -> distance along the drawn polyline (m). */
export function gAt(sKm: number): number {
  const { i, f } = seg(sKm)
  return alignment[i].gM + (alignment[i + 1].gM - alignment[i].gM) * f
}

/** Distance along the drawn polyline (m) -> chainage (km). */
export function sAtG(gM: number): number {
  const { i, f } = segG(gM)
  return alignment[i].sKm + (alignment[i + 1].sKm - alignment[i].sKm) * f
}

/**
 * Step `metres` along the track from a chainage and return the chainage you
 * land on. KMRL's shape_dist_traveled agrees with the projected geometry
 * overall (28.79 km vs 28.40 km) but not segment by segment — locally it runs
 * anywhere from 0.7x to 1.6x the true length. Adding metres/1000 to sKm would
 * therefore space a trainset's cars (or the viaduct's spans) by whatever that
 * stretch's error happens to be: authored 18.56 m cars came out 12.75 m apart.
 * Anything with a real physical length must be laid out through here.
 */
export function offsetBy(sKm: number, metres: number): number {
  return sAtG(gAt(sKm) + metres)
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
  trackOffsetM = TRACK_OFFSET_M,
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
