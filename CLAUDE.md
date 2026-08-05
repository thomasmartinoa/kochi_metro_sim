# CLAUDE.md — Kochi Metro Simulator

Context for AI assistants working in this repo. Read this first.

## What this is

A 3D browser app: a **live tracker + playable simulator** of Kochi's public
transit, rendered over the real city on streaming satellite imagery. Two
experiences share one 3D world and one sim clock:

- **Kochi Metro** (`#/metro`) — Blue Line, 25 stations Aluva ⇄ Tripunithura.
  Modes: **Tracker** (live positions from the real timetable), **Explore**
  (free-fly + ride-along), **Drive** (drive a Metropolis train).
- **Kochi Water Metro** (`#/water`) — 4 routes, 11 terminals, catamarans.
  **Currently "coming soon"** on the live site (see Feature flags).
- **Landing** (`#/`) — cinematic drift over the harbour with portal cards.

"Live" is not GPS: KMRL publishes only GTFS-static, so positions are
**deterministic interpolations of the real timetable** at the current IST time.
Fully client-side, static-hostable (Vercel). No backend.

## Stack

Vite + React 19 + TypeScript + **react-three-fiber / three** + **zustand** +
**Tailwind 4**. Ground imagery via **geo-three** (streaming Esri World Imagery
tiles). City model authored in Blender (Blosm OSM import) → glTF.

## Commands

```bash
npm run dev      # dev server (localhost:5173)
npm test         # vitest (sim engines) — must stay green
npm run build    # production build
npm run gtfs     # re-parse data/gtfs/*.txt -> src/data/gtfs.json
```

## Architecture

```
src/sim/          pure, tested core — NO react/three imports
  engine.ts         metro timetable -> train states at any instant
  waterEngine.ts    water timetable -> boat states (mirror of engine.ts)
  drive.ts          drive-mode physics + scoring
  alignment.ts      metro sKm -> 3D pose along the GTFS shape
  waterAlignment.ts water route sKm -> 3D pose
  projection.ts     lat/lon <-> app-world metres (see Coordinates)
  clock.ts          IST helpers (UTC+5:30, handles >24h GTFS times)
src/state/        zustand stores (sim clock + experience, drive)
src/scene/        r3f world: CityGLB, TileGround, Line3D, Trains, Boats, sky
src/ui/           HUD panels, Landing, Loader (Tailwind)
src/config.ts     build-time feature flags
scripts/          data pipelines (GTFS, water schedule, Blender exports)
docs/             PRDs, blueprints, art guide
```

The sim layer is deterministic and unit-tested; keep react/three out of it.

## Data

- **Metro**: real KMRL GTFS feed → `src/data/gtfs.json` (25 stations, ~450
  trips, fares, shape, ml/hi names). Attribution "Contains data provided by
  Kochi Metro Rail Limited" is a licence requirement — keep it in the footer.
- **Water**: no official GTFS. `scripts/gen-water-schedule.mjs` synthesises a
  deterministic timetable from published service patterns → `src/data/water.json`.
- **City**: `public/models/kochi-city-v2.glb` (Draco+WebP). Built from a Blosm
  Blender scene via `scripts/blender_export_city_v2.py`. Bump the `?v=` cache
  key in `src/scene/CityGLB.tsx` after re-exporting.
- **Ground**: streaming Esri tiles (`TileGround.tsx`); a static aerial overlay
  (`SatGround.tsx` + `public/textures/kochi-overlay.webp`) sits under them as an
  offline/instant fallback.

## Coordinates — the one thing that bites everyone

Everything renders in **true WGS84**. `project(lat, lon)` in
`src/sim/projection.ts` is the single source of truth; all geometry (metro,
city, water, tiles) is anchored through it.

**Blosm projects with SPHERICAL-MERCATOR scaling — 111319.49 m per degree of
latitude (π·6378137/180), NOT the true meridian arc (~110574 at Kochi).**
Assuming 110574 stretches everything ~100 m over 15 km and pushes the whole
city off the imagery. This was the cause of a long-running "map drifts" bug.
Consequences baked into the code/scripts:

- `CityGLB.tsx` `LAT_STRETCH = 111320 / 111319.49` (≈1.0) — do **not** revert to
  `/110574`.
- Blender export scripts use `M_LAT = π·6378137/180`.
- Metro alignment reads the raw GTFS shape (`gtfs.shapeUp`, genuine WGS84), not
  the abandoned `shape-corrected.json`.
- `TileGround` needs **no** latitude warp (`TILE_LAT_F = 1.0`).

If the city and the metro ever disagree again: the **GTFS metro is the truth**.
Fix the city/imagery to it — never bend the imagery onto a mis-projected city.

## Feature flags (`src/config.ts`)

- `WATER_METRO_ENABLED` ← `import.meta.env.VITE_WATER_METRO === 'true'`.
  Default **off** → Water Metro shows a "Coming soon" card and `#/water`
  redirects to landing (guarded centrally in `useSimStore.setExperience`).
  Enable with `VITE_WATER_METRO=true` in `.env.local` (local) or a Vercel env
  var on the `water` branch's deployment. Production (`main`) leaves it unset.
  Ambient boats still sail in the world; only the enterable experience is gated.

## Git workflow

- `main` — live / Vercel production. Keep it deployable.
- `metro` — Kochi Metro feature work.
- `water` — Kochi Water Metro work (its Vercel deploy sets `VITE_WATER_METRO=true`).
- Finish a feature on its branch → PR → `main`.

**Do NOT add `Co-Authored-By` (or any AI attribution) trailers to commits.**

## Conventions

- Match surrounding code style; keep `src/sim/*` framework-free and tested.
- Before claiming done: `npx tsc -b`, `npm test`, `npm run build` all clean.
- Verify visual/3D changes in the browser (dev server + a screenshot), not just
  types — the interesting bugs are geometric.
- Dev-only camera hooks exist in `World.tsx` (`window.__cam`, `__sAt`, `__gl`,
  etc.) for scripted screenshots; time-scrub via the `input.scrubber` element.
