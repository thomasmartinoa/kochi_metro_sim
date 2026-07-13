/**
 * Kochi Water Metro schedule generator.
 * No GTFS exists for the Water Metro, so this synthesises a deterministic
 * timetable from the published service pattern (routes, headways, journey
 * times — see docs/PRD-PHASE2.md §2).
 *
 * Route geometry is computed by A* over a navigation mesh built from the real
 * OSM water polygons (data/water-tris.json, exported from the Blosm scene):
 * terminals snap to the nearest water, legs are routed through water, and the
 * final polyline is simplified only where the shortcut stays on water. So
 * boats can never sail over land.
 *
 * Run: node scripts/gen-water-schedule.mjs         (writes src/data/water.json)
 *      node scripts/gen-water-schedule.mjs --check (report only)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- terminals
const TERMINALS = [
  { id: 'HICT', name: 'High Court', nameMl: 'ഹൈക്കോടതി', lat: 9.9908, lon: 76.2721 },
  { id: 'VYPN', name: 'Vypin', nameMl: 'വൈപ്പിൻ', lat: 9.9944, lon: 76.2662 },
  { id: 'BLGT', name: 'Bolgatty', nameMl: 'ബോൾഗാട്ടി', lat: 10.0027, lon: 76.2739 },
  { id: 'SCHT', name: 'South Chittoor', nameMl: 'സൗത്ത് ചിറ്റൂർ', lat: 10.027, lon: 76.2805 },
  { id: 'CHRN', name: 'Cheranalloor', nameMl: 'ചേരാനല്ലൂർ', lat: 10.0405, lon: 76.2824 },
  { id: 'ELOR', name: 'Eloor', nameMl: 'ഏലൂർ', lat: 10.0538, lon: 76.2928 },
  { id: 'VYTL', name: 'Vyttila', nameMl: 'വൈറ്റില', lat: 9.9663, lon: 76.3163 },
  { id: 'KKND', name: 'Kakkanad', nameMl: 'കാക്കനാട്', lat: 10.0172, lon: 76.3357 },
  { id: 'FTKC', name: 'Fort Kochi', nameMl: 'ഫോർട്ട് കൊച്ചി', lat: 9.9678, lon: 76.2442 },
  { id: 'MTNC', name: 'Mattancherry', nameMl: 'മട്ടാഞ്ചേരി', lat: 9.956, lon: 76.2585 },
  { id: 'WLGN', name: 'Willingdon Island', nameMl: 'വെല്ലിംഗ്ടൺ', lat: 9.9655, lon: 76.2625 },
]

// ------------------------------------------------------------------- routes
// path lists terminal ids in stop order; geometry comes from water routing.
const ROUTES = [
  {
    id: 'W1',
    name: 'High Court ⇄ Vypin',
    color: '#22D3EE',
    speedKmh: 12,
    dwellSec: 240,
    window: [6.3 * 3600, 21 * 3600],
    headway: { peak: 15 * 60, off: 20 * 60 },
    stops: ['HICT', 'VYPN'],
  },
  {
    id: 'W2',
    name: 'Vyttila ⇄ Kakkanad',
    color: '#34D399',
    speedKmh: 13,
    dwellSec: 240,
    window: [6.5 * 3600, 20 * 3600],
    headway: { peak: 20 * 60, off: 30 * 60 },
    stops: ['VYTL', 'KKND'],
  },
  {
    id: 'W3',
    name: 'High Court ⇄ Eloor',
    color: '#FBBF24',
    speedKmh: 13,
    dwellSec: 60,
    window: [7 * 3600, 19.5 * 3600],
    headway: { peak: 30 * 60, off: 40 * 60 },
    stops: ['HICT', 'BLGT', 'SCHT', 'CHRN', 'ELOR'],
  },
  {
    id: 'W4',
    name: 'Fort Kochi ⇄ High Court',
    color: '#A78BFA',
    speedKmh: 12,
    dwellSec: 90,
    window: [7 * 3600, 19 * 3600],
    headway: { peak: 30 * 60, off: 30 * 60 },
    stops: ['FTKC', 'MTNC', 'WLGN', 'HICT'],
  },
]

const PEAKS = [
  [7 * 3600, 10 * 3600],
  [16.5 * 3600, 20 * 3600],
]

// ------------------------------------------------------- water navigation
const M_LAT = 110574
const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180)
const M_LON0 = mLon(10.0)

const tris = JSON.parse(readFileSync(join(root, 'data', 'water-tris.json'), 'utf8'))

function inTri(p, a, b, c) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
  const d1 = s(p, a, b)
  const d2 = s(p, b, c)
  const d3 = s(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

// spatial hash of triangles (for point-in-water tests)
const TCELL = 0.004
const triGrid = new Map()
tris.forEach((t, i) => {
  const lats = t.map((v) => v[0])
  const lons = t.map((v) => v[1])
  for (let la = Math.floor(Math.min(...lats) / TCELL); la <= Math.floor(Math.max(...lats) / TCELL); la++)
    for (let lo = Math.floor(Math.min(...lons) / TCELL); lo <= Math.floor(Math.max(...lons) / TCELL); lo++) {
      const k = la + ':' + lo
      if (!triGrid.has(k)) triGrid.set(k, [])
      triGrid.get(k).push(i)
    }
})
function inWater(lat, lon) {
  const k = Math.floor(lat / TCELL) + ':' + Math.floor(lon / TCELL)
  for (const i of triGrid.get(k) ?? []) {
    const t = tris[i]
    if (inTri([lat, lon], t[0], t[1], t[2])) return true
  }
  return false
}
// OSM waterway centerlines (rivers/canals) — cover canals that have no
// water polygons (e.g. Kadambrayar to Kakkanad). Fetched by Overpass, see
// data/waterways.json.
const waterways = JSON.parse(readFileSync(join(root, 'data', 'waterways.json'), 'utf8'))
const WCELL = 0.002
const waySegGrid = new Map() // cell -> [ [a, b], ... ] segments
for (const w of waterways) {
  for (let i = 1; i < w.pts.length; i++) {
    const a = w.pts[i - 1]
    const b = w.pts[i]
    for (
      let la = Math.floor(Math.min(a[0], b[0]) / WCELL) - 1;
      la <= Math.floor(Math.max(a[0], b[0]) / WCELL) + 1;
      la++
    )
      for (
        let lo = Math.floor(Math.min(a[1], b[1]) / WCELL) - 1;
        lo <= Math.floor(Math.max(a[1], b[1]) / WCELL) + 1;
        lo++
      ) {
        const k = la + ':' + lo
        if (!waySegGrid.has(k)) waySegGrid.set(k, [])
        waySegGrid.get(k).push([a, b])
      }
  }
}
function nearWaterway(lat, lon, maxM = 60) {
  const k = Math.floor(lat / WCELL) + ':' + Math.floor(lon / WCELL)
  for (const [a, b] of waySegGrid.get(k) ?? []) {
    // point-to-segment distance in metres
    const ax = (lon - a[1]) * M_LON0
    const ay = (lat - a[0]) * M_LAT
    const bx = (b[1] - a[1]) * M_LON0
    const by = (b[0] - a[0]) * M_LAT
    const len2 = bx * bx + by * by
    const t = len2 ? Math.max(0, Math.min(1, (ax * bx + ay * by) / len2)) : 0
    const d = Math.hypot(ax - bx * t, ay - by * t)
    if (d < maxM) return true
  }
  return false
}
const wet = (lat, lon) => inWater(lat, lon) || nearWaterway(lat, lon)

/** On-water test tolerating dry runs ≤ 70 m (passing under bridges). */
function segOnWater(a, b) {
  const STEP = 12
  const len = Math.hypot((b[0] - a[0]) * M_LAT, (b[1] - a[1]) * M_LON0)
  const steps = Math.max(2, Math.ceil(len / STEP))
  let dryRun = 0
  for (let s = 1; s < steps; s++) {
    const la = a[0] + ((b[0] - a[0]) * s) / steps
    const lo = a[1] + ((b[1] - a[1]) * s) / steps
    if (!wet(la, lo)) {
      dryRun += len / steps
      if (dryRun > 70) return false
    } else dryRun = 0
  }
  return true
}

// ---- unified navigation graph: water-polygon centroids + waterway vertices
const distM = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON0)

const nodes = tris.map((t) => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3])
const nodeCost = new Array(nodes.length).fill(1) // polygon water = open water
const adj = nodes.map(() => [])
// midpoint of the shared edge between two adjacent triangles — inserted into
// paths so centroid→centroid hops can't cut across concave headlands
const adjMid = new Map()
{
  const edgeMap = new Map()
  const vkey = (v) => v[0].toFixed(6) + ',' + v[1].toFixed(6)
  tris.forEach((t, i) => {
    for (let e = 0; e < 3; e++) {
      const va = t[e]
      const vb = t[(e + 1) % 3]
      const a = vkey(va)
      const b = vkey(vb)
      const k = a < b ? a + '|' + b : b + '|' + a
      const other = edgeMap.get(k)
      if (other !== undefined) {
        adj[i].push(other)
        adj[other].push(i)
        const mid = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2]
        adjMid.set(Math.min(i, other) + '|' + Math.max(i, other), mid)
      } else edgeMap.set(k, i)
    }
  })
}
// waterway polyline vertices as extra nodes (streams cost more — last resort)
for (const w of waterways) {
  const cost = w.type === 'stream' ? 4 : w.type === 'canal' ? 1.15 : 1
  let prev = -1
  for (const p of w.pts) {
    const idx = nodes.length
    nodes.push([p[0], p[1]])
    nodeCost.push(cost)
    adj.push([])
    if (prev >= 0) {
      adj[idx].push(prev)
      adj[prev].push(idx)
    }
    prev = idx
  }
}

const CCELL = 0.002
const nodeGrid = new Map()
nodes.forEach((c, i) => {
  const k = Math.floor(c[0] / CCELL) + ':' + Math.floor(c[1] / CCELL)
  if (!nodeGrid.has(k)) nodeGrid.set(k, [])
  nodeGrid.get(k).push(i)
})

// OSM splits waterways at bridges; polygons and centerlines are separate
// layers. Stitch everything: link nodes from different components within 80 m
// (bridge gaps, canal-to-lake joins, centerline-to-polygon joins).
{
  const comp = new Array(nodes.length).fill(-1)
  let nc = 0
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] !== -1) continue
    const st = [i]
    comp[i] = nc
    while (st.length) {
      const c = st.pop()
      for (const n of adj[c])
        if (comp[n] === -1) {
          comp[n] = nc
          st.push(n)
        }
    }
    nc++
  }
  let links = 0
  const linked = new Set()
  for (const [key, list] of nodeGrid) {
    const [la0, lo0] = key.split(':').map(Number)
    for (const i of list) {
      for (let la = la0 - 1; la <= la0 + 1; la++)
        for (let lo = lo0 - 1; lo <= lo0 + 1; lo++)
          for (const j of nodeGrid.get(la + ':' + lo) ?? []) {
            if (j <= i || comp[i] === comp[j]) continue
            const lk = i + ':' + comp[j]
            if (linked.has(lk)) continue
            if (distM(nodes[i], nodes[j]) < 80 && segOnWater(nodes[i], nodes[j])) {
              adj[i].push(j)
              adj[j].push(i)
              linked.add(lk)
              links++
            }
          }
    }
  }
  console.log(`nav graph: ${nodes.length} nodes, ${nc} components, ${links} stitch edges`)
}

// post-stitch components (used to snap onto NAVIGABLE water, not pond slivers)
const compOf = new Array(nodes.length).fill(-1)
const compSize = []
{
  let nc = 0
  for (let i = 0; i < nodes.length; i++) {
    if (compOf[i] !== -1) continue
    const st = [i]
    compOf[i] = nc
    let size = 0
    while (st.length) {
      const c = st.pop()
      size++
      for (const n of adj[c])
        if (compOf[n] === -1) {
          compOf[n] = nc
          st.push(n)
        }
    }
    compSize.push(size)
    nc++
  }
  console.log(`post-stitch: ${nc} components, largest ${Math.max(...compSize)}`)
}

function snapToWater(lat, lon, minComp = 300) {
  let fallback = null
  for (let ring = 1; ring < 80; ring++) {
    let best = -1
    let bestD = Infinity
    const la0 = Math.floor(lat / CCELL)
    const lo0 = Math.floor(lon / CCELL)
    for (let la = la0 - ring; la <= la0 + ring; la++)
      for (let lo = lo0 - ring; lo <= lo0 + ring; lo++)
        for (const i of nodeGrid.get(la + ':' + lo) ?? []) {
          const d = distM([lat, lon], nodes[i])
          if (d < bestD && compSize[compOf[i]] >= minComp) {
            bestD = d
            best = i
          }
          if (!fallback || d < fallback.dist) fallback = { idx: i, dist: d }
        }
    if (best >= 0) return { idx: best, dist: bestD }
  }
  if (fallback) return fallback
  throw new Error(`no water near ${lat},${lon}`)
}

function astar(start, goal) {
  const open = new Set([start])
  const g = new Map([[start, 0]])
  const came = new Map()
  const f = new Map([[start, distM(nodes[start], nodes[goal])]])
  while (open.size) {
    let cur = -1
    let best = Infinity
    for (const n of open) {
      const fn = f.get(n) ?? Infinity
      if (fn < best) {
        best = fn
        cur = n
      }
    }
    if (cur === goal) {
      const path = [cur]
      while (came.has(cur)) {
        cur = came.get(cur)
        path.push(cur)
      }
      return path.reverse()
    }
    open.delete(cur)
    for (const nb of adj[cur]) {
      const w = (nodeCost[cur] + nodeCost[nb]) / 2
      const ng = g.get(cur) + distM(nodes[cur], nodes[nb]) * w
      if (ng < (g.get(nb) ?? Infinity)) {
        came.set(nb, cur)
        g.set(nb, ng)
        f.set(nb, ng + distM(nodes[nb], nodes[goal]))
        open.add(nb)
      }
    }
  }
  throw new Error(`no water path ${start}->${goal}`)
}

/** Water-aware simplification: only shortcut where the straight run stays wet. */
function simplify(chain, eps = 18) {
  const out = []
  const rec = (i0, i1) => {
    const a = chain[i0]
    const b = chain[i1]
    let imax = -1
    let dmax = -1
    const abLat = b[0] - a[0]
    const abLon = b[1] - a[1]
    const len2 = abLat * abLat + abLon * abLon
    for (let i = i0 + 1; i < i1; i++) {
      const t = len2 ? ((chain[i][0] - a[0]) * abLat + (chain[i][1] - a[1]) * abLon) / len2 : 0
      const px = a[0] + abLat * Math.max(0, Math.min(1, t))
      const py = a[1] + abLon * Math.max(0, Math.min(1, t))
      const d = distM(chain[i], [px, py])
      if (d > dmax) {
        dmax = d
        imax = i
      }
    }
    if (imax === -1 || (dmax <= eps && segOnWater(a, b))) {
      out.push(i1)
      return
    }
    rec(i0, imax)
    rec(imax, i1)
  }
  out.push(0)
  rec(0, chain.length - 1)
  return out.map((i) => chain[i])
}

// --------------------------------------------------------------- synthesis
function headwayAt(route, t) {
  return PEAKS.some(([a, b]) => t >= a && t < b) ? route.headway.peak : route.headway.off
}

const termIdx = Object.fromEntries(TERMINALS.map((t, i) => [t.id, i]))
// dock = terminal snapped onto water
const docks = TERMINALS.map((t) => {
  const s = snapToWater(t.lat, t.lon)
  return { ...t, lat: +nodes[s.idx][0].toFixed(6), lon: +nodes[s.idx][1].toFixed(6), snapM: s.dist }
})

function buildRoute(r) {
  // route each leg through water, concatenate, remember stop positions
  let chain = []
  const stopChainIdx = []
  for (let i = 0; i < r.stops.length; i++) {
    const d = docks[termIdx[r.stops[i]]]
    if (i === 0) {
      chain.push([d.lat, d.lon])
      stopChainIdx.push(0)
      continue
    }
    const prev = docks[termIdx[r.stops[i - 1]]]
    const legIdx = astar(snapToWater(prev.lat, prev.lon).idx, snapToWater(d.lat, d.lon).idx)
    // expand with shared-edge midpoints between adjacent triangles
    const leg = []
    for (let k = 0; k < legIdx.length; k++) {
      if (k > 0) {
        const a = legIdx[k - 1]
        const b = legIdx[k]
        const mid = adjMid.get(Math.min(a, b) + '|' + Math.max(a, b))
        if (mid) leg.push(mid)
      }
      leg.push(nodes[legIdx[k]])
    }
    chain = chain.concat(leg.slice(1))
    stopChainIdx.push(chain.length - 1)
  }
  // simplify while pinning stop vertices, then relax zig-zags (water-safe)
  let path = []
  const stopsKm = []
  for (let s = 0; s < stopChainIdx.length - 1; s++) {
    const part = simplify(chain.slice(stopChainIdx[s], stopChainIdx[s + 1] + 1))
    // in-place sequential relaxation so each move is validated against the
    // CURRENT neighbours (parallel updates broke water guarantees)
    for (let iter = 0; iter < 6; iter++) {
      for (let i = 1; i < part.length - 1; i++) {
        const q = [
          (part[i - 1][0] + part[i + 1][0]) / 4 + part[i][0] / 2,
          (part[i - 1][1] + part[i + 1][1]) / 4 + part[i][1] / 2,
        ]
        if (wet(q[0], q[1]) && segOnWater(part[i - 1], q) && segOnWater(q, part[i + 1])) {
          part[i] = q
        }
      }
    }
    if (s > 0) part.shift()
    path = path.concat(part)
    if (s === 0) stopsKm.push(0)
  }
  // cumulative distance + stop kms
  let dist = 0
  const stopSet = new Map()
  stopChainIdx.forEach((ci, s) => stopSet.set(JSON.stringify([chain[ci][0], chain[ci][1]].map((x) => +x.toFixed(6))), s))
  const outPath = []
  const kmAtStop = new Array(r.stops.length).fill(0)
  path.forEach((p, i) => {
    if (i > 0) dist += distM(path[i - 1], p) / 1000
    outPath.push([+p[0].toFixed(6), +p[1].toFixed(6), +dist.toFixed(4)])
    const key = JSON.stringify([+p[0].toFixed(6), +p[1].toFixed(6)])
    if (stopSet.has(key)) kmAtStop[stopSet.get(key)] = +dist.toFixed(4)
  })

  const legSec = []
  for (let i = 1; i < r.stops.length; i++) legSec.push(((kmAtStop[i] - kmAtStop[i - 1]) / r.speedKmh) * 3600)

  const mkTrips = (dir) => {
    const trips = []
    let n = 0
    const stopsArr = r.stops.map((id) => termIdx[id])
    for (let t = r.window[0] + (dir === 1 ? headwayAt(r, r.window[0]) / 2 : 0); t <= r.window[1]; t += headwayAt(r, t)) {
      const order = dir === 0 ? stopsArr : [...stopsArr].reverse()
      const legs = dir === 0 ? legSec : [...legSec].reverse()
      let clock = t
      const tripStops = order.map((termI, i) => {
        const arr = Math.round(clock)
        const dwell = i === 0 || i === order.length - 1 ? 30 : r.dwellSec
        const dep = arr + dwell
        if (i < legs.length) clock = dep + legs[i]
        return [termI, arr, dep]
      })
      trips.push({ id: `${r.id}_${dir}_${n++}`, dir, stops: tripStops })
    }
    return trips
  }

  return {
    id: r.id,
    name: r.name,
    color: r.color,
    speedKmh: r.speedKmh,
    path: outPath,
    stops: r.stops.map((id, s) => ({ term: termIdx[id], km: kmAtStop[s] })),
    lengthKm: +dist.toFixed(3),
    window: r.window,
    trips: [...mkTrips(0), ...mkTrips(1)],
  }
}

// ------------------------------------------------------------------- main
const routes = ROUTES.map(buildRoute)

// final gate: every path segment on water
let bad = 0
for (const r of routes) {
  for (let i = 1; i < r.path.length; i++) {
    if (!segOnWater(r.path[i - 1], r.path[i])) {
      console.log(`OFF WATER: ${r.id} seg ${i - 1}->${i} @ ${r.path[i - 1][0]},${r.path[i - 1][1]}`)
      bad++
    }
  }
}
for (const d of docks) {
  if (d.snapM > 400) console.log(`NOTE: ${d.id} snapped ${d.snapM.toFixed(0)} m to reach water`)
}
console.log(bad === 0 ? 'water validation: all route segments on water ✓' : `water validation: ${bad} bad segments`)
if (process.argv.includes('--check')) process.exit(bad ? 1 : 0)
if (bad) process.exit(1)

const bundle = {
  meta: {
    generatedAt: new Date().toISOString(),
    note: 'Synthesised from published Kochi Water Metro service patterns — no official GTFS exists',
    attribution: 'Route/terminal facts: watermetro.co.in, Wikipedia',
  },
  terminals: docks.map(({ snapM, ...t }) => t),
  routes,
}
const out = join(root, 'src', 'data', 'water.json')
writeFileSync(out, JSON.stringify(bundle))
const tripCount = routes.reduce((a, r) => a + r.trips.length, 0)
console.log(
  `wrote ${out}: ${bundle.terminals.length} terminals, ${routes.length} routes, ${tripCount} trips, ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB`,
)
for (const r of routes) {
  const j = r.trips[0]
  const e2e = ((j.stops.at(-1)[1] - j.stops[0][2]) / 60) | 0
  console.log(`  ${r.id} ${r.name}: ${r.lengthKm} km, ${r.trips.length} trips, e2e ${e2e} min, path pts ${r.path.length}`)
}
