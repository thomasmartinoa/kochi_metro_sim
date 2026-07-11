/**
 * Fetch + stitch Esri World Imagery tiles for the Kochi bbox into one ground
 * texture: public/textures/kochi-sat.jpg, plus src/data/kochi-sat-meta.json
 * with the exact geographic bounds of the stitched image.
 *
 * Attribution required in-app: "Imagery © Esri, Maxar, Earthstar Geographics".
 * Run: node scripts/fetch-satellite.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const Z = 14
const BBOX = { south: 9.88, north: 10.16, west: 76.2, east: 76.44 }
const URL = (z, y, x) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`

const n = 2 ** Z
const lon2x = (lon) => Math.floor(((lon + 180) / 360) * n)
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)
}
const x2lon = (x) => (x / n) * 360 - 180
const y2lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI

const x0 = lon2x(BBOX.west)
const x1 = lon2x(BBOX.east)
const y0 = lat2y(BBOX.north) // smaller y = north
const y1 = lat2y(BBOX.south)
const cols = x1 - x0 + 1
const rows = y1 - y0 + 1
console.log(`z${Z}: ${cols}x${rows} = ${cols * rows} tiles`)

async function fetchTile(x, y, attempt = 0) {
  try {
    const res = await fetch(URL(Z, y, x))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
      return fetchTile(x, y, attempt + 1)
    }
    throw new Error(`tile ${x},${y}: ${e.message}`)
  }
}

const jobs = []
for (let ty = y0; ty <= y1; ty++)
  for (let tx = x0; tx <= x1; tx++) jobs.push({ tx, ty })

const tiles = []
const CONC = 8
for (let i = 0; i < jobs.length; i += CONC) {
  const batch = jobs.slice(i, i + CONC)
  const bufs = await Promise.all(batch.map((j) => fetchTile(j.tx, j.ty)))
  batch.forEach((j, k) =>
    tiles.push({ input: bufs[k], left: (j.tx - x0) * 256, top: (j.ty - y0) * 256 }),
  )
  process.stdout.write(`\r${Math.min(i + CONC, jobs.length)}/${jobs.length}`)
}
console.log('\nstitching...')

const outDir = join(root, 'public', 'textures')
mkdirSync(outDir, { recursive: true })
await sharp({
  create: { width: cols * 256, height: rows * 256, channels: 3, background: '#375a3a' },
})
  .composite(tiles)
  .jpeg({ quality: 80 })
  .toFile(join(outDir, 'kochi-sat.jpg'))

const meta = {
  north: y2lat(y0),
  south: y2lat(y1 + 1),
  west: x2lon(x0),
  east: x2lon(x1 + 1),
  zoom: Z,
  px: [cols * 256, rows * 256],
  attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
}
writeFileSync(join(root, 'src', 'data', 'kochi-sat-meta.json'), JSON.stringify(meta, null, 1))
console.log('done:', meta)
