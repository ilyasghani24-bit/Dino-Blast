# Headless texture bake:  blender -b --factory-startup -P tools/blender/bake_run.py -- rock [grass ...]
# then pack PNG -> JPG albedo/normal/ORM.
import os
import sys
import bpy

BASE = os.path.dirname(os.path.abspath(__file__))
names = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else None
g = {'__name__': 'bake'}
exec(open(os.path.join(BASE, 'bake_pbr.py'), encoding='utf-8').read(), g)
print('BAKED', g['bake_all'](names))
