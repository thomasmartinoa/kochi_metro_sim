import { useEffect, useState } from 'react'

/** Whether a CSS media query matches, kept current as the viewport changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** a finger, or a viewport too narrow for the keyboard desk: the touch controls show */
export const TOUCH_QUERY = '(pointer: coarse), (max-width: 900px)'
/** a phone held upright */
export const PORTRAIT_PHONE_QUERY = '(orientation: portrait) and (max-width: 640px)'
