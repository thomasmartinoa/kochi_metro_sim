/** Map legend: lines and train-marker directions. */
export function Legend() {
  return (
    <div className="hud-panel pointer-events-auto flex flex-col gap-1.5 px-3.5 py-2.5 font-display text-[11px] text-paper-dim">
      <div className="flex items-center gap-2">
        <span className="h-1 w-5 rounded-full bg-blueline" />
        <span>Blue Line · in service</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="h-1 w-5 rounded-full bg-pinkline"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px)',
          }}
        />
        <span>Pink Line · opening 2027</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-kmrl" />
        <span>train → Tripunithura</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-lemon" />
        <span>train → Aluva</span>
      </div>
    </div>
  )
}
