# Environment kit. Exec'd after lib.py.
# Style: chunky, faceted ("low-poly") stonework and foliage with chamfered
# edges, after the concept art -- flat-shaded faces (smooth=False) and slightly
# chiselled vertices, still rendered with the game's PBR triplanar materials.


def _stone_mats():
    return [mat('Stone_A', '#b0936b', rough=0.85), mat('Stone_B', '#9a7c58', rough=0.9),
            mat('Stone_C', '#c2a67c', rough=0.85)]


def _grass_mats():
    return mat('Grass', '#79c832', rough=0.7), mat('Grass_Dark', '#4f9a22', rough=0.8)


def stone(p, loc, size, m, seed, bevel=0.12, segs=1, amount=0.035, rot=(0, 0, 0)):
    """A chunky hand-cut stone: chamfered box with chiselled, flat faces."""
    bevel = min(bevel, min(size) * 0.45)
    p.box(loc, size, m, rot=rot, bevel=bevel, segs=segs, smooth=False, deform=chisel(amount, 2.4, seed))


def drips(p, a, b, out, m, rnd, n, lmin=0.1, lmax=0.3, depth=0.07):
    """Row of triangular grass 'teeth' hanging off the edge a->b (top edge of a
    grass slab). out = outward horizontal direction of that edge."""
    a, b, out = Vector(a), Vector(b), Vector(out).normalized()
    drop = Vector((0, 0, -1))
    L = (b - a).length
    edge = (b - a).normalized()
    seg = L / n
    for k in range(n):
        w = seg * rnd.uniform(0.75, 1.0)
        c = a + edge * (seg * (k + 0.5) + rnd.uniform(-0.15, 0.15) * seg)
        l = rnd.uniform(lmin, lmax)
        p0 = c - edge * w * 0.5 + out * 0.012
        p1 = c + edge * w * 0.5 + out * 0.012
        back = c - out * depth
        tip = c + edge * rnd.uniform(-0.25, 0.25) * w + out * rnd.uniform(0.0, 0.04) + drop * l
        p.poly([p0, p1, back, tip], [(0, 1, 3), (1, 2, 3), (2, 0, 3), (0, 2, 1)], m)


def grass_slab(p, x0, x1, y0, y1, thick, m, m_dk, rnd, nx=4, edge=0.06, bump=0.025, drip_long=0.45, z0=0.0):
    """Turf slab with a wobbly front edge and lumpy top (not a ruler-straight box),
    plus zig-zag teeth of uneven length following the wobble."""
    xs = [x0 + (x1 - x0) * i / nx for i in range(nx + 1)]
    ys = [y0, y0 + 0.35, (y0 + y1) / 2, y1]
    top, bot = [], []
    for j, y in enumerate(ys):
        rt, rb = [], []
        for i, x in enumerate(xs):
            end = i in (0, nx)  # keep seams between tiles close to level
            dy = 0.0 if j else -rnd.uniform(0.0, edge) * (0.4 if end else 1.0)
            dz = 0.0 if end else rnd.uniform(-bump, bump)
            if j == 0:
                dz -= 0.02
            rt.append(Vector((x, y + dy, z0 + dz)))
            rb.append(Vector((x, y + dy * 0.6 + (0.03 if j == 0 else 0), z0 - thick - rnd.uniform(0, 0.04))))
        top.append(rt)
        bot.append(rb)
    verts, faces = [], []

    def vid(v):
        verts.append(v)
        return len(verts) - 1
    T = [[vid(v) for v in row] for row in top]
    B = [[vid(v) for v in row] for row in bot]
    nyr = len(ys)
    for j in range(nyr - 1):
        for i in range(nx):
            faces.append((T[j][i], T[j][i + 1], T[j + 1][i + 1], T[j + 1][i]))
            faces.append((B[j][i], B[j + 1][i], B[j + 1][i + 1], B[j][i + 1]))
    for i in range(nx):
        faces.append((T[0][i], B[0][i], B[0][i + 1], T[0][i + 1]))
        faces.append((T[-1][i], T[-1][i + 1], B[-1][i + 1], B[-1][i]))
    for j in range(nyr - 1):
        faces.append((T[j][0], T[j + 1][0], B[j + 1][0], B[j][0]))
        faces.append((T[j][-1], B[j][-1], B[j + 1][-1], T[j + 1][-1]))
    p.poly(verts, faces, m)
    # teeth: one per front segment, the odd long tongue
    for i in range(nx):
        a, b = top[0][i], top[0][i + 1]
        a = Vector((a.x, a.y, a.z - 0.05))
        b = Vector((b.x, b.y, b.z - 0.05))
        n = rnd.choice((1, 1, 2))
        lmax = drip_long if rnd.random() < 0.3 else 0.26
        drips(p, a, b, (0, -1, 0), m if rnd.random() < 0.65 else m_dk, rnd, n, 0.07, lmax, depth=0.06)


def hanging_vine(p, top, length, vine, rnd, leaves=6):
    pts = []
    for i in range(6):
        t = i / 5
        pts.append(Vector((top[0] + math.sin(t * 2.6 + top[0] * 7) * 0.06, top[1] - 0.03 * t, top[2] - t * length)))
    p.tube(pts, [0.035 - i * 0.004 for i in range(6)], vine, seg=4, smooth=False)
    for i in range(1, leaves + 1):
        t = i / (leaves + 1)
        q = pts[0].lerp(pts[-1], t)
        s = 1 if i % 2 else -1
        p.leaf((q.x, q.y - 0.02, q.z), (0.7 * s, -0.35, -0.35), rnd.uniform(0.12, 0.2), 0.07, vine,
               bend=0.1, seg=2, smooth=False)


def hanging_root(p, top, length, bark, rnd):
    pts = [Vector(top)]
    for i in range(1, 5):
        q = pts[-1] + Vector((rnd.uniform(-0.08, 0.08), rnd.uniform(-0.03, 0.02), -length / 4))
        pts.append(q)
    p.tube(pts, [0.04, 0.03, 0.022, 0.014, 0.006], bark, seg=4, smooth=False)


def build_block(name, seed, vines=0, roots=False):
    """1 unit wide platform tile. Top surface at z~0, spans x -0.5..0.5, depth y -1..1.
    Every variant has its own random stone layout so rows of tiles stay irregular."""
    rnd = random.Random(seed)
    stones = _stone_mats()
    dirt = mat('Dirt', '#4e3a26', rough=1.0)
    grass, grass_dk = _grass_mats()
    vine = mat('Vine', '#3f8f1f', rough=0.7)
    bark = mat('Bark', '#7a5638', rough=0.9)
    root = empty(name)
    p = Piece(name + '_Mesh')
    p.box((0, 0.05, -0.38), (0.98, 1.7, 0.55), dirt, bevel=0.0, smooth=False)
    # front course: 1-3 stones of random width that overhang the tile edges
    n = rnd.choice((1, 2, 2, 3))
    cuts = sorted(rnd.uniform(-0.3, 0.3) for _ in range(n - 1))
    edges = [-0.56] + cuts + [0.56]
    for k in range(n):
        a, b = edges[k], edges[k + 1]
        w = b - a
        h = rnd.uniform(0.42, 0.92)
        top = -0.07 - rnd.uniform(0.0, 0.05)
        rot = (rnd.uniform(-5, 5), rnd.uniform(-5, 5), rnd.uniform(-7, 7))
        stone(p, ((a + b) / 2, -0.72 + rnd.uniform(-0.07, 0.05), top - h / 2),
              (w - 0.035, rnd.uniform(0.5, 0.66), h), rnd.choice(stones), rnd.random() * 40,
              bevel=rnd.uniform(0.09, 0.17), amount=0.05, rot=rot)
        if rnd.random() < 0.35:  # a smaller stone wedged underneath
            hw = w * rnd.uniform(0.45, 0.7)
            sh = rnd.uniform(0.2, 0.36)
            stone(p, ((a + b) / 2 + rnd.uniform(-0.1, 0.1), -0.66, top - h - sh * 0.35),
                  (hw, 0.45, sh), rnd.choice(stones), rnd.random() * 40, bevel=0.08, amount=0.04,
                  rot=(0, rnd.uniform(-6, 6), rnd.uniform(-12, 12)))
    # back course
    for bx in ((-0.25, 0.25) if rnd.random() < 0.5 else (0.0,)):
        bw = 0.5 if bx else 1.0
        stone(p, (bx, 0.5, -0.42), (bw - 0.04, 0.8, rnd.uniform(0.5, 0.7)), rnd.choice(stones), rnd.random() * 40,
              bevel=0.1, amount=0.04)
    grass_slab(p, -0.53, 0.53, -1.03, 1.02, 0.15, grass, grass_dk, rnd, edge=0.1, bump=0.035)
    for k in range(vines):
        vx = rnd.uniform(-0.4, 0.4)
        hanging_vine(p, (vx, -1.0, -0.2), rnd.uniform(0.45, 1.8), vine, rnd, rnd.choice((4, 5, 6, 7)))
    if roots:
        for k in range(rnd.choice((2, 3))):
            hanging_root(p, (rnd.uniform(-0.4, 0.4), -0.55, -0.85), rnd.uniform(0.3, 0.7), bark, rnd)
    p.build(root, (0, 0, 0))
    return root


def build_block_cap(name='BlockCap', seed=7):
    """Rounded end of a platform row at x=+0.5 (mirror for the left end): a big
    chiselled boulder under a turf lip that drips down the side."""
    rnd = random.Random(seed)
    stones = _stone_mats()
    grass, grass_dk = _grass_mats()
    root = empty(name)
    p = Piece(name + '_Mesh')
    r = rnd.uniform(0.42, 0.55)
    p.ico((0.08, -0.4, -0.46), (r, 0.55, rnd.uniform(0.42, 0.55)), rnd.choice(stones), subdiv=1,
          deform=chisel(0.12, 2.0, seed))
    stone(p, (0.04, 0.45, -0.42), (0.38, 0.95, 0.62), rnd.choice(stones), seed + 3, bevel=0.14, amount=0.05,
          rot=(0, rnd.uniform(-6, 6), rnd.uniform(-8, 8)))
    if rnd.random() < 0.6:
        p.ico((0.16, -0.5, -0.9), (0.22, 0.25, 0.2), rnd.choice(stones), subdiv=1, deform=chisel(0.08, 2.4, seed + 5))
    grass_slab(p, -0.12, 0.24, -1.03, 1.02, 0.15, grass, grass_dk, rnd, nx=2)
    drips(p, (0.25, -0.95, -0.06), (0.25, 0.95, -0.06), (1, 0, 0), grass, rnd, rnd.choice((3, 4, 5)), 0.08, 0.36)
    p.build(root, (0, 0, 0))
    return root


def build_boulder(name, seed, mossy=False):
    """Loose rounded-off boulder (heavily chamfered, chiselled block) for scattering
    under ledges, on the floor and against the walls."""
    rnd = random.Random(seed)
    stones = _stone_mats()
    root = empty(name)
    p = Piece(name + '_Mesh')
    sx, sy, sz = rnd.uniform(0.9, 1.3), rnd.uniform(0.75, 1.0), rnd.uniform(0.7, 1.0)
    stone(p, (0, 0, 0), (sx, sy, sz), rnd.choice(stones), seed, bevel=0.3, segs=2, amount=0.1,
          rot=(rnd.uniform(-8, 8), rnd.uniform(-8, 8), rnd.uniform(-15, 15)))
    if rnd.random() < 0.7:
        stone(p, (sx * 0.45, -0.12, -sz * 0.3), (0.5, 0.5, 0.45), rnd.choice(stones), seed + 2, bevel=0.14,
              amount=0.06, rot=(rnd.uniform(-15, 15), 0, rnd.uniform(-25, 25)))
    if mossy:
        grass, grass_dk = _grass_mats()
        grass_slab(p, -sx * 0.4, sx * 0.4, -sy * 0.42, sy * 0.42, 0.1, grass, grass_dk, rnd, nx=3, edge=0.06,
                   z0=sz * 0.5 + 0.04)
    p.build(root, (0, 0, 0))
    return root


def build_bush(name, seed):
    """Faceted leafy shrub (broad tropical leaves around a few leaf pads)."""
    rnd = random.Random(seed)
    leaves = [mat('Leaf_A', '#3f9e3a', rough=0.7), mat('Leaf_B', '#58b845', rough=0.7), mat('Leaf_C', '#2f7d34', rough=0.75)]
    root = empty(name)
    p = Piece(name + '_Mesh')
    for i in range(rnd.choice((3, 4))):
        p.ico((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.1, 0.15), 0.2 + rnd.uniform(0, 0.25)),
              (rnd.uniform(0.25, 0.4), rnd.uniform(0.22, 0.32), rnd.uniform(0.18, 0.28)),
              rnd.choice(leaves), subdiv=1, deform=chisel(0.06, 3, seed + i))
    for i in range(6):
        a = i / 6 * math.pi + rnd.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), rnd.uniform(-0.7, 0.1), math.sin(a) * 0.9 + 0.5))
        p.leaf((0, 0, 0.12), d, rnd.uniform(0.45, 0.7), rnd.uniform(0.14, 0.2), rnd.choice(leaves),
               bend=0.3, seg=3, thick=0.03, smooth=False)
    p.build(root, (0, 0, 0))
    return root


def build_pillar(name='Pillar', seed=11):
    """Stone column segment, 1 unit tall (z 0..1): two courses of uneven cut stone."""
    rnd = random.Random(seed)
    stones = _stone_mats()
    root = empty(name)
    p = Piece(name + '_Mesh')
    p.box((0, 0, 0.5), (0.78, 0.78, 1.0), mat('Dirt', '#4e3a26', rough=1.0), bevel=0.0, smooth=False)
    z = 0.0
    for course in range(2):
        h = rnd.uniform(0.42, 0.56) if course == 0 else 1.0 - z
        n = rnd.choice((1, 2, 2))
        cut = rnd.uniform(-0.18, 0.18)
        parts = [(-0.5, cut), (cut, 0.5)] if n == 2 else [(-0.5, 0.5)]
        for a, b in parts:
            stone(p, ((a + b) / 2 + rnd.uniform(-0.03, 0.03), rnd.uniform(-0.04, 0.03), z + h / 2),
                  (b - a - 0.035, rnd.uniform(0.88, 0.98), h - 0.03), rnd.choice(stones), rnd.random() * 40,
                  bevel=rnd.uniform(0.08, 0.13), amount=0.045,
                  rot=(rnd.uniform(-3, 3), rnd.uniform(-3, 3), rnd.uniform(-4, 4)))
        z += h
    p.build(root, (0, 0, 0))
    return root


def build_pillar_cap():
    """Grass crown for the top of a pillar (sits at z=0 on the last course)."""
    rnd = random.Random(13)
    grass, grass_dk = _grass_mats()
    root = empty('PillarCap')
    p = Piece('PillarCap_Mesh')
    grass_slab(p, -0.56, 0.56, -0.56, 0.56, 0.16, grass, grass_dk, rnd, nx=3, edge=0.05, z0=0.15)
    for a, b, o in (((0.57, -0.5, 0.1), (0.57, 0.5, 0.1), (1, 0, 0)),
                    ((-0.57, 0.5, 0.1), (-0.57, -0.5, 0.1), (-1, 0, 0))):
        drips(p, a, b, o, grass, rnd, 3, 0.08, 0.32)
    for i in range(3):  # a few leaves sprouting from the top
        a = rnd.uniform(0, 2 * math.pi)
        p.leaf((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 0.17), (math.cos(a), math.sin(a), 0.9), 0.4, 0.12,
               grass_dk, bend=0.3, seg=2, thick=0.03, smooth=False)
    p.build(root, (0, 0.0, 0.0))
    return root


def build_wall(name='Wall', seed=21):
    """Big chiselled boulder stack segment for the arena side walls (1.6 wide, 1.6 tall)."""
    rnd = random.Random(seed)
    stones = _stone_mats()
    moss = mat('Moss', '#5aa82a', rough=0.8)
    vine = mat('Vine', '#3f8f1f', rough=0.7)
    root = empty(name)
    p = Piece(name + '_Mesh')
    for row in range(2):
        split = rnd.uniform(-0.25, 0.25)
        for a, b in ((-0.82, split), (split, 0.82)):
            h = rnd.uniform(0.7, 0.9)
            stone(p, ((a + b) / 2, rnd.uniform(-0.08, 0.08), 0.4 + row * 0.8 + rnd.uniform(-0.05, 0.05)),
                  (b - a - 0.03, rnd.uniform(1.15, 1.4), h), rnd.choice(stones), rnd.random() * 30,
                  bevel=rnd.uniform(0.16, 0.26), segs=2, amount=0.07,
                  rot=(rnd.uniform(-4, 4), rnd.uniform(-5, 5), rnd.uniform(-6, 6)))
    for i in range(rnd.choice((2, 3, 4))):
        p.ico((rnd.uniform(-0.6, 0.6), -0.64, rnd.uniform(0.2, 1.4)), (rnd.uniform(0.14, 0.26), 0.06, 0.13), moss,
              subdiv=1, deform=chisel(0.15, 3, i + seed))
    for i in range(rnd.choice((0, 1, 2))):
        hanging_vine(p, (rnd.uniform(-0.6, 0.6), -0.66, 1.55), rnd.uniform(0.6, 1.5), vine, rnd, 5)
    p.build(root, (0, 0, 0))
    return root


def build_plank():
    wood = mat('Wood', '#a0683a', rough=0.8)
    wood_dk = mat('Wood_Dark', '#6e4424', rough=0.9)
    rope = mat('Rope', '#d9b77a', rough=0.9)
    root = empty('Plank')
    p = Piece('Plank_Mesh')
    p.box((0, 0, -0.06), (0.4, 1.6, 0.1), wood, bevel=0.03, segs=1, smooth=False, deform=chisel(0.015, 4, 2))
    for y in (-0.7, 0.7):
        p.cone((0, y, -0.02), 0.035, 0.035, 0.14, rope, seg=6, smooth=False)
        p.box((0, y, -0.05), (0.1, 0.08, 0.13), wood_dk, bevel=0.02, segs=1, smooth=False)
    p.build(root, (0, 0, 0))
    return root


def _canopy_pad(p, c, s, m, seed):
    p.ico(c, s, m, subdiv=1, smooth=False, deform=chisel(0.18, 1.6, seed))


def build_tree(name, seed):
    """Low-poly umbrella (acacia-like) tree: forked faceted trunk, flat layered canopy."""
    rnd = random.Random(seed)
    bark = mat('Bark', '#7a5638', rough=0.9)
    leaves = [mat('Leaf_A', '#3f9e3a', rough=0.7), mat('Leaf_B', '#58b845', rough=0.7), mat('Leaf_C', '#2f7d34', rough=0.75)]
    root = empty(name)
    p = Piece(name + '_Mesh')
    lean = rnd.uniform(-0.35, 0.35)
    top = Vector((lean, 0, 3.0 + rnd.uniform(-0.2, 0.3)))
    fork = Vector((lean * 0.4, 0, 1.7))
    p.tube([Vector((0, 0, 0)), Vector((0.05, 0, 0.9)), fork], [0.24, 0.17, 0.14], bark, seg=6, smooth=False)
    tips = []
    for i in range(3):
        a = i / 3 * 2 * math.pi + rnd.uniform(-0.4, 0.4)
        tip = top + Vector((math.cos(a) * 0.9, math.sin(a) * 0.5, rnd.uniform(-0.15, 0.15)))
        p.tube([fork, (fork + tip) / 2 + Vector((0, 0, 0.25)), tip], [0.13, 0.09, 0.06], bark, seg=5, smooth=False)
        tips.append(tip)
    # wide, flat canopy: one big pad over smaller pads at the branch tips
    _canopy_pad(p, top + Vector((0, 0, 0.35)), (1.75, 1.25, 0.42), leaves[0], rnd.random() * 9)
    for i, tip in enumerate(tips):
        _canopy_pad(p, tip + Vector((0, 0, 0.12)), (0.95, 0.75, 0.32), leaves[(i + 1) % 3], rnd.random() * 9)
    _canopy_pad(p, top + Vector((rnd.uniform(-0.4, 0.4), 0, 0.72)), (1.0, 0.8, 0.3), leaves[1], rnd.random() * 9)
    p.build(root, (0, 0, 0))
    return root


def build_palm(name, seed):
    """Low-poly palm: segmented curved trunk, faceted fronds and coconuts."""
    rnd = random.Random(seed)
    bark = mat('Bark', '#7a5638', rough=0.9)
    frond = mat('Leaf_B', '#58b845', rough=0.7)
    frond_dk = mat('Leaf_C', '#2f7d34', rough=0.75)
    nut = mat('Wood_Dark', '#6e4424', rough=0.9)
    root = empty(name)
    p = Piece(name + '_Mesh')
    bend = rnd.uniform(0.5, 0.9) * rnd.choice((-1, 1))
    pts = [Vector((bend * (t ** 2), 0, t * 3.6)) for t in [i / 6 for i in range(7)]]
    for i in range(6):  # stacked tapered rings read as the trunk's segments
        p.cone_between(pts[i], pts[i + 1], 0.17 - i * 0.012, 0.13 - i * 0.012, bark, seg=6, smooth=False)
    crown = pts[-1]
    for i in range(7):
        a = i / 7 * 2 * math.pi + rnd.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a) * 0.8, rnd.uniform(0.05, 0.35)))
        p.leaf(crown, d, rnd.uniform(1.4, 1.9), rnd.uniform(0.26, 0.34), frond if i % 2 else frond_dk,
               bend=0.55, seg=4, thick=0.04, smooth=False)
    for i in range(3):
        a = i / 3 * 2 * math.pi
        p.ico(crown + Vector((math.cos(a) * 0.14, math.sin(a) * 0.14, -0.12)), 0.11, nut, subdiv=1)
    p.build(root, (0, 0, 0))
    return root


def build_island(name, seed, tree=True):
    """Floating island: faceted inverted rock cone under a grass cap with dripping edge."""
    rnd = random.Random(seed)
    rock = mat('Island_Rock', '#9d8a70', rough=0.9)
    rock_dk = mat('Island_RockDark', '#6f604e', rough=0.95)
    grass, grass_dk = _grass_mats()
    root = empty(name)
    p = Piece(name + '_Mesh')
    jit = chisel(0.12, 1.8, seed)

    def dfm(co):
        if co.z > 0:
            v = Vector((co.x, co.y, co.z * 0.18))
        else:
            k = max(0.08, 1.0 + co.z * 0.95)
            v = Vector((co.x * k, co.y * k, co.z * 1.7))
        return jit(v)
    p.ico((0, 0, 0), (1.0, 0.85, 1.0), rock, subdiv=2, smooth=False, deform=dfm)
    p.ico((0.25, -0.2, -1.0), (0.45, 0.4, 0.55), rock_dk, subdiv=1, smooth=False, deform=chisel(0.1, 2, seed + 1))
    p.cone((0, 0, 0.2), 1.06, 0.98, 0.16, grass, seg=10, smooth=False)
    for k in range(10):
        a0, a1 = k / 10 * 2 * math.pi, (k + 1) / 10 * 2 * math.pi
        A = Vector((math.cos(a0) * 1.06, math.sin(a0) * 1.06, 0.13))
        B = Vector((math.cos(a1) * 1.06, math.sin(a1) * 1.06, 0.13))
        mid = (a0 + a1) / 2
        drips(p, A, B, (math.cos(mid), math.sin(mid), 0), grass if k % 2 else grass_dk, rnd, 1, 0.12, 0.3, depth=0.1)
    if tree:
        leaves = mat('Leaf_A', '#3f9e3a', rough=0.7)
        bark = mat('Bark', '#7a5638', rough=0.9)
        p.tube([(0, 0, 0.25), (0.08, 0, 0.8), (0.0, 0, 1.25)], [0.09, 0.07, 0.05], bark, seg=5, smooth=False)
        _canopy_pad(p, (0, 0, 1.38), (0.7, 0.55, 0.2), leaves, seed)
        _canopy_pad(p, (0.25, 0.1, 1.28), (0.42, 0.36, 0.16), leaves, seed + 2)
    p.build(root, (0, 0, 0))
    return root


def build_volcano():
    rock = mat('Volcano_Rock', '#6e5a63', rough=0.95)
    lava = mat('Lava', '#ff6a00', rough=0.4, emit='#ff5a00', es=8.0)
    lava_hot = mat('Lava_Hot', '#ffd23a', rough=0.3, emit='#ffc020', es=12.0)
    root = empty('Volcano')
    p = Piece('Volcano_Mesh')

    def dfm(co):
        r = Vector((co.x, co.y, 0)).length
        z = min(1.0 - r, 0.82)
        v = Vector((co.x, co.y, max(0.0, z)))
        v += Vector((co.x, co.y, 0)) * noise.noise(co * 3.0) * 0.12
        v.z += noise.noise(co * 5.0 + Vector((3, 1, 0))) * 0.05
        return v
    p._begin()
    bmesh.ops.create_grid(p.bm, x_segments=30, y_segments=30, size=1.0)
    verts = list(p.bm.verts)
    for v in verts:
        v.co = dfm(v.co.copy())
    bmesh.ops.transform(p.bm, matrix=trs((0, 0, 0), (0, 0, 0), (6.0, 4.0, 5.0)), verts=verts)
    p._finish(verts, rock, False)
    p.cone((0, 0, 4.06), 0.85, 0.7, 0.08, lava_hot, seg=8, smooth=False)
    # lava channels down the front face (faceted ribbons)
    rnd = random.Random(5)
    for k in range(5):
        x0 = rnd.uniform(-0.8, 0.8)
        pts = []
        for i in range(8):
            t = i / 7
            r = 0.16 + t * 0.8
            ang = -math.pi / 2 + (x0 * 0.6) + math.sin(t * 5 + k) * 0.18
            x, y = math.cos(ang) * r, math.sin(ang) * r
            z = min(0.82, 1.0 - r)
            pts.append((x * 6.0, y * 4.0 - 0.12, z * 5.0 + 0.08))
        p.tube(pts, [0.2 - i * 0.018 for i in range(8)], lava, seg=4, smooth=False)
    p.build(root, (0, 0, 0))
    return root


def build_ufo():
    hull = mat('UFO_Hull', '#b9c3d8', rough=0.2, metal=0.8)
    hull_dk = mat('UFO_HullDark', '#5d6a8a', rough=0.3, metal=0.7)
    dome = mat('UFO_Dome', '#7ff3ff', rough=0.05, emit='#40d8ff', es=1.2, alpha=0.6)
    light = mat('UFO_Light', '#ffe066', emit='#ffd21a', es=8.0)
    beam = mat('UFO_Glow', '#66ff99', emit='#40ff80', es=6.0)
    root = empty('UFO')
    p = Piece('UFO_Hull')
    p.sphere((0, 0, 0), (1.2, 1.2, 0.26), hull, seg=36, rings=14)
    p.sphere((0, 0, -0.12), (0.8, 0.8, 0.2), hull_dk, seg=28, rings=10)
    p.ring((0, 0, 0), 1.18, 0.05, hull_dk, axis='Z', seg=48)
    p.sphere((0, 0, -0.3), (0.35, 0.35, 0.08), beam, seg=20, rings=8)
    ufo = p.build(root, (0, 0, 0))
    d = Piece('UFO_Dome')
    d.sphere((0, 0, 0.15), (0.55, 0.55, 0.45), dome, seg=28, rings=14)
    d.build(ufo, (0, 0, 0))
    l = Piece('UFO_Lights')
    for i in range(12):
        a = i / 12 * 2 * math.pi
        l.sphere((math.cos(a) * 1.0, math.sin(a) * 1.0, 0.08), 0.07, light, seg=10, rings=6)
    l.build(ufo, (0, 0, 0))
    return root


def build_ptero():
    skin = mat('Ptero_Skin', '#c0674a', rough=0.6)
    wing = mat('Ptero_Wing', '#e0906a', rough=0.6)
    dark = mat('Pupil', '#12081f', rough=0.1)
    root = empty('Ptero')
    b = Piece('Ptero_Body')
    b.tube([(-0.5, 0, 0), (-0.1, 0, 0.02), (0.3, 0, 0.08), (0.45, 0, 0.18)], [0.03, 0.12, 0.1, 0.08], skin, seg=10)
    b.sphere((0.5, 0, 0.22), (0.12, 0.09, 0.1), skin)
    b.cone_between((0.55, 0, 0.2), (0.95, 0, 0.12), 0.05, 0.004, skin, seg=8)
    b.cone_between((0.45, 0, 0.28), (0.2, 0, 0.42), 0.04, 0.004, skin, seg=8)
    b.sphere((0.56, -0.07, 0.25), 0.02, dark, seg=8, rings=5)
    body = b.build(root, (0, 0, 0))
    for side, s in (('L', 1), ('R', -1)):
        w = Piece('Ptero_Wing' + side)
        w._begin()
        before = set()
        bm = w.bm
        pts = [(0.25, 0.0), (0.1, 0.5), (0.25, 1.0), (-0.05, 1.3), (-0.3, 0.7), (-0.35, 0.0)]
        top = [bm.verts.new((x, y * s, 0.03)) for x, y in pts]
        bot = [bm.verts.new((x, y * s, -0.01)) for x, y in pts]
        bm.faces.new(top if s > 0 else list(reversed(top)))
        bm.faces.new(list(reversed(bot)) if s > 0 else bot)
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((top[i], top[j], bot[j], bot[i]))
        w._finish(w._new_verts(before), wing, False, recalc=True)
        w.build(body, (0.05, 0.05 * s, 0.05))
    return root


def build_fern(name, seed, col='#3fae3a'):
    """Big faceted tropical leaves fanning out of the ground."""
    rnd = random.Random(seed)
    leaf = mat(name + '_Mat', col, rough=0.6)
    root = empty(name)
    p = Piece(name + '_Mesh')
    for i in range(7):
        a = (i / 7) * math.pi * 1.1 - math.pi * 0.05 + rnd.uniform(-0.12, 0.12)
        d = Vector((math.cos(a), rnd.uniform(-0.6, 0.2), math.sin(a) * 1.3 + 0.4))
        p.leaf((0, 0, 0), d, rnd.uniform(1.0, 1.6), rnd.uniform(0.26, 0.38), leaf, bend=0.35, seg=4,
               thick=0.05, smooth=False)
    p.build(root, (0, 0, 0))
    return root


def build_flower(name='Flower', petal_mat='Flower_Petal', col='#b04cff'):
    petal = mat(petal_mat, col, rough=0.5)
    center = mat('Flower_Center', '#ffd21a', rough=0.4, emit='#ffb000', es=0.5)
    stem = mat('Leaf_A', '#3f9e3a', rough=0.7)
    root = empty(name)
    p = Piece(name + '_Mesh')
    p.tube([(0, 0, 0), (0.05, 0, 0.3), (0.0, 0, 0.6)], 0.03, stem, seg=4, smooth=False)
    for i in range(5):
        a = i / 5 * 2 * math.pi
        p.leaf((0, 0, 0.6), (math.cos(a), -0.3, math.sin(a) * 0.7 + 0.3), 0.34, 0.16, petal, bend=-0.2, seg=2,
               thick=0.03, smooth=False)
    p.ico((0, -0.03, 0.62), 0.07, center, subdiv=1)
    p.build(root, (0, 0, 0))
    return root


# ---------------------------------------------------------------- foreground frame
# Big pieces that frame the screen corners like the concept art. They face the
# camera (-Y) and fan up and to the right (+X); the game mirrors them for the
# right-hand corners.

def build_fg_leaves(name, seed, n=8, lush=False):
    """A clump of huge, folded, faceted tropical leaves."""
    rnd = random.Random(seed)
    greens = [mat('Fg_LeafLime', '#7cc92a', rough=0.55), mat('Leaf_B', '#58b845', rough=0.7),
              mat('Fg_LeafDark', '#1f6e2c', rough=0.6), mat('Leaf_C', '#2f7d34', rough=0.75)]
    root = empty(name)
    p = Piece(name + '_Mesh')
    for i in range(n):
        t = i / max(1, n - 1)
        a = math.radians(rnd.uniform(8, 25) + t * rnd.uniform(110, 150))  # fan from right-low to up-left
        d = Vector((math.cos(a), rnd.uniform(-0.55, -0.15), math.sin(a) * 1.15 + 0.15))
        length = rnd.uniform(1.0, 1.55) * (1.15 if lush else 1.0)
        p.leaf((rnd.uniform(-0.08, 0.08), rnd.uniform(-0.1, 0.05), 0), d, length,
               length * rnd.uniform(0.3, 0.42), greens[(i + seed) % len(greens)],
               bend=rnd.uniform(0.25, 0.45), seg=5, thick=0.07, smooth=False)
    if lush:  # a second, shorter layer in front
        for i in range(4):
            a = math.radians(rnd.uniform(20, 140))
            d = Vector((math.cos(a), -0.9, math.sin(a) * 0.9 + 0.2))
            p.leaf((0, -0.15, 0), d, rnd.uniform(0.6, 0.85), 0.26, greens[i % 2 * 2], bend=0.3, seg=4,
                   thick=0.06, smooth=False)
    p.build(root, (0, 0, 0))
    return root


def build_fg_flower(name, seed, col, center='#ffd21a'):
    """Large star-shaped jungle flower with faceted petals, two leaves and a stem."""
    rnd = random.Random(seed)
    petal = mat(name + '_Petal', col, rough=0.45)
    heart = mat('Flower_Center', center, rough=0.4, emit='#ffb000', es=0.5)
    green = mat('Leaf_B', '#58b845', rough=0.7)
    root = empty(name)
    p = Piece(name + '_Mesh')
    head = Vector((0.08, 0, 0.75))
    p.tube([(0, 0, 0), (0.06, 0, 0.4), head], 0.035, green, seg=4, smooth=False)
    for s in (-1, 1):
        p.leaf((0.03, 0, 0.25), (s * 1.0, -0.3, 0.6), 0.42, 0.15, green, bend=0.25, seg=3, thick=0.04, smooth=False)
    k = rnd.choice((5, 6))
    for i in range(k):
        a = i / k * 2 * math.pi + rnd.uniform(-0.1, 0.1)
        p.leaf(head, (math.cos(a), -0.45, math.sin(a)), rnd.uniform(0.34, 0.42), 0.17, petal,
               bend=-0.15, seg=3, thick=0.04, smooth=False)
    for i in range(k):  # inner ring, offset
        a = (i + 0.5) / k * 2 * math.pi
        p.leaf(head + Vector((0, -0.04, 0)), (math.cos(a), -0.7, math.sin(a)), 0.2, 0.1, petal,
               bend=-0.1, seg=2, thick=0.03, smooth=False)
    p.ico(head + Vector((0, -0.08, 0)), 0.07, heart, subdiv=1)
    p.build(root, (0, 0, 0))
    return root


def build_fg_branch(name, seed):
    """Gnarled tree limb entering from the top-left corner, heading right, with
    hanging leaf bunches and vines (origin at the root end)."""
    rnd = random.Random(seed)
    bark = mat('Bark', '#7a5638', rough=0.9)
    vine = mat('Vine', '#3f8f1f', rough=0.7)
    leaves = [mat('Leaf_A', '#3f9e3a', rough=0.7), mat('Fg_LeafLime', '#7cc92a', rough=0.55),
              mat('Leaf_C', '#2f7d34', rough=0.75)]
    root = empty(name)
    p = Piece(name + '_Mesh')
    pts = [Vector((0, 0, 0.25)), Vector((0.9, 0.0, -0.05)), Vector((1.8, 0.05, -0.2)),
           Vector((2.7, 0.05, -0.1)), Vector((3.4, 0.08, 0.05))]
    pts = [q + Vector((0, 0, rnd.uniform(-0.06, 0.06))) for q in pts]
    p.tube(pts, [0.2, 0.16, 0.12, 0.08, 0.04], bark, seg=6, smooth=False)
    # a twig curling down
    p.tube([pts[1], pts[1] + Vector((0.35, -0.05, -0.3)), pts[1] + Vector((0.55, -0.05, -0.55))],
           [0.07, 0.045, 0.02], bark, seg=5, smooth=False)
    # leaf bunches hanging off the limb
    for j, q in enumerate((pts[0], pts[1], pts[2], pts[3], pts[4])):
        for i in range(rnd.choice((4, 5, 6))):
            a = rnd.uniform(-1.2, 1.2)
            d = Vector((math.sin(a) * 0.8, rnd.uniform(-0.5, 0.0), -math.cos(a) * 0.6 + rnd.uniform(-0.2, 0.5)))
            p.leaf(q + Vector((rnd.uniform(-0.15, 0.15), -0.05, 0)), d, rnd.uniform(0.35, 0.6), 0.16,
                   leaves[(i + j) % 3], bend=0.25, seg=3, thick=0.04, smooth=False)
    # vines dangling from the limb
    for x, L in ((0.55, rnd.uniform(0.7, 1.1)), (1.5, rnd.uniform(0.45, 0.8)), (2.4, rnd.uniform(0.6, 1.0)),
                 (3.1, rnd.uniform(0.35, 0.6))):
        hanging_vine(p, (x, -0.06, -0.12), L, vine, rnd, max(3, int(L * 6)))
    p.build(root, (0, 0, 0))
    return root


def build_environment():
    objs = [build_block('BlockA', 1), build_block('BlockB', 2), build_block('BlockC', 5), build_block('BlockD', 6, roots=True),
            build_block('BlockE', 9), build_block('BlockV', 3, vines=2), build_block('BlockV2', 4, vines=3, roots=True),
            build_block_cap('BlockCap', 7), build_block_cap('BlockCap2', 8),
            build_boulder('Boulder1', 31), build_boulder('Boulder2', 32), build_boulder('Boulder3', 33, mossy=True),
            build_bush('Bush', 41), build_bush('Bush2', 42),
            build_pillar('Pillar', 11), build_pillar('Pillar2', 12), build_pillar_cap(),
            build_wall('Wall', 21), build_wall('Wall2', 22), build_plank(),
            build_tree('TreeA', 1), build_palm('TreeB', 4), build_tree('TreeC', 7),
            build_island('IslandA', 2), build_island('IslandB', 5, tree=False),
            build_volcano(), build_ufo(), build_ptero(),
            build_fern('Fern', 3), build_fern('RedLeaf', 8, '#e0452a'), build_flower(),
            build_flower('FlowerRed', 'Flower_PetalRed', '#ff3a5a'),
            build_fg_leaves('FgLeaves', 51), build_fg_leaves('FgLeaves2', 52, n=9, lush=True),
            build_fg_flower('FgFlowerRed', 61, '#ff3a24'), build_fg_flower('FgFlowerPink', 62, '#ff3aa8'),
            build_fg_branch('FgBranch', 71), build_fg_branch('FgBranch2', 72)]
    for i, o in enumerate(objs):
        o.location.x = (i % 10) * 3.0
        o.location.y = 8.0 + (i // 10) * 4.0
    return objs
