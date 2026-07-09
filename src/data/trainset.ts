/**
 * Alstom Metropolis (Kochi) trainset constants — physical + livery.
 * Sources: Alstom press material, KMRL. Design: Alstom Design&Styling + TATA Elxsi.
 */
export const TRAINSET = {
  cars: 3,
  lengthM: 65,
  widthM: 2.9,
  heightM: 3.9,
  doorsPerSidePerCar: 4,
  capacity: 975,
  seats: 136,
  maxSpeedKmh: 80,
  /** service acceleration / braking, m/s^2 (typical metro values) */
  accelMs2: 1.0,
  brakeMs2: 1.1,
  emergencyBrakeMs2: 1.3,
  fleetSize: 25,
} as const

/** Viaduct rail level above ground (m) — uniform per KMRL design. */
export const RAIL_LEVEL_M = 12.5

/** Brand / world colour tokens. */
export const COLORS = {
  kmrlTurquoise: '#12B3A6',
  kmrlGreen: '#2E8B57',
  accentLemon: '#D6E64B',
  trainBody: '#F2F4F5',
  viaductConcrete: '#C9CCCE',
  water: '#1E6E8C',
  nightSky: '#0B1A2B',
  blueLine: '#1E63C8',
  pinkLine: '#E24F9A',
} as const
