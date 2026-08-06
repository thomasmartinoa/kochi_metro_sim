"""
Headless export of the authored metro assets (station / viaduct span / train)
from a Blender library into app-ready GLBs.

The models are authored in real-world metres with:
  * ground at z = 0, rail running surface at z = RAIL_TOP
  * track running along +X, nose of the train toward +X
  * deck centreline at y = DECK_Y, the modelled train on the track at y = TRAIN_Y

The app wants each asset with its length along +Z (three.js Object3D.lookAt
points +Z at the target), width along X, height along Y, and its origin on the
alignment curve — i.e. on the track centreline at rail level. So every asset is
baked with:
    rotate -90 deg about Z   (+X -> -Y, which glTF's Z-up->Y-up makes +Z)
    translate so the pivot below lands at the origin

Run:
  blender -b --factory-startup -P scripts/blender_export_assets.py -- <library.blend> <out_dir>
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
LIB, OUT_DIR = argv[0], argv[1]

# ---- measured from the authored sample scene (see docs/ART-GUIDE.md) --------
RAIL_TOP = 14.833   # rail running surface above ground
DECK_Y = -37.57     # viaduct/station deck centreline
TRAIN_Y = -40.32    # centreline of the track the sample train sits on
SPAN_PITCH = 30.71  # viaduct span repeat length
SPAN_ORIGIN_X = 32.97   # location.x of the sample Bridge_Baked
# train car boundaries (midway between adjacent bogie pairs)
CAR_SPLIT_X = (-8.44, 9.715)

bpy.ops.wm.read_factory_settings(use_empty=True)

with bpy.data.libraries.load(LIB, link=False) as (src, dst):
    dst.collections = list(src.collections)
loaded = {c.name: c for c in dst.collections if c}
for c in loaded.values():
    bpy.context.scene.collection.children.link(c)
# matrix_world is only valid once the view layer has been evaluated — without
# this the first bbox read comes back in local space (identity matrices).
bpy.context.view_layer.update()
print('loaded collections:', sorted(loaded))

gn = [o.name for c in loaded.values() for o in c.all_objects if any(m.type == 'NODES' for m in o.modifiers)]
print(f'objects with geometry nodes (baked by export_apply): {len(gn)}')

# A couple of the baked maps are 32-bit float, which Blender writes as 16-bit
# PNG — sharp/libvips inside `gltf-transform optimize` rejects those
# ("colourspace: parameter space not set"). Re-save them as 8-bit in place so
# every material keeps pointing at the same datablock.
_iset = bpy.context.scene.render.image_settings
_iset.file_format, _iset.color_mode, _iset.color_depth = 'PNG', 'RGBA', '8'
for _img in list(bpy.data.images):
    if _img.is_float and _img.has_data:
        _tmp = os.path.join(OUT_DIR, '_8bit_%d.png' % abs(hash(_img.name)))
        _img.save_render(_tmp)
        _img.filepath = _tmp
        _img.source = 'FILE'
        _img.reload()
        print('converted float texture ->', _img.name)


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def bake_transform(objs, pivot):
    """Move `objs` so `pivot` sits at the origin with length along glTF +Z."""
    m = Matrix.Rotation(math.radians(-90), 4, 'Z') @ Matrix.Translation(-Vector(pivot))
    for o in objs:
        o.matrix_world = m @ o.matrix_world


def export(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT_DIR, name + '.glb')
    kwargs = dict(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,      # bakes the geometry-nodes modifiers
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    # Keep textures as PNG here: Blender's WEBP output trips up the sharp/vips
    # decoder in `gltf-transform optimize`, which does the real compression.
    bpy.ops.export_scene.gltf(**kwargs, export_image_format='AUTO')
    print(f'EXPORTED {name}.glb  {os.path.getsize(path)//1024} KB  ({len(objs)} objs)')


def mesh_objs(col_name):
    return [o for o in loaded[col_name].all_objects if o.type == 'MESH']


# ------------------------------------------------------------ viaduct span
# One repeating span. Origin at the centre of the repeat interval so copies can
# be dropped every SPAN_PITCH along the alignment.
span = [o for o in mesh_objs('bridge')
        if o.name in ('Bridge_Baked', 'rails_Baked.003')]
lo, hi = world_bbox(span)
print(f'span raw  X[{lo.x:.2f},{hi.x:.2f}] Y[{lo.y:.2f},{hi.y:.2f}] Z[{lo.z:.2f},{hi.z:.2f}]')
bake_transform(span, (SPAN_ORIGIN_X + SPAN_PITCH / 2, DECK_Y, RAIL_TOP))
lo, hi = world_bbox(span)
print(f'span baked X[{lo.x:.2f},{hi.x:.2f}] Y[{lo.y:.2f},{hi.y:.2f}] Z[{lo.z:.2f},{hi.z:.2f}]')
export(span, 'metro-span')

# ---------------------------------------------------------------- station
stn = mesh_objs('ViaDuct')
lo, hi = world_bbox(stn)
cx = (lo.x + hi.x) / 2
bake_transform(stn, (cx, DECK_Y, RAIL_TOP))
lo, hi = world_bbox(stn)
print(f'station baked X[{lo.x:.2f},{hi.x:.2f}] Y[{lo.y:.2f},{hi.y:.2f}] Z[{lo.z:.2f},{hi.z:.2f}]')
export(stn, 'metro-station')

# ------------------------------------------------------------------ train
# main_train + wheels, split into the 3 cars so the app can pose each car on
# the curve (a rigid 56 m body would cut Kochi's tighter corners).
train = mesh_objs('main_train') + mesh_objs('metrunder parts')
cars = [[], [], []]
for o in train:
    lo, hi = world_bbox([o])
    x = (lo.x + hi.x) / 2
    cars[0 if x < CAR_SPLIT_X[0] else 1 if x < CAR_SPLIT_X[1] else 2].append(o)
print('car object counts:', [len(c) for c in cars])

for i, car in enumerate(cars):
    lo, hi = world_bbox(car)
    print(f'car{i} raw X[{lo.x:.2f},{hi.x:.2f}] len={hi.x-lo.x:.2f}')
    bake_transform(car, ((lo.x + hi.x) / 2, TRAIN_Y, RAIL_TOP))
    export(car, f'metro-car{i}')

# cockpit interior — exported for a future drive-mode cab view, not used yet
cock = mesh_objs('cockpit')
lo, hi = world_bbox(cock)
bake_transform(cock, ((lo.x + hi.x) / 2, TRAIN_Y, RAIL_TOP))
export(cock, 'metro-cockpit')

print('DONE')
