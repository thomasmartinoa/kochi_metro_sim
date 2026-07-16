/**
 * The 3D world: canvas, atmosphere, ground, the line, and the live trains.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Component, Suspense, useEffect, type ReactNode } from 'react'
import type * as THREE from 'three'
import { centerAt } from '../sim/alignment'
import { useDriveStore } from '../state/useDriveStore'
import { useSimStore } from '../state/useSimStore'
import { mat } from './materials'
import { Atmosphere } from './Atmosphere'
import { Boats } from './Boats'
import { CameraRig } from './CameraRig'
import { City, Palms } from './City'
import { CityGLB } from './CityGLB'
import { DriveTrain } from './DriveTrain'
import { KeyboardFly } from './KeyboardFly'
import { Line3D } from './Line3D'
import { PinkLine } from './PinkLine'
import { PostFX } from './PostFX'
import { SatGround } from './SatGround'
import { Trains } from './Trains'
import { WaterRouteLanes } from './WaterRouteLanes'
import { WaterTerminals } from './WaterTerminals'

/** Real-OSM city with the procedural city as loading fallback / error safety net. */
class CityBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <City /> : this.props.children
  }
}

/** Advances the shared sim clock once per frame. */
function ClockTick() {
  useFrame((_, dt) => {
    useSimStore.getState().tick(Math.min(dt, 0.25) * 1000)
  })
  return null
}

/**
 * Keeps the camera out of the ground. OrbitControls' polar limit stops you
 * *tilting* under the city, but dollying/panning can still push the eye below
 * it — from underneath you see the map's backside and the sky through it.
 * Drive mode owns its own camera (cab view sits low on purpose).
 */
function GroundClamp() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as {
    target?: THREE.Vector3
    update?: () => void
  } | null
  useFrame(() => {
    if (useSimStore.getState().appMode === 'drive') return
    const MIN_Y = 8
    if (camera.position.y >= MIN_Y) return
    const lift = MIN_Y - camera.position.y
    camera.position.y = MIN_Y
    // lift the orbit target with the eye so the view direction doesn't snap
    if (controls?.target && controls.update) {
      controls.target.y += lift
      controls.update()
    }
  })
  return null
}

/** Dev-only helper: window.__cam(px,py,pz, tx,ty,tz) frames the view; __sAt(sKm) returns line coords. */
function DevCam() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3; update?: () => void } | null
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    // renderer/scene/camera handles for perf profiling from the console
    w.__gl = gl
    w.__scene = scene
    w.__camObj = camera
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
  }, [camera, controls, gl, scene])
  return null
}

const mid = centerAt(15.8) // Ernakulam core (around M.G. Road)

export function World() {
  const select = useSimStore((s) => s.select)
  return (
    <Canvas
      shadows={false}
      dpr={[1, 1.75]}
      // The world spans 1 m (cab view) to 60 km (whole-region view). A normal
      // depth buffer spends nearly all its precision near the camera, so at a
      // few km the ground/roads/backdrop are indistinguishable and flicker.
      // A logarithmic buffer keeps precision usable across the whole range.
      gl={{ logarithmicDepthBuffer: true }}
      camera={{ position: [mid.pos.x + 210, 130, mid.pos.z + 310], far: 60000, near: 1 }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={['#BFDDE2']} />
      {/* Haze thick enough that the aerial sheet dissolves into the sky well
          before its edge (~12 km+ out) can be seen. Paired with the zoom-out
          limit below, the map never shows a border. Colour is driven per
          time-of-day by Atmosphere. */}
      <fog attach="fog" args={['#BFDDE2', 1200, 11000]} />
      <Atmosphere />

      {/* Fills the horizon beyond the aerial sheet's ~31 km extent. Kept far
          below it so it can never win the depth test and sheet over the city. */}
      <mesh material={mat.ground} rotation={[-Math.PI / 2, 0, 0]} position={[0, -120, 0]}>
        <planeGeometry args={[60000, 60000]} />
      </mesh>

      <CityBoundary>
        <Suspense fallback={<City />}>
          <CityGLB />
          <Palms />
        </Suspense>
      </CityBoundary>
      <Suspense fallback={null}>
        <SatGround />
      </Suspense>
      <Line3D />
      <PinkLine />
      <Trains />
      <Boats />
      <WaterTerminals />
      <WaterRouteLanes />
      <DriveTrain />
      <ClockTick />
      <CameraRig />
      <KeyboardFly />
      <GroundClamp />
      <DevCam />
      <PostFX />

      <OrbitControls
        makeDefault
        target={[mid.pos.x, 30, mid.pos.z]}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={60}
        // Pulled in to 3.6 km: beyond this the aerial sheet's edge creeps into
        // frame at the top. At this distance the corridor city fills the view
        // and the horizon is already faded to haze/sky.
        maxDistance={3600}
        enableDamping
      />
    </Canvas>
  )
}
