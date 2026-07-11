/**
 * Stylized low-poly Kochi: backwaters to the west, the Periyar crossing near
 * Aluva, seeded building clusters around stations (denser in the Ernakulam
 * core), palm groves, and a few landmark masses. Evocative, not literal.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { alignment, stationPoses } from '../sim/alignment'
import { project } from '../sim/projection'
import { mat } from './materials'

/** deterministic PRNG so the city is identical every load */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** urban density weight per station order (Ernakulam core is busiest) */
const density = (order: number) => {
  const core = 1 - Math.abs(order - 14.5) / 14
  return 0.35 + core * 0.9
}

function tooCloseToTrack(x: number, z: number, minD: number): boolean {
  // coarse check against alignment points (~60 m spacing)
  for (let i = 0; i < alignment.length; i += 2) {
    const p = alignment[i].pos
    const dx = p.x - x
    const dz = p.z - z
    if (dx * dx + dz * dz < minD * minD) return true
  }
  return false
}

function Buildings() {
  const { matrices, colors } = useMemo(() => {
    const rand = mulberry32(20260709)
    const ms: THREE.Matrix4[] = []
    const cs: THREE.Color[] = []
    const palette = ['#D9CFC0', '#CBC2B2', '#E2D8CA', '#BFB7A8', '#D2C6B4', '#C7BFB3']
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (const { station, pos } of stationPoses) {
      const n = Math.round(90 * density(station.order))
      for (let k = 0; k < n; k++) {
        const ang = rand() * Math.PI * 2
        const r = 60 + rand() * 620
        const x = pos.x + Math.cos(ang) * r
        const z = pos.z + Math.sin(ang) * r * 0.8
        if (tooCloseToTrack(x, z, 42)) continue
        const w = 10 + rand() * 22
        const d = 10 + rand() * 22
        const coreBoost = station.order > 10 && station.order < 21 ? 1.8 : 1
        const hgt = (5 + rand() * rand() * 26) * coreBoost
        const m = new THREE.Matrix4()
        q.setFromAxisAngle(up, rand() * Math.PI)
        m.compose(new THREE.Vector3(x, hgt / 2, z), q, new THREE.Vector3(w, hgt, d))
        ms.push(m)
        cs.push(new THREE.Color(palette[Math.floor(rand() * palette.length)]))
      }
    }
    return { matrices: ms, colors: cs }
  }, [])

  return (
    <instancedMesh
      args={[undefined, undefined, matrices.length]}
      material={mat.building}
      ref={(mesh) => {
        if (!mesh) return
        matrices.forEach((m, i) => {
          mesh.setMatrixAt(i, m)
          mesh.setColorAt(i, colors[i])
        })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  )
}

export function Palms() {
  const { trunks, fronds } = useMemo(() => {
    const rand = mulberry32(9101112)
    const t: THREE.Matrix4[] = []
    const f: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const tilt = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (const { pos } of stationPoses) {
      for (let k = 0; k < 26; k++) {
        const ang = rand() * Math.PI * 2
        const r = 40 + rand() * 700
        const x = pos.x + Math.cos(ang) * r
        const z = pos.z + Math.sin(ang) * r
        if (tooCloseToTrack(x, z, 30)) continue
        const h = 6 + rand() * 6
        q.setFromAxisAngle(up, rand() * Math.PI)
        tilt.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.16, 0, (rand() - 0.5) * 0.16))
        const m = new THREE.Matrix4()
        m.compose(new THREE.Vector3(x, h / 2, z), q.clone().multiply(tilt), new THREE.Vector3(0.5, h, 0.5))
        t.push(m)
        const mf = new THREE.Matrix4()
        mf.compose(new THREE.Vector3(x, h + 1.2, z), q, new THREE.Vector3(4.6, 2.6, 4.6))
        f.push(mf)
      }
    }
    return { trunks: t, fronds: f }
  }, [])

  return (
    <>
      <instancedMesh
        args={[undefined, undefined, trunks.length]}
        material={mat.palmTrunk}
        ref={(mesh) => {
          if (!mesh) return
          trunks.forEach((m, i) => mesh.setMatrixAt(i, m))
          mesh.instanceMatrix.needsUpdate = true
        }}
      >
        <cylinderGeometry args={[0.35, 0.55, 1, 5]} />
      </instancedMesh>
      <instancedMesh
        args={[undefined, undefined, fronds.length]}
        material={mat.palmFrond}
        ref={(mesh) => {
          if (!mesh) return
          fronds.forEach((m, i) => mesh.setMatrixAt(i, m))
          mesh.instanceMatrix.needsUpdate = true
        }}
      >
        <coneGeometry args={[1, 1, 6]} />
      </instancedMesh>
    </>
  )
}

/** Water: Vembanad backwaters west of the core + Periyar river near Aluva. */
function Water() {
  const backwater = useMemo(() => {
    // wide organic-ish polygon west of Marine Drive (near Maharaja's, order 15)
    const anchor = stationPoses[15].pos
    const shape = new THREE.Shape()
    const rand = mulberry32(424242)
    const cx = anchor.x - 2400
    const cz = anchor.z
    const rx = 2100
    const rz = 3400
    const n = 18
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const rr = 1 + (rand() - 0.5) * 0.25
      const x = cx + Math.cos(a) * rx * rr
      const z = cz + Math.sin(a) * rz * rr
      if (i === 0) shape.moveTo(x, z)
      else shape.lineTo(x, z)
    }
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(Math.PI / 2) // shape XY -> world XZ
    return geo
  }, [])

  const river = useMemo(() => {
    // Periyar band crossing the alignment just south of Aluva (s ~ 1.1 km)
    const a = project(10.1035, 76.335)
    const geo = new THREE.PlaneGeometry(3600, 420)
    geo.rotateX(-Math.PI / 2)
    geo.rotateY(-0.35)
    geo.translate(a.x, 0, a.z)
    return geo
  }, [])

  return (
    <>
      <mesh geometry={backwater} material={mat.water} position={[0, 0.25, 0]} />
      <mesh geometry={river} material={mat.water} position={[0, 0.25, 0]} />
    </>
  )
}

/** A few recognisable landmark masses. */
function Landmarks() {
  const edapally = stationPoses[8].pos // Lulu Mall
  const jln = stationPoses[11].pos // stadium
  const vytilla = stationPoses[19].pos // mobility hub
  return (
    <group>
      {/* Lulu Mall: broad white mass with curved roof */}
      <group position={[edapally.x + 260, 0, edapally.z - 140]}>
        <mesh material={mat.landmark} position={[0, 11, 0]}>
          <boxGeometry args={[260, 22, 150]} />
        </mesh>
        <mesh material={mat.roof} position={[0, 24, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[70, 70, 252, 20, 1, true, Math.PI * 0.72, Math.PI * 0.56]} />
        </mesh>
      </group>
      {/* JLN Stadium: elliptical bowl */}
      <group position={[jln.x - 320, 0, jln.z - 60]}>
        <mesh material={mat.landmark} position={[0, 12, 0]} scale={[1.35, 1, 1]}>
          <cylinderGeometry args={[150, 170, 24, 28, 1, true]} />
        </mesh>
        <mesh
          material={mat.column}
          position={[0, 24, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[1.35, 1, 1]}
        >
          <torusGeometry args={[152, 5, 8, 28]} />
        </mesh>
      </group>
      {/* Vyttila Mobility Hub: bus-stand slab */}
      <mesh material={mat.landmark} position={[vytilla.x + 190, 7, vytilla.z + 120]}>
        <boxGeometry args={[180, 14, 90]} />
      </mesh>
    </group>
  )
}

export function City() {
  return (
    <group>
      <Water />
      <Buildings />
      <Palms />
      <Landmarks />
    </group>
  )
}
