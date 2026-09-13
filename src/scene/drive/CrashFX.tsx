/**
 * What a derailment looks like: a burst of sparks at the moment, smoke that
 * keeps rising from the lead car, fire from a second and a half on, and the
 * camera shaking with the impact. Sprites and points only — nothing here is
 * simulated, so it costs the same on a phone. Everything is keyed to the
 * wreck's own clock (physics seconds since the derail), not the wall's.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { shake, wreck } from './wreck'

/**
 * A soft disc for the smoke puffs. A bare square quad reads as a grid of
 * boxes; this radial falloff is drawn once on a small canvas so no texture
 * has to ship.
 */
function softDisc(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

const SPARKS = 160
const SPARK_LIFE_S = 1.2
const SMOKE = 48
const FIRE_AFTER_S = 1.5
const SHAKE_M = 1.6
const SHAKE_DECAY_S = 1.4

function Sparks() {
  const ref = useRef<THREE.Points>(null)
  const { geo, vel } = useMemo(() => {
    const pos = new Float32Array(SPARKS * 3)
    const vel: THREE.Vector3[] = []
    for (let i = 0; i < SPARKS; i++) {
      pos.set([0, 0.4, 0], i * 3)
      vel.push(
        new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 7 + 2, (Math.random() - 0.5) * 12),
      )
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return { geo, vel }
  }, [])
  // sparks fly from where it came off, and stay there as the wreck moves on
  const origin = useMemo(() => wreck.lead.clone(), [])
  const lastT = useRef(0)
  useFrame(() => {
    const p = ref.current
    if (!p) return
    const dt = Math.max(0, wreck.simT - lastT.current)
    lastT.current = wreck.simT
    const a = p.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < SPARKS; i++) {
      vel[i].y -= 9.81 * dt
      a.setXYZ(
        i,
        a.getX(i) + vel[i].x * dt,
        Math.max(0.05, a.getY(i) + vel[i].y * dt),
        a.getZ(i) + vel[i].z * dt,
      )
    }
    a.needsUpdate = true
    ;(p.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - wreck.simT / SPARK_LIFE_S)
    p.visible = wreck.simT < SPARK_LIFE_S
  })
  return (
    <points ref={ref} geometry={geo} position={origin}>
      <pointsMaterial
        color="#FFB347"
        size={0.18}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function Smoke() {
  const group = useRef<THREE.Group>(null)
  const puffs = useMemo(
    () =>
      Array.from({ length: SMOKE }, (_, i) => ({
        seed: i / SMOKE,
        drift: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.2 + Math.random(), (Math.random() - 0.5) * 0.8),
      })),
    [],
  )
  // the plume starts above the flames, lit from below, not on top of them
  const up = useMemo(() => new THREE.Vector3(0, 5.5, 0), [])
  const disc = useMemo(softDisc, [])
  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    const age = wreck.simT
    g.position.copy(wreck.lead)
    g.children.forEach((c, i) => {
      const p = puffs[i]
      const t = (age * 0.5 + p.seed) % 1 // each puff on its own 2 s loop
      c.position.copy(p.drift).multiplyScalar(t * 6).add(up)
      c.scale.setScalar(1.5 + t * 5)
      c.quaternion.copy(camera.quaternion)
      ;((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity =
        0.28 * (1 - t) * Math.min(1, age / 0.5)
    })
  })
  return (
    <group ref={group}>
      {puffs.map((_, i) => (
        <mesh key={i}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="#2E2E2E" alphaMap={disc} transparent depthWrite={false} opacity={0} />
        </mesh>
      ))}
    </group>
  )
}

function Fire() {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        // normal blending: additive fire disappears against a daylight sky
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
        // The canvas uses a logarithmic depth buffer. three's own materials
        // write log-encoded depth through these chunks; a custom shader that
        // leaves them out writes plain depth instead, which compares as
        // "behind everything" and the quad silently never appears.
        vertexShader: `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          uniform float uTime;
          uniform float uAlpha;
          varying vec2 vUv;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                       mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
          }
          void main() {
            #include <logdepthbuf_fragment>
            vec2 p = vUv;
            p.y -= uTime * 0.9;
            float n = noise(p * 4.0) * 0.6 + noise(p * 9.0 + 3.0) * 0.4;
            float flame = smoothstep(0.15, 0.9, n * (1.3 - vUv.y)) * (1.0 - abs(vUv.x - 0.5) * 2.0);
            // deep red at the edges, a white-yellow core low down
            vec3 col = mix(vec3(0.9, 0.12, 0.0), vec3(1.0, 0.95, 0.55), flame * (1.0 - vUv.y * 0.6));
            gl_FragColor = vec4(col, min(1.0, flame * 1.6) * uAlpha);
          }`,
      }),
    [],
  )
  useFrame(({ camera }) => {
    const m = ref.current
    if (!m) return
    mat.uniforms.uTime.value = wreck.simT
    mat.uniforms.uAlpha.value = Math.min(1, Math.max(0, (wreck.simT - FIRE_AFTER_S) / 0.8))
    m.position.copy(wreck.lead).setY(wreck.lead.y + 2.6)
    m.quaternion.copy(camera.quaternion)
  })
  return (
    // drawn after the smoke, whatever the sort says: flames sit in front of
    // the plume they light, never buried under it
    <mesh ref={ref} material={mat} renderOrder={1}>
      <planeGeometry args={[6, 8]} />
    </mesh>
  )
}

export function CrashFX() {
  useFrame(() => {
    shake.value = SHAKE_M * Math.max(0, 1 - wreck.simT / SHAKE_DECAY_S)
  })
  return (
    <>
      <Sparks />
      <Smoke />
      <Fire />
    </>
  )
}
