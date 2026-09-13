/**
 * The scheduled train just ahead of the player, published by Trains every
 * frame while driving: its three car objects (leading car first, world
 * transforms) and its speed. DriveTrain records it on the replay tape and
 * hands it to the wreck when it is hit. Plain mutable, like rig and wreck.
 */
import type * as THREE from 'three'

export const traffic = {
  ahead: null as { tripId: string; cars: THREE.Object3D[]; speedMs: number } | null,
}

/** a train further ahead than this is not worth a place on the tape */
export const TRAFFIC_RANGE_M = 450
