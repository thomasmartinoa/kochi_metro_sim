/**
 * The 3D world: canvas, atmosphere, ground, the line, and the live trains.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Component, Suspense, useEffect, type ReactNode } from 'react'
import type * as THREE from 'three'
import overlayMeta from '../data/kochi-overlay-meta.json'
import { centerAt } from '../sim/alignment'
import { project } from '../sim/projection'
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
import { TileGround } from './TileGround'
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

/* ============================================================================
 * CAMERA LIMITS — adjust these to taste.
 *   MIN_CAM_Y   : lowest the eye may sit (metres). Stops going under the map.
 *   MAX_CAM_Y   : highest the eye may sit (metres). Stops flying too high with
 *                 Q/E. Lower it for a tighter ceiling.
 *   MAP_INSET_M : how far INSIDE the aerial map's edge the camera must stay
 *                 (metres). Raise it to keep the border further out of frame.
 *   maxDistance (on <OrbitControls> below): how far you can zoom/dolly out.
 *                 Beyond it the aerial map's edge shows.
 * ==========================================================================*/
const MIN_CAM_Y = 8
const MAX_CAM_Y = 2600
const MAP_INSET_M = 1500

/** Horizontal walls, derived from the real aerial sheet's bounds. */
const MAP_BOUNDS = (() => {
  const nw = project(overlayMeta.north, overlayMeta.west)
  const se = project(overlayMeta.south, overlayMeta.east)
  return {
    minX: Math.min(nw.x, se.x) + MAP_INSET_M,
    maxX: Math.max(nw.x, se.x) - MAP_INSET_M,
    minZ: Math.min(nw.z, se.z) + MAP_INSET_M,
    maxZ: Math.max(nw.z, se.z) - MAP_INSET_M,
  }
})()

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * Keeps the camera inside the map. OrbitControls' polar limit and maxDistance
 * only bound orbiting/dollying; WASD+Q/E flight (KeyboardFly) can still push the
 * eye under the map, arbitrarily high, or off the sheet entirely — so clamp all
 * three axes here every frame. The orbit target moves with the eye so the view
 * direction never snaps. Drive mode owns its own camera (cab sits low on purpose).
 */
function CameraBounds() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as {
    target?: THREE.Vector3
    update?: () => void
  } | null
  useFrame(() => {
    if (useSimStore.getState().appMode === 'drive') return
    const p = camera.position
    const nx = clamp(p.x, MAP_BOUNDS.minX, MAP_BOUNDS.maxX)
    const ny = clamp(p.y, MIN_CAM_Y, MAX_CAM_Y)
    const nz = clamp(p.z, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ)
    if (nx === p.x && ny === p.y && nz === p.z) return
    const dx = nx - p.x
    const dy = ny - p.y
    const dz = nz - p.z
    p.set(nx, ny, nz)
    if (controls?.target && controls.update) {
      controls.target.set(
        controls.target.x + dx,
        controls.target.y + dy,
        controls.target.z + dz,
      )
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
      <TileGround />
      {/* the metro models stream in; without their own boundary a suspend here
          would freeze the entire canvas rather than just the line */}
      <Suspense fallback={null}>
        <Line3D />
        <Trains />
        <DriveTrain />
      </Suspense>
      <PinkLine />
      <Boats />
      <WaterTerminals />
      <WaterRouteLanes />
      <ClockTick />
      <CameraRig />
      <KeyboardFly />
      <CameraBounds />
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
