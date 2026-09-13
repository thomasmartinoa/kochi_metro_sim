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
import { carPoseAt, curvatureAtG, gAt, sAtG, trackOffsetBy } from '../sim/alignment'
import { VIEWS } from '../sim/driveCameras'
import { Cockpit } from './drive/Cockpit'
import { traffic } from './drive/traffic'
import { useDriveStore } from '../state/useDriveStore'
import { useSimStore } from '../state/useSimStore'
import { CarModel, useCarParts } from './MetroTrain'
import { groundDim } from './TileGround'
import { replay } from './drive/replay'
import { rig } from './drive/rig'
import { wreck, type CarSnapshot } from './drive/wreck'

const CAR_LEN = MODEL_CAR_PITCH_M
let keysBound = false
/**
 * The leading car model carries a joined copy of the cab interior; drive mode
 * draws the live Cockpit there instead. The nose shell and the cab's outer
 * skin (Cockpit_Component_001) stay.
 */
const BAKED_CAB = /^(Cockpit_(Component_0(45|47|52)|Control_Button|Display_Screen|Radio_Panel)|Driver_Seat|Bogie_Frame_Assembly)/


export function DriveTrain() {
  const group = useRef<THREE.Group>(null)

  const pose = useMemo(() => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3() }), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const tmpQ = useMemo(() => new THREE.Quaternion(), [])
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
      const { drive, nudgeNotch, emergency, cycleView, setView, doors, horn, toggleHeadlights } =
        useDriveStore.getState()
      if (!drive || e.repeat || formFocused()) return
      switch (e.key) {
        case 'o':
        case 'O':
          doors()
          break
        case 'h':
        case 'H':
          horn()
          break
        case 'l':
        case 'L':
          toggleHeadlights()
          break
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
          if (/^[0-9]$/.test(e.key)) {
            const v = VIEWS[e.key === '0' ? 9 : Number(e.key) - 1]
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

  useFrame((_, dt) => {
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
    if (d.phase === 'ready' && d.stops.length === 0 && replay.buffer.length && !replay.buffer.isFrozen) {
      // a fresh run: start the tape over
      replay.buffer.reset()
      replay.clock = 0
      replay.sealed = false
    }

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
        // a collision: the train we hit is part of the wreck, from where the
        // timetable has it this frame (Trains publishes it as traffic.ahead)
        wreck.struck = null
        if (d.derail?.cause === 'collision' && d.derail.struckRearG !== undefined) {
          const t = traffic.ahead
          if (t) {
            wreck.struck = {
              tripId: t.tripId,
              speedMs: t.speedMs,
              cars: t.cars.map((c) => ({
                position: c.getWorldPosition(new THREE.Vector3()),
                quaternion: c.getWorldQuaternion(new THREE.Quaternion()),
              })),
            }
          } else {
            // no train published (should not happen): rebuild its pose from the sim
            const cars: CarSnapshot[] = []
            for (let c = 0; c < 3; c++) {
              // the rear car's centre is half a pitch beyond the tail; the others a pitch further each
              const centreG = d.derail.struckRearG + (d.dir === 0 ? 1 : -1) * (MODEL_CAR_PITCH_M * (2.5 - c))
              carPoseAt(sAtG(centreG), d.dir, pose)
              cars.push({
                position: pose.pos.clone(),
                quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pose.heading),
              })
            }
            wreck.struck = { tripId: '', speedMs: 0, cars }
          }
        }
        wreck.lead.copy(lead.position)
        wreck.atMs = performance.now()
        wreck.ready = true
        useDriveStore.getState().setView('crash')
        // the pre-crash window is fixed now; the wreck is appended to it
        replay.buffer.freeze()
        replay.buffer.extend()
        replay.sealed = false
      }
      // stay drawn until the bodies are: they spawn in these exact poses, so
      // the frame the swap happens on looks like every frame before it.
      // During a replay the ghost is the train; neither the plain cars nor
      // the wreck are shown.
      group.current.visible = !wreck.live && !useDriveStore.getState().replaying
    } else {
      wreck.ready = false
      group.current.visible = true
      placeCars()
    }

    // record the tape: what the scene draws this frame, on the buffer's clock.
    // Rolling: the plain cars. Derailed: the rigid bodies (published by the
    // wreck as `wreck.bodies`), until the wreck settles and the tape seals.
    if (!useDriveStore.getState().replaying) {
      replay.clock += Math.min(dt, 0.1)
      const src = d.phase === 'derailed' ? (wreck.live ? wreck.bodies : null) : group.current.children
      // the train ahead rides along on the tape, so a collision replays
      // against the train that was actually there
      const others =
        d.phase === 'derailed'
          ? wreck.live && wreck.struckBodies.length === 3
            ? wreck.struckBodies
            : null
          : traffic.ahead?.cars ?? null
      const xf = (o: THREE.Object3D) => ({
        p: o.getWorldPosition(tmp).toArray() as [number, number, number],
        q: o.getWorldQuaternion(tmpQ).toArray() as [number, number, number, number],
      })
      if (src && src.length === 3) {
        replay.buffer.push({
          t: replay.clock,
          cars: [0, 1, 2].map((i) => xf(src[i] as THREE.Object3D)) as never,
          ...(others ? { others: others.map(xf) } : {}),
          speedKmh: d.phase === 'derailed' ? 0 : d.vMs * 3.6,
          notch: d.notch,
          doorsOpen: d.doorsOpen,
        })
      }
      if (d.phase === 'derailed' && wreck.live && wreck.simT >= 8 && !replay.sealed) {
        replay.buffer.freeze()
        replay.sealed = true
      }
    }

    // publish the lead car's pose for DriveCamera
    const lead = group.current.children[0] as THREE.Group
    rig.pos.copy(lead.position)
    rig.heading.set(0, 0, 1).applyQuaternion(lead.quaternion).setY(0).normalize()
    rig.speed = d.vMs
    rig.wreckLead = d.phase === 'derailed' && wreck.ready ? wreck.lead : null
    rig.valid = true

    // headlights: the driver's switch, or automatically once the sun is low
    const auto = groundDim.value < 0.55
    const lightsOn = useDriveStore.getState().headlights || auto
    const lamp = group.current.children[3] as THREE.SpotLight | undefined
    if (lamp) {
      lamp.visible = lightsOn && d.phase !== 'derailed'
      if (lamp.visible) {
        const lead0 = group.current.children[0] as THREE.Group
        // mounted low on the nose, aimed down the line
        lamp.position.copy(lead0.position).addScaledVector(rig.heading, 9.4).setY(lead0.position.y + 1.2)
        lamp.target.position.copy(lamp.position).addScaledVector(rig.heading, 60).setY(lead0.position.y + 0.2)
        lamp.target.updateMatrixWorld()
      }
    }


  })

  return (
    <group ref={group} name="drive-train" visible={false}>
      <group name="drive-car">
        <CarModel slot={0} parts={carParts} hide={BAKED_CAB} />
        <Cockpit />
      </group>
      <group name="drive-car">
        <CarModel slot={1} parts={carParts} />
      </group>
      <group name="drive-car">
        <CarModel slot={2} parts={carParts} />
      </group>
      {/* children[3]: the headlight, placed on the nose each frame */}
      <spotLight
        visible={false}
        color="#FFF3D6"
        intensity={2200}
        distance={140}
        angle={0.32}
        penumbra={0.55}
        decay={1.6}
      />
    </group>
  )
}
