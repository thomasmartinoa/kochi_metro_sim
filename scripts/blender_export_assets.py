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


"""How see-through the roof's glazed panels are (0 = solid, 1 = invisible)."""
ROOF_GLASS_TRANSPARENCY = 0.10


def bake_transmission_to_alpha():
    """Fold a transmission mask into the base-colour texture's alpha channel.

    The station roof is one material covering two surfaces: teal structural ribs
    and the glazed panels between them. The author separates them with a mask —
    Roof_Arch_Transmission_2K — feeding both a Mix on Base Color (white in the
    glass areas) and Transmission Weight.

    glTF has no equivalent, and the exporter dropped it, so the roof arrived
    flat and colourless. What glTF *can* express is per-texel alpha in the base
    colour texture, which is the same idea: rib texels opaque, panel texels
    slightly see-through. Composite that here, then wire Base Color and Alpha to
    the one combined image so the exporter emits a single BLEND material.

    The RGB buffer is copied verbatim between images that share a colour space,
    so no conversion happens to the baked colour — only alpha is written.
    """
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        trans = bsdf.inputs.get('Transmission Weight')
        if not trans or not trans.is_linked:
            continue
        mask_node = trans.links[0].from_node
        if mask_node.type != 'TEX_IMAGE' or not mask_node.image:
            continue
        # the material's own baked colour map, wherever it sits in the graph
        base_img = None
        stack, seen_n = [bsdf.inputs['Base Color']], set()
        while stack:
            s = stack.pop()
            for l in s.links:
                n = l.from_node
                if n in seen_n:
                    continue
                seen_n.add(n)
                if n.type == 'TEX_IMAGE' and n.image and 'basecolor' in n.image.name.lower():
                    base_img = n.image
                    stack = []
                    break
                stack.extend(n.inputs)
        if not base_img:
            continue
        mask_img = mask_node.image
        if tuple(base_img.size) != tuple(mask_img.size):
            print('  ! %s: base %s and mask %s differ in size; skipped'
                  % (m.name, tuple(base_img.size), tuple(mask_img.size)))
            continue

        w, h = base_img.size
        combined = bpy.data.images.new('%s_BaseColorA' % m.name, w, h, alpha=True)
        combined.colorspace_settings.name = base_img.colorspace_settings.name
        buf = [0.0] * (w * h * 4)
        base_img.pixels.foreach_get(buf)
        mbuf = [0.0] * (w * h * 4)
        mask_img.pixels.foreach_get(mbuf)
        for i in range(w * h):
            k = mbuf[i * 4]
            # Reproduce the author's Mix: the baked map carries the teal ribs,
            # and the glass panels are lifted to white. Without this the panels
            # keep whatever the bake left behind — near black — and the roof
            # reads as a dark slab instead of glazing between teal ribs.
            for ch in range(3):
                buf[i * 4 + ch] += (1.0 - buf[i * 4 + ch]) * k
            # mask 1 = glass -> alpha 1 - transparency; mask 0 = solid -> alpha 1
            buf[i * 4 + 3] = 1.0 - ROOF_GLASS_TRANSPARENCY * k
        combined.pixels.foreach_set(buf)
        combined.pack()

        nodes, links = m.node_tree.nodes, m.node_tree.links
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = combined
        tex.location = (bsdf.location.x - 400, bsdf.location.y)
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        for l in list(trans.links):
            links.remove(l)
        trans.default_value = 0.0
        m.blend_method = 'BLEND'
        print('  baked transmission -> alpha: %s (%s + %s)'
              % (m.name, base_img.name, mask_img.name))


def flatten_base_color():
    """Give every Principled BSDF a Base Color the glTF exporter can carry.

    The station roof drives Base Color through a Mix node — the baked colour
    map, whitened wherever a transmission mask marks a glass panel — and feeds
    the same mask into Transmission Weight. glTF has no equivalent of that node
    graph, so the exporter silently dropped the colour and the roof came out
    flat and wrong in the app while looking correct in Blender.

    Reconnect Base Color straight to the material's own *_BaseColor_* image.
    The glass panels of the roof read as glass from their roughness and from
    the app's own glazing rules, so nothing is lost by dropping the whitening.
    """
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        sock = bsdf.inputs.get('Base Color')
        if not sock or not sock.is_linked:
            continue
        src = sock.links[0].from_node
        if src.type == 'TEX_IMAGE':
            continue  # already a plain texture; nothing to do
        # walk the subtree for the base-colour image this material owns
        stack, seen_nodes, found = [src], set(), None
        while stack:
            n = stack.pop()
            if n in seen_nodes:
                continue
            seen_nodes.add(n)
            if n.type == 'TEX_IMAGE' and n.image and 'basecolor' in n.image.name.lower():
                found = n
                break
            for i in n.inputs:
                for l in i.links:
                    stack.append(l.from_node)
        if not found:
            print('  ! %s: Base Color is a %s with no BaseColor image behind it'
                  % (m.name, src.type))
            continue
        m.node_tree.links.new(found.outputs['Color'], sock)
        print('  rewired Base Color: %s -> %s' % (m.name, found.image.name))


print('folding transmission masks into base-colour alpha:')
bake_transmission_to_alpha()
print('flattening any remaining node-graph base colours for glTF:')
flatten_base_color()


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
# Split into the 3 cars so the app can pose each on the curve (a rigid 56 m body
# would cut Kochi's tighter corners).
#
# The collections OVERLAP: main_train already holds every Bogie_Wheel_* (the
# whole of 'metrunder parts') and every Cockpit_*/Driver_Seat_* (the whole of
# 'cockpit'). Concatenating them listed each wheel twice, so bake_transform ran
# on it twice — a double rotate + double translate that flung the wheels ~48 m
# sideways down to ground level, where they trailed the train across the map.
# Collect by identity, once.
cockpit_names = {o.name for o in mesh_objs('cockpit')}
train = []
seen = set()
for o in mesh_objs('main_train') + mesh_objs('metrunder parts'):
    if o.name in seen:
        continue
    seen.add(o.name)
    train.append(o)
print('train objects: %d (%d of them cab interior)' % (len(train), len(cockpit_names)))

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
    # Full detail keeps the cab interior: the windscreen is glazed at 50% and you
    # are meant to see a driving cab through it, not an empty shell.
    export(car, f'metro-car{i}')
    # The distant LOD drops it. It is ~3/4 of a driving car's materials, nothing
    # of it is legible past a couple of hundred metres, and this is the model
    # that gets drawn for most of the 26 pooled trains at once.
    ext = [o for o in car if o.name not in cockpit_names]
    if len(ext) != len(car):
        export(ext, f'metro-car{i}-ext')

# cockpit interior — exported for a future drive-mode cab view, not used yet
cock = mesh_objs('cockpit')
lo, hi = world_bbox(cock)
bake_transform(cock, ((lo.x + hi.x) / 2, TRAIN_Y, RAIL_TOP))
export(cock, 'metro-cockpit')

print('DONE')
