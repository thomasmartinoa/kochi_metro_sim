"""
Headless Blender pipeline: turns the Blosm-derived Kochi city library
(kochi_city_data.blend) into public/models/kochi-city.glb.

Self-sufficient: recomputes building islands, material classification and
metric UVs from geometry every run (immune to material-slot accidents in the
live session). Adds per-building variety: tinted facade variants, office
glass for tall buildings, terracotta roof tiles on small residences.

Run:
  blender -b --factory-startup -P scripts/blender_export_city.py -- \
    <library.blend> <baked_textures_dir> <blosm_textures_dir> <out.glb>
"""
import math
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
LIB, TEXDIR, ASSETS, OUT = argv

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- append objects from library ---
names = ['map.osm_buildings', 'kochi_roads', 'map.osm_water', 'map.osm_vegetation', 'map.osm_forest']
with bpy.data.libraries.load(LIB, link=False) as (src, dst):
    dst.objects = [n for n in src.objects if n in names]
for ob in dst.objects:
    if ob is not None:
        bpy.context.scene.collection.objects.link(ob)
print('appended:', [o.name for o in bpy.context.scene.objects])

# --- materials ---
def tex_mat(name, tex_path, emis_path=None, rough=0.85, tint=(1, 1, 1, 1)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    b.inputs['Base Color'].default_value = tint  # multiplies the texture in glTF
    ti = nt.nodes.new('ShaderNodeTexImage')
    ti.image = bpy.data.images.load(tex_path, check_existing=True)
    nt.links.new(ti.outputs['Color'], b.inputs['Base Color'])
    if emis_path:
        te = nt.nodes.new('ShaderNodeTexImage')
        te.image = bpy.data.images.load(emis_path, check_existing=True)
        nt.links.new(te.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 1.0
    return m

def flat_mat(name, color, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    return m

APT_TEX = f'{TEXDIR}/facade_apartments.png'
APT_EMI = f'{TEXDIR}/facade_apartments_emissive.png'
OFF_TEX = f'{TEXDIR}/facade_office.png'
OFF_EMI = f'{TEXDIR}/facade_office_emissive.png'
CONCRETE = f'{TEXDIR}/roof_concrete.png'
ROOFTILE = f'{TEXDIR}/roof_tiles.png'

# slot order (face material_index computed below must match):
#  0..3 apartment tints  4..5 office tints  6 concrete roof  7 dark roof  8 terracotta tiles
APT_TINTS = [(1, 1, 1, 1), (0.90, 0.88, 0.83, 1), (1.0, 0.93, 0.80, 1), (0.93, 0.85, 0.82, 1)]
mats = []
for i, t in enumerate(APT_TINTS):
    mats.append(tex_mat(f'KochiFacadeApt{i}', APT_TEX, APT_EMI, rough=0.85, tint=t))
mats.append(tex_mat('KochiFacadeOffice0', OFF_TEX, OFF_EMI, rough=0.6))
mats.append(tex_mat('KochiFacadeOffice1', OFF_TEX, OFF_EMI, rough=0.55, tint=(0.82, 0.90, 1.0, 1)))
mats.append(tex_mat('KochiRoofConcrete', CONCRETE, rough=0.95))
mats.append(tex_mat('KochiRoofDark', CONCRETE, rough=0.95, tint=(0.52, 0.52, 0.54, 1)))
mats.append(tex_mat('KochiRoofTiles', ROOFTILE, rough=0.9))

APT_U, APT_V = 10.4, 12.0
OFF_U, OFF_V = 15.6, 10.8
ROOF_S = 6.0
TILE_S = 2.4

b_obj = bpy.data.objects['map.osm_buildings']
me = b_obj.data
me.materials.clear()
for m in mats:
    me.materials.append(m)

bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

# --- islands (whole buildings) ---
n = len(bm.faces)
island_id = [-1] * n
island_maxz = []
for f in bm.faces:
    if island_id[f.index] != -1:
        continue
    iid = len(island_maxz)
    stack = [f]
    island_id[f.index] = iid
    mz = 0.0
    while stack:
        cur = stack.pop()
        for v in cur.verts:
            if v.co.z > mz:
                mz = v.co.z
            for lf in v.link_faces:
                if island_id[lf.index] == -1:
                    island_id[lf.index] = iid
                    stack.append(lf)
    island_maxz.append(mz)
print('islands:', len(island_maxz))

def wall_variant(iid):
    return iid * 2654435761 % 4  # knuth hash -> stable pseudo-random 0..3

def office_variant(iid):
    return 4 + (iid * 2654435761 % 2)

def roof_variant(iid, mz):
    h = (iid * 40503) % 100
    if mz > 16:
        return 6 if h < 70 else 7  # towers: concrete / dark
    if mz < 9 and h < 45:
        return 8  # small residence: terracotta tiles
    return 6 if h < 75 else 7

uvl = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
for f in bm.faces:
    iid = island_id[f.index]
    mz = island_maxz[iid]
    tall = mz > 16.0
    if abs(f.normal.z) > 0.6:
        f.material_index = roof_variant(iid, mz)
        s = TILE_S if f.material_index == 8 else ROOF_S
        for lo in f.loops:
            lo[uvl].uv = (lo.vert.co.x / s, lo.vert.co.y / s)
    else:
        f.material_index = office_variant(iid) if tall else wall_variant(iid)
        U, V = (OFF_U, OFF_V) if tall else (APT_U, APT_V)
        nrm = f.normal
        t = Vector((nrm.y, -nrm.x, 0.0))
        if t.length < 1e-6:
            t = Vector((1, 0, 0))
        t.normalize()
        for lo in f.loops:
            co = lo.vert.co
            lo[uvl].uv = ((co.x * t.x + co.y * t.y) / U, co.z / V)

bm.to_mesh(me)
me.update()
bm.free()

# --- roads / water / greens materials (indices already on the meshes) ---
road_main = flat_mat('KochiRoadMain', (0.055, 0.06, 0.068), 0.95)
road_minor = flat_mat('KochiRoadMinor', (0.10, 0.105, 0.115), 0.95)
rail = flat_mat('KochiRail', (0.13, 0.11, 0.10), 0.9)
water = flat_mat('KochiWater', (0.035, 0.16, 0.22), 0.32)
veg = flat_mat('KochiVeg', (0.115, 0.24, 0.10), 1.0)
ASSIGN = {
    'kochi_roads': [road_main, road_minor, rail],
    'map.osm_water': [water],
    'map.osm_vegetation': [veg],
    'map.osm_forest': [veg],
}
for nm, ms in ASSIGN.items():
    ob = bpy.data.objects.get(nm)
    if not ob:
        continue
    ob.data.materials.clear()
    for m in ms:
        ob.data.materials.append(m)

for ob in bpy.context.scene.objects:
    if ob.type == 'MESH':
        ob.data.shade_flat()

RENAME = {
    'map.osm_buildings': 'Buildings',
    'kochi_roads': 'Roads',
    'map.osm_water': 'Water',
    'map.osm_vegetation': 'Greens',
    'map.osm_forest': 'Forest',
}
for old, new in RENAME.items():
    ob = bpy.data.objects.get(old)
    if ob:
        ob.name = new
        ob.data.name = new

kwargs = dict(
    filepath=OUT,
    export_format='GLB',
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
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

import os
print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB')
