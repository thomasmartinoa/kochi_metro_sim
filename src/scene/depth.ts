/**
 * Which depth buffer the scene can afford.
 *
 * The world spans 8 cm (the cab desk) to 60 km. A plain 24-bit depth buffer
 * spends nearly all its precision near the camera, so a few km out the
 * ground, roads and backdrop flicker through each other. The scene used a
 * logarithmic depth buffer for that, but it costs: three implements it by
 * writing gl_FragDepth in every fragment shader, which switches off the
 * GPU's early depth test, so every overdrawn fragment (a city has plenty)
 * is shaded before it is thrown away.
 *
 * A reversed-Z buffer gets the same precision from the projection maths
 * alone -- no fragment-shader depth, early-Z intact -- given a floating
 * point depth attachment and the EXT_clip_control extension. The effect
 * composer's render target supplies the float depth (PostFX.tsx).
 *
 * It is opt-in for now (`?reversez` in the URL): the headless renderer this
 * project verifies with advertises the extension but draws the backdrop
 * over the city under it, and no real GPU has been checked yet. Once it
 * has, flip the default here.
 */
export const REVERSED_DEPTH: boolean = (() => {
  try {
    if (!location.search.includes('reversez')) return false
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    if (!gl) return false
    const ok = gl.getExtension('EXT_clip_control') !== null
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return ok
  } catch {
    return false
  }
})()
