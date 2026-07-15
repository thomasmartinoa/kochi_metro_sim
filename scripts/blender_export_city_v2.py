"""
Headless export of the NEW detailed Kochi city (Blosm map_7 scene) to
public/models/kochi-city-v2.glb.

Input library (written from the live session by the prep step) holds the
corridor-trimmed, clearance-carved `map_7.osm_buildings` with the user's own
per-face material assignment (brick / appartments / office / glass /
roof_tiles / concrete). This script:

  * rebuilds those 6 materials as clean, glTF-valid PBR materials
    (base + normal + emissive sampling the default UVMap). The source scene
    mapped textures through TEX_COORD:Object -> Mapping, which glTF cannot
    express and which projects top-down (smearing vertical walls); we keep the
    per-material tile size the author chose and project it correctly instead.
  * recomputes per-face UVs: walls = horizontal-run x height, roofs = planar XY.
  * builds textured road + railway ribbons from the prepped centerlines.
  * exports GLB with WEBP textures.

Run:
  blender -b --factory-startup -P scripts/blender_export_city_v2.py -- \
    <library.blend> <scratchpad_dir> <blosm_textures_dir> <out.glb>
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
LIB, SCRATCH, ASSETS, OUT = argv

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- helpers
def img(path):
    return bpy.data.images.load(path, check_existing=True)

def pbr_mat(name, base, nrm=None, emis=None, rough=0.85, metal=0.0):
    """glTF-friendly material: every texture samples the default UVMap."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'

    ti = nt.nodes.new('ShaderNodeTexImage')
    ti.image = img(base)
    nt.links.new(uv.outputs['UV'], ti.inputs['Vector'])
    nt.links.new(ti.outputs['Color'], b.inputs['Base Color'])

    if nrm:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img(nrm)
        tn.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(uv.outputs['UV'], tn.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])

    if emis:
        te = nt.nodes.new('ShaderNodeTexImage')
        te.image = img(emis)
        nt.links.new(uv.outputs['UV'], te.inputs['Vector'])
        nt.links.new(te.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 1.0
    return m

# ------------------------------------------------- building material table
# tile = metres per texture repeat, taken from the author's Mapping scales
# (0.1667 -> 6 m, 0.0667 -> 15 m, 0.1111 -> 9 m, 0.3333 -> 3 m, 0.25 -> 4 m,
#  0.1 -> 10 m). Alpha-cutout sheets (apartments 58%, office 35% transparent)
# use the pre-baked opaque composites from the scratchpad.
RES = f'{ASSETS}/Residential house facade with windowsdoors'
BUILDING_MATS = {
    'brick.1': dict(
        name='KochiBrick', tile=6.0, rough=0.9,
        base=f'{RES}/Residential house facade with windows.png',
        nrm=f'{RES}/Residential house facade with windows_nrm.png',
        emis=f'{RES}/Residential house facade with windows emmision.png',
    ),
    'appartments.1': dict(
        name='KochiApartments', tile=15.0, rough=0.85,
        base=f'{SCRATCH}/facade_apartments.png',
        nrm=f'{ASSETS}/facades/appartments/pro_6908_nrm.png',
        emis=f'{SCRATCH}/facade_apartments_emissive.png',
    ),
    'office.1': dict(
        name='KochiOffice', tile=9.0, rough=0.6,
        base=f'{SCRATCH}/facade_office.png',
        nrm=f'{ASSETS}/facades/office/pro_2157_nrm.png',
        emis=f'{SCRATCH}/facade_office_emissive.png',
    ),
    'glass.1': dict(
        name='KochiGlass', tile=10.0, rough=0.25, metal=0.3,
        base=f'{ASSETS}/facades/glass/pro_6841.jpg',
        nrm=None,
        emis=f'{ASSETS}/facades/glass/pro_6841_emission.png',
    ),
    'roof_tiles.1': dict(
        name='KochiRoofTiles', tile=3.0, rough=0.9,
        base=f'{ASSETS}/cladding/roof tiles/rubberduck_220.jpg',
        nrm=f'{ASSETS}/cladding/roof tiles/rubberduck_220_nrm.png',
        emis=None,
    ),
    # source concrete maps are 1-channel greyscale, which Blender's WEBP writer
    # rejects -> pre-converted to RGB in the scratchpad.
    'concrete.1': dict(
        name='KochiConcrete', tile=4.0, rough=0.95,
        base=f'{SCRATCH}/roof_concrete_rgb.png',
        nrm=f'{SCRATCH}/roof_concrete_rgb_nrm.png',
        emis=None,
    ),
}

# ------------------------------------------------ append buildings + water
with bpy.data.libraries.load(LIB, link=False) as (src, dst):
    dst.objects = [n for n in src.objects if 'buildings' in n or 'water' in n]
for ob in dst.objects:
    if ob is not None:
        bpy.context.scene.collection.objects.link(ob)
b_obj = next(o for o in bpy.context.scene.objects if 'buildings' in o.name)
me = b_obj.data
print('buildings appended:', len(me.polygons), 'faces,', len(b_obj.material_slots), 'slots')

# old slot index -> (new index, tile). Unused/None slots fall back to concrete.
old_names = [s.material.name if s.material else '' for s in b_obj.material_slots]
new_mats = []
tiles = []
name_to_new = {}
for key, spec in BUILDING_MATS.items():
    m = pbr_mat(spec['name'], spec['base'], spec.get('nrm'), spec.get('emis'),
                rough=spec.get('rough', 0.85), metal=spec.get('metal', 0.0))
    name_to_new[key] = len(new_mats)
    new_mats.append(m)
    tiles.append(spec['tile'])

FALLBACK = name_to_new['concrete.1']
remap = []
for nm in old_names:
    remap.append(name_to_new.get(nm, FALLBACK))

# IMPORTANT: materials.clear() resets every polygon's material_index to 0, so
# snapshot the author's per-face assignment BEFORE swapping the slots.
orig_idx = [p.material_index for p in me.polygons]
hist = {}
for i in orig_idx:
    hist[old_names[i] if i < len(old_names) else '?'] = hist.get(old_names[i] if i < len(old_names) else '?', 0) + 1
print('author face assignment:', hist)

me.materials.clear()
for m in new_mats:
    me.materials.append(m)

# Blosm bakes vertex colours that would multiply (and darken) the facades.
while me.color_attributes:
    me.color_attributes.remove(me.color_attributes[0])

# ------------------------------------------- rebuild UVs + material indices
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

for lay in list(bm.loops.layers.uv):
    bm.loops.layers.uv.remove(lay)
uvl = bm.loops.layers.uv.new('UVMap')

for f in bm.faces:
    o = orig_idx[f.index] if f.index < len(orig_idx) else 0
    idx = remap[o] if o < len(remap) else FALLBACK
    f.material_index = idx
    tile = tiles[idx]
    n = f.normal
    if abs(n.z) > 0.6:  # roof / floor -> planar XY
        for lo in f.loops:
            co = lo.vert.co
            lo[uvl].uv = (co.x / tile, co.y / tile)
    else:  # wall -> horizontal run x height
        t = Vector((n.y, -n.x, 0.0))
        if t.length < 1e-6:
            t = Vector((1.0, 0.0, 0.0))
        t.normalize()
        for lo in f.loops:
            co = lo.vert.co
            lo[uvl].uv = ((co.x * t.x + co.y * t.y) / tile, co.z / tile)

bmesh.ops.triangulate(bm, faces=bm.faces)  # required for tangent generation
bm.to_mesh(me)
me.update()
bm.free()
b_obj.name = 'Buildings'
me.name = 'Buildings'
print('buildings re-materialed:', [m.name for m in new_mats])

# ----------------------------------------------------------- road ribbons
roads = json.load(open(f'{SCRATCH}/roads-v2.json'))
ROAD_MATS = {
    'asphalt': pbr_mat(
        'KochiAsphalt',
        f'{ASSETS}/striped_asphalt_ufoidcskw_2k/Striped_Asphalt_ufoidcskw_2K_BaseColor.jpg',
        f'{ASSETS}/striped_asphalt_ufoidcskw_2k/Striped_Asphalt_ufoidcskw_2K_Normal.jpg',
        rough=0.95),
    'rail': pbr_mat(
        'KochiRailTrack',
        f'{ASSETS}/railway_tracks_ubppaiur_2k/Railway_Tracks_ubppaiur_2K_BaseColor.jpg',
        f'{ASSETS}/railway_tracks_ubppaiur_2k/Railway_Tracks_ubppaiur_2K_Normal.jpg',
        rough=0.9),
}
CLASS_MAT = {'trunk': 'asphalt', 'primary': 'asphalt', 'secondary': 'asphalt',
             'tertiary': 'asphalt', 'rail': 'rail'}
# metres of road length per texture repeat (keeps texels ~square)
CLASS_VTILE = {'trunk': 9.0, 'primary': 9.0, 'secondary': 8.0, 'tertiary': 7.0, 'rail': 12.0}

rbm = bmesh.new()
ruv = rbm.loops.layers.uv.new('UVMap')
mat_order = ['asphalt', 'rail']
Z = 0.0
built = 0
for r in roads:
    pts = [Vector((p[0], p[1], Z)) for p in r['p']]
    if len(pts) < 2:
        continue
    hw = r['w'] / 2.0
    vtile = CLASS_VTILE[r['c']]
    mi = mat_order.index(CLASS_MAT[r['c']])
    run = 0.0
    rows = []
    for i, p in enumerate(pts):
        if i == 0:
            d = (pts[1] - pts[0])
        elif i == len(pts) - 1:
            d = (pts[-1] - pts[-2])
        else:
            d = (pts[i + 1] - pts[i - 1])
            run += (pts[i] - pts[i - 1]).length
        if i == len(pts) - 1:
            run += (pts[-1] - pts[-2]).length
        d.z = 0
        if d.length == 0:
            d = Vector((1, 0, 0))
        d.normalize()
        left = Vector((-d.y, d.x, 0)) * hw
        va = rbm.verts.new(p + left)
        vb = rbm.verts.new(p - left)
        rows.append((va, vb, run))
    for i in range(len(rows) - 1):
        a0, b0, r0 = rows[i]
        a1, b1, r1 = rows[i + 1]
        try:
            f = rbm.faces.new((a0, b0, b1, a1))
        except ValueError:
            continue
        f.material_index = mi
        v0, v1 = r0 / vtile, r1 / vtile
        for lo in f.loops:
            if lo.vert is a0:
                lo[ruv].uv = (0.0, v0)
            elif lo.vert is b0:
                lo[ruv].uv = (1.0, v0)
            elif lo.vert is b1:
                lo[ruv].uv = (1.0, v1)
            else:
                lo[ruv].uv = (0.0, v1)
        built += 1

rme = bpy.data.meshes.new('Roads')
bmesh.ops.triangulate(rbm, faces=rbm.faces)
rbm.to_mesh(rme)
rbm.free()
for k in mat_order:
    rme.materials.append(ROAD_MATS[k])
r_obj = bpy.data.objects.new('Roads', rme)
bpy.context.scene.collection.objects.link(r_obj)
print('roads built:', built, 'quads from', len(roads), 'polylines')

# ------------------------------------------------------------------- water
# The author's kochi_water is a normal-mapped glossy surface (dark teal base,
# roughness 0.06, ripple normal tiled at 30 m) but drives the normal through
# TEX_COORD:Object and the mesh carries no UVs at all -> generate planar UVs.
w_obj = next((o for o in bpy.context.scene.objects if 'water' in o.name), None)
if w_obj:
    WATER_TILE = 30.0
    wmat = bpy.data.materials.new('KochiWater')
    wmat.use_nodes = True
    wnt = wmat.node_tree
    wb = wnt.nodes['Principled BSDF']
    wb.inputs['Base Color'].default_value = (0.015, 0.07, 0.1, 1.0)
    # author's 0.06 is a mirror: nudged up so the sun is a broken glare on the
    # ripples rather than one blown-out hotspot in a real-time renderer
    wb.inputs['Roughness'].default_value = 0.12
    wb.inputs['Metallic'].default_value = 0.0
    wuvn = wnt.nodes.new('ShaderNodeUVMap')
    wuvn.uv_map = 'UVMap'
    wtn = wnt.nodes.new('ShaderNodeTexImage')
    wtn.image = img(f'{ASSETS}/water 0342normal.jpg')
    wtn.image.colorspace_settings.name = 'Non-Color'
    wnt.links.new(wuvn.outputs['UV'], wtn.inputs['Vector'])
    wnmap = wnt.nodes.new('ShaderNodeNormalMap')
    wnmap.inputs['Strength'].default_value = 0.6
    wnt.links.new(wtn.outputs['Color'], wnmap.inputs['Color'])
    wnt.links.new(wnmap.outputs['Normal'], wb.inputs['Normal'])

    wme = w_obj.data
    wme.materials.clear()
    wme.materials.append(wmat)
    wbm = bmesh.new()
    wbm.from_mesh(wme)
    for lay in list(wbm.loops.layers.uv):
        wbm.loops.layers.uv.remove(lay)
    wuv = wbm.loops.layers.uv.new('UVMap')
    for f in wbm.faces:
        f.material_index = 0
        for lo in f.loops:
            co = lo.vert.co
            lo[wuv].uv = (co.x / WATER_TILE, co.y / WATER_TILE)
    bmesh.ops.triangulate(wbm, faces=wbm.faces)
    wbm.to_mesh(wme)
    wme.update()
    wbm.free()
    w_obj.name = 'Water'
    wme.name = 'Water'
    print('water:', len(wme.polygons), 'tris, planar UVs @', WATER_TILE, 'm')

for ob in bpy.context.scene.objects:
    if ob.type == 'MESH':
        ob.data.shade_flat()

# ------------------------------------------------------------------ export
kwargs = dict(
    filepath=OUT,
    export_format='GLB',
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_tangents=True,
    export_materials='EXPORT',
    export_cameras=False,
    export_lights=False,
    export_skins=False,
    export_animations=False,
)
try:
    bpy.ops.export_scene.gltf(**kwargs, export_image_format='WEBP', export_image_quality=85)
except TypeError:
    print('WEBP args unsupported, falling back to AUTO')
    bpy.ops.export_scene.gltf(**kwargs, export_image_format='AUTO')

print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB')
