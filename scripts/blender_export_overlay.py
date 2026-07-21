"""
Extract the aerial ground overlay + its exact geographic bounds from the
authored Blosm scene.

The scene's Terrain is flat (zero elevation) — it is only a plane carrying the
aerial overlay — so the web app never needs its 1.2M polys, just the image and
where it sits. Bounds are fitted from the Terrain's UV->world mapping (not its
bounding box), which is what actually georeferences the image.

Run:
  blender -b <scene.blend> --factory-startup -P scripts/blender_export_overlay.py -- \
    <out.png> <lat0> <lon0>

lat0/lon0 = the Blosm geo origin of that scene (Scene['lat'], Scene['lon']).
Follow with:  node scripts/export-overlay.mjs <out.png>
"""
import json
import math
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
LAT0 = float(argv[1]) if len(argv) > 1 else bpy.context.scene.get('lat')
LON0 = float(argv[2]) if len(argv) > 2 else bpy.context.scene.get('lon')

# Blosm projects with spherical-mercator scaling, not the true meridian arc.
M_LAT = (math.pi * 6378137) / 180  # 111319.49 m/deg
M_LON = 111320.0 * math.cos(math.radians(LAT0))

terrain = next(o for o in bpy.data.objects if o.type == 'MESH' and 'terrain' in o.name.lower())
me = terrain.data
uvl = me.uv_layers.active
mw = terrain.matrix_world

# sample (world.xy, uv) pairs for an axis-aligned affine fit
samples = []
step = max(1, len(me.loops) // 4000)
for li in range(0, len(me.loops), step):
    lo = me.loops[li]
    co = mw @ me.vertices[lo.vertex_index].co
    uv = uvl.data[li].uv
    samples.append((co.x, co.y, uv.x, uv.y))

def fit(i_in, i_out):
    xs = [s[i_in] for s in samples]
    us = [s[i_out] for s in samples]
    n = len(xs)
    mx, mu = sum(xs) / n, sum(us) / n
    a = sum((x - mx) * (u - mu) for x, u in zip(xs, us)) / sum((x - mx) ** 2 for x in xs)
    b = mu - a * mx
    resid = max(abs(a * x + b - u) for x, u in zip(xs, us))
    return a, b, resid

ax, bx, rx = fit(0, 2)
ay, by, ry = fit(1, 3)
print(f'UV fit residuals u={rx:.5f} v={ry:.5f} (must be ~0: overlay is axis-aligned)')
if max(rx, ry) > 0.01:
    raise SystemExit('Terrain UVs are not axis-aligned; bounds fit would be wrong.')

# world extents at uv 0..1 -> lat/lon
x0, x1 = (0 - bx) / ax, (1 - bx) / ax
y0, y1 = (0 - by) / ay, (1 - by) / ay
bounds = {
    'west': LON0 + min(x0, x1) / M_LON,
    'east': LON0 + max(x0, x1) / M_LON,
    'south': LAT0 + min(y0, y1) / M_LAT,
    'north': LAT0 + max(y0, y1) / M_LAT,
}

mat = terrain.material_slots[0].material
img = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
img.save_render(OUT)
with open(OUT + '.bounds.json', 'w') as f:
    json.dump(bounds, f)
print('overlay', img.size[0], 'x', img.size[1], '->', OUT)
print(json.dumps(bounds, indent=1))
