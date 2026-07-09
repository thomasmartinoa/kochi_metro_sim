import { World } from './scene/World'
import { HUD } from './ui/HUD'

export default function App() {
  return (
    <div className="relative h-full w-full">
      <World />
      <HUD />
    </div>
  )
}
