/**
 * Pink Line (Phase 2, under construction) — dashed elevated alignment from
 * JLN Stadium to Infopark/Kakkanad, shown as a "coming 2027" ghost. Display
 * only: no service is simulated on it.
 */
import { Text } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import labelFont from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff?url'
import { pinkLine } from '../data/network'
import { RAIL_LEVEL_M } from '../data/trainset'
import { project } from '../sim/projection'
import { mat } from './materials'

export function PinkLine() {
  const pts = useMemo(
    () =>
      pinkLine.stations.map((s) => {
        const { x, z } = project(s.lat, s.lon)
        return new THREE.Vector3(x, RAIL_LEVEL_M, z)
      }),
    [],
  )

  const dashes = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(pts)
    const segs: { pos: THREE.Vector3; quat: THREE.Quaternion; len: number }[] = []
    const total = curve.getLength()
    const dash = 26
    const gap = 18
    const up = new THREE.Vector3(0, 0, 1)
    for (let d = 0; d < total - dash; d += dash + gap) {
      const u0 = d / total
      const u1 = (d + dash) / total
      const a = curve.getPointAt(u0)
      const b = curve.getPointAt(u1)
      const mid = a.clone().add(b).multiplyScalar(0.5)
      const dir = b.clone().sub(a).normalize()
      const quat = new THREE.Quaternion().setFromUnitVectors(up, dir)
      segs.push({ pos: mid, quat, len: a.distanceTo(b) })
    }
    return segs
  }, [pts])

  const kakkanad = pts[6]

  return (
    <group>
      {dashes.map((s, i) => (
        <mesh key={i} position={s.pos} quaternion={s.quat} material={mat.pinkLine}>
          <boxGeometry args={[7, 1.2, s.len]} />
        </mesh>
      ))}
      {pinkLine.stations.map((s, i) => {
        const p = pts[i]
        return (
          <mesh key={s.name} position={[p.x, RAIL_LEVEL_M, p.z]} material={mat.pinkLine}>
            <cylinderGeometry args={[6, 6, 2.4, 16]} />
          </mesh>
        )
      })}
      <Text
        font={labelFont}
        position={[kakkanad.x, RAIL_LEVEL_M + 26, kakkanad.z]}
        fontSize={9}
        color="#E24F9A"
        outlineColor="#0A1620"
        outlineWidth={0.5}
        anchorX="center"
      >
        {`Pink Line · opening ${pinkLine.opens}`}
      </Text>
    </group>
  )
}
