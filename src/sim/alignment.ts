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
import { CatmullRomCurve3, Vector3 } from 'three'
import { gtfs, stations } from '../data/network'
import { BOGIE_SPACING_M, RAIL_LEVEL_M, TRACK_OFFSET_M } from '../data/trainset'
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
/**
 * Spacing of the resampled alignment. KMRL's shape has a point every 48 m on
 * average and up to 490 m apart, so used raw it is a polyline: every curve is
 * a run of visible facets, and anything with a physical length laid along it
 * (a car, a viaduct span) pivots at each corner. It is fitted with a spline
 * and resampled this densely instead, so headings change by a fraction of a
 * degree between samples and the geometry that rides on it can't see the
 * corners.
 */
const SAMPLE_M = 2
/** shape points closer than this are jitter, not geometry — the spline would kink through them */
const MIN_CONTROL_SPACING_M = 6
/**
 * No metro curve is tighter than about 100 m. A shape point that implies a
 * radius under this is a glitch in the feed — KMRL's shape has several in
 * its southern half, the worst a 46° turn between 12 m legs — and the spline
 * would faithfully reproduce it as a kink the cars have to swing round.
 */
const MIN_PLAUSIBLE_RADIUS_M = 60
/**
 * Tightest bend the finished alignment may hold, as a heading change per
 * sample. Kochi's sharpest revenue curves are ~100 m radius: at SAMPLE_M that
 * is 1.15° a step. What the spline leaves sharper than this at the despiked
 * sites is still the feed's jitter, and is eased out in place — only samples
 * over the limit move, and each only halfway to its neighbours per pass, so
 * a kink spreads into an arc while genuine curves are never touched.
 */
const MAX_TURN_RAD = (1.2 * Math.PI) / 180
/**
 * And curvature may not jump. Real track eases into a bend through a
 * transition spiral; a step from straight to full curvature between two
 * samples makes a rigid car chording the track meet its neighbour off-centre
 * at the coupling. This caps the change in heading rate between neighbouring
 * samples — full curvature is reached over ~12 samples, a 24 m spiral.
 */
const MAX_TURN_STEP_RAD = (0.1 * Math.PI) / 180
const RELAX_PASSES = 600

/** Index of the shape point nearest a station, for trimming at the terminals. */
function nearestIndex(pts: Vector3[], lat: number, lon: number): number {
  const { x, z } = project(lat, lon)
  let best = 0
  let bestD = Infinity
  pts.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** Turn angle (rad) at pts[i] and the shorter of its two legs (m). */
function turnAt(pts: Vector3[], i: number): { rad: number; leg: number } {
  const a = pts[i].clone().sub(pts[i - 1])
  const b = pts[i + 1].clone().sub(pts[i])
  const la = a.length()
  const lb = b.length()
  if (la < 1e-6 || lb < 1e-6) return { rad: 0, leg: 0 }
  const cos = Math.min(1, Math.max(-1, a.dot(b) / (la * lb)))
  return { rad: Math.acos(cos), leg: Math.min(la, lb) }
}

/** Drop any interior point that turns tighter than a train can. Iterates, since removing one can expose the next. */
function despike(pts: Vector3[]): Vector3[] {
  let out = pts.slice()
  for (let pass = 0; pass < 8; pass++) {
    let worstI = -1
    let worstR = Infinity
    for (let i = 1; i < out.length - 1; i++) {
      const { rad, leg } = turnAt(out, i)
      if (rad < 1e-4) continue
      const r = leg / rad
      if (r < worstR) {
        worstR = r
        worstI = i
      }
    }
    if (worstI < 0 || worstR >= MIN_PLAUSIBLE_RADIUS_M) break
    out = out.filter((_, i) => i !== worstI)
  }
  return out
}

function buildPoints(): AlignmentPoint[] {
  const raw = (gtfs.shapeUp as unknown as [number, number, number][]).map(([lat, lon]) => {
    const { x, z } = project(lat, lon)
    return new Vector3(x, RAIL_LEVEL_M, z)
  })
  // The shape runs on past Tripunithura and doubles back into the stabling
  // sidings — a hairpin no train in service ever takes. Keep terminal to
  // terminal, and give each end a straight run-out so the station box has
  // viaduct under it.
  const first = stations[0]
  const last = stations[stations.length - 1]
  const i0 = nearestIndex(raw, first.lat, first.lon)
  const i1 = nearestIndex(raw, last.lat, last.lon)
  const trimmed = raw.slice(Math.min(i0, i1), Math.max(i0, i1) + 1)

  const spaced: Vector3[] = []
  for (const p of trimmed) {
    if (!spaced.length || p.distanceTo(spaced[spaced.length - 1]) >= MIN_CONTROL_SPACING_M) {
      spaced.push(p)
    }
  }
  const control = despike(spaced)
  const head = control[0].clone().sub(control[1]).setY(0).normalize()
  const tail = control[control.length - 1].clone().sub(control[control.length - 2]).setY(0).normalize()
  control.unshift(control[0].clone().addScaledVector(head, TERMINAL_PAD_M))
  control.push(control[control.length - 1].clone().addScaledVector(tail, TERMINAL_PAD_M))

  // centripetal: the one parameterisation that neither loops nor cusps
  // between unevenly spaced control points
  const curve = new CatmullRomCurve3(control, false, 'centripetal')
  // the arc-length table the equal-spacing walk reads; ~10 m per entry
  curve.arcLengthDivisions = Math.ceil(curve.getLength() / 10)
  curve.updateArcLengths()
  const total = curve.getLength()
  const n = Math.max(2, Math.round(total / SAMPLE_M))
  const pts: Vector3[] = []
  for (let i = 0; i <= n; i++) pts.push(curve.getPointAt(i / n).setY(RAIL_LEVEL_M))
  relax(pts)

  const out: AlignmentPoint[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const tan = b.clone().sub(a).setY(0).normalize()
    out.push({ pos: pts[i], tan, gM: i > 0 ? out[i - 1].gM + pts[i].distanceTo(pts[i - 1]) : 0 })
  }
  return out
}

/** Ease any sample bending harder than MAX_TURN_RAD toward its neighbours until none does. */
function relax(pts: Vector3[]): void {
  const mid = new Vector3()
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    let moved = false
    for (let i = 2; i < pts.length - 2; i++) {
      const t = turnAt(pts, i).rad
      const jump = Math.max(
        Math.abs(t - turnAt(pts, i - 1).rad),
        Math.abs(t - turnAt(pts, i + 1).rad),
      )
      if (t <= MAX_TURN_RAD && jump <= MAX_TURN_STEP_RAD) continue
      mid.addVectors(pts[i - 1], pts[i + 1]).multiplyScalar(0.5)
      pts[i].lerp(mid, 0.5)
      moved = true
    }
    if (!moved) return
  }
}

export const alignment: AlignmentPoint[] = buildPoints()
/** Length of the drawn alignment in real world metres. */
export const G_MAX = alignment[alignment.length - 1].gM

/** Left-hand unit vector for a travel tangent (rotate +90° around Y). */
export function leftOf(tan: Vector3): Vector3 {
  return new Vector3(tan.z, 0, -tan.x)
}

/**
 * Distance along each direction's OWN rail, indexed like `alignment`.
 *
 * gM measures the centreline, but no train runs on it: each direction's track
 * is TRACK_OFFSET_M to the left of its travel, and round a bend the outer
 * rail is longer than the centreline and the inner one shorter — by
 * offset x curvature, which at an 80 m radius is 3.4%. Space three cars by
 * centreline metres and the couplers land 0.6 m apart on the outer track and
 * 0.6 m into each other on the inner one. Anything rigidly coupled — bogies
 * of a car, cars of a set — is laid out along these instead.
 */
const { TRACK_LEN, CURV } = (() => {
  const up = [0]
  const down = [0]
  const curv = [0]
  const left = new Vector3()
  for (let i = 1; i < alignment.length; i++) {
    const a = alignment[i - 1]
    const b = alignment[i]
    const ds = b.gM - a.gM
    // signed curvature (1/m): positive when the path bends toward the left of +s
    left.set(a.tan.z, 0, -a.tan.x)
    const kappa = ds > 0 ? b.tan.dot(left) / ds : 0
    curv.push(kappa)
    // dir 0 runs toward +s on the left-of-+s rail: inner on a left bend.
    // dir 1 runs toward -s on the left of ITS travel, i.e. the other rail.
    up.push(up[i - 1] + ds * (1 - TRACK_OFFSET_M * kappa))
    down.push(down[i - 1] + ds * (1 + TRACK_OFFSET_M * kappa))
  }
  return { TRACK_LEN: [up, down] as [number[], number[]], CURV: curv }
})()

/**
 * Signed curvature of the centreline at a geometric distance, 1/m: positive
 * bending toward the left of +s, zero on the straight. 1/curvature is the
 * radius. The viaduct bends its spans to this; drive mode reads it for how
 * fast a curve can be taken.
 */
export function curvatureAtG(gM: number): number {
  return tableAtG(CURV, gM)
}

/** Interpolate a monotonic per-sample table at a centreline distance. */
function tableAtG(table: number[], gM: number): number {
  const { i, f } = segG(gM)
  return table[i] + (table[i + 1] - table[i]) * f
}

/** Invert a monotonic per-sample table: table value -> centreline distance. */
function gAtTable(table: number[], v: number): number {
  const n = table.length - 1
  if (v <= table[0]) return 0
  if (v >= table[n]) return G_MAX
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (table[mid] <= v) lo = mid
    else hi = mid
  }
  const f = (v - table[lo]) / (table[lo + 1] - table[lo])
  return alignment[lo].gM + (alignment[lo + 1].gM - alignment[lo].gM) * f
}

/**
 * Step `metres` along the rail that direction `dir` runs on, from a chainage,
 * and return the chainage you land on. For anything rigidly coupled: use this
 * between a car's bogies and between the cars of a set. See TRACK_LEN.
 */
export function trackOffsetBy(sKm: number, metres: number, dir: 0 | 1): number {
  const table = TRACK_LEN[dir]
  return sAtG(gAtTable(table, tableAtG(table, gAt(sKm)) + metres))
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

const _bogieF = { pos: new Vector3(), heading: new Vector3() }
const _bogieR = { pos: new Vector3(), heading: new Vector3() }

/**
 * Where a car body sits when its centre is at sKm: on its two bogies, one
 * half a bogie spacing ahead of the centre and one behind, each on the rail.
 * The body is the chord between them, so `heading` is bogie-to-bogie and
 * `pos` their midpoint. Posing a rigid car on the tangent at its centre
 * instead lets adjacent cars pivot into each other around every bend.
 */
export function carPoseAt(
  sKm: number,
  dir: 0 | 1,
  out: { pos: Vector3; heading: Vector3 },
): void {
  const ahead = dir === 0 ? BOGIE_SPACING_M / 2 : -BOGIE_SPACING_M / 2
  poseAt(trackOffsetBy(sKm, ahead, dir), dir, _bogieF)
  poseAt(trackOffsetBy(sKm, -ahead, dir), dir, _bogieR)
  out.pos.addVectors(_bogieF.pos, _bogieR.pos).multiplyScalar(0.5)
  out.heading.subVectors(_bogieF.pos, _bogieR.pos).setY(0).normalize()
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
