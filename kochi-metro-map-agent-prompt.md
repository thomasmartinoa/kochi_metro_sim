# Task: Streaming LOD satellite ground map for a Kochi Metro 3D simulator

## Context
This is a Vite + React + Three.js project: a 3D simulator of the Kochi Metro (Kochi, Kerala, India).
I need the ground to work like Google Maps: **satellite imagery that streams in tiles with
level-of-detail** — when the camera is close, high-zoom tiles load and the ground looks sharp
(real-map detail); when the camera moves away, low-zoom tiles replace them. No giant static
texture — tiles must load/unload on demand.

## Requirements

### 1. Library
Use **geo-three** (npm package `geo-three`, https://github.com/tentone/geo-three).
- Create a `MapView` in **planar mode** (`MapView.PLANAR`) added to our existing three.js scene.
  If the project uses react-three-fiber, wrap it in a `<primitive object={mapView} />`.
- Write a **custom tile provider** for ArcGIS World Imagery:
  - URL template: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
  - `maxZoom = 19`, `minZoom = 1`, tile size 256.
  - Show the required Esri attribution ("Powered by Esri | Maxar, Earthstar Geographics")
    as a small overlay in the corner of the canvas. (If we later get a MapTiler or Bing key,
    the provider should be swappable in one place.)
- LOD: start with the default `LODRaycast`; if tile popping is distracting, try `LODRadial`
  and tune the subdivide/simplify distance constants until street-level tiles (z18–19) load
  when the camera is under ~500 m altitude.

### 2. Coordinate system and precision
- geo-three positions tiles in **EPSG:3857 Web Mercator meters** — world coordinates near Kochi
  are around x ≈ 8,492,000, y ≈ 1,122,000, which breaks float32 precision.
  **Re-root the world**: put the MapView inside a parent `Group` translated by minus-the-mercator
  coordinates of our scene origin, so our origin sits at scene (0,0,0).
- Our scene origin (must match our Blender-exported city model):
  - `ORIGIN_LAT = 10.040735244750977`
  - `ORIGIN_LON = 76.28477096557617`
- Provide a utility `latLonToScene(lat, lon): Vector3` (and the inverse) that everything else
  (stations, route splines, train position, camera targets) uses. Metro station/route data will
  be given as lat/lon.

### 3. Aligning our city model (exported from Blender)
Our Kochi city model (OSM buildings, roads, water) comes from Blender in **true meters**,
local tangent plane centered on the origin above (X = east, Y = north in Blender; the glTF
exporter converts to three.js Y-up, so north becomes −Z).
Web Mercator meters are stretched by `1 / cos(latitude)` relative to true meters.
At our origin: `1 / cos(10.040735°) = 1.01556`.
- Scale the imported city model **uniformly by 1.01556** so it matches the mercator ground.
- Add a one-time **calibration check**: place a debug marker at a known landmark, e.g.
  Aluva metro station (10.1099° N, 76.3495° E) and verify the marker sits on that station in
  the imagery. Verify axis orientation empirically (north on the imagery vs. −Z of the model)
  before assuming signs.

### 4. Camera & controls
- `MapControls` (from `three/examples/jsm/controls/MapControls`) or our existing controls:
  pan across the map, zoom from ~50 km overview down to ~50 m street level, tilt clamped
  (e.g. 15°–89° polar) so the camera never goes under the ground.
- Imagery tiles must keep resolving to max zoom (19) at the closest camera distance.

### 5. Performance / quality
- Tile textures: `SRGBColorSpace`, `anisotropy = 8` (oblique views stay sharp), linear mipmaps.
- Dispose tile textures/geometry when nodes simplify — memory must not grow unboundedly while
  panning around the city.
- Target 60 fps on a mid-range GPU with the city model + one animated train loaded.

### 6. Acceptance criteria
- Zooming from full-city view to street level progressively sharpens the ground to z19 imagery
  with no manual steps.
- Zooming out swaps to coarse tiles and frame rate stays stable.
- City model and imagery align within ~10 m at metro stations along the line.
- Works offline-tolerant: a failed tile request retries and never crashes the scene.
- Attribution overlay is always visible.

## Explicitly out of scope (for now)
- Terrain elevation (Kochi is flat; a flat plane is fine).
- Google Photorealistic 3D Tiles (no photogrammetry coverage for Kochi; would need API billing).
- Vector/label overlays.
