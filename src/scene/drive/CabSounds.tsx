/** Plays the horn when the driver sounds it and the chime when boarding ends. */
import { useEffect, useRef } from 'react'
import { useDriveStore } from '../../state/useDriveStore'
import { playChime, playHorn } from './sounds'

export function CabSounds() {
  const hornAt = useDriveStore((s) => s.hornAtMs)
  const chime = useDriveStore((s) => s.drive?.chime ?? false)
  const lastHorn = useRef(0)
  useEffect(() => {
    if (hornAt && hornAt !== lastHorn.current) {
      lastHorn.current = hornAt
      playHorn()
    }
  }, [hornAt])
  useEffect(() => {
    if (chime) playChime()
  }, [chime])
  return null
}
