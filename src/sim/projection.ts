/**
 * Geographic projection: WGS84 lat/lon -> local metres around the Kochi Metro centroid.
 * Equirectangular is plenty accurate over a ~30 km extent.
 * World axes: +x = east, +z = south (so the map reads like a north-up map in three.js).
 */
const ORIGIN_LAT = 10.03 // mid-line
const ORIGIN_LON = 76.32
const M_PER_DEG_LAT = 111_320
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN_LAT * Math.PI) / 180)

export function project(lat: number, lon: number): { x: number; z: number } {
  return {
    x: (lon - ORIGIN_LON) * M_PER_DEG_LON,
    z: -(lat - ORIGIN_LAT) * M_PER_DEG_LAT,
  }
}

export function unproject(x: number, z: number): { lat: number; lon: number } {
  return {
    lat: ORIGIN_LAT - z / M_PER_DEG_LAT,
    lon: ORIGIN_LON + x / M_PER_DEG_LON,
  }
}
