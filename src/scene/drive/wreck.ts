/**
 * Hand-off from the rails to the physics on the derail frame.
 *
 * The sim decides the train has derailed; the plain car meshes hide; this
 * carries their last transforms and the set's velocity to DriveWreck, which
 * spawns rigid bodies in exactly those poses. Plain mutable, like firstLoad
 * and groundDim, so useFrame can read it with no React churn.
 */
import * as THREE from 'three'

export interface CarSnapshot {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

export const wreck = {
  /** the three cars' world transforms on the derail frame, leading car first */
  cars: [] as CarSnapshot[],
  /** the set's velocity on that frame, m/s, world axes */
  velocity: new THREE.Vector3(),
  /** signed curvature at the derail point; the outside of the bend is -sign(kappa) x left */
  kappa: 0,
  /** lateral acceleration at the derail, m/s² */
  lateralMs2: 0,
  /** written every frame by DriveWreck: the lead car, for the camera */
  lead: new THREE.Vector3(),
  /** wall-clock ms of the derail frame */
  atMs: 0,
  /**
   * Seconds of PHYSICS time since the derail. The wreck's clock, not the
   * wall's: slow motion, the settle point and the effects are all keyed to
   * this, so a slow device (or a paused tab) sees the same crash, just later.
   */
  simT: 0,
  /** advance the wreck by dt physics-seconds; installed by DriveWreck while mounted */
  advance: null as ((dt: number) => void) | null,
  ready: false,
}

/** camera shake amplitude, metres; decays after the derail */
export const shake = { value: 0 }
