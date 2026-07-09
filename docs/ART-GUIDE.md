# Art Upgrade Guide — modeling the real Kochi Metro

The world is already in **true metres** (1 three.js unit = 1 m, `src/sim/projection.ts`),
so anything modeled at real scale in Blender drops straight in. Blueprints with
measurements are in `docs/blueprints/` (PNG at 4400 px for import as Blender
reference images, SVG source alongside).

| Sheet | File | Key confirmed dims |
| --- | --- | --- |
| Trainset | `train-blueprint.png` | 66.55 m 3-car set, cars 2.90 W × 3.90 H, 4 doors/side, 750 V DC third rail (no pantograph) |
| Viaduct | `viaduct-blueprint.png` | span 25.0 m, pier shaft Ø1.60 circular, pile cap Ø3.60, twin U-girders |
| Station | `station-blueprint.png` | platform 75 m, 3 levels (street / concourse ~+6 / platform +11.4, rail +12.5), arched teal roof |

Dims marked `*` on the sheets are standard-DMRC estimates — worth checking against
your own site photos before detailing.

## 1 · Blender workflow

**Scene setup:** Units = Metric, 1.0 scale. Import each blueprint PNG as a
*Reference* empty in front/side/top orthographic views; scale it until the
printed dimension matches (e.g. the 66.55 m train = 66.55 BU).

**Per-asset spec** (origins matter — the game places objects by these):

| Asset | Origin | Forward | Budget | Notes |
| --- | --- | --- | --- | --- |
| Train car (DMC + TC variants) | rail level, car centre | +Y | ≤ 15k tris/car | Export **one car** per variant. The game positions 3 cars separately so the set bends on curves. |
| Pier (standard) | ground, shaft centre | cap across ±X | ≤ 2k tris | Instanced ~900×. Also worth: portal variant, cantilever variant. |
| Station | track centreline, rail level, mid-length | +X along track | ≤ 40k tris | Leave the track trough open/hollow — trains drive through the model. |
| Extras (palm, boat, bus, auto-rickshaw) | ground centre | any | ≤ 800 tris | All get instanced. |

**Materials & naming (the game drives these):**
- One 2k texture atlas per asset + a separate emissive map.
- Name night-glow materials exactly: `LED` (tusk lights), `TrainGlass`
  (windows), `PlatformLight` (station strip lights) — `Atmosphere.tsx` finds
  materials by name and animates `emissiveIntensity` after dark.
- KMRL palette: teal `#12B3A6`, deep green `#2E8B57`, body white `#F2F4F5`,
  lemon interior `#D6E64B`, concrete `#C9CCCE`. Bake AO into vertex colour or
  the atlas — the scene uses cheap lighting, baked AO does the heavy lifting.

**Export:** glTF 2.0 (`.glb`), *Apply Modifiers*, +Y up (exporter default),
compression optional (app can add Draco decoding). Drop files in
`public/models/` — e.g. `public/models/metropolis-dmc.glb`.

## 2 · Wiring models into the game (I do this part — or follow this)

- **Train:** in `src/scene/Trains.tsx`, replace the box-built `Car` component
  with `useGLTF('/models/metropolis-dmc.glb')` + `<primitive object={clone}/>`
  (use `SkeletonUtils.clone` or drei `<Clone>` per pool slot). Keep the
  3-child-group structure — positioning logic stays untouched.
- **Pier:** in `src/scene/Line3D.tsx` `Piers()`, take `geometry`/`material`
  off the loaded GLTF mesh and feed them to the existing `instancedMesh` —
  900 piers stay one draw call.
- **Station:** in `StationModel`, swap the platform/roof primitives for
  `<primitive>` of the station GLB; keep the `<Text>` name boards and the
  click handler on the group.
- **Drive/ride cams** need no changes — they follow track poses, not meshes.

## 3 · Making the map *actually Kochi* (OSM pipeline)

The single biggest visual upgrade after the models. OpenStreetMap has full
vector data for Kochi — real coastline, backwaters, roads, even building
footprints. Plan:

1. **Extract** with Overpass (bbox `9.88,76.20,10.16,76.44` covers the line +
   backwaters). Query per layer at [overpass-turbo.eu](https://overpass-turbo.eu):
   - water: `way["natural"="water"]`, `relation["natural"="water"]`, plus
     `waterway=riverbank` (Periyar, Vembanad edges)
   - roads: `way["highway"~"trunk|primary|secondary|tertiary"]` (skip minor)
   - buildings: `way["building"]` only within ~800 m of the metro line
     (huge dataset otherwise)
   - rail: `way["railway"="rail"]` (Ernakulam Jn/Town lines for realism)
2. **Simplify** in [mapshaper.org](https://mapshaper.org) — Visvalingam 10–20 %
   keeps shapes recognisable and tiny. Export GeoJSON.
3. **Convert**: a `scripts/parse-osm.mjs` (same pattern as `parse-gtfs.mjs`)
   projects every coordinate through the *existing* `project()` so it lands
   exactly under the metro line, and writes compact JSON to `src/data/`.
4. **Render** (replaces the procedural guesses in `City.tsx`):
   - water → `THREE.ShapeGeometry` polygons (real Vembanad/Periyar shapes)
   - roads → flat ribbon meshes (like the deck builder, width by road class)
   - buildings → `ExtrudeGeometry` from footprints, height = `levels × 3 m`
     (OSM `building:levels` where present, else random 2–5), merged into a few
     big buffers or instanced — keeps draw calls low
   - your GLB landmarks (Lulu, stadium…) placed at their real coordinates

**Faster alternative** (weekend version): export one styled raster of Kochi
(Mapbox Studio / Snazzy Maps style matching the game palette, ~8k px) and
drape it on the ground plane as a texture, keeping 3D buildings only near the
line. Hybrid raster-ground + vector-buildings is the sweet spot: real
geography readable from above, 3D where the camera lives.

## 4 · Photo-survey shot list (for texturing accuracy)

If you can visit: pier close-up (concrete tone + stains), U-girder underside,
station column cladding, platform floor tiles + tactile strip, name board
typography, cab front ¾ view, door interior faces, roof soffit. Overcast light,
straight-on, include something of known size for scale.

## 5 · Beyond models — ranked improvement ideas

1. **Post-processing** (`@react-three/postprocessing`): SMAA + subtle Bloom —
   makes the night LEDs/window glow actually bloom. Biggest wow per effort.
2. **Shadows**: one directional shadow cascade following the camera target
   (`shadow-camera` box ~500 m). Ground the trains visually.
3. **Water shader**: animated normal-scroll + fresnel on the backwater
   polygons; boats (Water Metro ferries!) as instanced GLBs on spline paths.
4. **Platform crowds**: billboard sprites that fade in with `occupancy` —
   sells the "living metro" instantly.
5. **Audio**: door chime, Malayalam/English announcements, traction hum tied
   to `speedKmh`, monsoon rain layer. (Howler or plain WebAudio.)
6. **Monsoon mode**: rain particles + wet-road reflection + darker sky preset —
   Kochi's most characteristic weather, and it reuses the Atmosphere keyframes.
7. **Route glow**: after planning a journey, light the track segment between
   origin/destination stations along the real curve.
8. **Performance**: code-split three.js chunk, `<Detailed>` LODs for stations,
   halve `dpr` on mobile — keeps the phone experience smooth as art gets heavier.

## Sources
- [Alstom press — Kochi Metropolis design](https://www.alstom.com/press-releases-news/2015/9/alstoms-metropolis-for-kochi-design-unveiled-for-the-first-time), [Alstom — 25 trainsets for Kochi](https://www.alstom.com/press-releases-news/2014/10/alstom-to-supply-the-city-of-kochi-with-25-metropolis-train-sets)
- [Kochi Metro — Wikipedia](https://en.wikipedia.org/wiki/Kochi_Metro) (66.55 m sets, 3.9 m height, capacity)
- [Dynamic Analysis of Metro Rail Supporting Structure — IJISET](https://ijiset.com/vol5/v5s4/IJISET_V5_I04_03.pdf) (25 m span, Ø1.6 m pier, Ø3.6 m pile cap)
- [DMRC Outline Design Specifications Ph-IV](https://delhimetrorail.com/otherdocuments/Outline-Design-Specifications-for-Phase-IV-(April-2019)10042019.pdf) (twin U-girder standard)
- [Kochi Metro Phase 2 U-girder — Metro Rail Today](https://metrorailtoday.com/news/first-u-girder-installed-on-jln-stadiuminfopark-corridor-of-kochi-metro-phase-2)
