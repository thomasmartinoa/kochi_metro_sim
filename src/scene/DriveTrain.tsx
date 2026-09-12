/**
 * The player's trainset in drive mode + physics tick + cab/chase camera.
 * Reuses the Metropolis car model; runs as a special service alongside the
 * scheduled ghosts.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MODEL_CAR_PITCH_M } from '../data/trainset'
import { carPoseAt, curvatureAtG, gAt, offsetBy, poseAt, trackOffsetBy } from '../sim/alignment'
import { useDriveStore } from '../state/useDriveStore'
import { useSimStore } from '../state/useSimStore'
import { CarModel, useCarParts } from './MetroTrain'
import { shake, wreck } from './drive/wreck'

const CAR_LEN = MODEL_CAR_PITCH_M
let keysBound = false

/**
 * The crash camera is a drone shot: it starts from wherever the chase camera
 * was — no cut — and circles the wreck slowly while easing in to this
 * distance and height. (6b replaces this with the camera rig.)
 */
const DRONE_R_M = 34
const DRONE_H_M = 13
/** radians per second round the wreck: a full circle in about half a minute */
const DRONE_RATE = 0.2
/** how fast the drone eases in from the chase distance, per second */
const DRONE_EASE = 0.8

export function DriveTrain() {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as {
    target: THREE.Vector3
    update: () => void
    enabled: boolean
  } | null

  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const camGoal = useMemo(() => new THREE.Vector3(), [])
  const lookGoal = useMemo(() => new THREE.Vector3(), [])
  /** the drone's orbit about the wreck, seeded from the chase pose on the derail frame */
  const drone = useRef({ init: false, az: 0, r: 0, h: 0 })
  const carParts = useCarParts()

  // keyboard controls (module flag prevents StrictMode double-binding)
  useEffect(() => {
    if (keysBound) return
    keysBound = true
    const onKey = (e: KeyboardEvent) => {
      const { drive, nudgeNotch, emergency, toggleCam } = useDriveStore.getState()
      if (!drive) return
      if (e.repeat) return
      switch (e.key) {
        case 'w':
        case 'W':
        case 'ArrowUp':
          nudgeNotch(1)
          break
        case 's':
        case 'S':
        case 'ArrowDown':
          nudgeNotch(-1)
          break
        case ' ':
          emergency()
          e.preventDefault()
          break
        case 'c':
        case 'C':
          toggleCam()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      keysBound = false
    }
  }, [])

  useFrame((_, dt) => {
    const { drive, tick, cam } = useDriveStore.getState()
    const driving = useSimStore.getState().appMode === 'drive' && drive
    if (!group.current) return
    group.current.visible = !!driving
    if (!driving) return

    void dt // physics dt derives from wall-clock inside the store
    tick()
    const d = useDriveStore.getState().drive
    if (!d) return

    // the three cars, each on its bogies, spaced along their own rail
    const placeCars = () => {
      for (let c = 0; c < 3; c++) {
        const car = group.current!.children[c] as THREE.Group
        const offsetM = (1 - c) * CAR_LEN
        const sCar = trackOffsetBy(d.sKm, d.dir === 0 ? offsetM : -offsetM, d.dir)
        carPoseAt(sCar, d.dir, pose)
        car.position.copy(pose.pos)
        tmp.copy(pose.pos).add(pose.heading)
        car.lookAt(tmp)
      }
    }

    if (d.phase === 'derailed') {
      // the first derailed frame: hand the cars' poses and the set's velocity
      // to the wreck, then hide — from here the rigid bodies are the train.
      // Pose from the sim first: the meshes may not have been drawn at the
      // derail chainage yet (a derail can land between frames).
      if (!wreck.ready) {
        placeCars()
        wreck.cars = [0, 1, 2].map((c) => {
          const car = group.current!.children[c] as THREE.Group
          return { position: car.position.clone(), quaternion: car.quaternion.clone() }
        })
        const lead = group.current.children[0] as THREE.Group
        wreck.velocity
          .set(0, 0, 1)
          .applyQuaternion(lead.quaternion)
          .multiplyScalar((d.derail?.speedKmh ?? 0) / 3.6)
        wreck.kappa = curvatureAtG(gAt(d.sKm))
        wreck.lateralMs2 = d.lateralMs2
        wreck.lead.copy(lead.position)
        wreck.atMs = performance.now()
        wreck.ready = true
      }
      // stay drawn until the bodies are: they spawn in these exact poses, so
      // the frame the swap happens on looks like every frame before it
      group.current.visible = !wreck.live
    } else {
      wreck.ready = false
      drone.current.init = false
      group.current.visible = true
      placeCars()
    }

    // camera
    if (controls) {
      if (d.phase === 'derailed') {
        const dr = drone.current
        if (!dr.init) {
          // pick the orbit up from where the chase camera is: no cut
          tmp.copy(camera.position).sub(wreck.lead)
          dr.az = Math.atan2(tmp.z, tmp.x)
          dr.r = Math.hypot(tmp.x, tmp.z)
          dr.h = tmp.y
          dr.init = true
        }
        // circle the wreck, easing in from the chase distance and height
        dr.az += DRONE_RATE * dt
        const k = Math.min(1, dt * DRONE_EASE)
        dr.r += (DRONE_R_M - dr.r) * k
        dr.h += (DRONE_H_M - dr.h) * k
        camGoal.set(
          wreck.lead.x + Math.cos(dr.az) * dr.r,
          wreck.lead.y + dr.h,
          wreck.lead.z + Math.sin(dr.az) * dr.r,
        )
        lookGoal.copy(wreck.lead).setY(wreck.lead.y + 1.5)
        camera.position.lerp(camGoal, Math.min(1, dt * 3))
        controls.target.lerp(lookGoal, Math.min(1, dt * 5))
        if (shake.value > 0) {
          camera.position.x += (Math.random() - 0.5) * shake.value
          camera.position.y += (Math.random() - 0.5) * shake.value * 0.6
        }
        controls.update()
        return
      }
      poseAt(offsetBy(d.sKm, (d.dir === 0 ? 1 : -1) * (CAR_LEN * 1.5 + 1)), d.dir, pose)
      if (cam === 'cab') {
        // eye just ahead of the nose so the cab shell sits behind the camera
        camGoal.copy(pose.pos).addScaledVector(pose.heading, 2.6).setY(pose.pos.y + 3.1)
        lookGoal.copy(pose.pos).addScaledVector(pose.heading, 80).setY(pose.pos.y + 1.0)
        camera.position.lerp(camGoal, Math.min(1, dt * 10))
        controls.target.lerp(lookGoal, Math.min(1, dt * 10))
      } else {
        camGoal.copy(pose.pos).addScaledVector(pose.heading, -85).setY(pose.pos.y + 32)
        lookGoal.copy(pose.pos).addScaledVector(pose.heading, 40).setY(pose.pos.y)
        camera.position.lerp(camGoal, Math.min(1, dt * 4))
        controls.target.lerp(lookGoal, Math.min(1, dt * 4))
      }
      controls.update()
    }
  })

  return (
    <group ref={group} name="drive-train" visible={false}>
      <group name="drive-car">
        <CarModel slot={0} parts={carParts} />
      </group>
      <group name="drive-car">
        <CarModel slot={1} parts={carParts} />
      </group>
      <group name="drive-car">
        <CarModel slot={2} parts={carParts} />
      </group>
    </group>
  )
}
