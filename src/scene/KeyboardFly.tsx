/**
 * Game-style WASD flight for Tracker and Explore: pans the orbit target in the
 * camera's horizontal frame (W/S forward-back, A/D strafe, Q/E or Space/C
 * up-down, Shift = boost). Speed scales with camera altitude so hopping
 * between Aluva and Tripunithura doesn't take all day. Moving releases a
 * train follow. Keys are ignored while a form control has focus.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useSimStore } from '../state/useSimStore'

interface ControlsLike {
  target: THREE.Vector3
  update: () => void
}

const KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'KeyC',
])

function formFocused(): boolean {
  const el = document.activeElement
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  )
}

export function KeyboardFly() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const pressed = useRef<Set<string>>(new Set())
  const shift = useRef(false)

  const fwd = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])
  const move = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      shift.current = e.shiftKey
      if (!KEYS.has(e.code) || formFocused()) return
      // drive mode has its own keyboard scheme
      if (useSimStore.getState().appMode === 'drive') return
      if (e.code === 'Space') e.preventDefault() // don't scroll/press buttons
      if (!e.repeat) pressed.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => {
      shift.current = e.shiftKey
      pressed.current.delete(e.code)
    }
    const blur = () => pressed.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useFrame((_, dt) => {
    const keys = pressed.current
    if (keys.size === 0 || !controls) return
    const state = useSimStore.getState()
    if (state.appMode === 'drive' || state.experience === 'landing') return

    // moving under keyboard control releases a follow/selection lock
    if (state.selection?.kind === 'train') state.select(null)

    // camera-frame axes projected onto the ground plane
    camera.getWorldDirection(fwd)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
    fwd.normalize()
    right.set(-fwd.z, 0, fwd.x) // screen-right = fwd × up

    move.set(0, 0, 0)
    if (keys.has('KeyW')) move.add(fwd)
    if (keys.has('KeyS')) move.sub(fwd)
    if (keys.has('KeyD')) move.add(right)
    if (keys.has('KeyA')) move.sub(right)
    let dy = 0
    if (keys.has('KeyE') || keys.has('Space')) dy += 1
    if (keys.has('KeyQ') || keys.has('KeyC')) dy -= 1
    if (move.lengthSq() === 0 && dy === 0) return
    if (move.lengthSq() > 0) move.normalize()

    // altitude-scaled speed: ~40 m/s near ground, ~2 km/s from 5 km up
    const alt = Math.max(10, camera.position.y)
    let speed = 30 + alt * 0.38
    if (shift.current) speed *= 3.5
    const step = speed * Math.min(dt, 0.1)

    move.multiplyScalar(step)
    move.y = dy * step * 0.7
    camera.position.add(move)
    controls.target.add(move)
    // keep the camera from diving underground
    if (camera.position.y < 6) {
      controls.target.y += 6 - camera.position.y
      camera.position.y = 6
    }
    controls.update()
  })

  return null
}
