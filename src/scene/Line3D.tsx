/**
 * The Blue Line as world geometry, built from the authored Blender models
 * (scripts/blender_export_assets.py):
 *
 *   metro-span.glb     one viaduct span, repeated every SPAN_PITCH_M along the
 *                      alignment to carry the track
 *   metro-station.glb  the station box (arched roof, platforms, both tracks)
 *
 * Both are authored with the track along +Z, the deck centreline at the origin
 * and the rail running surface at y = 0, so a model dropped on the alignment
 * curve (which sits at RAIL_LEVEL_M) lands with its piers on the ground.
 *
 * Spans are instanced, but split into chunks so the frustum can cull the far
 * ones — a single InstancedMesh spanning 28 km would always draw all ~900.
 */
import { Text, useGLTF } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import labelFont from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff?url'
import { G_END, G_START, centerAtG, stationPoses } from '../sim/alignment'
import { SPAN_PITCH_M } from '../data/trainset'
import { useSimStore } from '../state/useSimStore'
import { prepareMetroMaterial } from './metroMaterials'

const SPAN_URL = '/models/metro-span.glb?v=6'
const STATION_URL = '/models/metro-station.glb?v=6'
/** spans per instanced chunk — small enough to cull, large enough to stay cheap */
const SPANS_PER_CHUNK = 24

/** Flattened (geometry, material) pairs of a loaded GLB, in world-space of the model. */
function useParts(url: string) {
  // '/draco/' — Draco-compressed assets; the local decoder avoids a CDN fetch.
  const { scene } = useGLTF(url, '/draco/')
  return useMemo(() => {
    const parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = []
    scene.updateMatrixWorld(true)
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const geo = o.geometry.clone()
      geo.applyMatrix4(o.matrixWorld) // bake the node transform into the geometry
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      prepareMetroMaterial(mats[0])
      parts.push({ geometry: geo, material: mats[0] })
    })
    return parts
  }, [scene])
}

/** Poses for every span along the line, chunked for frustum culling. */
function useSpanChunks() {
  return useMemo(() => {
    const all: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const one = new THREE.Vector3(1, 1, 1)
    // stepped in true metres: the spans butt end to end, so pacing them by GTFS
    // chainage (which drifts 0.7-1.6x locally) would tear gaps in the deck
    for (let g = G_START; g <= G_END; g += SPAN_PITCH_M) {
      const { pos, tan } = centerAtG(g)
      // the model's length runs along +Z, so aim +Z down the track tangent
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.clone().setY(0).normalize())
      all.push(new THREE.Matrix4().compose(pos, q, one))
    }
    const chunks: THREE.Matrix4[][] = []
    for (let i = 0; i < all.length; i += SPANS_PER_CHUNK) {
      chunks.push(all.slice(i, i + SPANS_PER_CHUNK))
    }
    return chunks
  }, [])
}

function SpanChunk({
  matrices,
  parts,
}: {
  matrices: THREE.Matrix4[]
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]
}) {
  return (
    <>
      {parts.map((p, i) => (
        <instancedMesh
          key={i}
          args={[p.geometry, p.material, matrices.length]}
          frustumCulled
          ref={(m) => {
            if (!m) return
            matrices.forEach((mat, k) => m.setMatrixAt(k, mat))
            m.instanceMatrix.needsUpdate = true
            m.computeBoundingSphere()
          }}
        />
      ))}
    </>
  )
}

function Viaduct() {
  const parts = useParts(SPAN_URL)
  const chunks = useSpanChunks()
  return (
    <group>
      {chunks.map((c, i) => (
        <SpanChunk key={i} matrices={c} parts={parts} />
      ))}
    </group>
  )
}

function Stations() {
  const parts = useParts(STATION_URL)
  const select = useSimStore((s) => s.select)
  return (
    <group>
      {stationPoses.map(({ station, pos, tan }, i) => {
        const isTerminal = i === 0 || i === stationPoses.length - 1
        // +Z of the model runs along the track
        const rotY = Math.atan2(tan.x, tan.z)
        return (
          <group
            key={station.id}
            position={[pos.x, pos.y, pos.z]}
            rotation={[0, rotY, 0]}
            onClick={(e) => {
              e.stopPropagation()
              select({ kind: 'station', id: station.id })
            }}
          >
            {parts.map((p, k) => (
              <mesh key={k} geometry={p.geometry} material={p.material} />
            ))}
            <Text
              font={labelFont}
              position={[0, 16, 0]}
              fontSize={isTerminal ? 5.2 : 4}
              color="#EDF4F2"
              outlineColor="#0A1620"
              outlineWidth={0.22}
              anchorX="center"
              anchorY="bottom"
              rotation={[0, Math.PI / 2, 0]}
            >
              {station.name}
            </Text>
          </group>
        )
      })}
    </group>
  )
}

export function Line3D() {
  return (
    <group>
      <Viaduct />
      <Stations />
    </group>
  )
}

useGLTF.preload(SPAN_URL, '/draco/')
useGLTF.preload(STATION_URL, '/draco/')
