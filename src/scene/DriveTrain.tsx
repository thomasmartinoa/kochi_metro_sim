/**
 * The player's trainset in drive mode + the physics tick + the keys.
 * Reuses the Metropolis car model; runs as a special service alongside the
 * scheduled trains of the opposing direction. Publishes the lead car's pose
 * to `rig` every frame; DriveCamera owns the camera from there.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MODEL_CAR_PITCH_M } from '../data/trainset'
import { carPoseAt, curvatureAtG, gAt, trackOffsetBy } from '../sim/alignment'
import { VIEWS } from '../sim/driveCameras'
import { useDriveStore } from '../state/useDriveStore'
import { useSimStore } from '../state/useSimStore'
import { CarModel, useCarParts } from './MetroTrain'
import { rig } from './drive/rig'
import { wreck } from './drive/wreck'

const CAR_LEN = MODEL_CAR_PITCH_M
let keysBound = false


export function DriveTrain() {
  const group = useRef<THREE.Group>(null)

  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const carParts = useCarParts()

  // keyboard controls (module flag prevents StrictMode double-binding)
  useEffect(() => {
    if (keysBound) return
    keysBound = true
    const formFocused = () => {
      const el = document.activeElement
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      )
    }
    const onKey = (e: KeyboardEvent) => {
      const { drive, nudgeNotch, emergency, cycleView, setView } = useDriveStore.getState()
      if (!drive || e.repeat || formFocused()) return
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
          cycleView(1)
          break
        case 'v':
        case 'V':
          cycleView(-1)
          break
        default:
          if (/^[1-9]$/.test(e.key)) {
            const v = VIEWS[Number(e.key) - 1]
            if (v) setView(v)
          }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      keysBound = false
    }
  }, [])

  useFrame(() => {
    const { drive, tick } = useDriveStore.getState()
    const driving = useSimStore.getState().appMode === 'drive' && drive
    if (!group.current) return
    group.current.visible = !!driving
    if (!driving) {
      rig.valid = false
      return
    }

    tick() // physics dt derives from wall-clock inside the store
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
        useDriveStore.getState().setView('crash')
      }
      // stay drawn until the bodies are: they spawn in these exact poses, so
      // the frame the swap happens on looks like every frame before it
      group.current.visible = !wreck.live
    } else {
      wreck.ready = false
      group.current.visible = true
      placeCars()
    }

    // publish the lead car's pose for DriveCamera
    const lead = group.current.children[0] as THREE.Group
    rig.pos.copy(lead.position)
    rig.heading.set(0, 0, 1).applyQuaternion(lead.quaternion).setY(0).normalize()
    rig.speed = d.vMs
    rig.wreckLead = d.phase === 'derailed' && wreck.ready ? wreck.lead : null
    rig.valid = true

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
