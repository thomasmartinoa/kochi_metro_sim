/**
 * parse-gtfs.mjs — converts the raw KMRL GTFS feed (data/gtfs/*.txt)
 * into a compact typed JSON bundle at src/data/gtfs.json.
 *
 * Contains data provided by Kochi Metro Rail Limited.
 * Run: node scripts/parse-gtfs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const gtfsDir = join(root, 'data', 'gtfs')

/** Minimal CSV parser (handles quoted fields). Returns array of row objects. */
function csv(file) {
  const text = readFileSync(join(gtfsDir, file), 'utf8').replace(/^﻿/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const parseLine = (line) => {
    const out = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
        } else cur += c
      } else if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur)
    return out
  }
  const header = parseLine(lines[0])
  return lines.slice(1).map((l) => {
    const vals = parseLine(l)
    const row = {}
    header.forEach((h, i) => (row[h] = vals[i] ?? ''))
    return row
  })
}

/** "HH:MM:SS" (may exceed 24h per GTFS) -> seconds since service-day midnight */
const toSec = (t) => {
  const [h, m, s] = t.split(':').map(Number)
  return h * 3600 + m * 60 + s
}

// ---------- stops ----------
const stopsRaw = csv('stops.txt')
const translations = csv('translations.txt')
const tName = (id, lang) =>
  translations.find(
    (t) => t.table_name === 'stops' && t.field_name === 'stop_name' && t.language === lang && t.record_id === id,
  )?.translation

// ---------- shapes: canonical "up" axis = R1_0 (Aluva -> Tripunithura) ----------
const shapesRaw = csv('shapes.txt')
const shapeUp = shapesRaw
  .filter((r) => r.shape_id === 'R1_0')
  .sort((a, b) => +a.shape_pt_sequence - +b.shape_pt_sequence)
  .map((r) => [+r.shape_pt_lat, +r.shape_pt_lon, +r.shape_dist_traveled])
const shapeDown = shapesRaw
  .filter((r) => r.shape_id === 'R1_1')
  .sort((a, b) => +a.shape_pt_sequence - +b.shape_pt_sequence)
  .map((r) => [+r.shape_pt_lat, +r.shape_pt_lon, +r.shape_dist_traveled])
const lineLengthKm = shapeUp[shapeUp.length - 1][2]

// ---------- trips + stop_times ----------
const tripsRaw = csv('trips.txt')
const stopTimesRaw = csv('stop_times.txt')
const stByTrip = new Map()
for (const st of stopTimesRaw) {
  if (!stByTrip.has(st.trip_id)) stByTrip.set(st.trip_id, [])
  stByTrip.get(st.trip_id).push(st)
}
for (const arr of stByTrip.values()) arr.sort((a, b) => +a.stop_sequence - +b.stop_sequence)

// Station order along the up axis: use a full-length dir-0 trip's stop order.
const fullUpTrip = tripsRaw.find((t) => t.direction_id === '0' && (stByTrip.get(t.trip_id)?.length ?? 0) === stopsRaw.length)
const upOrder = stByTrip.get(fullUpTrip.trip_id).map((st) => st.stop_id)

// distance of each station along the up axis (km) from that trip's shape_dist_traveled
const sKmByStop = new Map()
for (const st of stByTrip.get(fullUpTrip.trip_id)) sKmByStop.set(st.stop_id, +st.shape_dist_traveled)

const stations = upOrder.map((id, idx) => {
  const s = stopsRaw.find((r) => r.stop_id === id)
  return {
    id,
    order: idx,
    name: s.stop_name,
    nameMl: tName(id, 'ml') ?? '',
    nameHi: tName(id, 'hi') ?? '',
    lat: +s.stop_lat,
    lon: +s.stop_lon,
    sKm: sKmByStop.get(id),
  }
})
const stopIdx = new Map(stations.map((s) => [s.id, s.order]))

// ---------- calendar ----------
const calendar = csv('calendar.txt')
const services = {}
for (const c of calendar) {
  services[c.service_id] = {
    days: [c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday, c.sunday].map(Number),
    start: c.start_date,
    end: c.end_date,
  }
}

// ---------- trips (compact) ----------
// dir 0 = up axis (Aluva->Tripunithura). For dir 1 trips, sKm = lineLength - dist_traveled.
const trips = tripsRaw.map((t) => {
  const sts = stByTrip.get(t.trip_id) ?? []
  const dir = +t.direction_id
  return {
    id: t.trip_id,
    service: t.service_id,
    dir,
    stops: sts.map((st) => [stopIdx.get(st.stop_id), toSec(st.arrival_time), toSec(st.departure_time)]),
  }
})
trips.sort((a, b) => a.stops[0][1] - b.stops[0][1])

// ---------- fares: 25x25 price matrix (origin x destination, station order) ----------
const fareAttrs = Object.fromEntries(csv('fare_attributes.txt').map((f) => [f.fare_id, +f.price]))
const n = stations.length
const fares = Array.from({ length: n }, () => Array(n).fill(0))
for (const r of csv('fare_rules.txt')) {
  const o = stopIdx.get(r.origin_id)
  const d = stopIdx.get(r.destination_id)
  if (o != null && d != null) fares[o][d] = fareAttrs[r.fare_id]
}

// ---------- feed info ----------
const fi = csv('feed_info.txt')[0]
const meta = {
  publisher: fi.feed_publisher_name,
  url: fi.feed_publisher_url,
  version: fi.feed_version,
  feedStart: fi.feed_start_date,
  feedEnd: fi.feed_end_date,
  attribution: 'Contains data provided by Kochi Metro Rail Limited',
  generatedAt: new Date().toISOString(),
  lineLengthKm,
}

const bundle = { meta, stations, shapeUp, shapeDown, services, trips, fares }
const outPath = join(root, 'src', 'data', 'gtfs.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(bundle))

// ---------- report ----------
const wkTrips = trips.filter((t) => t.service === 'WK')
const weTrips = trips.filter((t) => t.service === 'WE')
const fmt = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`
const first = (arr) => Math.min(...arr.map((t) => t.stops[0][2]))
const last = (arr) => Math.max(...arr.map((t) => t.stops[0][2]))
console.log(`stations: ${stations.length}`)
console.log(`line length: ${lineLengthKm.toFixed(2)} km`)
console.log(`shape points: up=${shapeUp.length} down=${shapeDown.length}`)
console.log(`trips: total=${trips.length} WK=${wkTrips.length} WE=${weTrips.length}`)
console.log(`WK first dep ${fmt(first(wkTrips))}  last dep ${fmt(last(wkTrips))}`)
console.log(`WE first dep ${fmt(first(weTrips))}  last dep ${fmt(last(weTrips))}`)
const alva = stopIdx.get('ALVA'), tpht = stopIdx.get('TPHT')
console.log(`fare Aluva->Tripunithura: Rs.${fares[alva][tpht]}, adjacent: Rs.${fares[alva][stopIdx.get('PNCU')]}`)
const full = wkTrips.find((t) => t.stops.length === n)
console.log(`end-to-end: ${((full.stops[n - 1][1] - full.stops[0][2]) / 60).toFixed(1)} min`)
console.log(`bundle size: ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB -> src/data/gtfs.json`)
