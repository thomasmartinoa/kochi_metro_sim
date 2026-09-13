/**
 * The 3D world: canvas, atmosphere, ground, the line, and the live trains.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react'
import * as THREE from 'three'
import { WATER_METRO_ENABLED } from '../config'
import { stations } from '../data/network'
import { centerAt, gAt } from '../sim/alignment'
import { stepDrive } from '../sim/drive'
import { trainStateById } from '../sim/engine'
import { liveEnv, useDriveStore } from '../state/useDriveStore'
import { useRunHistory } from '../state/runHistory'
import { useSimStore } from '../state/useSimStore'
import { Atmosphere } from './Atmosphere'
import { Boats } from './Boats'
import { CameraController } from './CameraController'
import { City, Palms } from './City'
import { CityGLB } from './CityGLB'
import { DriveTrain } from './DriveTrain'
import { DriveCamera } from './drive/DriveCamera'
import { ReplayTrain } from './drive/ReplayTrain'
import { CabSounds } from './drive/CabSounds'
import { SpeedBoards } from './drive/SpeedBoards'
import { Signals } from './drive/Signals'
import { Rain } from './drive/Rain'
import { GhostTrain } from './drive/GhostTrain'
import { GltfSetup } from './gltf'
import { REVERSED_DEPTH } from './depth'
import { replay } from './drive/replay'
import { wreck } from './drive/wreck'
import { HorizonHaze } from './HorizonHaze'
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

const DriveWreck = lazy(() => import('./drive/DriveWreck'))

/**
 * The physics world, for as long as Drive mode is open. Rapier and its WASM
 * live in this chunk and its init suspends, so it gets a Suspense boundary
 * of its own: the metro layer above must not blink out while it loads.
 */
function WreckGate() {
  const driving = useSimStore((s) => s.appMode === 'drive')
  if (!driving) return null
  return (
    <Suspense fallback={null}>
      <DriveWreck />
    </Suspense>
  )
}

/** Advances the shared sim clock once per frame. */
function ClockTick() {
  useFrame((_, dt) => {
    useSimStore.getState().tick(Math.min(dt, 0.25) * 1000)
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
    w.__THREE = THREE
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
    w.__setDaySec = (s: number) => useSimStore.getState().scrubToDaySec(s)
    w.__setWeather = (x: string) => useSimStore.getState().setWeather(x as never)
    w.__runHistory = useRunHistory
    w.__trainSKm = (id: string) => trainStateById(useSimStore.getState().epochMs, id)?.sKm
    w.__drive = () => useDriveStore.getState().drive
    w.__driveView = (v: string) => useDriveStore.getState().setView(v as never)
    w.__driveViewNow = () => useDriveStore.getState().view
    w.__driveRestart = () => useDriveStore.getState().restart()
    w.__replay = (on: boolean) => (on ? useDriveStore.getState().enterReplay() : useDriveStore.getState().leaveReplay())
    w.__replayState = () => ({ ...replay, buffer: undefined, frames: replay.buffer.length, first: replay.buffer.first?.t, last: replay.buffer.last?.t, frozen: replay.buffer.isFrozen })
    w.__replaySeek = (t: number) => { replay.head = t; replay.playing = false }
    w.__replayFrames = () => { const out: unknown[] = []; for (let t = replay.buffer.first?.t ?? 0; t <= (replay.buffer.last?.t ?? 0); t += 1) out.push(replay.buffer.sampleAt(t)); return out }
    w.__controlsEnabled = () => (controls as { enabled?: boolean } | null)?.enabled
    w.__driveNotch = (n: number) => {
      const d = useDriveStore.getState().drive
      if (d) useDriveStore.getState().nudgeNotch(n - d.notch)
    }
    // where the wreck's lead car is (null until a derail), for tests
    w.__wreckLead = () => (wreck.ready ? wreck.lead.clone() : null)
    w.__wreckState = () => ({ ready: wreck.ready, live: wreck.live, simT: wreck.simT, hasAdvance: !!wreck.advance })
    // advance the wreck by s physics-seconds regardless of frame rate, for tests
    w.__wreckStep = (s: number) => {
      if (!wreck.advance) return null // not mounted yet
      wreck.advance(s)
      return wreck.simT
    }
    // step the drive sim by dt seconds regardless of frame rate, for tests
    w.__driveStep = (dt: number) => {
      const d = useDriveStore.getState().drive
      // the same env the game ticks with: signals and the train ahead included
      if (d) useDriveStore.setState({ drive: stepDrive(d, dt, liveEnv(d.dir)) })
    }
    // teleport the drive to a chainage, at rest, for testing curves and crashes
    w.__driveJump = (sKm: number) => {
      const d = useDriveStore.getState().drive
      if (!d) return
      // the next stop is the first station past the jump in the direction of travel
      const idx = stations.findIndex((st) => (d.dir === 0 ? st.sKm > sKm : st.sKm >= sKm))
      const nextStopOrder = d.dir === 0 ? (idx < 0 ? stations.length - 1 : idx) : Math.max(0, (idx < 0 ? stations.length : idx) - 1)
      const lastStopOrder = nextStopOrder + (d.dir === 0 ? -1 : 1)
      useDriveStore.setState({
        drive: { ...d, gM: gAt(sKm), sKm, vMs: 0, phase: 'run', nextStopOrder, lastStopOrder },
      })
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
      dpr={[1, 1.5]}
      // The world spans 8 cm (cab view) to 60 km (whole-region view). A normal
      // depth buffer spends nearly all its precision near the camera, so at a
      // few km the ground/roads/backdrop are indistinguishable and flicker.
      // Reversed-Z keeps precision across the whole range for free where the
      // GPU allows it; elsewhere the logarithmic buffer does, at the cost of
      // early depth testing (see depth.ts).
      gl={{ reversedDepthBuffer: REVERSED_DEPTH, logarithmicDepthBuffer: !REVERSED_DEPTH }}
      camera={{ position: [mid.pos.x + 210, 130, mid.pos.z + 310], far: 60000, near: 1 }}
      onPointerMissed={() => select(null)}
    >
      {/* first, so every useGLTF below finds the texture loader ready */}
      <GltfSetup />
      <color attach="background" args={['#BFDDE2']} />
      {/* Haze thick enough that the aerial sheet dissolves into the sky well
          before its edge (~12 km+ out) can be seen. Paired with the zoom-out
          limit below, the map never shows a border. Colour is driven per
          time-of-day by Atmosphere. */}
      <fog attach="fog" args={['#BFDDE2', 1200, 11000]} />
      <Atmosphere />

      {/* Fills everything past the aerial sheet's ~31 km extent, ramping from
          fog colour to sky colour so the ground dissolves into the horizon
          instead of ending on a line. */}
      <HorizonHaze />

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
        <DriveCamera />
        <ReplayTrain />
        <CabSounds />
        <WreckGate />
        <SpeedBoards />
        <Signals />
        <Rain />
        <GhostTrain />
      </Suspense>
      {/* Water Metro stays off the map entirely until it ships — routes,
          terminals and boats alike. It is built on the `water` branch, where
          VITE_WATER_METRO=true turns all of this back on. The Pink Line goes
          with it: nothing unbuilt should be visible to visitors. */}
      {WATER_METRO_ENABLED && (
        <>
          <PinkLine />
          <Boats />
          <WaterTerminals />
          <WaterRouteLanes />
        </>
      )}
      <ClockTick />
      <CameraController />
      <DevCam />
      <PostFX />

      <OrbitControls
        makeDefault
        target={[mid.pos.x, 30, mid.pos.z]}
        maxPolarAngle={Math.PI * 0.49}
        // close enough to stand beside a trainset; the controller's floor
        // (MIN_CAM_Y) is what actually keeps the eye above ground
        minDistance={18}
        // Pulled in to 3.6 km: beyond this the aerial sheet's edge creeps into
        // frame at the top. At this distance the corridor city fills the view
        // and the horizon is already faded to haze/sky.
        maxDistance={3600}
        enableDamping
      />
    </Canvas>
  )
}
