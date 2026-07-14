import { useEffect } from 'react'
import { World } from './scene/World'
import { HUD } from './ui/HUD'
import { Landing } from './ui/Landing'
import { Loader } from './ui/Loader'
import { useSimStore, type Experience } from './state/useSimStore'

const HASH_TO_EXP: Record<string, Experience> = {
  '#/metro': 'metro',
  '#/water': 'water',
  '#/': 'landing',
  '': 'landing',
}
const EXP_TO_HASH: Record<Experience, string> = {
  landing: '#/',
  metro: '#/metro',
  water: '#/water',
}

/** Two-way sync between the URL hash and the experience state. */
function useHashRouting() {
  const experience = useSimStore((s) => s.experience)
  const setExperience = useSimStore((s) => s.setExperience)

  useEffect(() => {
    const fromHash = () => {
      const exp = HASH_TO_EXP[window.location.hash]
      if (exp && exp !== useSimStore.getState().experience) setExperience(exp)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [setExperience])

  useEffect(() => {
    const want = EXP_TO_HASH[experience]
    if (window.location.hash !== want) window.history.pushState(null, '', want)
  }, [experience])
}

export default function App() {
  useHashRouting()
  const experience = useSimStore((s) => s.experience)
  return (
    <div className="relative h-full w-full">
      <World />
      {experience === 'landing' ? <Landing /> : <HUD />}
      <Loader />
    </div>
  )
}
