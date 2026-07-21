/**
 * One-off: rebase Blosm-derived latitudes onto true WGS84.
 *
 * Several data files were produced by reading geometry out of a Blender/Blosm
 * scene and converting local metres back to lat/lon with M_LAT = 110574 (the
 * true meridian arc at Kochi). But Blosm projects with SPHERICAL MERCATOR
 * scaling — 111319.49 m/deg (pi * WGS84 equatorial radius / 180). So every
 * latitude came out stretched away from the scene origin by 0.674%: ~100 m
 * over 15 km. That is why the water routes and the old road-snapped viaduct
 * drifted off the satellite imagery.
 *
 * Blosm northing  n = (lat_true - lat0) * 111319.49
 * what we recorded: lat_bad = lat0 + n / 110574
 * therefore:        lat_true = lat0 + (lat_bad - lat0) * 110574 / 111319.49
 *
 * Longitude needs no fix: it was converted with 111320*cos(lat0) against
 * Blosm's 111319.49*cos(lat0) — a 5 ppm difference (< 0.1 m across the map).
 *
 * Run: node scripts/fix-blosm-latitude.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')

/** Origin of the Blender scene these files were exported from. */
const LAT0 = 10.021240234375
const M_LAT_ASSUMED = 110574
const M_LAT_BLOSM = (Math.PI * 6378137) / 180 // 111319.49

const fix = (latBad) => LAT0 + ((latBad - LAT0) * M_LAT_ASSUMED) / M_LAT_BLOSM
const round6 = (v) => +v.toFixed(6)

const waterPath = join(root, 'src', 'data', 'water.json')
const water = JSON.parse(readFileSync(waterPath, 'utf8'))

let maxShift = 0
const track = (before, after) => {
  const d = Math.abs(after - before) * M_LAT_BLOSM
  if (d > maxShift) maxShift = d
}

for (const t of water.terminals) {
  const before = t.lat
  t.lat = round6(fix(before))
  track(before, t.lat)
}
for (const r of water.routes) {
  for (const p of r.path) {
    const before = p[0]
    p[0] = round6(fix(before))
    track(before, p[0])
  }
}

console.log(
  `water.json: ${water.terminals.length} terminals, ` +
    `${water.routes.reduce((a, r) => a + r.path.length, 0)} route points`,
)
console.log(`max latitude shift applied: ${maxShift.toFixed(1)} m`)

if (DRY) {
  console.log('(dry run — nothing written)')
} else {
  writeFileSync(waterPath, JSON.stringify(water))
  console.log('wrote', waterPath)
}
