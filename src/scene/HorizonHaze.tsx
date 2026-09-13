/**
 * The haze the world dissolves into past the edge of the aerial imagery.
 *
 * This used to be a flat plane painted one fog colour. That leaves a hard line
 * across the view at dawn and dusk: the ground fogs to the fog keyframe while
 * the sky right above it is the atmospheric-scattering dome, and at sunset
 * those two are nowhere near the same colour.
 *
 * So instead of one colour, the disc ramps outward — fog colour underfoot,
 * blending to the sky's own colour by the time it reaches the horizon. The
 * ground fades into the sky rather than stopping against it.
 *
 * It stays opaque the whole way out on purpose: the sky dome is drawn below the
 * horizon as well as above, and letting that show through would put a band of
 * "sky seen from underneath" under the horizon line. The disc covers it.
 *
 * It follows the camera so the ramp is always centred on the viewer — the
 * horizon is the same distance away in every direction, wherever you fly.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

/** how far the haze reaches; well past the aerial sheet's ~31 km */
const RADIUS = 90000
/** fraction of the radius that is pure fog before the ramp to sky begins */
const RAMP_START = 0.35
/** kept below the ground so it can never win the depth test over the city */
const Y = -120

const VERT = /* glsl */ `
  varying float vR;
  void main() {
    vR = length(position.xy) / ${RADIUS.toFixed(1)};
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uNear;
  uniform vec3 uFar;
  varying float vR;
  void main() {
    float t = smoothstep(${RAMP_START.toFixed(2)}, 1.0, vR);
    gl_FragColor = vec4(mix(uNear, uFar, t), 1.0);
    #include <colorspace_fragment>
  }
`

export function HorizonHaze() {
  const mesh = useRef<THREE.Mesh>(null)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uNear: { value: new THREE.Color('#BFDDE2') },
          uFar: { value: new THREE.Color('#BFDDE2') },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        depthWrite: true,
        fog: false,
      }),
    [],
  )

  useFrame(() => {
    if (!mesh.current) return
    // ride with the camera so the ramp is always centred on the viewer
    mesh.current.position.set(camera.position.x, Y, camera.position.z)
    const fog = scene.fog
    if (fog) material.uniforms.uNear.value.copy(fog.color)
    if (scene.background instanceof THREE.Color) {
      material.uniforms.uFar.value.copy(scene.background)
    }
  })

  return (
    <mesh ref={mesh} material={material} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <circleGeometry args={[RADIUS, 96]} />
    </mesh>
  )
}
