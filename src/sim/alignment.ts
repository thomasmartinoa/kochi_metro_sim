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
 *
 * TWO COORDINATES, and it matters which one you reach for:
 *
 *   sKm  the timetable's axis — GTFS `shape_dist_traveled`. The engine speaks
 *        only this. It is NOT a faithful measure of ground distance: KMRL's
 *        values agree with the projected geometry overall (28.79 km declared vs
 *        28.40 km measured) but locally run anywhere from 0.7x to 1.6x.
 *   gM   metres along the drawn polyline. Everything with a real physical size
 *        — trainset cars, viaduct spans, camera distances — belongs on this.
 *
 * The two are tied together by pinning them at the 25 stations: each station's
 * real lat/lon is projected onto the polyline, and chainage maps to geometry by
 * linear interpolation between those pins. So a train at a station's chainage
 * stands exactly on that station's platform, and the station model sits exactly
 * where the imagery shows it. Interpolating raw shape_dist_traveled instead put
 * stations a median 48 m — and Tripunithura 185 m — off their real positions.
 */
import { Vector3 } from 'three'
import { gtfs, stations } from '../data/network'
import { RAIL_LEVEL_M, TRACK_OFFSET_M } from '../data/trainset'
import { project } from './projection'

interface AlignmentPoint {
  pos: Vector3
  /** unit tangent pointing toward increasing s */
  tan: Vector3
  /** cumulative length along the projected polyline (m) */
  gM: number
}

/** run-out past a terminal so the whole station box has viaduct under it */
const TERMINAL_PAD_M = 60

function buildPoints(): AlignmentPoint[] {
  const raw = (gtfs.shapeUp as unknown as [number, number, number][]).map(([lat, lon]) => {
    const { x, z } = project(lat, lon)
    return new Vector3(x, RAIL_LEVEL_M, z)
  })
  // light smoothing pass to soften polyline corners (keeps endpoints)
  for (let iter = 0; iter < 2; iter++) {
    const smoothed = raw.map((p, i) => {
      if (i === 0 || i === raw.length - 1) return p.clone()
      const avg = raw[i - 1].clone().add(raw[i + 1]).multiplyScalar(0.5)
      return avg.lerp(p, 0.5)
    })
    smoothed.forEach((v, i) => raw[i].copy(v))
  }
  let gM = 0
  return raw.map((pos, i) => {
    const a = raw[Math.max(0, i - 1)]
    const b = raw[Math.min(raw.length - 1, i + 1)]
    const tan = b.clone().sub(a).setY(0).normalize()
    if (i > 0) gM += pos.distanceTo(raw[i - 1])
    return { pos, tan, gM }
  })
}

export const alignment: AlignmentPoint[] = buildPoints()
/** Length of the drawn alignment in real world metres. */
export const G_MAX = alignment[alignment.length - 1].gM

/** Left-hand unit vector for a travel tangent (rotate +90° around Y). */
export function leftOf(tan: Vector3): Vector3 {
  return new Vector3(tan.z, 0, -tan.x)
}

/** Metres along the polyline of the point closest to (x, z). */
function nearestG(x: number, z: number): number {
  let bestD = Infinity
  let bestG = 0
  for (let i = 1; i < alignment.length; i++) {
    const a = alignment[i - 1]
    const b = alignment[i]
    const dx = b.pos.x - a.pos.x
    const dz = b.pos.z - a.pos.z
    const len2 = dx * dx + dz * dz
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.pos.x) * dx + (z - a.pos.z) * dz) / len2)) : 0
    const px = a.pos.x + dx * t
    const pz = a.pos.z + dz * t
    const d = (x - px) ** 2 + (z - pz) ** 2
    if (d < bestD) {
      bestD = d
      bestG = a.gM + (b.gM - a.gM) * t
    }
  }
  return bestG
}

/**
 * Chainage <-> geometry pins, one per station, in station order.
 * Kept strictly increasing so both directions of the mapping stay invertible.
 */
const PINS = (() => {
  const s: number[] = []
  const g: number[] = []
  for (const st of stations) {
    const p = project(st.lat, st.lon)
    const gi = nearestG(p.x, p.z)
    // guard against a station projecting behind its predecessor on a tight loop
    s.push(st.sKm)
    g.push(g.length && gi <= g[g.length - 1] ? g[g.length - 1] + 1 : gi)
  }
  return { s, g }
})()

/** Piecewise-linear map through the pins, extrapolating past the terminals. */
function pinLerp(from: number[], to: number[], v: number): number {
  const n = from.length
  if (v <= from[0]) {
    const rate = (to[1] - to[0]) / (from[1] - from[0])
    return to[0] + (v - from[0]) * rate
  }
  if (v >= from[n - 1]) {
    const rate = (to[n - 1] - to[n - 2]) / (from[n - 1] - from[n - 2])
    return to[n - 1] + (v - from[n - 1]) * rate
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (from[mid] <= v) lo = mid
    else hi = mid
  }
  const f = (v - from[lo]) / (from[hi] - from[lo])
  return to[lo] + (to[hi] - to[lo]) * f
}

/** Chainage (km) -> distance along the drawn polyline (m). */
export function gAt(sKm: number): number {
  return pinLerp(PINS.s, PINS.g, sKm)
}

/** Distance along the drawn polyline (m) -> chainage (km). */
export function sAtG(gM: number): number {
  return pinLerp(PINS.g, PINS.s, gM)
}

export const S_MIN = sAtG(0)
export const S_MAX = sAtG(G_MAX)

/**
 * The revenue line, in metres along the polyline: terminal to terminal plus a
 * short run-out. KMRL's shape carries on ~680 m past Tripunithura and doubles
 * back — that is the stabling tail track, not viaduct the public ever sees, so
 * the drawn structure stops here rather than at the raw polyline's ends.
 */
export const G_START = Math.max(0, gAt(stations[0].sKm) - TERMINAL_PAD_M)
export const G_END = Math.min(G_MAX, gAt(stations[stations.length - 1].sKm) + TERMINAL_PAD_M)

/**
 * Step `metres` along the track from a chainage and return the chainage you
 * land on. Anything with a real physical length — car pitch, span pitch, a
 * camera lead distance — must be laid out through here rather than by adding
 * metres/1000 to sKm (see the header note on the two coordinates).
 */
export function offsetBy(sKm: number, metres: number): number {
  return sAtG(gAt(sKm) + metres)
}

/** Binary search the polyline for a geometric distance (m). */
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

const _tmpA = new Vector3()
const _tmpB = new Vector3()

/** Centreline position + tangent at a geometric distance (m). */
export function centerAtG(gM: number): { pos: Vector3; tan: Vector3 } {
  const { i, f } = segG(gM)
  const a = alignment[i]
  const b = alignment[i + 1]
  return {
    pos: new Vector3().lerpVectors(a.pos, b.pos, f),
    tan: new Vector3().lerpVectors(a.tan, b.tan, f).normalize(),
  }
}

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
  const { i, f } = segG(gAt(sKm))
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
  return centerAtG(gAt(sKm))
}

/** Station world poses on the centreline (platforms flank the tracks). */
export const stationPoses = stations.map((s) => ({
  station: s,
  ...centerAt(s.sKm),
}))
