/**
 * The 3D world: canvas, atmosphere, ground, the line, and the live trains.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect } from 'react'
import type * as THREE from 'three'
import { centerAt } from '../sim/alignment'
import { useDispatchStore } from '../state/useDispatchStore'
import { useDriveStore } from '../state/useDriveStore'
import { useSimStore } from '../state/useSimStore'
import { mat } from './materials'
import { Atmosphere } from './Atmosphere'
import { CameraRig } from './CameraRig'
import { City } from './City'
import { DriveTrain } from './DriveTrain'
import { Line3D } from './Line3D'
import { PinkLine } from './PinkLine'
import { Trains } from './Trains'

/** Advances the shared sim clock (and the dispatch session) once per frame. */
function ClockTick() {
  useFrame((_, dt) => {
    useSimStore.getState().tick(Math.min(dt, 0.25) * 1000)
    useDispatchStore.getState().tick(useSimStore.getState().epochMs)
  })
  return null
}

/** Dev-only helper: window.__cam(px,py,pz, tx,ty,tz) frames the view; __sAt(sKm) returns line coords. */
function DevCam() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3; update?: () => void } | null
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__cam = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
      camera.position.set(px, py, pz)
      if (controls?.target && controls.update) {
        controls.target.set(tx, ty, tz)
        controls.update()
      }
    }
    w.__sAt = (sKm: number) => {
      const { pos } = centerAt(sKm)
      return { x: pos.x, y: pos.y, z: pos.z }
    }
    w.__select = (kind: 'train' | 'station' | null, id?: string) => {
      useSimStore.getState().select(kind && id ? { kind, id } : null)
    }
    w.__drive = () => useDriveStore.getState().drive
    w.__driveNotch = (n: number) => {
      const d = useDriveStore.getState().drive
      if (d) useDriveStore.getState().nudgeNotch(n - d.notch)
    }
  }, [camera, controls])
  return null
}

const mid = centerAt(15.8) // Ernakulam core (around M.G. Road)

export function World() {
  const select = useSimStore((s) => s.select)
  return (
    <Canvas
      shadows={false}
      dpr={[1, 1.75]}
      camera={{ position: [mid.pos.x + 210, 130, mid.pos.z + 310], far: 60000, near: 1 }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={['#BFDDE2']} />
      <fog attach="fog" args={['#BFDDE2', 6000, 30000]} />
      <Atmosphere />

      {/* ground */}
      <mesh material={mat.ground} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[60000, 60000]} />
      </mesh>

      <City />
      <Line3D />
      <PinkLine />
      <Trains />
      <DriveTrain />
      <ClockTick />
      <CameraRig />
      <DevCam />

      <OrbitControls
        makeDefault
        target={[mid.pos.x, 30, mid.pos.z]}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={60}
        maxDistance={22000}
        enableDamping
      />
    </Canvas>
  )
}
