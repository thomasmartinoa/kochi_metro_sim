"""
Export the OSM water mesh triangles (Blosm local metres) as lat/lon triangles
for water-route validation. Run headless:
  blender -b --factory-startup -P scripts/export_water_tris.py -- <library.blend> <out.json>
"""
import json
import math
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
LIB, OUT = argv

LAT0, LON0 = 10.021240234375, 76.30382537841797
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))

bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(LIB, link=False) as (src, dst):
    dst.objects = [n for n in src.objects if n == 'map.osm_water']
ob = dst.objects[0]
bpy.context.scene.collection.objects.link(ob)

me = ob.data
me.calc_loop_triangles()
tris = []
for lt in me.loop_triangles:
    t = []
    for vi in lt.vertices:
        co = me.vertices[vi].co
        lat = LAT0 + co.y / M_LAT
        lon = LON0 + co.x / M_LON
        t.append([round(lat, 6), round(lon, 6)])
    tris.append(t)

with open(OUT, 'w') as f:
    json.dump(tris, f)
print('EXPORTED', len(tris), 'water triangles ->', OUT)
