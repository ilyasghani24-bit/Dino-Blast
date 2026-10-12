import * as THREE from 'three';
import * as A from '../assets.js';

// 20 columns x 14 rows. Row 13 is the floor (top y = 0). Platforms sit on rows
// 1/4/7/10 (tops y = 12/9/6/3). Markers stand on the tile row below them.
//   #  platform     P player    a basic alien   j jumper   s shooter   B boss
// pillars: solid stone columns standing in the walking lane, [column, base y, height].
// They block players, aliens, eggs and shots, and their tops can be stood on.
// Layouts follow the concept art: staggered, asymmetric ledges of different
// lengths, linked by overlaps so every ledge is one jump from another.
export const STAGES = [
  {
    name: 'JUNGLE DAWN', theme: 0,
    map: [
      '     a              ',
      '  ##########        ',
      '                    ',
      '              j     ',
      '           ######   ',
      '                    ',
      '         a      a   ',
      '        #####  #### ',
      '                    ',
      '   a                ',
      ' #########     #### ',
      '                    ',
      '         P          ',
      '####################',
    ],
    pillars: [[2, 12, 2], [6, 3, 2], [16, 9, 2]],
  },
  {
    name: 'CANOPY CLIMB', theme: 1,
    map: [
      '   a          j     ',
      ' ######    #######  ',
      '                    ',
      '        j           ',
      '     ########       ',
      '                    ',
      ' a             a    ',
      '####   ####   ######',
      '                    ',
      '    a      a        ',
      '  ##########    ### ',
      '                    ',
      '         P          ',
      '####################',
    ],
    pillars: [[1, 12, 2], [17, 12, 2], [19, 6, 2], [7, 3, 2]],
  },
  {
    name: 'WATERFALL RUINS', theme: 2,
    map: [
      '                    ',
      '                    ',
      '                    ',
      ' s       a       s  ',
      '#######  ####  #####',
      '                    ',
      '     j        j     ',
      '   ######   ######  ',
      '                    ',
      'a        s         a',
      '####  ########  ####',
      '                    ',
      '         P          ',
      '####################',
    ],
    pillars: [[0, 9, 2], [19, 9, 2], [11, 3, 2]],
  },
  {
    name: 'VOLCANO RIM', theme: 3,
    map: [
      '  j              j  ',
      ' ####          #### ',
      '                    ',
      '      s   s         ',
      '   #########   #### ',
      '                    ',
      ' a             a    ',
      '#####    ###  ######',
      '                    ',
      '     j       j      ',
      '   #####   #####    ',
      '                    ',
      '         P          ',
      '####################',
    ],
    pillars: [[1, 12, 2], [18, 12, 2], [10, 6, 3]],
  },
  {
    name: 'THE MOTHERSHIP', theme: 4, boss: true,
    map: [
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '###    ######    ###',
      '                    ',
      '                    ',
      '   #####    #####   ',
      '                    ',
      '                    ',
      '###    ######    ###',
      '                    ',
      '  a      P       a  ',
      '####################',
    ],
    pillars: [[1, 9, 2], [18, 9, 2]],
  },
];

export const COLS = 20, ROWS = 14;
export const ARENA = { x0: -10, x1: 10, top: 14.5 };

export class Level {
  constructor(stage) {
    this.stage = stage;
    this.segments = [];
    this.spawns = [];
    this.player = { x: 0, y: 0 };
    const map = stage.map;
    for (let r = 0; r < ROWS; r++) {
      const row = map[r] || '';
      let c = 0;
      while (c < COLS) {
        const ch = row[c] || ' ';
        if (ch === '#') {
          let e = c;
          while (e + 1 < COLS && row[e + 1] === '#') e++;
          this.segments.push({ x0: c - 10, x1: e + 1 - 10, y: ROWS - 1 - r, floor: r === ROWS - 1, c0: c, c1: e });
          c = e + 1;
          continue;
        }
        const x = c - 9.5, y = ROWS - 2 - r;
        if (ch === 'P') this.player = { x, y };
        else if ('ajs'.includes(ch)) this.spawns.push({ type: { a: 'basic', j: 'jumper', s: 'shooter' }[ch], x, y });
        c++;
      }
    }
    // solid pillars: a wall box in the lane, plus a standable top
    this.walls = [];
    for (const [c, y, h] of stage.pillars || []) {
      const w = { x0: c - 10, x1: c - 9, y0: y, y1: y + h };
      this.walls.push(w);
      if (!this.segments.some((s) => !s.floor && Math.abs(s.y - w.y1) < 0.01 && s.x0 <= w.x0 && s.x1 >= w.x1)) {
        this.segments.push({ x0: w.x0, x1: w.x1, y: w.y1, floor: false, pillar: true, c0: c, c1: c });
      }
    }
  }

  /** Solid pillar containing the point (x, y), if any. */
  wallAt(x, y, r = 0) {
    for (const w of this.walls) if (x + r > w.x0 && x - r < w.x1 && y + r > w.y0 && y - r < w.y1) return w;
    return null;
  }

  /**
   * Push a body {x, y, hw, h} out of the pillars after it moved from (px, py).
   * Returns -1/1 when it hit a pillar side (like the arena walls), else 0.
   */
  collideWalls(b, px, py) {
    let hit = 0;
    const h = b.h || 1;
    for (const w of this.walls) {
      if (!(b.x + b.hw > w.x0 && b.x - b.hw < w.x1 && b.y < w.y1 && b.y + h > w.y0)) continue;
      if (py >= w.y1 - 0.06) continue; // coming down onto the top: the landing test handles it
      if (py + h <= w.y0 + 0.06 && b.vy > 0) { b.y = w.y0 - h; b.vy = 0; continue; } // head bump
      if (px <= (w.x0 + w.x1) / 2) { b.x = w.x0 - b.hw; hit = 1; } else { b.x = w.x1 + b.hw; hit = -1; }
    }
    return hit;
  }

  /** One-way landing test for an entity that moved from prevY to y this frame. */
  land(x, hw, prevY, y, ignorePlatforms = false) {
    let best = null;
    for (const s of this.segments) {
      if (ignorePlatforms && !s.floor) continue;
      if (x + hw * 0.7 <= s.x0 || x - hw * 0.7 >= s.x1) continue;
      if (prevY >= s.y - 0.001 && y <= s.y && (best === null || s.y > best)) best = s.y;
    }
    return best;
  }

  /** Is there ground at (x, y)? Used by AI for edge detection. */
  groundAt(x, y) {
    for (const s of this.segments) if (Math.abs(s.y - y) < 0.06 && x > s.x0 && x < s.x1) return s;
    return null;
  }

  /** Platform reachable above (for AI jumps). */
  platformAbove(x, y, minDy = 1.5, maxDy = 3.4) {
    for (const s of this.segments) {
      const dy = s.y - y;
      if (dy > minDy && dy < maxDy && x > s.x0 + 0.3 && x < s.x1 - 0.3) return s;
    }
    return null;
  }

  /** Build the visual platforms (merged into a few meshes). */
  buildMeshes() {
    const raw = new THREE.Group();
    const rnd = mulberry(this.stage.name.length * 977);
    const pick = (arr) => arr[(rnd() * arr.length) | 0];
    const range = (a, b) => a + rnd() * (b - a);
    const BLOCKS = ['BlockA', 'BlockB', 'BlockC', 'BlockD', 'BlockE', 'BlockV', 'BlockV2', 'BlockA', 'BlockC', 'BlockV'];
    const FLOOR = ['BlockA', 'BlockB', 'BlockC', 'BlockE'];
    const BOULDERS = ['Boulder1', 'Boulder2', 'Boulder3'];
    // every placed piece gets its own depth, tilt, offset and mirroring, so a
    // row of tiles never reads as one stamped, ruler-straight strip
    const vary = (o, k = 1) => {
      if (rnd() < 0.5) o.scale.x *= -1;
      o.scale.y *= 1 + (rnd() - 0.3) * 0.55 * k; // deeper or shallower; the top stays on the walk line
      o.scale.z *= 1 + (rnd() - 0.5) * 0.14 * k;
      o.position.y += (rnd() - 0.5) * 0.045 * k;
      o.position.z += (rnd() - 0.5) * 0.16 * k;
      o.rotation.y = (rnd() - 0.5) * 0.09 * k;
      o.rotation.z = (rnd() - 0.5) * 0.04 * k;
      return o;
    };
    const boulder = (x, y, z, s, name = pick(BOULDERS)) => {
      const b = A.clone(name);
      b.position.set(x, y, z);
      b.scale.set(s * range(0.85, 1.2), s * range(0.8, 1.15), s * range(0.85, 1.15));
      b.rotation.set(range(-0.3, 0.3), rnd() * 6.28, range(-0.25, 0.25));
      raw.add(b);
    };
    for (const s of this.segments) {
      if (s.pillar) continue;
      for (let c = s.c0; c <= s.c1; c++) {
        const x = c - 9.5;
        if (s.floor && c >= 7 && c <= 12) {
          // rope bridge section of the floor
          for (let k = 0; k < 2; k++) {
            const p = A.clone('Plank');
            p.position.set(x - 0.25 + k * 0.5, s.y, 0);
            p.rotation.z = (rnd() - 0.5) * 0.06;
            p.rotation.y = (rnd() - 0.5) * 0.08;
            p.scale.set(1.15, 1, 1.25 + (rnd() - 0.5) * 0.15);
            raw.add(p);
          }
          continue;
        }
        const b = vary(A.clone(s.floor ? pick(FLOOR) : pick(BLOCKS)), s.floor ? 0.7 : 1);
        b.position.x += x;
        b.position.y += s.y;
        raw.add(b);
        if (s.floor) {
          const deep = vary(A.clone(pick(FLOOR)), 1.2);
          deep.position.x += x;
          deep.position.y += s.y - 0.8;
          deep.position.z += 0.1;
          deep.scale.multiply(new THREE.Vector3(1, 1.2, 1.05));
          raw.add(deep);
        }
      }
      if (!s.floor) {
        for (const [ex, side] of [[s.x1, 1], [s.x0, -1]]) {
          const cap = vary(A.clone(rnd() < 0.5 ? 'BlockCap' : 'BlockCap2'), 0.8);
          cap.scale.x = Math.abs(cap.scale.x) * side;
          cap.position.x += ex;
          cap.position.y += s.y;
          raw.add(cap);
          // a chunky boulder often props up the end of a ledge
          if (rnd() < 0.55) boulder(ex - side * range(0.1, 0.4), s.y - range(0.75, 1.0), range(-0.4, 0.1), range(0.38, 0.55));
        }
        // loose boulders wedged under the ledge break up its bottom edge
        const n = 1 + Math.floor((s.x1 - s.x0) / 2.6);
        for (let i = 0; i < n; i++) {
          boulder(range(s.x0 + 0.5, s.x1 - 0.5), s.y - range(0.72, 1.0), range(-0.45, 0.15), range(0.28, 0.5));
        }
      }
    }
    // the floor: boulders along the waterline and flanking the bridge
    for (const x of [-3.5, 3.5]) boulder(x + range(-0.15, 0.15), -0.95, range(1.1, 1.3), range(0.55, 0.7), 'Boulder3');
    for (let i = 0; i < 8; i++) {
      const x = range(-9.5, 9.5);
      if (Math.abs(x) < 4) continue;
      boulder(x, range(-1.8, -1.45), range(1.15, 1.6), range(0.4, 0.7));
    }
    // stone pillars behind the walking lane, crowned with grass
    for (const [c, y, h] of this.stage.pillars || []) {
      const px = c - 9.5;
      for (let k = 0; k < h; k++) {
        const p = A.clone(rnd() < 0.5 ? 'Pillar' : 'Pillar2');
        p.position.set(px + range(-0.03, 0.03), y - 0.1 + k * 1.03, range(-0.05, 0.05));
        p.rotation.y = range(-0.08, 0.08);
        p.scale.set((rnd() < 0.5 ? -1 : 1) * range(1.0, 1.06), 1.03, range(1.6, 1.75));
        raw.add(p);
      }
      const cap = A.clone('PillarCap');
      cap.position.set(px, y + h - 0.05, 0);
      cap.rotation.y = range(-0.1, 0.1);
      cap.scale.set(1, 1, 1.55);
      raw.add(cap);
    }
    // plants along the back edge of the ledges, in uneven clumps
    const PLANTS = [['Fern', 0.36, 0.6], ['Bush', 0.7, 1.1], ['Bush2', 0.7, 1.1], ['RedLeaf', 0.32, 0.5], ['Flower', 0.8, 1.3], ['FlowerRed', 0.8, 1.3]];
    for (const s of this.segments) {
      if (s.pillar) continue;
      const n = s.floor ? 7 : Math.max(1, Math.round((s.x1 - s.x0) / 2.6));
      for (let i = 0; i < n; i++) {
        const x = s.x0 + 0.4 + rnd() * (s.x1 - s.x0 - 0.8);
        if (s.floor && x > -3.2 && x < 3.2) continue;
        for (let k = 0; k < (rnd() < 0.4 ? 2 : 1); k++) {
          const [name, s0, s1] = pick(PLANTS);
          const f = A.clone(name);
          f.scale.setScalar(range(s0, s1));
          f.position.set(x + (k ? range(-0.5, 0.5) : 0), s.y, -0.66 - rnd() * 0.28);
          f.rotation.y = (rnd() - 0.5) * 1.4;
          raw.add(f);
        }
      }
    }
    const merged = A.mergeStatic(raw);
    // bridge ropes
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xd9b77a, roughness: 0.9 });
    for (const z of [-0.95, 0.95]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push(new THREE.Vector3(-3 + t * 6, 0.35 - Math.sin(t * Math.PI) * 0.25, z));
      }
      const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.035, 6), ropeMat);
      rope.castShadow = true;
      merged.add(rope);
      for (const x of [-3, 3]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x6e4424, roughness: 0.9 }));
        post.position.set(x, 0.25, z);
        post.castShadow = true;
        merged.add(post);
      }
    }
    return merged;
  }
}

export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
