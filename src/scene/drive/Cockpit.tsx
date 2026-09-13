/**
 * The modelled driving cab, mounted in the leading car in drive mode.
 *
 * `metro-cockpit.glb` is the front cab of the Blender scene exported with its
 * hierarchy intact (scripts/build-metro-assets.mjs joins everything else by
 * material, which would weld the lever to the desk). It is the very same cab
 * the leading car model carries, so the car's own copy is hidden (see
 * DriveTrain) and this one is placed exactly where it was: MOUNT is the
 * offset between the seat in the two files, measured at export.
 *
 * Live parts, by the names the author gave them:
 *   Cockpit_Component_026            the master controller — origin at the
 *                                    hinge, swings about its local X (lateral)
 *   Cockpit_Display_Screen_004/3/1   right MFD, centre MFD, small left readout
 *   Cockpit_Control_Button_* etc.    the button clusters; four controls do
 *                                    something (BUTTON_ACTION), the rest click
 */
import { useGLTF } from '@react-three/drei'
import { DRACO_PATH, withKTX2 } from '../gltf'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { stations } from '../../data/network'
import { brakingDistanceM, NOTCH_MAX, NOTCH_MIN } from '../../sim/drive'
import { istDayTime } from '../../sim/clock'
import { useDriveStore } from '../../state/useDriveStore'
import { useSimStore } from '../../state/useSimStore'
import { prepareMetroMaterial } from '../metroMaterials'
import { groundDim } from '../TileGround'

const URL = '/models/metro-cockpit.glb?v=3'
/** the cab's seat in the leading-car model minus the same seat in this file */
const MOUNT = new THREE.Vector3(1.65, 3.78, 23.47)

const LEVER = 'Cockpit_Component_026'
/** lever swing per notch, radians; forward (positive notch) tips the grip away from the driver */
const LEVER_STEP = THREE.MathUtils.degToRad(6)
/** pixels of vertical drag per notch */
const DRAG_PX_PER_NOTCH = 22

interface ScreenSpec {
  node: string
  w: number
  h: number
  /** the part of the UV square the author mapped the pane to (glTF v, top-down) */
  uv: [u0: number, v0: number, u1: number, v1: number]
  /** this pane was unwrapped the other way up */
  flip?: boolean
}
/** right MFD, centre MFD, left readout -- as the driver sees them */
const SCREENS: ScreenSpec[] = [
  { node: 'Cockpit_Display_Screen_004', w: 512, h: 320, uv: [0, 0, 0.75, 1], flip: true },
  { node: 'Cockpit_Display_Screen_003', w: 512, h: 320, uv: [0, 0, 0.75, 1] },
  { node: 'Cockpit_Display_Screen_001', w: 384, h: 144, uv: [0.55, 0.39, 0.83, 1] },
]
const SCREEN_HZ = 10
/** canvas pixels per content unit: the panes are close to the eye and want the sharpness */
const DPR = 2

type Action = 'emergency' | 'doors' | 'horn' | 'headlights'
/** the buttons that do something, picked by their place on the desk at export */
const BUTTON_ACTION: Record<string, Action> = {
  // the red mushroom with the yellow collar, bottom-left of the desk: its
  // head, collar and stem were exported under the names below
  Bogie_Frame_Assembly_002: 'emergency',
  Cockpit_Component_045: 'emergency',
  Cockpit_Component_005: 'emergency',
  Steel_Frame_002: 'emergency',
  Steel_Frame_004: 'emergency',
  Cockpit_Control_Button_011: 'horn', // the large button on the right wing
  Cockpit_Control_Button_012: 'headlights', // beside it
  Cockpit_Control_Button_010: 'doors', // the large one in the centre row
}
const PRESS_M = 0.004
const PRESS_S = 0.15

/** true while the lever is being dragged, so the cab camera does not look around */
export const cockpitGrab = { active: false }

const FONT = "'IBM Plex Mono', ui-monospace, monospace"
const DISPLAY = "'Space Grotesk', system-ui, sans-serif"

function fmtTime(daySec: number): string {
  const h = Math.floor(daySec / 3600) % 24
  const m = Math.floor(daySec / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function Cockpit() {
  const gltf = useGLTF(URL, DRACO_PATH, undefined, withKTX2) as unknown as { scene: THREE.Object3D }
  const group = useRef<THREE.Group>(null)
  const lever = useRef<THREE.Object3D | null>(null)
  const leverBase = useRef(0)
  const pressed = useRef(new Map<THREE.Object3D, { until: number; base: THREE.Vector3 }>())
  const drag = useRef({ y0: 0, notch0: 0 })
  const lastDraw = useRef(0)

  // one instance: materials prepared, screens replaced with canvases
  const built = useMemo(() => {
    const scene = gltf.scene.clone(true)
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) prepareMetroMaterial(m)
      // the cover glass over the displays: the trainset rule makes it a
      // half-silvered mirror of the sky, which is all you would see of the
      // screens. Here it is a faint pane.
      if (o.material instanceof THREE.MeshStandardMaterial && /^M_Cockpit_glass$/i.test(o.material.name)) {
        const g = o.material.clone()
        g.opacity = 0.12
        g.roughness = 0.2
        g.envMapIntensity = 0.15
        g.depthWrite = false
        o.material = g
        // and it must not catch the clicks meant for what is under it
        o.raycast = () => {}
      }
    })
    const screens = SCREENS.map((spec) => {
      // the author's pane UVs run u down the screen and v across it (a
      // transpose), so the canvas is allocated sideways and every draw goes
      // through a transposing transform -- see panel()
      const canvas = document.createElement('canvas')
      canvas.width = spec.h * DPR
      canvas.height = spec.w * DPR
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      // glTF UVs run top-down; keep the canvas the same way up
      tex.flipY = false
      const [u0, v0, u1, v1] = spec.uv
      tex.repeat.set(1 / (u1 - u0), 1 / (v1 - v0))
      tex.offset.set(-u0 / (u1 - u0), -v0 / (v1 - v0))
      const mesh = scene.getObjectByName(spec.node) as THREE.Mesh | undefined
      if (mesh) {
        // the author's screen faces were exported inside out, hence both sides
        mesh.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false })
      }
      return { spec, canvas, ctx: canvas.getContext('2d')!, tex, mesh }
    })
    return { scene, screens }
  }, [gltf])

  useEffect(() => {
    lever.current = built.scene.getObjectByName(LEVER) ?? null
    leverBase.current = lever.current?.rotation.x ?? 0
  }, [built])

  // the lever: vertical drag sets the notch, absolute from where the grab began
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!cockpitGrab.active) return
      const d = Math.round((drag.current.y0 - e.clientY) / DRAG_PX_PER_NOTCH)
      const want = THREE.MathUtils.clamp(drag.current.notch0 + d, NOTCH_MIN, NOTCH_MAX)
      const st = useDriveStore.getState()
      if (st.drive && st.drive.notch !== want) st.setNotch(want)
    }
    const up = () => {
      cockpitGrab.active = false
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (useDriveStore.getState().view !== 'cockpit') return
    let o: THREE.Object3D | null = e.object
    while (o && o !== built.scene && o.name !== LEVER && !(o.name in BUTTON_ACTION)) o = o.parent
    if (!o || o === built.scene) return
    e.stopPropagation()
    const st = useDriveStore.getState()
    if (o.name === LEVER) {
      cockpitGrab.active = true
      drag.current = { y0: e.nativeEvent.clientY, notch0: st.drive?.notch ?? 0 }
      return
    }
    const action = BUTTON_ACTION[o.name]
    if (!pressed.current.has(o)) pressed.current.set(o, { until: 0, base: o.position.clone() })
    pressed.current.get(o)!.until = performance.now() + PRESS_S * 1000
    if (action === 'emergency') st.emergency()
    else if (action === 'doors') st.doors()
    else if (action === 'horn') st.horn()
    else if (action === 'headlights') st.toggleHeadlights()
  }

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const st = useDriveStore.getState()
    const d = st.drive
    if (!d) return
    // lever follows the notch, eased so a key press reads as a hand moving it
    const lv = lever.current
    if (lv) {
      const want = leverBase.current + d.notch * LEVER_STEP
      lv.rotation.x += (want - lv.rotation.x) * Math.min(1, dt * 12)
    }
    // buttons spring back
    const now = performance.now()
    for (const [o, p] of pressed.current) {
      const down = now < p.until
      o.position.copy(p.base)
      if (down) o.position.y -= PRESS_M
    }
    // screens at SCREEN_HZ, dimmed with the cab at night
    if (now - lastDraw.current < 1000 / SCREEN_HZ) return
    lastDraw.current = now
    const dim = THREE.MathUtils.clamp(0.45 + groundDim.value * 0.7, 0.45, 1)
    const [right, centre, small] = built.screens
    drawRight(right.ctx, right.spec, d, st.headlights, dim)
    drawCentre(centre.ctx, centre.spec, d, dim)
    drawSmall(small.ctx, small.spec, d, dim)
    for (const s of built.screens) s.tex.needsUpdate = true
  })

  return (
    <group ref={group} position={MOUNT} onPointerDown={onPointerDown}>
      <primitive object={built.scene} />
    </group>
  )
}

// --- the screens -----------------------------------------------------------

function panel(ctx: CanvasRenderingContext2D, spec: ScreenSpec, dim: number) {
  // content (x right, y down) -> canvas (y, x): undoes the pane's transposed
  // UVs; a flipped pane is the same the other way round
  if (spec.flip) ctx.setTransform(0, -DPR, -DPR, 0, spec.h * DPR, spec.w * DPR)
  else ctx.setTransform(0, DPR, DPR, 0, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = '#0A1620'
  ctx.fillRect(0, 0, spec.w, spec.h)
  ctx.globalAlpha = dim
}

/** right MFD: speed, notch, next stop, doors */
function drawRight(
  ctx: CanvasRenderingContext2D,
  spec: ScreenSpec,
  d: { vMs: number; notch: number; nextStopOrder: number; distToNextM: number; doorsOpen: boolean; slipping: boolean; adhesion: number },
  headlights: boolean,
  dim: number,
) {
  panel(ctx, spec, dim)
  const kmh = d.vMs * 3.6
  ctx.textBaseline = 'alphabetic'
  // --- speed, top left: the number, its unit tucked under it
  ctx.fillStyle = d.slipping ? '#FF6B8A' : '#E8F4FF'
  ctx.font = `700 104px ${DISPLAY}`
  ctx.textAlign = 'left'
  ctx.fillText(String(Math.round(kmh)), 24, 112)
  ctx.font = `500 18px ${FONT}`
  ctx.fillStyle = d.slipping ? '#FF6B8A' : '#7FA6C0'
  ctx.fillText(d.slipping ? 'WHEEL SLIP' : 'km/h', 26, 140)
  // --- notch, top right: brake cells to the left, power to the right
  const cells = NOTCH_MAX - NOTCH_MIN + 1
  const cw = 18
  const bx = spec.w - 24 - cells * cw
  const by = 44
  for (let n = NOTCH_MIN; n <= NOTCH_MAX; n++) {
    const x = bx + (n - NOTCH_MIN) * cw
    const on = n < 0 ? d.notch <= n && d.notch < 0 : n > 0 ? d.notch >= n : false
    ctx.fillStyle = n === 0 ? '#2B3F50' : on ? (n < 0 ? (n === NOTCH_MIN ? '#FF3B5C' : '#FF9A3C') : '#38E1B6') : '#1B2A38'
    ctx.fillRect(x, by, cw - 4, 30)
  }
  ctx.fillStyle = '#7FA6C0'
  ctx.font = `500 14px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText('BRAKE', bx, by + 50)
  ctx.textAlign = 'right'
  ctx.fillText('POWER', bx + cells * cw - 4, by + 50)
  ctx.fillStyle = '#E8F4FF'
  ctx.font = `700 34px ${DISPLAY}`
  ctx.fillText(d.notch === NOTCH_MIN ? 'EMERG' : d.notch > 0 ? `P${d.notch}` : d.notch < 0 ? `B${-d.notch}` : 'N', spec.w - 24, 140)
  // --- rule
  ctx.fillStyle = '#1B2A38'
  ctx.fillRect(24, 162, spec.w - 48, 2)
  // --- next stop
  const target = stations[d.nextStopOrder]
  ctx.textAlign = 'left'
  ctx.fillStyle = '#7FA6C0'
  ctx.font = `500 14px ${FONT}`
  ctx.fillText('NEXT STOP', 24, 192)
  ctx.fillStyle = '#E8F4FF'
  ctx.font = `600 30px ${DISPLAY}`
  ctx.fillText(target ? target.name : 'END OF LINE', 24, 226)
  if (target) {
    const dist = Math.max(0, d.distToNextM)
    const need = brakingDistanceM(d.vMs, d.adhesion)
    ctx.font = `600 24px ${FONT}`
    ctx.fillStyle = '#E8F4FF'
    ctx.fillText(dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`, 24, 262)
    ctx.textAlign = 'right'
    ctx.font = `500 16px ${FONT}`
    ctx.fillStyle = dist < need ? '#FF9A3C' : '#7FA6C0'
    ctx.fillText(`brake point ${Math.round(need)} m`, spec.w - 24, 262)
    ctx.textAlign = 'left'
  }
  // --- doors and lamps, bottom row
  ctx.font = `600 16px ${FONT}`
  ctx.fillStyle = d.doorsOpen ? '#FF9A3C' : '#38E1B6'
  ctx.fillText(d.doorsOpen ? '◐ DOORS OPEN' : '● DOORS CLOSED', 24, 300)
  ctx.fillStyle = headlights ? '#F5E9B8' : '#3B5063'
  ctx.textAlign = 'right'
  ctx.fillText(headlights ? 'LAMPS ON' : 'LAMPS OFF', spec.w - 24, 300)
  ctx.textAlign = 'left'
}

/** centre MFD: curve ahead, signal, schedule, score */
function drawCentre(
  ctx: CanvasRenderingContext2D,
  spec: ScreenSpec,
  d: {
    ahead: { limitKmh: number; distM: number; radiusM: number } | null
    signal: { distM: number; aspect: 'green' | 'yellow' | 'red' } | null
    vMs: number
    schedule: Record<number, number> | null
    runS: number
    nextStopOrder: number
    score: number
    comfort: number
    lateralMs2: number
  },
  dim: number,
) {
  panel(ctx, spec, dim)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // signal
  const asp = d.signal?.aspect ?? 'green'
  const col = asp === 'red' ? '#FF3B5C' : asp === 'yellow' ? '#FFC53C' : '#38E1B6'
  ctx.beginPath()
  ctx.arc(52, 58, 26, 0, Math.PI * 2)
  ctx.fillStyle = col
  ctx.fill()
  ctx.fillStyle = '#7FA6C0'
  ctx.font = `500 16px ${FONT}`
  ctx.fillText('SIGNAL', 96, 44)
  ctx.fillStyle = '#E8F4FF'
  ctx.font = `600 28px ${DISPLAY}`
  ctx.fillText(d.signal ? `${asp.toUpperCase()} · ${Math.round(d.signal.distM)} m` : 'CLEAR', 96, 76)
  // curve ahead
  ctx.fillStyle = '#7FA6C0'
  ctx.font = `500 16px ${FONT}`
  ctx.fillText('CURVE AHEAD', 24, 122)
  if (d.ahead) {
    const kmh = d.vMs * 3.6
    const over = kmh > d.ahead.limitKmh
    ctx.fillStyle = over ? '#FF9A3C' : '#E8F4FF'
    ctx.font = `700 44px ${DISPLAY}`
    ctx.fillText(`${Math.round(d.ahead.limitKmh)}`, 24, 166)
    ctx.font = `500 20px ${FONT}`
    ctx.fillStyle = '#7FA6C0'
    ctx.fillText(`km/h · R${Math.round(d.ahead.radiusM)} m · ${d.ahead.distM > 0 ? Math.round(d.ahead.distM) + ' m' : 'IN CURVE'}`, 110, 166)
  } else {
    ctx.fillStyle = '#E8F4FF'
    ctx.font = `600 28px ${DISPLAY}`
    ctx.fillText('LINE SPEED', 24, 160)
  }
  // lateral g bar
  const lat = Math.min(1, Math.abs(d.lateralMs2) / 2.6)
  ctx.fillStyle = '#1B2A38'
  ctx.fillRect(24, 182, spec.w - 48, 8)
  ctx.fillStyle = lat > 0.62 ? '#FF3B5C' : lat > 0.5 ? '#FFC53C' : '#38E1B6'
  ctx.fillRect(24, 182, (spec.w - 48) * lat, 8)
  // schedule
  const due = d.schedule?.[d.nextStopOrder]
  ctx.fillStyle = '#7FA6C0'
  ctx.font = `500 16px ${FONT}`
  ctx.fillText('SCHEDULE', 24, 224)
  ctx.font = `600 28px ${DISPLAY}`
  if (due != null) {
    const late = d.runS - due
    ctx.fillStyle = late > 30 ? '#FF9A3C' : '#E8F4FF'
    ctx.fillText(late >= 0 ? `${Math.round(late)} s late` : `${Math.round(-late)} s early`, 24, 256)
  } else {
    ctx.fillStyle = '#E8F4FF'
    ctx.fillText('—', 24, 256)
  }
  ctx.fillStyle = '#7FA6C0'
  ctx.font = `500 16px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText('SCORE', spec.w - 24, 224)
  ctx.fillStyle = '#E8F4FF'
  ctx.font = `600 28px ${DISPLAY}`
  ctx.fillText(String(Math.round(d.score)), spec.w - 24, 256)
  ctx.fillStyle = '#7FA6C0'
  ctx.font = `500 18px ${FONT}`
  ctx.fillText(`comfort ${Math.round(d.comfort)}%`, spec.w - 24, 296)
  ctx.textAlign = 'left'
}

/** the small readout: clock, weather, destination */
function drawSmall(ctx: CanvasRenderingContext2D, spec: ScreenSpec, d: { dir: 0 | 1 }, dim: number) {
  panel(ctx, spec, dim)
  const { daySec } = istDayTime(useSimStore.getState().epochMs)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#38E1B6'
  ctx.font = `700 60px ${DISPLAY}`
  ctx.fillText(fmtTime(daySec), 16, 70)
  ctx.fillStyle = '#7FA6C0'
  ctx.font = `500 20px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(useSimStore.getState().weather.toUpperCase(), spec.w - 16, 70)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#E8F4FF'
  ctx.font = `600 22px ${FONT}`
  ctx.fillText(d.dir === 0 ? 'TO TRIPUNITHURA' : 'TO ALUVA', 16, 118)
}

