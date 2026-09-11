/**
 * Where the line is too curved for line speed, and how fast it may be taken.
 * The drive HUD looks ahead through DriveState.ahead; this is the same rule
 * applied once over the whole line so the boards can be planted.
 */
import { curveLimitKmh, LINE_SPEED_KMH, type DriveEnv } from './drive'

export interface SpeedRestriction {
  fromG: number
  toG: number
  /** rounded down to 5 km/h, as a board would read */
  limitKmh: number
  /** tightest radius in the stretch */
  radiusM: number
}

const STEP_M = 10
/** two restrictions closer than this are one board */
const MERGE_GAP_M = 40
/**
 * A stretch shorter than this is a flicker of curvature in the resampled
 * alignment, not a bend anyone would sign. Kochi's real restrictions run
 * 50-180 m; the blips ran 0-20.
 */
const MIN_LENGTH_M = 30

export function curveRestrictions(
  env: DriveEnv,
  fromG: number,
  toG: number,
  lineKmh = LINE_SPEED_KMH,
): SpeedRestriction[] {
  const out: SpeedRestriction[] = []
  let open: SpeedRestriction | null = null
  for (let g = fromG; g <= toG; g += STEP_M) {
    const kappa = env.curvatureAtG(g)
    const limit = curveLimitKmh(kappa)
    if (limit >= lineKmh) continue
    const radiusM = 1 / Math.abs(kappa)
    if (open && g - open.toG <= MERGE_GAP_M) {
      open.toG = g
      open.limitKmh = Math.min(open.limitKmh, limit)
      open.radiusM = Math.min(open.radiusM, radiusM)
    } else {
      if (open) out.push(open)
      open = { fromG: g, toG: g, limitKmh: limit, radiusM }
    }
  }
  if (open) out.push(open)
  const kept = out.filter((r) => r.toG - r.fromG >= MIN_LENGTH_M)
  for (const r of kept) r.limitKmh = Math.floor(r.limitKmh / 5) * 5
  return kept
}
