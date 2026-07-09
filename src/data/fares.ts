/** Fare lookup from the real KMRL fare matrix (origin x destination, INR). */
import { gtfs, stationById } from './network'

/** Fare in INR between two stations by order index. */
export function fareByOrder(originOrder: number, destOrder: number): number {
  if (originOrder === destOrder) return 0
  return gtfs.fares[originOrder][destOrder]
}

/** Fare in INR between two stations by stop id (e.g. 'ALVA', 'TPHT'). */
export function fareById(originId: string, destId: string): number {
  const o = stationById.get(originId)
  const d = stationById.get(destId)
  if (!o || !d) throw new Error(`unknown station ${originId} or ${destId}`)
  return fareByOrder(o.order, d.order)
}

/** Single-journey ticket validity, minutes. */
export const TICKET_VALIDITY_MIN = 90
