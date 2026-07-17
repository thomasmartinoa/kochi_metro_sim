/**
 * Real Kochi city from OpenStreetMap (via Blosm + headless Blender pipeline,
 * see scripts/blender_export_city_v2.py): true building footprints with
 * normal-mapped PBR facades (brick / apartments / office / glass / roof tiles /
 * concrete), textured road + railway ribbons. Draco-compressed GLB.
 *
 * Coordinates are Blosm-local metres around its geo origin; we anchor that
 * origin into the app world via project() and stretch z slightly to match the
 * app's equirectangular latitude scale (111320 vs true ~110574 m/deg).
 */
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { project } from '../sim/projection'

const CITY_URL = '/models/kochi-city-v2.glb?v=5'
/** Blosm geo origin of the map_7 scene this GLB was exported from. */
const ORIGIN = { lat: 10.040735244750977, lon: 76.28477096557617 }
const LAT_STRETCH = 111320 / 110574

/** Facade materials with emissive night windows — driven by Atmosphere. */
export const cityEmissives: THREE.MeshStandardMaterial[] = []

export function CityGLB() {
  const { scene } = useGLTF(CITY_URL, '/draco/')

  const gl = useThree((s) => s.gl)

  useEffect(() => {
    cityEmissives.length = 0
    const maxAniso = gl.capabilities.getMaxAnisotropy()
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      // sit just clear of the aerial ground (y=-0.35) so the ribbons read as
      // painted on the city; the log depth buffer keeps them solid at range
      if (o.name === 'Roads') o.position.y = 0.35
      o.updateMatrix()
      o.matrixAutoUpdate = false
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial)) continue
        // sharpen textures at grazing angles (window grids/asphalt alias badly)
        for (const tex of [m.map, m.emissiveMap, m.normalMap]) {
          if (tex) tex.anisotropy = Math.min(8, maxAniso)
        }
        if (m.map) m.map.needsUpdate = true
        if (m.emissiveMap) {
          m.emissive.set('#F5E9B8')
          m.emissiveIntensity = 0
          cityEmissives.push(m)
        }
      }
    })
    return () => {
      cityEmissives.length = 0
    }
  }, [scene, gl])

  const { x, z } = project(ORIGIN.lat, ORIGIN.lon)
  return <primitive object={scene} position={[x, 0, z]} scale={[1, 1, LAT_STRETCH]} />
}

useGLTF.preload(CITY_URL, '/draco/')
