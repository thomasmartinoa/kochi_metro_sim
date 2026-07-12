# PRD — Phase 2: Water Metro, Landing Experience, Game-like Navigation

Date: 2026-07-11 · Status: approved-pending-user-go · Builds on the shipped Phase 1
(M0–M7 + real-OSM city).

## 1 · Goals

1. Remove Dispatch mode (cut scope the user no longer wants).
2. Game-like **WASD navigation** in Tracker and Explore.
3. **Kochi Water Metro** as a second, first-class experience — live tracker +
   ride-along for the real boat network, in the same 3D city.
4. **Landing page** — interactive 3D entry that presents the site and routes the
   user to Metro or Water Metro.
5. **Themed loading screens** — train animation for Metro, boat-on-waves for
   Water Metro.

## 2 · Researched facts — Kochi Water Metro (design inputs)

India's first water metro, opened April 2023, operated by KMRL (same agency —
same brand family as our Blue Line, teal + white livery).

- **Terminals live (official site, 2026):** High Court, Vypin, Vyttila,
  Kakkanad, Fort Kochi, Willingdon Island, Mattancherry, South Chittoor,
  Cheranalloor, Eloor (+ Bolgatty widely reported on the northern route).
  Full build-out: 38 terminals / 16 routes / 78 boats / 76 km.
- **Routes to simulate (4):**
  - `W1 High Court ⇄ Vypin` — harbour crossing, ~10 min, 15 min peak headway
  - `W2 Vyttila ⇄ Kakkanad` — lake + canal to Infopark, ~20–25 min, 20–30 min headway
  - `W3 High Court ⇄ Bolgatty ⇄ South Chittoor ⇄ Cheranalloor ⇄ Eloor` — Periyar
    corridor, intermediate stops, ~40 min end-to-end
  - `W4 Fort Kochi ⇄ Willingdon Island ⇄ Mattancherry ⇄ High Court` — heritage loop
- **Boats:** Cochin Shipyard electric **catamarans**, aluminium twin hull,
  **24 m**, ~50–100 pax, AC cabin with panoramic windows, LTO batteries
  (10–15 min charge), **8 kn battery / 10 kn hybrid** (≈15–18 km/h service),
  0.9 m draft, low-wake hulls. Livery: white superstructure, teal band + KMRL
  marks, dark glazing band.
- **Service:** roughly 06:30–20:00 (route-dependent, up to ~22:00 on W1);
  fares ₹20 / ₹30 / ₹40 by journey length; Kochi1 card shared with the metro.
- **No GTFS** is published — schedules are frequency-based ⇒ we synthesise a
  deterministic timetable per route (generated once into JSON, same
  "deterministic clock" contract as the train engine — tracker stays honest).

Sources: Wikipedia (Kochi Water Metro), watermetro.co.in (+ /boat-schedule
terminal list), ship-technology.com, trafficinfratech.com, pppinindia.gov.in.

## 3 · Architecture decisions

- **One world, two experiences.** The city GLB + satellite ground + atmosphere
  are shared. A top-level `experience: 'landing' | 'metro' | 'water'` drives
  which UI + camera focus + moving vehicles are emphasised. Trains keep running
  in water mode (they're visible from the water — it's the same city) and
  boats keep sailing in metro mode; only UI focus changes.
- **Routing:** hash-based (`#/`, `#/metro`, `#/water`) — 3 screens don't need
  react-router; back button + shareable links work.
- **Water engine mirrors the train engine:** `scripts/gen-water-schedule.mjs`
  emits `src/data/water.json` (terminals, route polylines with per-vertex
  distance, per-route service windows + headways, synthesized trips with
  arr/dep at each terminal). `src/sim/waterEngine.ts` = pure
  `boatStatesAt(daySec)` with dwell/run phases — unit-testable exactly like
  `engine.ts`. Route polylines hand-traced over the OSM water polygons /
  satellite ground so boats never cross land (verified visually at build time).
- **WASD** = camera-frame panning of the OrbitControls target (not FPS
  pointer-lock): W/S along camera-forward projected to ground, A/D strafe,
  Q/E (or Space/C) altitude, Shift ×4, speed ∝ camera height. Pressing a move
  key releases train/boat follow. Ignored while an input/select has focus.
  One component (`KeyboardFly`) serves Tracker + Explore.

## 4 · Workstreams

### P0 — Cut Dispatch (small)
Delete `DispatchPanel`, dispatch branch in HUD/ModeSwitcher, `useDispatchStore`,
dispatch tick in World, related tests. `AppMode` becomes
`'tracker' | 'explore' | 'drive'`.

### P1 — WASD fly (small)
`src/scene/KeyboardFly.tsx` + hint chip + docs. Acceptance: WASD/QE/Shift work
in tracker & explore at 60 fps, follow-cam released on move, no capture while
typing in the journey planner.

### P2 — Water Metro data + engine
- `data/water/terminals.json` — 11 terminals: id, name, name_ml, lat/lon
  (jetty positions resolved against OSM water edge), routes served.
- Route polylines: traced vertex lists (lat/lon) per route; script computes
  cumulative km. Speeds: 14 km/h cruise, ease in/out near terminals; dwell 90 s
  (short hop) / 120 s (terminus turnaround).
- Synthesised trips per route from service windows + peak/off-peak headways.
- `waterEngine.ts`: `boatStatesAt`, `terminalDepartures`, `planWaterJourney`
  (single-route only, W-route interchange at High Court noted in UI).
- Vitest: terminal count, monotonic route distances, boats within water bbox,
  headway sanity, service-window boundaries, fare table (₹20/30/40 by duration).

### P3 — Water Metro 3D + UI
- `Boats.tsx`: pooled catamarans (procedural: twin hulls, cabin, teal band,
  glazing, small radar mast; ≤1.2k tris) with gentle bob + heading from route
  tangent + fading wake ribbon (double stripe of translucent white).
- `Terminals3D.tsx`: floating pontoon + gangway + mini teal canopy + name board.
- Water tracker UI (mirrors metro): routes rail (W1–W4 with colour codes),
  terminal panel (next boats), boat panel (next terminal, ETA, occupancy),
  journey planner with real fares; boat markers (route-coloured billboards);
  ride-along follow cam; explore + WASD work identically on water.
- Legend gains water routes; clock deck unchanged (same sim clock!).

### P4 — Landing experience
- `#/` renders the real 3D world as backdrop: slow auto-drift camera framing
  Marine Drive water + viaduct (train passing + boat crossing = the two
  products, live, behind the copy).
- Foreground: brand lockup "Kochi in Transit — കൊച്ചി" + two glass portal cards:
  **METRO** (Blue Line, 25 stations, live now: N trains in service) and
  **WATER METRO** (4 routes, 11 terminals, live boats count). Hover: camera
  eases toward that system; click: camera flies in, UI crossfades, hash updates.
- Below-fold (scroll or "About" toggle): what the site is, real-data notes,
  mode list (Track / Explore / Drive), attribution block, GitHub link.
- Mobile: cards stack, static camera.

### P5 — Loading + transitions
- Suspense fallback overlay keyed by target experience:
  - Metro: SVG 3-car Metropolis sliding across a track line, wheels rolling,
    KMRL teal, progress % from `useProgress`.
  - Water: SVG catamaran bobbing over two animated sine-wave lines, wake dots.
  - Landing: K-monogram pulse.
- 600 ms camera-fly + fade when switching experiences (no reload — same scene).

## 5 · Order & estimates

P0 → P1 (unblock feel immediately) → P2 → P3 → P4 → P5. Roughly: P0+P1 one
session; P2+tests one; P3 one–two; P4+P5 one. Commit per workstream, screenshot
verification per visual milestone (existing DevCam + scrubber workflow).

## 6 · Risks / notes

- Route tracing must respect real waterways (use OSM water polygons already in
  the GLB as the guide; boats at y≈0.4 above satellite water).
- Vyttila–Kakkanad canal is narrow on the satellite image — trace carefully or
  the boat clips banks at bends.
- Landing backdrop reuses the full city GLB — first paint needs the loader from
  P5, so build the loader before polishing landing (P5 overlaps P4).
- Water Metro has no live API; the tracker label stays "timetable-live" (same
  honest wording as the metro).
- Keep dispatch removal a pure deletion commit so it can be reverted if the
  user ever wants it back.
