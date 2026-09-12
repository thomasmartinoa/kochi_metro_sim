/**
 * The replay. While it is on, the plain train and the wreck are hidden and
 * this ghost trainset is posed from the tape each frame; the camera is the
 * chosen replay view, fed a rig built from the sampled frame. Playback is
 * on the replay's own head, so scrubbing is just moving that.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { newCamMemory, replayTrackside, viewCamera, type Rig } from '../../sim/driveCameras'
import { useDriveStore, type ReplayCam } from '../../state/useDriveStore'
import { CarModel, useCarParts } from '../MetroTrain'
import { replay } from './replay'

const MAX_DT = 1 / 30

interface ControlsLike {
  target: THREE.Vector3
  enabled: boolean
}

export function ReplayTrain() {
  const group = useRef<THREE.Group>(null)
  const parts = useCarParts()
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const replaying = useDriveStore((s) => s.replaying)
  const mem = useRef(newCamMemory())
  const lastCam = useRef<ReplayCam | null>(null)
  const rig = useMemo<Rig>(
    () => ({ pos: new THREE.Vector3(), heading: new THREE.Vector3(0, 0, 1), speed: 0, wreckLead: null }),
    [],
  )
  const tmp = useMemo(() => new THREE.Vector3(), [])

  // entering a replay: rewind to the start of the tape
  useEffect(() => {
    if (!replaying) return
    replay.head = replay.buffer.first?.t ?? 0
    replay.playing = true
    mem.current = newCamMemory()
    lastCam.current = null
  }, [replaying])

  useFrame((_, dtRaw) => {
    const g = group.current
    if (!g) return
    g.visible = replaying
    if (!replaying || !controls) return
    const dt = Math.min(dtRaw, MAX_DT)
    const buf = replay.buffer
    const end = buf.last?.t ?? 0
    if (replay.playing) {
      replay.head = Math.min(end, replay.head + dt * replay.rate)
      if (replay.head >= end) replay.playing = false
    }
    const f = buf.sampleAt(replay.head)
    if (!f) return
    for (let i = 0; i < 3; i++) {
      const car = g.children[i]
      car.position.set(f.cars[i].p[0], f.cars[i].p[1], f.cars[i].p[2])
      car.quaternion.set(f.cars[i].q[0], f.cars[i].q[1], f.cars[i].q[2], f.cars[i].q[3])
    }

    // the camera: the chosen replay view, over a rig built from the tape.
    // The lead car's heading is car0 -> travel; while the wreck tumbles, its
    // position still anchors the shot.
    const lead = g.children[0]
    rig.pos.copy(lead.position)
    rig.heading.set(0, 0, 1).applyQuaternion(lead.quaternion).setY(0)
    if (rig.heading.lengthSq() < 1e-6) rig.heading.set(0, 0, 1)
    rig.heading.normalize()
    rig.speed = f.speedKmh / 3.6
    rig.wreckLead = lead.position
    const cam = useDriveStore.getState().replayCam
    if (cam !== lastCam.current) {
      mem.current = newCamMemory()
      lastCam.current = cam
    }
    const pose = cam === 'trackside' ? replayTrackside(rig, mem.current) : viewCamera(cam, rig, mem.current, dt)
    controls.enabled = false
    if (cam === 'trackside') {
      camera.position.copy(pose.eye)
      controls.target.copy(pose.target)
    } else {
      const k = Math.min(1, dt * 4)
      if (camera.position.distanceTo(pose.eye) > 400) camera.position.copy(pose.eye)
      else camera.position.lerp(pose.eye, k)
      controls.target.lerp(pose.target, k)
    }
    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov += (pose.fov - camera.fov) * Math.min(1, dt * 6)
      camera.updateProjectionMatrix()
    }
    camera.lookAt(tmp.copy(controls.target))
  })

  return (
    <group ref={group} name="replay-train" visible={false}>
      <group>
        <CarModel slot={0} parts={parts} />
      </group>
      <group>
        <CarModel slot={1} parts={parts} />
      </group>
      <group>
        <CarModel slot={2} parts={parts} />
      </group>
    </group>
  )
}
