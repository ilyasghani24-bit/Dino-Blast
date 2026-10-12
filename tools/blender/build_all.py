# Rebuilds every game model from lib/characters/environment.py and exports
# assets/models.glb (+ saves tools/blender/assets.blend). Headless only:
#   blender -b --factory-startup -P tools/blender/build_all.py [-- --preview out.png]
# Never run this inside an interactive Blender session: it starts from an
# empty factory scene on purpose.
import os
import sys
import bpy
from mathutils import Vector, Euler

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

bpy.ops.wm.read_factory_settings(use_empty=True)
g = {'__name__': 'assets'}
for f in ('lib.py', 'characters.py', 'environment.py'):
    exec(open(os.path.join(BASE, f), encoding='utf-8').read(), g)
g['build_characters']()
g['build_environment']()

roots = [o for o in bpy.data.objects if o.parent is None]
saved = {o.name: o.location.copy() for o in roots}
for o in roots:
    o.location = (0, 0, 0)
for o in bpy.data.objects:
    o.select_set(True)
out = os.path.join(ROOT, 'assets', 'models.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=False, export_cameras=False, export_lights=False)
for o in roots:
    o.location = saved[o.name]
print('BUILD wrote', out, os.path.getsize(out))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BASE, 'assets.blend'))

if '--preview' in argv:
    # contact sheet of the environment kit, rendered with Workbench (flat colours)
    path = argv[argv.index('--preview') + 1]
    kit = ['BlockA', 'BlockB', 'BlockC', 'BlockD', 'BlockE', 'BlockV', 'BlockV2', 'BlockCap',
           'BlockCap2', 'Boulder1', 'Boulder2', 'Boulder3', 'Bush', 'Pillar', 'Pillar2', 'Wall']
    if '--kit' in argv:
        kit = argv[argv.index('--kit') + 1].split(',')
    for o in roots:
        o.hide_render = o.name not in kit
        for c in o.children_recursive:
            c.hide_render = o.hide_render
    for i, n in enumerate(kit):
        o = bpy.data.objects[n]
        o.location = ((i % 8) * 1.6, 0, 0 if i < 8 else 2.6)
        o.rotation_euler = (0, 0, -0.25)
    vol = bpy.data.objects['Volcano']
    vol.location = (11, 300, 1)
    cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (5.6, -9.5, 2.6)
    cam.rotation_euler = Euler((1.5, 0, 0))
    cam.data.lens = 30
    sc = bpy.context.scene
    sc.camera = cam
    sc.world = bpy.data.worlds.new('PreviewWorld')
    sc.world.color = (0.5, 0.6, 0.7)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_cavity = True
    sc.display.shading.show_shadows = True
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('PREVIEW wrote', path)
