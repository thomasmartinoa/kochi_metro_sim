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

/**
 * Rail running surface above ground (m). Taken from the authored viaduct/
 * station models (scripts/blender_export_assets.py), whose piers reach the
 * ground exactly this far below their rails — so the alignment curve sits at
 * rail level and the models land on y = 0.
 */
export const RAIL_LEVEL_M = 14.833

/** Distance from the deck centreline to each track centre, per the models. */
export const TRACK_OFFSET_M = 2.75

/** Length of one viaduct span in the authored model — the repeat pitch. */
export const SPAN_PITCH_M = 30.71

/**
 * Distance between car centres in the authored trainset (3 cars over ~56 m).
 * Measured from the split model, so cars sit nose-to-tail on the alignment.
 */
export const MODEL_CAR_PITCH_M = 18.56

/**
 * Distance between a car's two bogie centres. A car does not bend: it sits on
 * its bogies and its body chords the curve between them, so on a bend the
 * body's heading is the bogie-to-bogie line, not the track tangent at its
 * centre. Roughly two-thirds of the car pitch, as on the real Metropolis.
 */
export const BOGIE_SPACING_M = 12.6

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
