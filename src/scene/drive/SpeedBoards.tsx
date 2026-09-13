/**
 * Speed boards beside the track: a yellow-rimmed disc with the limit, planted
 * BOARD_LEAD_M before each curve restriction on the driver's left, and a
 * blue "line speed" board where it ends. They are the rule made visible;
 * nothing enforces them.
 */
import { Text } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import labelFont from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff?url'
import { TRACK_OFFSET_M } from '../../data/trainset'
import { centerAtG, G_END, G_START, leftOf } from '../../sim/alignment'
import { LINE_SPEED_KMH, REAL_ENV } from '../../sim/drive'
import { curveRestrictions } from '../../sim/speedLimits'

/** how far before a restriction its board stands */
const BOARD_LEAD_M = 120
/** boards stand this far outside the outer rail */
const BOARD_OUT_M = TRACK_OFFSET_M + 2.6
const POST_H = 2.2

interface Board {
  pos: THREE.Vector3
  rotY: number
  text: string
  end: boolean
}

function useBoards(): Board[] {
  return useMemo(() => {
    const out: Board[] = []
    const plant = (g: number, dir: 0 | 1, text: string, end: boolean) => {
      const { pos, tan } = centerAtG(g)
      const travel = dir === 0 ? tan : tan.clone().negate()
      const side = leftOf(travel).multiplyScalar(BOARD_OUT_M)
      out.push({
        pos: pos.clone().add(side),
        // the disc's face is its local +Z; turn it to meet the oncoming driver
        rotY: Math.atan2(-travel.x, -travel.z),
        text,
        end,
      })
    }
    for (const r of curveRestrictions(REAL_ENV, G_START, G_END)) {
      // up direction reads it approaching from lower g; down from higher g
      plant(r.fromG - BOARD_LEAD_M, 0, String(r.limitKmh), false)
      plant(r.toG + 20, 0, String(LINE_SPEED_KMH), true)
      plant(r.toG + BOARD_LEAD_M, 1, String(r.limitKmh), false)
      plant(r.fromG - 20, 1, String(LINE_SPEED_KMH), true)
    }
    return out
  }, [])
}

/** the number is only legible this close; beyond it the disc alone reads as a board */
const TEXT_RANGE_M = 500

/**
 * Posts and discs are three instanced meshes for every board on the line
 * (130-odd boards were ~400 draw calls a frame); the numbers are troika
 * text, one draw each, shown only within TEXT_RANGE_M of the camera.
 */
export function SpeedBoards() {
  const boards = useBoards()
  const camera = useThree((s) => s.camera)
  const textRefs = useRef<(THREE.Object3D | null)[]>([])
  const instances = useMemo(() => {
    const n = boards.length
    const post = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.06, 0.06, POST_H, 8),
      new THREE.MeshStandardMaterial({ color: '#8F9698', roughness: 0.9 }),
      n,
    )
    const rim = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.5, 32),
      new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.6, side: THREE.DoubleSide }),
      n,
    )
    const face = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.4, 32),
      new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.6 }),
      n,
    )
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const yellow = new THREE.Color('#F2C400')
    const blue = new THREE.Color('#1E63C8')
    const white = new THREE.Color('#F7F7F2')
    boards.forEach((b, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotY)
      const at = (lx: number, ly: number, lz: number) => p.set(lx, ly, lz).applyQuaternion(q).add(b.pos)
      post.setMatrixAt(i, m.compose(at(0, POST_H / 2, 0), q, one))
      rim.setMatrixAt(i, m.compose(at(0, POST_H + 0.45, 0), q, one))
      face.setMatrixAt(i, m.compose(at(0, POST_H + 0.45, 0.01), q, one))
      rim.setColorAt(i, b.end ? blue : yellow)
      face.setColorAt(i, b.end ? blue : white)
    })
    for (const im of [post, rim, face]) {
      im.instanceMatrix.needsUpdate = true
      im.frustumCulled = false
    }
    return { post, rim, face }
  }, [boards])

  useFrame(() => {
    // a text draw per board is only worth it where the number can be read
    for (let i = 0; i < boards.length; i++) {
      const t = textRefs.current[i]
      if (t) t.visible = camera.position.distanceTo(boards[i].pos) < TEXT_RANGE_M
    }
  })

  return (
    <group>
      <primitive object={instances.post} />
      <primitive object={instances.rim} />
      <primitive object={instances.face} />
      {boards.map((b, i) => (
        <group key={i} position={b.pos} rotation={[0, b.rotY, 0]}>
          <Text
            ref={(el) => {
              textRefs.current[i] = el
            }}
            font={labelFont}
            position={[0, POST_H + 0.45, 0.02]}
            fontSize={b.end ? 0.28 : 0.42}
            color={b.end ? '#F7F7F2' : '#0A1620'}
            anchorX="center"
            anchorY="middle"
            visible={false}
          >
            {b.text}
          </Text>
        </group>
      ))}
    </group>
  )
}
