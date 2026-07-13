/**
 * Water Metro terminals: floating pontoon, gangway, teal canopy, name board.
 * Clickable — selects the terminal for the departures panel.
 */
import { Text } from '@react-three/drei'
import labelFont from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff?url'
import { terminalPoses } from '../sim/waterAlignment'
import { useSimStore } from '../state/useSimStore'
import { mat } from './materials'

function Terminal({ index }: { index: number }) {
  const { terminal, pos, tan } = terminalPoses[index]
  const select = useSimStore((s) => s.select)
  const rotY = Math.atan2(tan.x, tan.z)

  return (
    <group
      position={[pos.x, pos.y, pos.z]}
      rotation={[0, rotY, 0]}
      onClick={(e) => {
        e.stopPropagation()
        select({ kind: 'terminal', id: terminal.id })
      }}
    >
      {/* floating pontoon */}
      <mesh material={mat.pontoon} position={[0, 0.35, 0]}>
        <boxGeometry args={[9, 0.7, 26]} />
      </mesh>
      {/* fender edge */}
      <mesh material={mat.boatBand} position={[0, 0.62, 0]}>
        <boxGeometry args={[9.2, 0.18, 26.2]} />
      </mesh>
      {/* canopy on posts */}
      {[-8, 0, 8].map((z) =>
        [-3.6, 3.6].map((x) => (
          <mesh key={`${x}:${z}`} material={mat.gangway} position={[x, 2.2, z]}>
            <boxGeometry args={[0.28, 3.1, 0.28]} />
          </mesh>
        )),
      )}
      <mesh material={mat.roof} position={[0, 4.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[5.4, 5.4, 24, 18, 1, true, Math.PI * 0.72, Math.PI * 0.56]} />
      </mesh>
      {/* gangway to shore */}
      <mesh material={mat.gangway} position={[8.5, 0.9, 0]} rotation={[0, 0, 0.16]}>
        <boxGeometry args={[9, 0.25, 2.6]} />
      </mesh>
      {/* name board */}
      <Text
        font={labelFont}
        position={[0, 7.6, 0]}
        fontSize={3.2}
        color="#EDF4F2"
        outlineColor="#0A1620"
        outlineWidth={0.2}
        anchorX="center"
        anchorY="bottom"
        rotation={[0, Math.PI / 2, 0]}
      >
        {terminal.name}
      </Text>
    </group>
  )
}

export function WaterTerminals() {
  return (
    <group>
      {terminalPoses.map((_, i) => (
        <Terminal key={i} index={i} />
      ))}
    </group>
  )
}
