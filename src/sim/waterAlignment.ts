/**
 * Water routes in world space: per-route polylines from the generated
 * water.json, distance-parameterised like the metro alignment. Boats float
 * just above the satellite water plane.
 */
import { Vector3 } from 'three'
import { project } from './projection'
import { terminals, waterRoutes, type WaterRoute } from './waterEngine'

export const BOAT_WATERLINE_Y = 0.55

interface WaterPoint {
  pos: Vector3
  tan: Vector3
  sKm: number
}

function buildRoute(route: WaterRoute): WaterPoint[] {
  const pts = route.path.map(([lat, lon, d]) => {
    const { x, z } = project(lat, lon)
    return { pos: new Vector3(x, BOAT_WATERLINE_Y, z), sKm: d }
  })
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)].pos
    const b = pts[Math.min(pts.length - 1, i + 1)].pos
    const tan = b.clone().sub(a).setY(0).normalize()
    return { pos: p.pos, tan, sKm: p.sKm }
  })
}

export const waterAlignments = new Map<string, WaterPoint[]>(
  waterRoutes.map((r) => [r.id, buildRoute(r)]),
)

const _tan = new Vector3()

/** Position + travel heading along a route (dir 1 = reversed). */
export function poseAtWater(
  routeId: string,
  sKm: number,
  dir: 0 | 1,
  out: { pos: Vector3; heading: Vector3 },
): void {
  const pts = waterAlignments.get(routeId)
  if (!pts || pts.length < 2) return
  const s = Math.min(Math.max(sKm, pts[0].sKm), pts[pts.length - 1].sKm)
  let lo = 0
  let hi = pts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].sKm <= s) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[hi]
  const f = b.sKm === a.sKm ? 0 : (s - a.sKm) / (b.sKm - a.sKm)
  out.pos.lerpVectors(a.pos, b.pos, f)
  _tan.lerpVectors(a.tan, b.tan, f).normalize()
  out.heading.copy(dir === 0 ? _tan : _tan.negate())
}

/** World poses for every terminal (pontoon anchor + boarding orientation). */
export const terminalPoses = terminals.map((t, i) => {
  const { x, z } = project(t.lat, t.lon)
  // orient the pontoon along the tangent of the first route that stops here
  const route = waterRoutes.find((r) => r.stops.some((s) => s.term === i))
  const tan = new Vector3(1, 0, 0)
  if (route) {
    const stop = route.stops.find((s) => s.term === i)!
    const tmp = { pos: new Vector3(), heading: new Vector3() }
    poseAtWater(route.id, stop.km, 0, tmp)
    tan.copy(tmp.heading)
  }
  return { terminal: t, index: i, pos: new Vector3(x, BOAT_WATERLINE_Y, z), tan }
})
