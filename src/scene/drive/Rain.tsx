/**
 * Rain: a volume of falling streaks that rides with the camera, so it is
 * always around the viewer and never has to cover the city. Points only;
 * density follows the weather (rain vs monsoon) and eases in and out.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useSimStore } from '../../state/useSimStore'

const COUNT = 3000
/** the box of rain around the camera, metres */
const BOX = { w: 60, h: 40, d: 60 }
const FALL_MS = 11
/** streak length as a fraction of the point size, via a stretched quad in the shader */
const DENSITY: Record<string, number> = { clear: 0, overcast: 0, fog: 0, rain: 0.55, monsoon: 1 }

export function Rain() {
  const camera = useThree((s) => s.camera)
  const ref = useRef<THREE.Points>(null)
  const amount = useRef(0)
  const { geo, mat } = useMemo(() => {
    const pos = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX.w
      pos[i * 3 + 1] = Math.random() * BOX.h
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX.d
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // a streak: tall points, thinner with distance
          gl_PointSize = clamp(420.0 / -mv.z, 2.0, 14.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uAlpha;
        void main() {
          #include <logdepthbuf_fragment>
          // a vertical streak within the point: narrow in x, full in y
          float x = abs(gl_PointCoord.x - 0.5);
          if (x > 0.12) discard;
          float a = (1.0 - x / 0.12) * uAlpha * 0.75;
          gl_FragColor = vec4(0.78, 0.85, 0.92, a);
        }`,
    })
    return { geo, mat }
  }, [])

  useFrame((_, dt) => {
    const p = ref.current
    if (!p) return
    const want = DENSITY[useSimStore.getState().weather] ?? 0
    amount.current += (want - amount.current) * Math.min(1, dt * 0.8)
    mat.uniforms.uAlpha.value = amount.current
    p.visible = amount.current > 0.02
    if (!p.visible) return
    // the box rides with the camera; drops fall and wrap
    p.position.set(camera.position.x, camera.position.y - BOX.h * 0.6, camera.position.z)
    const a = geo.attributes.position as THREE.BufferAttribute
    const drop = FALL_MS * Math.min(dt, 0.1)
    for (let i = 0; i < COUNT; i++) {
      let y = a.getY(i) - drop
      if (y < 0) y += BOX.h
      a.setY(i, y)
    }
    a.needsUpdate = true
  })

  return <points ref={ref} geometry={geo} material={mat} visible={false} frustumCulled={false} />
}
