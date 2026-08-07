/**
 * Day/night cycle driven by the sim clock (IST hour). An atmospheric-scattering
 * sky dome (drei Sky) with a real sun disk carries the daytime look; keyframed
 * colours drive fog, lights and the night backdrop. Also breathes night glow
 * into shared emissive materials (train windows, platform strips, city facades).
 */
import { Sky } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { istDayTime } from '../sim/clock'
import { useSimStore } from '../state/useSimStore'
import { cityEmissives } from './CityGLB'
import { groundDim } from './TileGround'
import { mat } from './materials'
import { updateSkyEnv } from './metroMaterials'
import { animateWater } from './waterLook'

interface Key {
  h: number
  sky: string
  fog: string
  sun: number
  hemi: number
  sunColor: string
}

const KEYS: Key[] = [
  { h: 0, sky: '#0B1A2B', fog: '#0B1A2B', sun: 0.04, hemi: 0.34, sunColor: '#7C90B8' },
  { h: 5, sky: '#0E2233', fog: '#122636', sun: 0.07, hemi: 0.38, sunColor: '#7C90B8' },
  { h: 6, sky: '#E8A06B', fog: '#D8A98C', sun: 0.7, hemi: 0.6, sunColor: '#FFC08A' },
  { h: 7.5, sky: '#BFDDE2', fog: '#C4DEE1', sun: 1.4, hemi: 1.05, sunColor: '#FFEFC9' },
  { h: 12, sky: '#B7DCE6', fog: '#C4E0E4', sun: 1.65, hemi: 1.15, sunColor: '#FFF4DC' },
  { h: 16.5, sky: '#BCD8DD', fog: '#C6DCDD', sun: 1.35, hemi: 1.05, sunColor: '#FFE9BE' },
  { h: 18.2, sky: '#E8956B', fog: '#D9A184', sun: 0.65, hemi: 0.55, sunColor: '#FF9F63' },
  { h: 19.3, sky: '#27354F', fog: '#2A3850', sun: 0.1, hemi: 0.42, sunColor: '#8FA2C6' },
  { h: 21, sky: '#0B1A2B', fog: '#0D1D2E', sun: 0.04, hemi: 0.34, sunColor: '#7C90B8' },
  { h: 24, sky: '#0B1A2B', fog: '#0B1A2B', sun: 0.04, hemi: 0.34, sunColor: '#7C90B8' },
]

interface SkyUniforms {
  sunPosition: { value: THREE.Vector3 }
  turbidity: { value: number }
  rayleigh: { value: number }
  mieCoefficient: { value: number }
}

export function Atmosphere() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const sunRef = useRef<THREE.DirectionalLight>(null)
  const fillRef = useRef<THREE.DirectionalLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)
  const skyRef = useRef<THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>>(null)

  const cols = useMemo(
    () => ({
      sky: new THREE.Color(),
      fog: new THREE.Color(),
      sun: new THREE.Color(),
      a: new THREE.Color(),
      b: new THREE.Color(),
    }),
    [],
  )
  const sunDir = useMemo(() => new THREE.Vector3(), [])

  useFrame((state) => {
    const { daySec } = istDayTime(useSimStore.getState().epochMs)
    const h = daySec / 3600
    let i = 0
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++
    const a = KEYS[i]
    const b = KEYS[i + 1]
    const f = THREE.MathUtils.clamp((h - a.h) / (b.h - a.h || 1), 0, 1)

    cols.sky.copy(cols.a.set(a.sky)).lerp(cols.b.set(b.sky), f)
    cols.fog.copy(cols.a.set(a.fog)).lerp(cols.b.set(b.fog), f)
    cols.sun.copy(cols.a.set(a.sunColor)).lerp(cols.b.set(b.sunColor), f)
    const sunI = THREE.MathUtils.lerp(a.sun, b.sun, f)
    const hemiI = THREE.MathUtils.lerp(a.hemi, b.hemi, f)

    // sun path: rises east 06:00, sets west 18:00, slight southern declination
    const ang = ((h - 6) / 12) * Math.PI
    sunDir.set(Math.cos(ang), Math.sin(ang) * 0.95, -0.32).normalize()
    const daylight = sunDir.y > -0.06

    if (scene.background instanceof THREE.Color) scene.background.copy(cols.sky)
    else scene.background = cols.sky.clone()
    if (scene.fog) {
      scene.fog.color.copy(cols.fog)
      // haze hides the map edge at street level but thins out from the air
      const alt = Math.max(0, camera.position.y)
      const fog = scene.fog as THREE.Fog
      fog.near = 4500 + alt * 2.4
      fog.far = 19000 + alt * 4.0
    }

    // sky dome: follow the sun, thicken haze toward dawn/dusk, hide at night
    if (skyRef.current) {
      skyRef.current.visible = daylight
      const u = (skyRef.current.material as THREE.ShaderMaterial)
        .uniforms as unknown as SkyUniforms
      u.sunPosition.value.copy(sunDir)
      u.turbidity.value = 10 - sunI * 4.5
      u.rayleigh.value = 1.0 + (1 - Math.min(1, sunI / 1.4)) * 1.6
      u.mieCoefficient.value = 0.004 + (1 - Math.min(1, sunI / 1.4)) * 0.006
    }

    if (sunRef.current) {
      sunRef.current.position.copy(sunDir).multiplyScalar(8000)
      sunRef.current.position.y = Math.max(600, sunRef.current.position.y)
      sunRef.current.intensity = sunI
      sunRef.current.color.copy(cols.sun)
    }
    if (hemiRef.current) hemiRef.current.intensity = hemiI
    // The fill light used to hold a fixed 0.4 all night, and the backwaters are
    // glossy enough to turn it into a bright specular blob floating on dark
    // water hours after sunset. Fade it with the sun like everything else.
    if (fillRef.current) fillRef.current.intensity = 0.06 + sunI * 0.21

    // unlit streamed satellite tiles follow the scene's light level
    groundDim.value = THREE.MathUtils.clamp(0.08 + hemiI * 0.58 + sunI * 0.22, 0.16, 1)

    // drift the backwater ripples (HorizonHaze reads fog/background itself)
    animateWater(state.clock.elapsedTime)

    // metal on the authored metro models needs a sky to reflect, and so does
    // water — a broad sky reflection is most of what makes it read as water
    updateSkyEnv(gl, cols.sky, cols.fog, sunI)

    // night glow: train windows + platform light strips + brighter tusk LEDs
    const night = THREE.MathUtils.clamp((0.55 - sunI) / 0.55, 0, 1)
    mat.trainGlass.emissive.set('#F5E9B8')
    mat.trainGlass.emissiveIntensity = night * 0.85
    mat.boatGlass.emissiveIntensity = night * 0.9
    mat.platformLight.emissiveIntensity = 0.25 + night * 2.2
    mat.led.emissiveIntensity = 1.4 + night * 2.4
    // real-city facade windows (OSM GLB) light up after dark
    for (const m of cityEmissives) m.emissiveIntensity = night * 1.15
  })

  return (
    <>
      <Sky
        ref={skyRef}
        distance={42000}
        sunPosition={[1, 0.5, -0.32]}
        turbidity={6}
        rayleigh={1.2}
        mieCoefficient={0.005}
        mieDirectionalG={0.82}
      />
      <hemisphereLight ref={hemiRef} args={['#DFF3F0', '#5C6B58', 1.1]} />
      <directionalLight ref={sunRef} position={[4000, 6000, -2500]} intensity={1.6} color="#FFF4DC" />
      <directionalLight ref={fillRef} position={[-3500, 2600, 4000]} intensity={0.4} color="#DCEFF5" />
    </>
  )
}
