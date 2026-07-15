/**
 * Screen-space glow. Bloom picks up anything brighter than the threshold and
 * bleeds it into neighbouring pixels: by day that's sun glare off water, glass
 * and pale roofs; after dark it's the emissive window maps, train/boat cabins
 * and platform strips spreading into a city-lights haze.
 *
 * The effect deliberately has *fixed* settings: Atmosphere already raises the
 * emissive materials as the sun goes down, so the same threshold naturally
 * catches far more at night. (It also must stay static — EffectComposer
 * memoises on its children, so animating props or attaching a ref to <Bloom>
 * throws a circular-structure error.)
 */
import { Bloom, EffectComposer } from '@react-three/postprocessing'

export function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.85}
        // only genuinely bright things glow, not every sunlit facade
        luminanceThreshold={0.75}
        luminanceSmoothing={0.3}
        mipmapBlur
        radius={0.75}
      />
    </EffectComposer>
  )
}
