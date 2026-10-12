# Shared helpers for building Dino Egg Bros assets procedurally in Blender.
# Everything is constructed through bmesh so it runs safely from the MCP bridge
# (no context-dependent join / modifier-apply operators).
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler, Quaternion, noise

D2R = math.pi / 180.0


def srgb(h):
    h = h.lstrip('#')
    r, g, b = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for d in list(coll):
            coll.remove(d)


def mat(name, hexcol, rough=0.5, metal=0.0, emit=None, es=0.0, coat=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(b.outputs[0], out.inputs[0])
    c = srgb(hexcol)
    b.inputs['Base Color'].default_value = (*c, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*srgb(emit), 1)
        b.inputs['Emission Strength'].default_value = es
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            m.blend_method = 'BLEND'
    m.diffuse_color = (*c, alpha)
    return m


def _scale_vec(s):
    if isinstance(s, (int, float)):
        return (s, s, s)
    return tuple(s)


def trs(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    s = _scale_vec(scale)
    return (Matrix.Translation(Vector(loc)) @
            Euler([a * D2R for a in rot]).to_matrix().to_4x4() @
            Matrix.Diagonal((*s, 1.0)))


WORLD_PIVOT = {}


class Piece:
    """Accumulates primitives (with materials) into one mesh object."""

    # Each primitive is built in its own scratch bmesh (self.bm) and merged into
    # the accumulator (self.acc) on _finish. Tracking "new" verts inside a shared
    # bmesh proved unreliable once verts were created with bm.verts.new().

    def __init__(self, name):
        self.name = name
        self.acc = bmesh.new()
        self.bm = None
        self.mats = []
        self._scratch = bpy.data.meshes.new('_piece_scratch')

    # ---- internals -------------------------------------------------------
    def _begin(self):
        self.bm = bmesh.new()

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _new_verts(self, before):
        return [v for v in self.bm.verts if v not in before]

    def _finish(self, verts, m, smooth, recalc=False, post=None):
        mi = self._mi(m)
        faces = list(self.bm.faces)
        for f in faces:
            f.material_index = mi
            f.smooth = smooth
        if recalc and faces:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        if post:
            post(self.bm)
        self.bm.to_mesh(self._scratch)
        self.acc.from_mesh(self._scratch)
        self.bm.free()
        self.bm = None
        return None

    # ---- primitives ------------------------------------------------------
    def sphere(self, loc, scale, m, rot=(0, 0, 0), seg=24, rings=14, smooth=True, deform=None, post=None):
        self._begin()
        before = set()
        bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0)
        verts = self._new_verts(before)
        if deform:
            for v in verts:
                v.co = deform(v.co.copy())
        bmesh.ops.transform(self.bm, matrix=trs(loc, rot, scale), verts=verts)
        return self._finish(verts, m, smooth, post=post)

    def ico(self, loc, scale, m, rot=(0, 0, 0), subdiv=2, smooth=False, deform=None):
        self._begin()
        before = set()
        bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0)
        verts = self._new_verts(before)
        if deform:
            for v in verts:
                v.co = deform(v.co.copy())
        bmesh.ops.transform(self.bm, matrix=trs(loc, rot, scale), verts=verts)
        return self._finish(verts, m, smooth)

    def cone(self, loc, r1, r2, depth, m, rot=(0, 0, 0), seg=16, smooth=True):
        self._begin()
        before = set()
        bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=True, segments=seg,
                              radius1=r1, radius2=r2, depth=depth)
        verts = self._new_verts(before)
        bmesh.ops.transform(self.bm, matrix=trs(loc, rot, 1.0), verts=verts)
        return self._finish(verts, m, smooth)

    def cone_between(self, p1, p2, r1, r2, m, seg=16, smooth=True):
        p1, p2 = Vector(p1), Vector(p2)
        d = p2 - p1
        self._begin()
        before = set()
        bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=True, segments=seg,
                              radius1=r1, radius2=r2, depth=d.length)
        verts = self._new_verts(before)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        M = Matrix.Translation((p1 + p2) * 0.5) @ q.to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=M, verts=verts)
        return self._finish(verts, m, smooth)

    def box(self, loc, size, m, rot=(0, 0, 0), bevel=0.05, segs=3, smooth=True, deform=None):
        self._begin()
        before = set()
        bmesh.ops.create_cube(self.bm, size=1.0)
        verts = self._new_verts(before)
        bmesh.ops.scale(self.bm, vec=Vector(size), verts=verts)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=verts + edges, offset=bevel, segments=segs,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
            verts = self._new_verts(before)
        if deform:
            for v in verts:
                v.co = deform(v.co.copy())
        bmesh.ops.transform(self.bm, matrix=trs(loc, rot, 1.0), verts=verts)
        return self._finish(verts, m, smooth)

    def tube(self, pts, radii, m, seg=12, smooth=True, closed=False, cap=True):
        pts = [Vector(p) for p in pts]
        n = len(pts)
        if isinstance(radii, (int, float)):
            radii = [radii] * n
        rings, prev = [], None
        self._begin()
        before = set()
        for i, p in enumerate(pts):
            if closed:
                t = (pts[(i + 1) % n] - pts[(i - 1) % n]).normalized()
            else:
                t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            if prev is None:
                ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
                nrm = t.cross(ref).normalized()
            else:
                nrm = (prev - t * prev.dot(t)).normalized()
            prev = nrm
            bn = t.cross(nrm)
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg
                ring.append(self.bm.verts.new(p + (nrm * math.cos(a) + bn * math.sin(a)) * radii[i]))
            rings.append(ring)
        segs = n if closed else n - 1
        for i in range(segs):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for k in range(seg):
                self.bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
        if cap and not closed:
            self.bm.faces.new(list(reversed(rings[0])))
            self.bm.faces.new(rings[-1])
        return self._finish(self._new_verts(before), m, smooth)

    def ring(self, center, radius, thickness, m, axis='Z', seg=32, tseg=10):
        c = Vector(center)
        pts = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            if axis == 'Z':
                off = Vector((math.cos(a), math.sin(a), 0))
            elif axis == 'Y':
                off = Vector((math.cos(a), 0, math.sin(a)))
            else:
                off = Vector((0, math.cos(a), math.sin(a)))
            pts.append(c + off * radius)
        return self.tube(pts, thickness, m, seg=tseg, closed=True)

    def star(self, loc, r_out, r_in, depth, m, rot=(0, 0, 0), points=5, smooth=False):
        """Extruded star lying in the XZ plane, thickness along Y."""
        self._begin()
        before = set()
        bm = self.bm
        outline = []
        for k in range(points * 2):
            a = math.pi / 2 + k * math.pi / points
            r = r_out if k % 2 == 0 else r_in
            outline.append((math.cos(a) * r, math.sin(a) * r))
        front = [bm.verts.new((x, -depth / 2, z)) for x, z in outline]
        back = [bm.verts.new((x, depth / 2, z)) for x, z in outline]
        cf = bm.verts.new((0, -depth / 2 - depth * 0.35, 0))
        cb = bm.verts.new((0, depth / 2 + depth * 0.35, 0))
        L = len(outline)
        for k in range(L):
            a, b = k, (k + 1) % L
            bm.faces.new((cf, front[b], front[a]))
            bm.faces.new((cb, back[a], back[b]))
            bm.faces.new((front[a], front[b], back[b], back[a]))
        verts = self._new_verts(before)
        bmesh.ops.transform(bm, matrix=trs(loc, rot, 1.0), verts=verts)
        return self._finish(verts, m, smooth, recalc=True)

    def poly(self, verts, faces, m, smooth=False):
        """Raw polygon soup: verts are xyz tuples, faces index into verts."""
        self._begin()
        bv = [self.bm.verts.new(Vector(v)) for v in verts]
        for f in faces:
            try:
                self.bm.faces.new([bv[i] for i in f])
            except ValueError:
                pass  # duplicate face
        return self._finish(bv, m, smooth, recalc=True)

    def leaf(self, base, direction, length, width, m, bend=0.3, twist=0.0, seg=6, thick=0.02, smooth=True):
        """A flat pointed leaf blade (double-sided via thickness)."""
        base, direction = Vector(base), Vector(direction).normalized()
        side = direction.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(direction).normalized()
        self._begin()
        before = set()
        bm = self.bm
        rows = []
        for i in range(seg + 1):
            t = i / seg
            spine = base + direction * (length * t) - up * (bend * length * t * t)
            w = width * math.sin(math.pi * min(1.0, 0.08 + t * 0.95)) * (1 - t * 0.25)
            fold = up * (w * 0.35)
            rows.append((bm.verts.new(spine - side * w - fold),
                         bm.verts.new(spine + up * thick),
                         bm.verts.new(spine + side * w - fold)))
        for i in range(seg):
            a, b = rows[i], rows[i + 1]
            bm.faces.new((a[0], b[0], b[1], a[1]))
            bm.faces.new((a[1], b[1], b[2], a[2]))
        return self._finish(self._new_verts(before), m, smooth, recalc=True)

    # ---- output ----------------------------------------------------------
    def build(self, parent=None, pivot=(0, 0, 0)):
        pv = Vector(pivot)
        bmesh.ops.translate(self.acc, vec=-pv, verts=self.acc.verts)
        me = bpy.data.meshes.new(self.name)
        self.acc.to_mesh(me)
        self.acc.free()
        bpy.data.meshes.remove(self._scratch)
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
            ob.location = pv - WORLD_PIVOT.get(parent.name, Vector())
        else:
            ob.location = pv
        WORLD_PIVOT[ob.name] = pv.copy()
        return ob


def empty(name, parent=None, pivot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = 'PLAIN_AXES'
    ob.empty_display_size = 0.3
    bpy.context.scene.collection.objects.link(ob)
    pv = Vector(pivot)
    if parent is not None:
        ob.parent = parent
        ob.location = pv - WORLD_PIVOT.get(parent.name, Vector())
    else:
        ob.location = pv
    WORLD_PIVOT[ob.name] = pv.copy()
    return ob


def rock_deform(amount=0.15, freq=2.0, seed=0.0, fine=0.35):
    """Two-octave displacement: broad lumps plus finer surface breakup."""
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))

    def f(co):
        n = noise.noise(co * freq + off) + noise.noise(co * freq * 3.1 + off * 1.7) * fine
        return co * (1.0 + n * amount)
    return f


def chisel(amount=0.04, freq=2.0, seed=0.0):
    """Low-poly 'hand-cut' look: shifts every vertex by smooth 3D noise so flat
    faces tilt slightly against each other (use with smooth=False)."""
    off = Vector((seed * 5.3, seed * 9.1, seed * 2.7))

    def f(co):
        return co + noise.noise_vector(co * freq + off) * amount
    return f
