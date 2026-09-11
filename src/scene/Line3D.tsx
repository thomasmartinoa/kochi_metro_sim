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
import { G_END, G_START, centerAtG, curvatureAtG, stationPoses } from '../sim/alignment'
import { SPAN_PITCH_M } from '../data/trainset'
import { useSimStore } from '../state/useSimStore'
import { prepareMetroMaterial } from './metroMaterials'

const SPAN_URL = '/models/metro-span.glb?v=11'
const STATION_URL = '/models/metro-station.glb?v=11'
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

interface SpanPose {
  matrix: THREE.Matrix4
  /** signed curvature (1/m) at the span's centre */
  curv: number
}

/** Poses for every span along the line, chunked for frustum culling. */
function useSpanChunks() {
  return useMemo(() => {
    const all: SpanPose[] = []
    const q = new THREE.Quaternion()
    const one = new THREE.Vector3(1, 1, 1)
    // stepped in true metres: the spans butt end to end, so pacing them by GTFS
    // chainage (which drifts 0.7-1.6x locally) would tear gaps in the deck
    for (let g = G_START; g <= G_END; g += SPAN_PITCH_M) {
      const { pos, tan } = centerAtG(g)
      // the model's length runs along +Z, so aim +Z down the track tangent
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.clone().setY(0).normalize())
      all.push({ matrix: new THREE.Matrix4().compose(pos, q, one), curv: curvatureAtG(g) })
    }
    const chunks: SpanPose[][] = []
    for (let i = 0; i < all.length; i += SPANS_PER_CHUNK) {
      chunks.push(all.slice(i, i + SPANS_PER_CHUNK))
    }
    return chunks
  }, [])
}

/**
 * Bend each span to the curve it sits on.
 *
 * A span is a rigid 30.7 m piece aimed along the tangent at its centre. On a
 * bend that leaves both its ends off the arc and every joint a wedge — the
 * deck read as a chain of straight planks. Instead the vertex shader wraps
 * the span round a circle of the local radius: length along +Z becomes arc,
 * lateral +X (the left of travel) stays at its offset from that arc. Ends
 * land on the curve, joints meet, rails and parapets sweep through. Per
 * instance, so the straight spans stay straight and the geometry stays one
 * instanced draw.
 */
function bendToCurve(material: THREE.Material): void {
  const m = material as THREE.MeshStandardMaterial
  if ((m.userData as { bent?: boolean }).bent) return
  ;(m.userData as { bent?: boolean }).bent = true
  const prev = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aCurv;
        // wrap a point (lateral x, along z) round a circle of radius 1/k, centre
        // at (1/k, 0): x' = r - (r - x)cos(zk), z' = (r - x)sin(zk)
        vec3 bendSpan(vec3 p) {
          float k = aCurv;
          if (abs(k) < 1e-5) return p;
          float r = 1.0 / k;
          float ang = p.z * k;
          float d = r - p.x;
          return vec3(r - d * cos(ang), p.y, d * sin(ang));
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed = bendSpan(transformed);`,
      )
  }
  m.customProgramCacheKey = () => 'kochi-span-bend'
}

function SpanChunk({ poses, parts }: { poses: SpanPose[]; parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] }) {
  // Each chunk carries its own per-instance curvature, so each needs its own
  // geometry container. The parts' geometry is one object shared by every
  // chunk, and an InstancedBufferAttribute set on it by one chunk is read by
  // all of them — so once the short tail chunk mounted last, every 24-span
  // chunk was drawing with a 12-entry attribute. WebGL treats that as an
  // out-of-range read and skips the draw: on a real GPU the whole viaduct
  // vanished. Vertex buffers stay shared by reference; only the container
  // and the curvature attribute are per chunk.
  const geometries = useMemo(
    () =>
      parts.map((p) => {
        const g = new THREE.BufferGeometry()
        g.index = p.geometry.index
        for (const [name, attr] of Object.entries(p.geometry.attributes)) g.setAttribute(name, attr)
        g.setAttribute(
          'aCurv',
          new THREE.InstancedBufferAttribute(new Float32Array(poses.map((sp) => sp.curv)), 1),
        )
        return g
      }),
    [parts, poses],
  )
  return (
    <>
      {parts.map((p, i) => (
        <instancedMesh
          key={i}
          args={[geometries[i], p.material, poses.length]}
          frustumCulled
          ref={(m) => {
            if (!m) return
            poses.forEach((sp, k) => m.setMatrixAt(k, sp.matrix))
            m.instanceMatrix.needsUpdate = true
            bendToCurve(m.material as THREE.Material)
            m.computeBoundingSphere()
            // the bend can pull a span's far corners up to a couple of metres
            // off its straight footprint; keep the cull sphere honest
            if (m.boundingSphere) m.boundingSphere.radius += 3
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
        <SpanChunk key={i} poses={c} parts={parts} />
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
