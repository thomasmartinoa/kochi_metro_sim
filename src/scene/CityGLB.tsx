/**
 * Real Kochi city from OpenStreetMap (via Blosm + headless Blender pipeline,
 * see scripts/blender_export_city.py): true building footprints with textured
 * facades, real road network, Vembanad/Periyar water. Draco-compressed GLB.
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

const CITY_URL = '/models/kochi-city.glb'
const ORIGIN = { lat: 10.021240234375, lon: 76.30382537841797 }
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
      o.matrixAutoUpdate = false
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial)) continue
        // sharpen facade textures at grazing angles (window grids alias badly)
        for (const tex of [m.map, m.emissiveMap]) {
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
