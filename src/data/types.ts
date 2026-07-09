/** Typed views over the generated GTFS bundle (src/data/gtfs.json). */

export interface StationData {
  id: string
  order: number
  name: string
  nameMl: string
  nameHi: string
  lat: number
  lon: number
  /** distance along the up axis (Aluva -> Tripunithura), km */
  sKm: number
}

/** [lat, lon, distKm] polyline vertex */
export type ShapePoint = [number, number, number]

/** [stationOrder, arrivalSec, departureSec] — seconds since service-day midnight (may exceed 24h) */
export type TripStop = [number, number, number]

export type ServiceId = 'WK' | 'WE'

export interface TripData {
  id: string
  service: ServiceId
  dir: 0 | 1
  stops: TripStop[]
}

export interface GtfsMeta {
  publisher: string
  url: string
  version: string
  feedStart: string
  feedEnd: string
  attribution: string
  generatedAt: string
  lineLengthKm: number
}

export interface GtfsBundle {
  meta: GtfsMeta
  stations: StationData[]
  shapeUp: ShapePoint[]
  shapeDown: ShapePoint[]
  services: Record<string, { days: number[]; start: string; end: string }>
  trips: TripData[]
  /** fares[originOrder][destOrder] in INR */
  fares: number[][]
}
