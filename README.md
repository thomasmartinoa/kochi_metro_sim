# Kochi in Transit — Metro & Water Metro Simulator

A 3D browser simulation of Kochi's public transit — a live tracker and a game
in one page, over the real city (OSM buildings + satellite ground). Built with
React 19, react-three-fiber, zustand and Tailwind 4 on Vite.

> **Contains data provided by Kochi Metro Rail Limited** — the real KMRL GTFS
> open-data feed (stations, track shape, 450 scheduled trips, fares,
> Malayalam/Hindi names) drives the metro. Map data © OpenStreetMap
> contributors · Imagery © Esri, Maxar.

## Experiences

An interactive landing page (`#/`) drifts over the living city and routes you
to either system — both run on the same deterministic IST clock:

| | |
| --- | --- |
| **Kochi Metro** (`#/metro`) | Blue Line, 25 stations Aluva ⇄ Tripunithura. Tracker · Explore · Drive. |
| **Water Metro** (`#/water`) | 4 routes, 11 terminals, electric catamarans on the real waterways. Tracker · Explore. |

## Modes

| Mode | What it does |
| --- | --- |
| **Tracker** | Every vehicle positioned live from the published timetable (IST). Departures per station/terminal, journey planner with real fares, day scrubber (00:00–24:00, 1×–300×). |
| **Explore** | Free-fly camera (`WASD` move · `Q/E` height · `Shift` fast). Click a train or boat to ride along. |
| **Drive** (metro) | Take a 3-car Alstom Metropolis down the line. Power/brake notches, 80 km/h limit with penalty brake, stop on the mark at all 25 stations, get graded. |

Because KMRL publishes no realtime feed, "live" positions are deterministic
interpolations of the official GTFS `stop_times` along the official
`shapes.txt` geometry. The Water Metro has no GTFS at all, so its timetable is
synthesised from the published service pattern and validated so every route
segment lies on real water (OSM water polygons + waterway centerlines, A*
routed). Fully client-side — static hosting, no backend.

## Real-data facts baked in

- 25 metro stations, bilingual names from the feed; real 28.8 km alignment,
  road-median-snapped against OSM
- 450 real metro trips: Mon–Sat 255 trips 05:00–23:22, Sun 195 from 06:30;
  fares ₹10–₹60 from the 25×25 matrix
- Water Metro: High Court ⇄ Vypin, Vyttila ⇄ Kakkanad (along the Kadambrayar
  canal), High Court ⇄ Eloor, Fort Kochi ⇄ High Court; fares ₹20/₹30/₹40
- Real Kochi: OSM building footprints with baked facades, roads, satellite
  ground; Pink Line (Phase 2 to Infopark) as a dashed "opening 2027" ghost

## Develop

```bash
npm install
npm run dev      # dev server
npm test         # 32 vitest unit tests (metro engine, water engine, drive)
npm run build    # production bundle
npm run gtfs     # re-parse data/gtfs/*.txt -> src/data/gtfs.json
node scripts/gen-water-schedule.mjs   # regenerate water routes/timetable
node scripts/fetch-satellite.mjs      # re-stitch the satellite ground
```

The Blender city pipeline (OSM via Blosm → textured GLB) is documented in
`docs/ART-GUIDE.md`; regenerate with `scripts/blender_export_city.py`.

### Controls

Tracker/Explore: `WASD` move · `Q/E` height · `Shift` boost ·
Drive: `W`/`↑` power · `S`/`↓` brake · `Space` emergency · `C` cab/chase camera

## Architecture

```
scripts/                 data pipelines (GTFS, water schedule, satellite, city GLB)
src/sim/                 pure, tested core (no react imports)
  engine.ts              metro timetable -> train states at any instant
  waterEngine.ts         water metro timetable -> boat states
  drive.ts               drive-mode physics + scoring
  alignment.ts           sKm -> 3D pose along the corrected metro shape
  waterAlignment.ts      route sKm -> 3D pose along water routes
src/state/               zustand stores (sim clock + experience, drive)
src/scene/               r3f world: city GLB, viaduct, trains, boats, sky
src/ui/                  HUD panels + Landing + loaders (Tailwind 4)
```

Data attribution: Kochi Metro Rail Limited open data
(<https://kochimetro.org/open-data/>), used under its attribution licence;
map data © OpenStreetMap contributors (ODbL); imagery © Esri, Maxar,
Earthstar Geographics. Unofficial fan project, not affiliated with KMRL.
