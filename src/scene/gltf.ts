/**
 * The one place GLB loading is configured: Draco for the geometry, KTX2 /
 * Basis for the textures (scripts/ktx-assets.mjs makes them).
 *
 * The KTX2 loader has to know the GPU's compressed formats before the first
 * texture is transcoded, and that needs the renderer. So World mounts
 * <GltfSetup/> as its first child, which primes the loader during render,
 * before any sibling calls useGLTF; and the module-level preloads other
 * scenes used to do are gone (they ran before a renderer existed).
 */
import { useThree } from '@react-three/fiber'
import type { CompressedTexture, WebGLRenderer } from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

export const DRACO_PATH = '/draco/'
export const BASIS_PATH = '/basis/'

let ktx2: KTX2Loader | null = null

/** Make the texture loader ready for this renderer. Idempotent. */
export function primeKTX2(gl: WebGLRenderer): void {
  if (ktx2) return
  ktx2 = new KTX2Loader().setTranscoderPath(BASIS_PATH)
  ktx2.detectSupport(gl)
}

/** pass as useGLTF's 4th argument */
// drei's loader is three-stdlib's; it takes three's KTX2Loader fine at run
// time (it only calls load on it), the types just do not know each other
export function withKTX2(loader: unknown): void {
  if (ktx2) (loader as { setKTX2Loader: (l: unknown) => unknown }).setKTX2Loader(ktx2)
}

/** A standalone .ktx2 texture through the same loader (suspends while it loads). */
const ktxCache = new Map<string, { p: Promise<void>; v?: CompressedTexture; e?: unknown }>()
export function useKTX2Texture(url: string): CompressedTexture {
  const gl = useThree((s) => s.gl)
  primeKTX2(gl)
  let c = ktxCache.get(url)
  if (!c) {
    const entry: { p: Promise<void>; v?: CompressedTexture; e?: unknown } = { p: Promise.resolve() }
    entry.p = ktx2!.loadAsync(url).then(
      (v) => {
        entry.v = v
      },
      (e: unknown) => {
        entry.e = e
      },
    )
    ktxCache.set(url, entry)
    c = entry
  }
  if (c.v) return c.v
  if (c.e) throw c.e
  throw c.p
}

export function GltfSetup() {
  const gl = useThree((s) => s.gl)
  primeKTX2(gl)
  return null
}
