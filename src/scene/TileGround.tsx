/**
 * Streaming LOD satellite ground (Google-Maps-style) via geo-three.
 *
 * Tiles come from Esri World Imagery (keyless endpoint; attribution shown in
 * the HUD/Landing footers). geo-three lays tiles out in EPSG:3857 web-mercator
 * metres — huge coordinates and a different metre-scale than our app world —
 * so the whole MapView is wrapped in a group that:
 *   1. scales by K = app-metres-per-mercator-metre (~cos(origin lat) ≈ 0.9847)
 *   2. translates so the app origin (project()'s ORIGIN) lands at (0,0,0)
 * Across the metro corridor this linearisation is accurate to < 1 m.
 *
 * geo-three tiles are unlit (MeshBasicMaterial), which would glow full-bright
 * at night; Atmosphere writes the current ground brightness into `groundDim`
 * and we tint every tile material with it each frame.
 *
 * The static aerial overlay (SatGround) stays underneath as an instant-on,
 * offline fallback — tiles simply cover it as they stream in.
 */
import { useFrame } from '@react-three/fiber'
import { LODRaycast, MapProvider, MapView, UnitsUtils } from 'geo-three'
import { useMemo } from 'react'
import * as THREE from 'three'
import { M_PER_DEG_LAT, ORIGIN_LAT, ORIGIN_LON } from '../sim/projection'

/** Ground brightness 0..1, driven by Atmosphere's day/night keyframes. */
export const groundDim = { value: 1 }

/** Same height the static overlay used before; below roads (0.35) and rail. */
const TILE_Y = -0.35

class EsriProvider extends MapProvider {
  public name = 'esri-world-imagery'
  public minZoom = 1
  public maxZoom = 19

  public fetchTile(zoom: number, x: number, y: number): Promise<HTMLImageElement | HTMLCanvasElement> {
    return new Promise((resolve) => {
      const attempt = (n: number): void => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => {
          if (n < 3) setTimeout(() => attempt(n + 1), 500 * (n + 1))
          else {
            // fully transparent tile: with alphaTest on the tile materials the
            // fragments are discarded, so the static overlay below shows
            // through instead of a black square
            resolve(document.createElement('canvas'))
          }
        }
        img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`
      }
      attempt(0)
    })
  }
}

export function TileGround() {
  const built = useMemo(() => {
    try {
      const map = new MapView(MapView.PLANAR, new EsriProvider())
      map.lod = new LODRaycast()
      // mercator metres -> app metres (app lat scale 111320 m/deg vs the
      // mercator sphere's equatorial 111319.49 m/deg, shrunk by cos(lat))
      const K =
        (Math.cos((ORIGIN_LAT * Math.PI) / 180) * M_PER_DEG_LAT) /
        ((Math.PI / 180) * UnitsUtils.EARTH_RADIUS)
      const anchor = UnitsUtils.datumsToSpherical(ORIGIN_LAT, ORIGIN_LON)
      return { map, K, anchor }
    } catch (e) {
      console.warn('TileGround disabled:', e)
      return null
    }
  }, [])

  // Tint tiles with the day/night ground brightness + texture quality niceties.
  useFrame(() => {
    if (!built) return
    built.map.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const m = mesh.material as THREE.MeshBasicMaterial
      if (!m || !m.map) return
      if (!m.userData.tuned) {
        m.userData.tuned = true
        m.map.anisotropy = 8
        m.map.colorSpace = THREE.SRGBColorSpace
        m.map.needsUpdate = true
        // failed tiles resolve to a transparent canvas; discarding their
        // fragments lets the static overlay below show instead of black
        m.alphaTest = 0.05
        m.needsUpdate = true
      }
      const d = groundDim.value
      if (m.color.r !== d) m.color.setScalar(d)
    })
  })

  if (!built) return null
  const { map, K, anchor } = built
  return (
    <group position={[-K * anchor.x, TILE_Y, K * anchor.y]} scale={[K, 1, K]}>
      <primitive object={map} />
    </group>
  )
}
