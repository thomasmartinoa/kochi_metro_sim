/**
 * Network data layer — real KMRL GTFS data plus the future Pink Line stub.
 * Contains data provided by Kochi Metro Rail Limited.
 */
import type { GtfsBundle, StationData, TripData } from './types'
import raw from './gtfs.json'

export const gtfs = raw as unknown as GtfsBundle

export const stations: StationData[] = gtfs.stations
export const trips: TripData[] = gtfs.trips
export const meta = gtfs.meta
export const LINE_LENGTH_KM = gtfs.meta.lineLengthKm

export const stationByOrder = (order: number): StationData => stations[order]
export const stationById = new Map(stations.map((s) => [s.id, s]))

/** Blue Line rendering/legend colour (operational line). */
export const BLUE_LINE_COLOR = '#1E63C8'

/** Pink Line (Phase 2, under construction, ~2027) — displayed as "coming soon". */
export interface PinkStationStub {
  name: string
  lat: number
  lon: number
}

/**
 * Approximate alignment: branches from JLN Stadium east to Infopark via Kakkanad.
 * Coordinates are approximate (published alignment maps); no service is simulated.
 */
export const pinkLine: { name: string; color: string; opens: string; stations: PinkStationStub[] } = {
  name: 'Pink Line (Phase 2)',
  color: '#E24F9A',
  opens: '2027',
  stations: [
    { name: 'JLN Stadium', lat: 10.0005, lon: 76.299 },
    { name: 'Palarivattom Junction', lat: 10.0043, lon: 76.3082 },
    { name: 'Palarivattom Bypass', lat: 10.0064, lon: 76.3164 },
    { name: 'Chembumukku', lat: 10.0089, lon: 76.3257 },
    { name: 'Vazhakkala', lat: 10.0114, lon: 76.3352 },
    { name: 'Padamughal', lat: 10.0142, lon: 76.3446 },
    { name: 'Kakkanad Junction', lat: 10.0154, lon: 76.3524 },
    { name: 'Cochin SEZ', lat: 10.0106, lon: 76.3595 },
    { name: 'Chittethukara', lat: 10.0068, lon: 76.3662 },
    { name: 'KINFRA', lat: 10.0091, lon: 76.3742 },
    { name: 'Infopark / SmartCity', lat: 10.0119, lon: 76.3814 },
  ],
}
