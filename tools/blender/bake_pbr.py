# Bakes seamless, tileable PBR texture sets (albedo / normal / ORM) with Cycles.
# Tiling trick: the plane's UV (u, v) is mapped onto a torus in 4D,
# (cos 2πu, sin 2πu, cos 2πv, sin 2πv), and fed to Blender's 4D noise/voronoi,
# so the pattern wraps perfectly on both axes.
import bpy, math, os

OUT = r"C:/Users/atma4/Desktop/__AI Tests/Opus 55/snowbro/assets/tex"
RES = 1024


def srgb_to_lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


class G:
    """Tiny node-graph helper."""

    def __init__(self, mat):
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.n = self.nt.nodes
        self.l = self.nt.links
        self.out = self.n.new('ShaderNodeOutputMaterial')
        self.bsdf = self.n.new('ShaderNodeBsdfPrincipled')
        self.l.new(self.bsdf.outputs[0], self.out.inputs[0])
        # torus coordinates
        uv = self.n.new('ShaderNodeTexCoord')
        sep = self.n.new('ShaderNodeSeparateXYZ')
        self.l.new(uv.outputs['UV'], sep.inputs[0])
        self.u, self.v = sep.outputs[0], sep.outputs[1]

    def math(self, op, a, b=None, v2=None):
        m = self.n.new('ShaderNodeMath')
        m.operation = op
        self._in(m.inputs[0], a)
        if b is not None:
            self._in(m.inputs[1], b)
        if v2 is not None:
            self._in(m.inputs[2], v2)
        return m.outputs[0]

    def _in(self, sock, val):
        if isinstance(val, (int, float)):
            sock.default_value = val
        else:
            self.l.new(val, sock)

    def torus(self, scale, stretch=(1.0, 1.0)):
        """Returns (vector, w) sockets for a tileable 4D lookup with `scale` repeats."""
        r = scale / (2 * math.pi)
        tu = self.math('MULTIPLY', self.u, 2 * math.pi)
        tv = self.math('MULTIPLY', self.v, 2 * math.pi)
        cu = self.math('MULTIPLY', self.math('COSINE', tu), r * stretch[0])
        su = self.math('MULTIPLY', self.math('SINE', tu), r * stretch[0])
        cv = self.math('MULTIPLY', self.math('COSINE', tv), r * stretch[1])
        sv = self.math('MULTIPLY', self.math('SINE', tv), r * stretch[1])
        comb = self.n.new('ShaderNodeCombineXYZ')
        self.l.new(cu, comb.inputs[0]); self.l.new(su, comb.inputs[1]); self.l.new(cv, comb.inputs[2])
        return comb.outputs[0], sv

    def noise(self, scale, detail=6, rough=0.55, stretch=(1, 1), distortion=0.0, offset=0.0):
        vec, w = self.torus(scale, stretch)
        t = self.n.new('ShaderNodeTexNoise')
        t.noise_dimensions = '4D'
        t.inputs['Scale'].default_value = 1.0
        t.inputs['Detail'].default_value = detail
        t.inputs['Roughness'].default_value = rough
        t.inputs['Distortion'].default_value = distortion
        self.l.new(vec, t.inputs['Vector'])
        self.l.new(self.math('ADD', w, offset), t.inputs['W'])
        return t.outputs['Fac']

    def voronoi(self, scale, feature='F1', dist='EUCLIDEAN', out='Distance', randomness=1.0, stretch=(1, 1), offset=0.0):
        vec, w = self.torus(scale, stretch)
        t = self.n.new('ShaderNodeTexVoronoi')
        t.voronoi_dimensions = '4D'
        t.feature = feature
        t.distance = dist
        t.inputs['Scale'].default_value = 1.0
        t.inputs['Randomness'].default_value = randomness
        self.l.new(vec, t.inputs['Vector'])
        self.l.new(self.math('ADD', w, offset), t.inputs['W'])
        return t.outputs[out]

    def ramp(self, fac, stops):
        r = self.n.new('ShaderNodeValToRGB')
        cr = r.color_ramp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = stops[0][1] if len(stops[0][1]) == 4 else srgb_to_lin(stops[0][1])
        for pos, col in stops[1:]:
            e = cr.elements.new(pos)
            e.color = col if isinstance(col, list) else srgb_to_lin(col)
        self._in(r.inputs[0], fac)
        return r.outputs[0]

    def mix(self, a, b, fac, blend='MIX'):
        m = self.n.new('ShaderNodeMix')
        m.data_type = 'RGBA'
        m.blend_type = blend
        self._in(m.inputs[0], fac)
        self.l.new(a, m.inputs[6]) if not isinstance(a, list) else setattr(m.inputs[6], 'default_value', a)
        self.l.new(b, m.inputs[7]) if not isinstance(b, list) else setattr(m.inputs[7], 'default_value', b)
        return m.outputs[2]

    def bump(self, height, strength=1.0, distance=0.02):
        b = self.n.new('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = distance
        self._in(b.inputs['Height'], height)
        self.l.new(b.outputs[0], self.bsdf.inputs['Normal'])

    def finish(self, albedo, rough, ao):
        self._in(self.bsdf.inputs['Base Color'], albedo)
        self._in(self.bsdf.inputs['Roughness'], rough)
        self.ao = ao


# ----------------------------------------------------------------- recipes
def rock(g):
    # cut sandstone for the faceted blocks: the geometry draws the stones now,
    # so the surface is just mottling, grain and a few pits (no drawn cells)
    macro = g.noise(3, detail=4, rough=0.5)
    mid = g.noise(9, detail=5, rough=0.55, offset=5)
    grain = g.noise(48, detail=8, rough=0.7, offset=3)
    pits = g.math('GREATER_THAN', g.noise(30, detail=2, rough=0.4, offset=7), 0.67)
    h = g.math('ADD', g.math('MULTIPLY', macro, 0.45), g.math('MULTIPLY', mid, 0.3))
    h = g.math('ADD', h, g.math('MULTIPLY', grain, 0.25))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', pits, 0.1))
    col = g.ramp(macro, [(0.25, '#a88a66'), (0.5, '#c2a47e'), (0.75, '#d6bd96')])
    col = g.mix(col, g.ramp(mid, [(0.3, '#9a7f60'), (0.7, '#dcc6a0')]), 0.3, 'OVERLAY')
    col = g.mix(col, g.ramp(grain, [(0.3, '#7a6650'), (0.7, '#e0cfae')]), 0.3, 'OVERLAY')
    col = g.mix(col, srgb_to_lin('#5a4a3a'), g.math('MULTIPLY', pits, 0.45))
    lichen = g.math('GREATER_THAN', g.noise(7, detail=3, rough=0.5, offset=11), 0.7)
    col = g.mix(col, srgb_to_lin('#a8a070'), g.math('MULTIPLY', lichen, 0.35))
    g.bump(h, 0.8, 0.04)
    g.finish(col, g.math('ADD', 0.8, g.math('MULTIPLY', grain, 0.15)),
             g.math('SUBTRACT', g.math('ADD', 0.82, g.math('MULTIPLY', mid, 0.18)), g.math('MULTIPLY', pits, 0.35)))


def grass(g):
    blades = g.noise(90, detail=3, rough=0.5, stretch=(1.0, 0.25))
    clump = g.noise(10, detail=5, rough=0.55, offset=2)
    dry = g.math('GREATER_THAN', g.noise(4, detail=3, offset=5), 0.58)
    h = g.math('ADD', g.math('MULTIPLY', blades, 0.6), g.math('MULTIPLY', clump, 0.4))
    col = g.ramp(h, [(0.2, '#2f6a18'), (0.5, '#5aa22c'), (0.8, '#8ccc46')])
    col = g.mix(col, srgb_to_lin('#b7b25a'), g.math('MULTIPLY', dry, 0.45))
    g.bump(h, 0.9, 0.03)
    g.finish(col, g.math('ADD', 0.62, g.math('MULTIPLY', blades, 0.25)), g.math('ADD', 0.55, g.math('MULTIPLY', h, 0.45)))


def dirt(g):
    base = g.noise(8, detail=6, rough=0.6)
    peb = g.voronoi(22, out='Distance', offset=4)
    pebble = g.math('SUBTRACT', 1.0, g.math('MINIMUM', g.math('MULTIPLY', peb, 2.6), 1.0))
    h = g.math('ADD', g.math('MULTIPLY', base, 0.5), g.math('MULTIPLY', pebble, 0.55))
    col = g.ramp(base, [(0.3, '#3a2a1c'), (0.7, '#6b5038')])
    col = g.mix(col, g.ramp(pebble, [(0.0, '#5a4a3a'), (1.0, '#a09080')]), g.math('MULTIPLY', pebble, 0.8))
    g.bump(h, 1.0, 0.05)
    g.finish(col, g.math('SUBTRACT', 0.95, g.math('MULTIPLY', pebble, 0.25)), g.math('ADD', 0.5, g.math('MULTIPLY', h, 0.5)))


def wood(g):
    grain = g.noise(3, detail=8, rough=0.6, stretch=(1.0, 14.0), distortion=0.4)
    rings = g.math('SINE', g.math('MULTIPLY', g.noise(2, detail=2, stretch=(1.0, 6.0), offset=3), 60.0))
    rings = g.math('MULTIPLY', g.math('ADD', rings, 1.0), 0.5)
    h = g.math('ADD', g.math('MULTIPLY', grain, 0.7), g.math('MULTIPLY', rings, 0.3))
    col = g.ramp(h, [(0.25, '#5a3418'), (0.55, '#8e5a30'), (0.8, '#b98050')])
    knots = g.math('GREATER_THAN', g.noise(5, detail=2, offset=9), 0.7)
    col = g.mix(col, srgb_to_lin('#3a200e'), g.math('MULTIPLY', knots, 0.6))
    g.bump(h, 0.6, 0.02)
    g.finish(col, g.math('ADD', 0.55, g.math('MULTIPLY', grain, 0.3)), g.math('ADD', 0.7, g.math('MULTIPLY', h, 0.3)))


def bark(g):
    ridges = g.voronoi(10, feature='DISTANCE_TO_EDGE', stretch=(1.0, 0.12), out='Distance')
    furrow = g.math('MINIMUM', g.math('MULTIPLY', ridges, 6.0), 1.0)
    fine = g.noise(30, detail=8, rough=0.7, stretch=(1.0, 0.3))
    h = g.math('ADD', g.math('MULTIPLY', furrow, 0.7), g.math('MULTIPLY', fine, 0.3))
    col = g.ramp(h, [(0.1, '#241408'), (0.5, '#5e3e24'), (0.9, '#8a6a4a')])
    moss = g.math('GREATER_THAN', g.noise(5, detail=4, offset=4), 0.6)
    col = g.mix(col, srgb_to_lin('#3f6a20'), g.math('MULTIPLY', moss, 0.55))
    g.bump(h, 1.0, 0.06)
    g.finish(col, 0.85, g.math('ADD', 0.35, g.math('MULTIPLY', furrow, 0.65)))


def cliff(g):
    # sedimentary layers: noise-warped horizontal bands of varying hardness
    warp = g.noise(3, detail=4, rough=0.5, offset=1)
    strata = g.noise(2, detail=5, rough=0.55, stretch=(0.08, 4.0), distortion=0.6)
    layers = g.math('MULTIPLY', g.math('ADD', g.math('SINE', g.math('ADD', g.math('MULTIPLY', strata, 55.0), g.math('MULTIPLY', warp, 6.0))), 1.0), 0.5)
    ledges = g.math('POWER', layers, 3.0)
    # sparse, thin vertical fractures
    cells = g.voronoi(2.5, feature='DISTANCE_TO_EDGE', stretch=(0.7, 1.8), out='Distance', offset=2)
    crack = g.math('SUBTRACT', 1.0, g.math('MINIMUM', g.math('MULTIPLY', cells, 26.0), 1.0))
    crack = g.math('MULTIPLY', crack, g.math('GREATER_THAN', g.noise(4, detail=2, offset=8), 0.45))
    fine = g.noise(35, detail=8, rough=0.7, offset=6)
    stain = g.noise(5, detail=4, rough=0.5, stretch=(0.5, 2.0), offset=12)
    h = g.math('ADD', g.math('MULTIPLY', ledges, 0.5), g.math('MULTIPLY', fine, 0.3))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', crack, 0.3))
    col = g.ramp(layers, [(0.0, '#6e5642'), (0.35, '#a08262'), (0.7, '#c4a988'), (1.0, '#d8c4a4')])
    col = g.mix(col, g.ramp(fine, [(0.3, '#5a4838'), (0.7, '#d0bea0')]), 0.25, 'OVERLAY')
    col = g.mix(col, srgb_to_lin('#5a5048'), g.math('MULTIPLY', g.math('GREATER_THAN', stain, 0.6), 0.35))
    col = g.mix(col, [0.06, 0.045, 0.03, 1], g.math('MULTIPLY', crack, 0.45))
    g.bump(h, 1.0, 0.08)
    g.finish(col, g.math('ADD', 0.78, g.math('MULTIPLY', fine, 0.15)), g.math('SUBTRACT', 1.0, g.math('ADD', g.math('MULTIPLY', crack, 0.5), g.math('MULTIPLY', g.math('SUBTRACT', 1.0, layers), 0.25))))


RECIPES = {'rock': rock, 'grass': grass, 'dirt': dirt, 'wood': wood, 'bark': bark, 'cliff': cliff}


def bake_all(names=None):
    os.makedirs(OUT, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 4
    scene.cycles.device = 'GPU' if bpy.context.preferences.addons.get('cycles') else 'CPU'
    scene.render.bake.margin = 0
    scene.view_settings.view_transform = 'Standard'
    # bake target plane
    for o in [o for o in bpy.data.objects if o.name.startswith('BakePlane')]:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, -50))
    plane = bpy.context.active_object
    plane.name = 'BakePlane'
    done = []
    for name, fn in RECIPES.items():
        if names and name not in names:
            continue
        mat = bpy.data.materials.get('Bake_' + name) or bpy.data.materials.new('Bake_' + name)
        try:
            mat.use_nodes = True
        except Exception:
            pass
        g = G(mat)
        fn(g)
        plane.data.materials.clear()
        plane.data.materials.append(mat)
        tex = g.n.new('ShaderNodeTexImage')
        for suffix, btype, cs in (('albedo', 'DIFFUSE', 'sRGB'), ('normal', 'NORMAL', 'Non-Color'), ('rough', 'ROUGHNESS', 'Non-Color'), ('ao', 'EMIT', 'Non-Color')):
            img = bpy.data.images.new(f'{name}_{suffix}', RES, RES, alpha=False, float_buffer=False)
            img.colorspace_settings.name = cs
            tex.image = img
            g.nt.nodes.active = tex
            for n in g.n:
                n.select = False
            tex.select = True
            if btype == 'EMIT':
                # bake AO factor through an emission shader
                em = g.n.new('ShaderNodeEmission')
                g._in(em.inputs[0], g.ao)
                lnk = g.l.new(em.outputs[0], g.out.inputs[0])
                bpy.ops.object.bake(type='EMIT')
                g.l.new(g.bsdf.outputs[0], g.out.inputs[0])
            elif btype == 'DIFFUSE':
                scene.render.bake.use_pass_direct = False
                scene.render.bake.use_pass_indirect = False
                scene.render.bake.use_pass_color = True
                bpy.ops.object.bake(type='DIFFUSE')
            else:
                bpy.ops.object.bake(type=btype)
            img.filepath_raw = os.path.join(OUT, f'{name}_{suffix}.png')
            img.file_format = 'PNG'
            img.save()
            done.append(f'{name}_{suffix}')
    return done
