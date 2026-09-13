/**
 * The lead car's pose, published by DriveTrain every frame for DriveCamera.
 * Plain mutable like wreck/firstLoad so useFrame reads it with no React churn.
 */
import * as THREE from 'three'
import type { Rig } from '../../sim/driveCameras'

export const rig: Rig & { valid: boolean } = {
  pos: new THREE.Vector3(),
  heading: new THREE.Vector3(0, 0, 1),
  speed: 0,
  wreckLead: null,
  valid: false,
}
