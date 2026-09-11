/**
 * The player's trainset in drive mode + physics tick + cab/chase camera.
 * Reuses the Metropolis car model; runs as a special service alongside the
 * scheduled ghosts.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MODEL_CAR_PITCH_M } from '../data/trainset'
import { carPoseAt, offsetBy, poseAt, trackOffsetBy } from '../sim/alignment'
import { useDriveStore } from '../state/useDriveStore'
import { useSimStore } from '../state/useSimStore'
import { CarModel, useCarParts } from './MetroTrain'

const CAR_LEN = MODEL_CAR_PITCH_M
let keysBound = false

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
    for (let c = 0; c < 3; c++) {
      const car = group.current.children[c] as THREE.Group
      const offsetM = (1 - c) * CAR_LEN
      const sCar = trackOffsetBy(d.sKm, d.dir === 0 ? offsetM : -offsetM, d.dir)
      carPoseAt(sCar, d.dir, pose)
      car.position.copy(pose.pos)
      tmp.copy(pose.pos).add(pose.heading)
      car.lookAt(tmp)
    }

    // camera
    if (controls) {
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
    <group ref={group} visible={false}>
      <group>
        <CarModel slot={0} parts={carParts} />
      </group>
      <group>
        <CarModel slot={1} parts={carParts} />
      </group>
      <group>
        <CarModel slot={2} parts={carParts} />
      </group>
    </group>
  )
}
