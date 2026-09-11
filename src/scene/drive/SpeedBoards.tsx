/**
 * Speed boards beside the track: a yellow-rimmed disc with the limit, planted
 * BOARD_LEAD_M before each curve restriction on the driver's left, and a
 * blue "line speed" board where it ends. They are the rule made visible;
 * nothing enforces them.
 */
import { Text } from '@react-three/drei'
import { useMemo } from 'react'
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

export function SpeedBoards() {
  const boards = useBoards()
  return (
    <group>
      {boards.map((b, i) => (
        <group key={i} position={b.pos} rotation={[0, b.rotY, 0]}>
          <mesh position={[0, POST_H / 2, 0]}>
            <cylinderGeometry args={[0.06, 0.06, POST_H, 8]} />
            <meshStandardMaterial color="#8F9698" roughness={0.9} />
          </mesh>
          <mesh position={[0, POST_H + 0.45, 0]}>
            <circleGeometry args={[0.5, 32]} />
            <meshStandardMaterial
              color={b.end ? '#1E63C8' : '#F2C400'}
              roughness={0.6}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh position={[0, POST_H + 0.45, 0.01]}>
            <circleGeometry args={[0.4, 32]} />
            <meshStandardMaterial color={b.end ? '#1E63C8' : '#F7F7F2'} roughness={0.6} />
          </mesh>
          <Text
            font={labelFont}
            position={[0, POST_H + 0.45, 0.02]}
            fontSize={b.end ? 0.28 : 0.42}
            color={b.end ? '#F7F7F2' : '#0A1620'}
            anchorX="center"
            anchorY="middle"
          >
            {b.text}
          </Text>
        </group>
      ))}
    </group>
  )
}
