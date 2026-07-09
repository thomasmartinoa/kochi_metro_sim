/**
 * The Blue Line as world geometry: viaduct deck ribbon, piers, stations with
 * platforms + roofs + name boards — all derived from the real GTFS shape.
 */
import { Text } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import labelFont from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff?url'
import { alignment, centerAt, leftOf, stationPoses } from '../sim/alignment'
import { RAIL_LEVEL_M } from '../data/trainset'
import { useSimStore } from '../state/useSimStore'
import { mat } from './materials'

const DECK_W = 9
const DECK_TOP = RAIL_LEVEL_M - 0.3

/** Ribbon geometry following the alignment (deck top + skirts). */
function buildDeckGeometry(): THREE.BufferGeometry {
  const pts = alignment
  const n = pts.length
  const positions = new Float32Array(n * 2 * 3)
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const left = leftOf(pts[i].tan).multiplyScalar(DECK_W / 2)
    const p = pts[i].pos
    positions.set([p.x + left.x, DECK_TOP, p.z + left.z], i * 6)
    positions.set([p.x - left.x, DECK_TOP, p.z - left.z], i * 6 + 3)
    if (i < n - 1) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function Piers() {
  const inst = useMemo(() => {
    const sStart = alignment[0].sKm
    const sEnd = alignment[alignment.length - 1].sKm
    const step = 0.032 // one pier every 32 m
    const poses: THREE.Matrix4[] = []
    for (let s = sStart; s <= sEnd; s += step) {
      const { pos } = centerAt(s)
      const m = new THREE.Matrix4()
      m.setPosition(pos.x, (RAIL_LEVEL_M - 1) / 2, pos.z)
      poses.push(m)
    }
    return poses
  }, [])

  return (
    <instancedMesh
      args={[undefined, undefined, inst.length]}
      material={mat.pier}
      ref={(mesh) => {
        if (!mesh) return
        inst.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.instanceMatrix.needsUpdate = true
      }}
    >
      <boxGeometry args={[1.6, RAIL_LEVEL_M - 1, 1.6]} />
    </instancedMesh>
  )
}

function StationModel({ index }: { index: number }) {
  const { station, pos, tan } = stationPoses[index]
  const select = useSimStore((s) => s.select)
  const isTerminal = index === 0 || index === stationPoses.length - 1
  const rotY = Math.atan2(tan.x, tan.z)
  const platformLen = 75
  const roofW = isTerminal ? 22 : 17

  return (
    <group
      position={[pos.x, 0, pos.z]}
      rotation={[0, rotY, 0]}
      onClick={(e) => {
        e.stopPropagation()
        select({ kind: 'station', id: station.id })
      }}
    >
      {/* side platforms flanking the two tracks */}
      <mesh material={mat.platform} position={[-6.2, RAIL_LEVEL_M - 0.55, 0]}>
        <boxGeometry args={[3.6, 1.1, platformLen]} />
      </mesh>
      <mesh material={mat.platform} position={[6.2, RAIL_LEVEL_M - 0.55, 0]}>
        <boxGeometry args={[3.6, 1.1, platformLen]} />
      </mesh>
      {/* concourse below */}
      <mesh material={mat.platform} position={[0, RAIL_LEVEL_M - 5.5, 0]}>
        <boxGeometry args={[14, 3.2, platformLen * 0.55]} />
      </mesh>
      {/* curved roof: open shell arched over the platforms */}
      <mesh
        material={mat.roof}
        position={[0, RAIL_LEVEL_M - 3, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry
          args={[roofW * 0.75, roofW * 0.75, platformLen + 6, 28, 1, true, Math.PI * 0.68, Math.PI * 0.64]}
        />
      </mesh>
      {/* roof columns */}
      {[-platformLen / 2 + 6, 0, platformLen / 2 - 6].map((z) =>
        [-7.5, 7.5].map((x) => (
          <mesh key={`${x}:${z}`} material={mat.column} position={[x, RAIL_LEVEL_M + 2, z]}>
            <boxGeometry args={[0.7, 5.5, 0.7]} />
          </mesh>
        )),
      )}
      {/* platform light strips under the roof — glow at night */}
      <mesh material={mat.platformLight} position={[-6.2, RAIL_LEVEL_M + 4.6, 0]}>
        <boxGeometry args={[0.6, 0.18, platformLen * 0.9]} />
      </mesh>
      <mesh material={mat.platformLight} position={[6.2, RAIL_LEVEL_M + 4.6, 0]}>
        <boxGeometry args={[0.6, 0.18, platformLen * 0.9]} />
      </mesh>
      {/* name board */}
      <Text
        font={labelFont}
        position={[0, RAIL_LEVEL_M + 13.5, 0]}
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
}

export function Line3D() {
  const deckGeo = useMemo(buildDeckGeometry, [])
  return (
    <group>
      <mesh geometry={deckGeo} material={mat.deck} />
      <Piers />
      {stationPoses.map((_, i) => (
        <StationModel key={i} index={i} />
      ))}
    </group>
  )
}
