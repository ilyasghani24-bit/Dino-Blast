# Characters + pickups. Exec'd after lib.py (shares its globals).
# Convention: +X = forward (facing right), -Y = toward camera, +Z = up, feet at z=0.


def build_dino():
    purple = mat('Dino_Purple', '#6c5cf5', rough=0.42, coat=0.3)
    purple_dk = mat('Dino_PurpleDark', '#4a3bcf', rough=0.5)
    belly = mat('Dino_Belly', '#c3bbff', rough=0.45)
    spike = mat('Dino_Spike', '#ffa928', rough=0.35, coat=0.4)
    white = mat('Eye_White', '#ffffff', rough=0.15)
    iris = mat('Dino_Iris', '#8a2cff', rough=0.1, coat=1.0)
    pupil = mat('Pupil', '#12081f', rough=0.1)
    shine = mat('Eye_Shine', '#ffffff', rough=0.1, emit='#ffffff', es=3.0)
    mouth = mat('Mouth', '#6a0f2a', rough=0.6)
    tongue = mat('Tongue', '#ff6f96', rough=0.4)
    blush = mat('Blush', '#ff8fcf', rough=0.6)
    claw = mat('Claw', '#fff1cf', rough=0.4)

    root = empty('Dino')

    # legs (children of root so they can swing independently of body bob)
    for side, y in (('L', 0.19), ('R', -0.19)):
        p = Piece('Dino_Leg' + side)
        p.sphere((0.0, y, 0.2), (0.15, 0.14, 0.2), purple)
        p.sphere((0.07, y, 0.065), (0.21, 0.15, 0.085), purple_dk)
        for dy in (-0.07, 0.0, 0.07):
            p.sphere((0.26, y + dy, 0.05), 0.045, claw, seg=10, rings=6)
        p.build(root, (0.0, y, 0.36))

    body = Piece('Dino_Body')
    body.sphere((0, 0, 0.6), (0.4, 0.34, 0.42), purple, rot=(0, -8, 0))
    body.sphere((0.14, 0, 0.55), (0.29, 0.28, 0.33), belly, rot=(0, -8, 0))
    # back spikes along an arc behind the body
    for i, ang in enumerate((115, 140, 165, 190)):
        a = ang * D2R
        c = Vector((0, 0, 0.6))
        n = Vector((math.cos(a), 0, math.sin(a)))
        base = c + Vector((n.x * 0.38, 0, n.z * 0.4))
        s = 0.16 - i * 0.02
        body.cone_between(base - n * 0.03, base + n * s, 0.075, 0.005, spike, seg=10)
    body_ob = body.build(root, (0, 0, 0.4))

    head = Piece('Dino_Head')
    head.sphere((0.18, 0, 1.18), (0.42, 0.38, 0.37), purple)
    head.sphere((0.5, 0, 1.08), (0.3, 0.28, 0.22), purple)          # snout
    head.sphere((0.44, 0, 0.96), (0.26, 0.24, 0.12), belly)          # jaw
    head.sphere((0.6, 0, 0.995), (0.16, 0.18, 0.07), mouth)          # open mouth
    head.sphere((0.6, 0, 0.965), (0.11, 0.12, 0.04), tongue)
    for dy in (-0.08, 0.08):
        head.cone((0.69, dy, 1.035), 0.028, 0.0, 0.06, claw, rot=(180, 0, 0), seg=8)
        head.sphere((0.77, dy, 1.15), (0.02, 0.025, 0.018), pupil, seg=8, rings=6)
    # eyes
    for s in (1, -1):
        ec = Vector((0.45, 0.19 * s, 1.27))
        d = Vector((1.0, 0.6 * s, 0.08)).normalized()
        head.sphere(ec, (0.14, 0.14, 0.165), white)
        head.sphere(ec + d * 0.07, (0.1, 0.1, 0.12), iris)
        head.sphere(ec + d * 0.115, (0.06, 0.06, 0.075), pupil)
        head.sphere(ec + d * 0.15 + Vector((0, 0.02 * s, 0.05)), 0.028, shine, seg=10, rings=6)
        head.sphere(ec + d * 0.15 + Vector((0, -0.02 * s, -0.035)), 0.014, shine, seg=8, rings=5)
        head.sphere((0.5, 0.29 * s, 1.08), (0.07, 0.03, 0.045), blush, rot=(0, 0, 30 * s), seg=12, rings=8)
    # crest spikes
    for i, ang in enumerate((78, 102, 126, 150)):
        a = ang * D2R
        n = Vector((math.cos(a), 0, math.sin(a)))
        base = Vector((0.18, 0, 1.18)) + Vector((n.x * 0.4, 0, n.z * 0.35))
        s = 0.2 - abs(i - 1.2) * 0.03
        head.cone_between(base - n * 0.04, base + n * s, 0.085, 0.006, spike, seg=10)
    head.build(body_ob, (0.12, 0, 0.92))

    for side, y in (('L', 0.27), ('R', -0.27)):
        a = Piece('Dino_Arm' + side)
        a.sphere((0.33, y, 0.67), (0.15, 0.09, 0.085), purple, rot=(0, 30, 0))
        a.sphere((0.46, y, 0.6), 0.075, belly)
        for dz in (-0.03, 0.03):
            a.cone_between((0.5, y, 0.6 + dz), (0.57, y, 0.6 + dz * 1.4), 0.022, 0.002, claw, seg=6)
        a.build(body_ob, (0.22, y, 0.74))

    tail = Piece('Dino_Tail')
    pts = [(-0.2, 0, 0.52), (-0.45, 0, 0.42), (-0.7, 0, 0.35), (-0.92, 0, 0.36), (-1.06, 0, 0.45), (-1.12, 0, 0.55)]
    tail.tube(pts, [0.26, 0.2, 0.14, 0.09, 0.05, 0.015], purple, seg=16)
    for (x, z, s) in ((-0.5, 0.6, 0.13), (-0.72, 0.5, 0.1), (-0.92, 0.46, 0.08)):
        tail.cone_between((x, 0, z - 0.06), (x - 0.03, 0, z + s), 0.06, 0.004, spike, seg=10)
    tail.build(body_ob, (-0.25, 0, 0.5))
    return root


def build_alien():
    skin = mat('Alien_Skin', '#9be34a', rough=0.45, coat=0.3)
    skin_dk = mat('Alien_SkinDark', '#5fae2a', rough=0.5)
    helmet = mat('Alien_Helmet', '#2848d6', rough=0.2, metal=0.2, coat=1.0)
    gold = mat('Gold', '#ffbb12', rough=0.25, metal=0.9)
    eye = mat('Alien_Eye', '#c238ff', rough=0.05, coat=1.0)
    pupil = mat('Pupil', '#12081f', rough=0.1)
    shine = mat('Eye_Shine', '#ffffff', rough=0.1, emit='#ffffff', es=3.0)
    bulb = mat('Alien_Bulb', '#ffe34a', rough=0.2, emit='#ffd21a', es=6.0)
    phone = mat('Alien_Phone', '#ff8a1c', rough=0.3, coat=0.6)
    boot = mat('Alien_Boot', '#252a66', rough=0.4)
    mouth = mat('Mouth', '#6a0f2a', rough=0.6)

    root = empty('Alien')
    for side, y in (('L', 0.1), ('R', -0.1)):
        p = Piece('Alien_Leg' + side)
        p.sphere((0, y, 0.17), (0.075, 0.075, 0.13), skin)
        p.sphere((0.04, y, 0.05), (0.12, 0.085, 0.065), boot)
        p.build(root, (0, y, 0.28))

    body = Piece('Alien_Body')
    body.sphere((0, 0, 0.42), (0.2, 0.18, 0.2), skin)
    body.ring((0, 0, 0.33), 0.185, 0.035, helmet, axis='Z')
    body.star((0.19, 0, 0.44), 0.06, 0.028, 0.03, gold, rot=(0, 0, 90))
    body_ob = body.build(root, (0, 0, 0.3))

    head = Piece('Alien_Head')
    hc = Vector((0.02, 0, 0.86))
    head.sphere(hc, (0.33, 0.31, 0.3), skin)
    # helmet shell: upper part of a slightly larger sphere, tilted back
    def cut_helmet(bm):
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=hc + Vector((0, 0, 0.02)),
                               plane_no=Vector((-0.22, 0, 1)).normalized(), clear_inner=True)
    head.sphere(hc, (0.36, 0.345, 0.34), helmet, rot=(0, -12, 0), seg=28, rings=16, post=cut_helmet)
    head.ring(hc + Vector((0.005, 0, 0.035)), 0.345, 0.035, gold, axis='Z', seg=36)
    head.star(hc + Vector((0.3, 0, 0.2)), 0.085, 0.04, 0.04, gold, rot=(0, -40, 90))
    for s in (1, -1):
        c = Vector((0.02, 0.315 * s, 0.86))
        head.cone(c, 0.11, 0.11, 0.08, phone, rot=(90, 0, 0))
        head.cone(c + Vector((0, 0.045 * s, 0)), 0.07, 0.07, 0.03, helmet, rot=(90, 0, 0))
        ec = Vector((0.24, 0.125 * s, 0.82))
        head.sphere(ec, (0.1, 0.08, 0.12), eye, rot=(0, 0, 25 * s))
        head.sphere(ec + Vector((0.07, 0.0, -0.02)), (0.04, 0.045, 0.06), pupil, rot=(0, 0, 25 * s))
        head.sphere(ec + Vector((0.08, 0.02 * s, 0.05)), 0.028, shine, seg=10, rings=6)
        head.sphere(ec + Vector((0.09, -0.02 * s, -0.04)), 0.013, shine, seg=8, rings=5)
    head.sphere((0.33, 0, 0.68), (0.02, 0.05, 0.016), mouth, seg=10, rings=6)
    head_ob = head.build(body_ob, (0, 0, 0.58))

    ant = Piece('Alien_Antenna')
    ant.tube([(-0.02, 0, 1.18), (0.0, 0, 1.32), (0.05, 0, 1.44)], 0.018, gold, seg=8)
    ant.sphere((0.055, 0, 1.47), 0.055, bulb)
    ant.build(head_ob, (-0.02, 0, 1.18))

    for side, y in (('L', 0.19), ('R', -0.19)):
        a = Piece('Alien_Arm' + side)
        a.sphere((0.05, y * 1.1, 0.4), (0.055, 0.055, 0.12), skin, rot=(0, -25, 0))
        a.sphere((0.1, y * 1.12, 0.3), 0.06, skin_dk)
        a.build(body_ob, (0.02, y, 0.5))
    return root


def egg_deform(co):
    z = co.z
    k = 1.0 - 0.2 * max(0.0, z)
    return Vector((co.x * k, co.y * k, z * (1.12 if z > 0 else 0.92)))


def build_egg():
    shell = mat('Egg_Shell', '#fffaf0', rough=0.25, coat=0.8)
    spot = mat('Egg_Spot', '#9a4cff', rough=0.3, coat=0.6)
    root = empty('Egg')
    p = Piece('Egg_Mesh')
    R = Vector((0.56, 0.56, 0.6))
    center = Vector((0, 0, 0.58))
    p.sphere(center, R, shell, seg=32, rings=20, deform=egg_deform)
    rnd = random.Random(7)
    golden = math.pi * (3 - math.sqrt(5))
    count = 16
    for i in range(count):
        zz = 1 - (i + 0.5) / count * 2
        r = math.sqrt(1 - zz * zz)
        th = golden * i * 1.7
        d = Vector((math.cos(th) * r, math.sin(th) * r, zz * 0.95))
        d.normalize()
        sp = egg_deform(d)
        pos = center + Vector((sp.x * R.x, sp.y * R.y, sp.z * R.z))
        nrm = Vector((sp.x / R.x, sp.y / R.y, sp.z / R.z)).normalized()
        size = rnd.uniform(0.07, 0.14)
        q = Vector((0, 0, 1)).rotation_difference(nrm)
        eul = q.to_euler()
        p.sphere(pos - nrm * 0.012, (size, size * rnd.uniform(0.7, 1.0), 0.028), spot,
                 rot=(eul.x / D2R, eul.y / D2R, eul.z / D2R), seg=14, rings=8)
    p.build(root, (0, 0, 0))
    return root


def build_coin():
    gold = mat('Coin_Gold', '#ffc21a', rough=0.22, metal=0.95)
    face = mat('Coin_Face', '#ffab00', rough=0.3, metal=0.9)
    star = mat('Coin_Star', '#fff08a', rough=0.2, metal=0.6, emit='#ffcf3a', es=0.4)
    root = empty('Coin')
    p = Piece('Coin_Mesh')
    p.cone((0, 0, 0), 0.28, 0.28, 0.06, face, rot=(90, 0, 0), seg=32)
    p.ring((0, 0, 0), 0.28, 0.045, gold, axis='Y', seg=32, tseg=10)
    p.star((0, -0.03, 0), 0.16, 0.07, 0.035, star)
    p.star((0, 0.03, 0), 0.16, 0.07, 0.035, star)
    p.build(root, (0, 0, 0))
    return root


def build_heart():
    red = mat('Heart_Red', '#ff2f5b', rough=0.2, coat=1.0, emit='#ff1040', es=0.3)
    shine = mat('Eye_Shine', '#ffffff', rough=0.1, emit='#ffffff', es=3.0)
    root = empty('Heart')
    p = Piece('Heart_Mesh')
    for s in (1, -1):
        p.sphere((0.1 * s, 0, 0.05), (0.13, 0.11, 0.24), red, rot=(0, 42 * s, 0))
    p.sphere((-0.12, -0.08, 0.14), (0.04, 0.02, 0.05), shine, rot=(0, -30, 0), seg=10, rings=6)
    p.build(root, (0, 0, 0))
    return root


def build_potion():
    glass = mat('Potion_Glass', '#d8f4ff', rough=0.05, alpha=0.35)
    liquid = mat('Potion_Liquid', '#ff3fa0', rough=0.2, emit='#ff3fa0', es=1.5)
    cork = mat('Potion_Cork', '#b07845', rough=0.8)
    shine = mat('Eye_Shine', '#ffffff', rough=0.1, emit='#ffffff', es=3.0)
    root = empty('Potion')
    p = Piece('Potion_Liquid')
    p.sphere((0, 0, 0.2), 0.165, liquid)
    p.build(root, (0, 0, 0))
    g = Piece('Potion_Glass')
    g.sphere((0, 0, 0.2), 0.2, glass)
    g.cone((0, 0, 0.42), 0.07, 0.07, 0.14, glass)
    g.cone((0, 0, 0.51), 0.075, 0.065, 0.08, cork)
    g.sphere((-0.08, -0.14, 0.27), (0.03, 0.015, 0.06), shine, seg=10, rings=6)
    g.build(root, (0, 0, 0))
    return root


def build_characters():
    objs = [build_dino(), build_alien(), build_egg(), build_coin(), build_heart(), build_potion()]
    for i, o in enumerate(objs):
        o.location.x = i * 2.5
    return objs
