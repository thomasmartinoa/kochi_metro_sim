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
import { firstLoad } from './firstLoad'

/** Ground brightness 0..1, driven by Atmosphere's day/night keyframes. */
export const groundDim = { value: 1 }

/**
 * Initial-load tracking so the branded Loader can stay up until the opening
 * view's tiles have fully streamed in (otherwise the low-res -> high-res pop-in
 * is visible on first paint). `pending` counts in-flight tile requests and
 * `lastBusyAt` the last time any fetch started or finished — so "settled" means
 * a real quiet period, not a transient dip to 0 between LOD waves while the
 * camera is still resolving the view.
 */
const tileLoad = { pending: 0, loaded: 0, lastBusyAt: 0, leaves: 0, bare: 0 }
const MIN_TILES = 6
const STABLE_MS = 800
/**
 * Rays the LOD casts per frame while the opening view streams in. geo-three
 * refines the map by casting ONE random ray a frame and subdividing whatever
 * it hits, so a static view takes many seconds to reach its final detail —
 * and in the gaps nothing is pending, so "quiet" was true long before the
 * view was finished and the veil lifted onto coarse tiles. Cast a lot more
 * while the loader is up, so the whole view refines within a few frames.
 */
const FIRST_LOAD_RAYS = 24
/**
 * The opening view is settled when every tile currently being drawn has its
 * texture (`bare` counts drawn leaves still waiting on one), nothing is in
 * flight, and it has stayed that way for a moment.
 */
export function tilesSettled(): boolean {
  return (
    tileLoad.leaves >= MIN_TILES &&
    tileLoad.bare === 0 &&
    tileLoad.loaded >= MIN_TILES &&
    tileLoad.pending === 0 &&
    performance.now() - tileLoad.lastBusyAt >= STABLE_MS
  )
}

/** Same height the static overlay used before; below roads (0.35) and rail. */
const TILE_Y = -0.35

/**
 * Latitude-axis correction for the tiles, scaled about the Blosm-origin
 * latitude line. This is now 1.0 (identity): the tiles are true web-mercator
 * and everything else is corrected to true WGS84 at its own source, so no
 * warping of the imagery is needed.
 *
 * (It was briefly 1.006739 to bend the imagery onto a city that CityGLB was
 * mis-stretching. That matched the buildings but threw the GTFS metro off,
 * because the metro is genuine WGS84 — the real bug was the city's stretch.)
 * window.__tileF(f) still nudges it live if imagery ever needs re-checking.
 */
const TILE_LAT_F = 1.0
const TILE_DX = 0
const TILE_DZ = 0
/** Blosm scene geo-origin (must match CityGLB.ORIGIN); the lat pivot for the scale. */
const BLOSM_ORIGIN_LAT = 10.040735244750977

class EsriProvider extends MapProvider {
  public name = 'esri-world-imagery'
  public minZoom = 1
  public maxZoom = 19

  public fetchTile(zoom: number, x: number, y: number): Promise<HTMLImageElement | HTMLCanvasElement> {
    tileLoad.pending++
    tileLoad.lastBusyAt = performance.now()
    return new Promise((resolve) => {
      const done = (result: HTMLImageElement | HTMLCanvasElement, ok: boolean) => {
        tileLoad.pending = Math.max(0, tileLoad.pending - 1)
        tileLoad.lastBusyAt = performance.now()
        if (ok) tileLoad.loaded++
        resolve(result)
      }
      const attempt = (n: number): void => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => done(img, true)
        img.onerror = () => {
          if (n < 3) setTimeout(() => attempt(n + 1), 500 * (n + 1))
          // fully transparent tile: with alphaTest on the tile materials the
          // fragments are discarded, so the static overlay below shows
          // through instead of a black square
          else done(document.createElement('canvas'), false)
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

  // Tint tiles with the day/night ground brightness + texture quality niceties,
  // and take the census the loader gates on.
  useFrame(() => {
    if (!built) return
    ;(built.map.lod as LODRaycast).subdivisionRays = firstLoad.ready ? 1 : FIRST_LOAD_RAYS
    let leaves = 0
    let bare = 0
    built.map.traverse((o) => {
      const mesh = o as THREE.Mesh & { level?: number }
      // a map node that is currently drawn (subdivided parents drop isMesh)
      if (!mesh.isMesh || mesh.level === undefined) return
      leaves++
      const m = mesh.material as THREE.MeshBasicMaterial
      if (!m || !m.map) {
        bare++
        return
      }
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
    tileLoad.leaves = leaves
    tileLoad.bare = bare
  })

  if (!built) return null
  const { map, K, anchor } = built
  // Blosm-origin latitude line in app world z — the pivot the tiles' north axis
  // is scaled about to match the city's latitude frame.
  const pivotZ = -(BLOSM_ORIGIN_LAT - ORIGIN_LAT) * M_PER_DEG_LAT

  // dev calibration hooks: __tileF(f) sets the latitude scale, __tileShift(dx,dz)
  // a residual nudge. Both re-derive the two group transforms live.
  const outerRef = (g: THREE.Group | null) => {
    if (g && import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>
      w.__tileF = (f: number) => {
        g.scale.z = f
        g.position.z = pivotZ * (1 - f)
        console.log('tileF', f, '-> pivotZ', pivotZ.toFixed(1))
      }
    }
  }
  const innerRef = (g: THREE.Group | null) => {
    if (g && import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__tileShift = (dx: number, dz: number) => {
        g.position.x = -K * anchor.x + dx
        g.position.z = K * anchor.y + dz
        console.log('tileShift', dx, dz)
      }
    }
  }
  // Outer group scales the tiles' north (z) axis by TILE_LAT_F about pivotZ so
  // true-mercator imagery lands in the city's Blosm latitude frame. Inner group
  // is the mercator->app transform.
  return (
    <group ref={outerRef} position={[0, 0, pivotZ * (1 - TILE_LAT_F)]} scale={[1, 1, TILE_LAT_F]}>
      <group
        ref={innerRef}
        position={[-K * anchor.x + TILE_DX, TILE_Y, K * anchor.y + TILE_DZ]}
        scale={[K, 1, K]}
      >
        <primitive object={map} />
      </group>
    </group>
  )
}
