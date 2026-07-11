"""
Headless Blender pipeline: turns the Blosm-derived Kochi city library
(kochi_city_data.blend, written from the live session) into public/models/kochi-city.glb.

Run:
  blender -b --factory-startup -P scripts/blender_export_city.py -- \
    <library.blend> <textures_dir> <assets_concrete_path> <out.glb>

Meshes carry material_index already:
  map.osm_buildings: 0 apartment walls, 1 office walls (tall), 2 roofs
  kochi_roads:       0 main asphalt,   1 minor asphalt,     2 railway
"""
import sys
import bpy
import bmesh

argv = sys.argv[sys.argv.index('--') + 1:]
LIB, TEXDIR, CONCRETE, OUT = argv

# --- fresh scene ---
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
def tex_mat(name, tex_path, emis_path=None, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    ti = nt.nodes.new('ShaderNodeTexImage')
    ti.image = bpy.data.images.load(tex_path)
    nt.links.new(ti.outputs['Color'], b.inputs['Base Color'])
    if emis_path:
        te = nt.nodes.new('ShaderNodeTexImage')
        te.image = bpy.data.images.load(emis_path)
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

apt = tex_mat('KochiFacadeApartments', f'{TEXDIR}/facade_apartments.png', f'{TEXDIR}/facade_apartments_emissive.png')
off = tex_mat('KochiFacadeOffice', f'{TEXDIR}/facade_office.png', f'{TEXDIR}/facade_office_emissive.png', rough=0.6)
roof = tex_mat('KochiRoofConcrete', CONCRETE, rough=0.95)
road_main = flat_mat('KochiRoadMain', (0.055, 0.06, 0.068), 0.95)
road_minor = flat_mat('KochiRoadMinor', (0.10, 0.105, 0.115), 0.95)
rail = flat_mat('KochiRail', (0.13, 0.11, 0.10), 0.9)
water = flat_mat('KochiWater', (0.035, 0.16, 0.22), 0.1)
veg = flat_mat('KochiVeg', (0.115, 0.24, 0.10), 1.0)

ASSIGN = {
    'map.osm_buildings': [apt, off, roof],
    'kochi_roads': [road_main, road_minor, rail],
    'map.osm_water': [water],
    'map.osm_vegetation': [veg],
    'map.osm_forest': [veg],
}
for nm, mats in ASSIGN.items():
    ob = bpy.data.objects.get(nm)
    if not ob:
        print('MISSING', nm)
        continue
    ob.data.materials.clear()
    for m in mats:
        ob.data.materials.append(m)

# --- normals sanity on buildings (outward) + flat shading ---
b_obj = bpy.data.objects['map.osm_buildings']
bm = bmesh.new()
bm.from_mesh(b_obj.data)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(b_obj.data)
bm.free()
for ob in bpy.context.scene.objects:
    if ob.type == 'MESH':
        ob.data.shade_flat()

# --- rename for clean glTF node names ---
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

# --- export ---
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
    bpy.ops.export_scene.gltf(**kwargs, export_image_format='WEBP', export_image_quality=80)
except TypeError:
    print('WEBP args unsupported, falling back to AUTO')
    bpy.ops.export_scene.gltf(**kwargs, export_image_format='AUTO')

import os
print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB')
