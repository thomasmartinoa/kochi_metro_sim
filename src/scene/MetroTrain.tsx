/**
 * The authored Alstom Metropolis trainset, shared by the live trains and by
 * drive mode (scripts/blender_export_assets.py).
 *
 * The model is split into its three cars so each can be posed separately on the
 * alignment — a rigid 56 m body would visibly cut Kochi's tighter curves. Each
 * car is authored with its length along +Z, centred on its track, and its
 * wheels on y = 0, so dropping it on the alignment curve puts it on the rails.
 *
 * Both end cars have cabs. In the exported models car2's cab faces +Z (the
 * direction of travel) and car0's faces -Z, so the leading slot renders car2
 * and the trailing slot car0.
 *
 * At ~400 k triangles a full trainset is far too heavy for the 26 pooled
 * trains, so every car also ships a simplified LOD (~1/3 the triangles) that
 * takes over past LOD_SWITCH_M.
 */
import { Detailed, useGLTF } from '@react-three/drei'
import { DRACO_PATH, withKTX2 } from './gltf'
import { useMemo } from 'react'
import * as THREE from 'three'
import { prepareMetroMaterial } from './metroMaterials'

const FULL_URLS = [0, 1, 2].map((i) => `/models/metro-car${i}.glb?v=11`)
const LOD_URLS = [0, 1, 2].map((i) => `/models/metro-car${i}-lod.glb?v=11`)
/** slot 0 leads the train, slot 2 trails it -> model index */
export const SLOT_MODEL = [2, 1, 0] as const
const LOD_SWITCH_M = 320

export interface Part {
  name: string
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/** Flatten a GLB into (geometry, material) pairs with node transforms baked in. */
export function flattenScene(scene: THREE.Object3D): Part[] {
  const parts: Part[] = []
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const geometry = o.geometry.clone()
    geometry.applyMatrix4(o.matrixWorld)
    const material = Array.isArray(o.material) ? o.material[0] : o.material
    prepareMetroMaterial(material)
    parts.push({ name: o.name, geometry, material })
  })
  return parts
}

/** [full0, full1, full2, lod0, lod1, lod2] */
export function useCarParts(): Part[][] {
  // '/draco/' — these are Draco-compressed; without the local decoder drei
  // falls back to a CDN fetch and the loader hangs forever offline.
  const gltfs = useGLTF([...FULL_URLS, ...LOD_URLS], DRACO_PATH, undefined, withKTX2) as unknown as {
    scene: THREE.Object3D
  }[]
  return useMemo(() => gltfs.map((g) => flattenScene(g.scene)), [gltfs])
}

function Meshes({ parts, hide }: { parts: Part[]; hide?: RegExp }) {
  return (
    <>
      {parts.map((p, i) =>
        hide?.test(p.name) ? null : <mesh key={i} geometry={p.geometry} material={p.material} />,
      )}
    </>
  )
}

/**
 * One car of the set: `slot` 0 = leading, 1 = middle, 2 = trailing. `hide`
 * leaves out the full-detail parts whose names match (drive mode swaps the
 * leading car's baked-in cab for the live one).
 */
export function CarModel({ slot, parts, hide }: { slot: 0 | 1 | 2; parts: Part[][]; hide?: RegExp }) {
  const m = SLOT_MODEL[slot]
  return (
    <Detailed distances={[0, LOD_SWITCH_M]}>
      <group>
        <Meshes parts={parts[m]} hide={hide} />
      </group>
      <group>
        <Meshes parts={parts[3 + m]} />
      </group>
    </Detailed>
  )
}

