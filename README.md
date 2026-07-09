# Kochi Metro Simulator

A 3D browser simulation of the **Kochi Metro** — a live tracker and a game in one page.
Built with React 19, react-three-fiber, zustand and Tailwind 4 on Vite.

> **Contains data provided by Kochi Metro Rail Limited** — the real KMRL GTFS
> open-data feed (stations, track shape, 450 scheduled trips, fares,
> Malayalam/Hindi names) drives everything you see.

## Modes

| Mode | What it does |
| --- | --- |
| **Tracker** | Every train on the Blue Line, positioned live from the published timetable (IST). Station departures, route planner with real fares, day scrubber (00:00–24:00, 1×–300×). |
| **Explore** | Free-fly camera over a stylized Kochi. Click a train to ride along. |
| **Drive** | Take a 3-car Alstom Metropolis down the line. Power/brake notches, 80 km/h limit with penalty brake, stop on the mark at all 25 stations, get graded. |
| **Dispatch** | The Muttom OCC desk: random incidents strike the service — hold trains to even out the gaps and keep the service-quality KPI high. |

Because KMRL publishes no realtime feed, "live" positions are deterministic
interpolations of the official GTFS `stop_times` along the official
`shapes.txt` track geometry — the same technique most transit apps fall back
to, and it runs fully client-side (static hosting, no backend).

## Real-data facts baked in

- 25 stations Aluva → Tripunithura, bilingual names from the feed
- Real track alignment (28.8 km shape polyline, stations at true chainages)
- 450 real trips: Mon–Sat 255 trips 05:00–23:22, Sun 195 trips from 06:30
- End-to-end ~54 min as timetabled; fares ₹10–₹60 from the 25×25 fare matrix
- Pink Line (Phase 2 to Infopark) shown as a dashed "opening 2027" ghost

## Develop

```bash
npm install
npm run dev      # dev server
npm test         # 24 vitest unit tests (engine, drive physics, dispatch)
npm run build    # production bundle (~444 kB gzip)
npm run gtfs     # re-parse data/gtfs/*.txt -> src/data/gtfs.json
```

### Controls (Drive mode)

`W`/`↑` power up · `S`/`↓` brake · `Space` emergency · `C` cab/chase camera

## Architecture

```
scripts/parse-gtfs.mjs   GTFS feed -> compact typed JSON bundle
src/sim/                 pure, tested core (no react/three imports)
  engine.ts              timetable -> train states at any instant
  drive.ts               drive-mode physics + scoring
  dispatch.ts            delay overlay + headway KPIs
  alignment.ts           sKm -> 3D pose along the real shape (three)
src/state/               zustand stores (sim clock, drive, dispatch)
src/scene/               r3f world: viaduct, stations, trains, city, sky
src/ui/                  HUD panels (Tailwind 4, KMRL identity tokens)
```

Data attribution: Kochi Metro Rail Limited open data
(<https://kochimetro.org/open-data/>), used under its attribution licence.
This is an unofficial fan project, not affiliated with KMRL.
