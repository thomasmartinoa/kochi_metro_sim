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
import { lightWithSky } from './metroMaterials'
import { applyWaterLook } from './waterLook'

const CITY_URL = '/models/kochi-city-v2.glb?v=5'
/** Blosm geo origin of the map_7 scene this GLB was exported from. */
const ORIGIN = { lat: 10.040735244750977, lon: 76.28477096557617 }
/**
 * Blosm projects the scene with spherical-mercator scaling — 111319.49 m per
 * degree of latitude (pi * WGS84 equatorial radius / 180), NOT the true local
 * meridian arc of ~110574 m/deg. This factor converts Blosm northing into the
 * app's project() frame; it is ~1.0 because both use the same scale.
 * (It was 111320/110574 = 1.00675, which stretched the city ~100 m over 15 km
 * and pushed every building off the satellite imagery.)
 */
const LAT_STRETCH = 111320 / 111319.49

/** Facade materials with emissive night windows — driven by Atmosphere. */
export const cityEmissives: THREE.MeshStandardMaterial[] = []
/** The backwaters, so Atmosphere can hand them a sky to reflect. */
export const cityWater: THREE.MeshStandardMaterial[] = []

export function CityGLB() {
  const { scene } = useGLTF(CITY_URL, '/draco/')

  const gl = useThree((s) => s.gl)

  useEffect(() => {
    cityEmissives.length = 0
    cityWater.length = 0
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
        if (m.name === 'KochiWater') {
          // The surface arrives as a near-mirror (roughness 0.12) with nothing
          // to break it up, so each light landed as one hard blob and the mesh's
          // own triangulation showed as patches of tone across the bay.
          // applyWaterLook flattens the normals and hands it a drifting ripple
          // field, which is what scatters the sun into a glitter path; the tint
          // stays light so the imagery underneath keeps supplying the real
          // colour and shoreline instead of a painted-on slab.
          m.roughness = 0.28
          m.metalness = 0.0
          m.transparent = true
          m.opacity = 0.55
          m.depthWrite = true
          lightWithSky(m, 0.45) // a broad sky sheen, not a mirror
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
          const bb = o.geometry.boundingBox!
          applyWaterLook(
            m,
            o.geometry,
            Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z),
            Math.min(8, maxAniso),
          )
          cityWater.push(m)
        }
      }
    })
    return () => {
      cityEmissives.length = 0
      cityWater.length = 0
    }
  }, [scene, gl])

  const { x, z } = project(ORIGIN.lat, ORIGIN.lon)
  return <primitive object={scene} position={[x, 0, z]} scale={[1, 1, LAT_STRETCH]} />
}

useGLTF.preload(CITY_URL, '/draco/')
