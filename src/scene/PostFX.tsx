/**
 * Screen-space glow, then the tone map that turns the render into an image.
 *
 * **The tone map is not optional here.** r3f gives the canvas ACES filmic tone
 * mapping by default, and the whole scene — sun/hemi/fill intensities, the sky
 * radiance the metro's metals reflect, the emissive night materials — was tuned
 * looking through it. Mounting an EffectComposer silently takes it away: the
 * composer forces `gl.toneMapping = NoToneMapping` for the whole renderer so it
 * can tone map at the end of its own chain, and if nothing in the chain does,
 * nothing ever does. Everything above 1.0 then hard-clips to flat white instead
 * of rolling off, which is what blew out the station roof, its glazing and the
 * white flanks of the trainset into one glowing block.
 *
 * So ToneMapping goes last, after Bloom. That is also the correct order on its
 * own merits: bloom wants the real HDR values (a 3x-over-white highlight should
 * bleed more than a 1.1x one), and the tone map wants to be the final step that
 * maps the accumulated result into displayable range.
 *
 * Bloom's threshold is in that same pre-tone-map linear space, so it sits above
 * 1.0 — a sunlit facade reaching 0.9 is not a light source and should not glow.
 *
 * (Bloom's settings must stay static: EffectComposer memoises on its children,
 * so animating props or attaching a ref to <Bloom> throws a circular-structure
 * error. Atmosphere already raises the emissive materials as the sun goes down,
 * so the same fixed threshold naturally catches far more after dark.)
 */
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

export function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.5}
        // above 1.0 = brighter than white, i.e. genuinely a light source or a
        // specular hit — not every sunlit roof
        luminanceThreshold={1.05}
        luminanceSmoothing={0.3}
        mipmapBlur
        radius={0.7}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
