import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Point-sprite particle system. Shapes are drawn procedurally in the shader:
// 0 soft glow, 1 star, 2 confetti rect, 3 ring, 4 solid disc (smoke / dust)
// ---------------------------------------------------------------------------
export const SHAPE = { GLOW: 0, STAR: 1, CONFETTI: 2, RING: 3, DISC: 4, LEAF: 5 };

const VERT = /* glsl */`
attribute float size;
attribute vec4 color;
attribute float shape;
attribute float rot;
uniform float uScale;
varying vec4 vColor;
varying float vShape;
varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  vColor = color; vShape = shape; vRot = rot;
}`;

const FRAG = /* glsl */`
varying vec4 vColor;
varying float vShape;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vRot), s = sin(vRot);
  p = mat2(c, -s, s, c) * p;
  float d = length(p);
  float a = 0.0;
  if (vShape < 0.5) {
    a = 1.0 - smoothstep(0.0, 1.0, d);
    a = a * a;
  } else if (vShape < 1.5) {
    // guard atan(0,0) and pow(negative) — both yield NaN on D3D/ANGLE, and a
    // single NaN pixel gets smeared across the whole screen by the bloom pass
    float ang = atan(p.y, abs(p.x) < 1e-4 && abs(p.y) < 1e-4 ? 1.0 : p.x);
    float lobe = max(0.0, 0.5 + 0.5 * cos(ang * 5.0));
    float k = 0.38 + 0.62 * lobe * lobe * lobe;
    a = 1.0 - smoothstep(k * 0.82, k, d);
    a = max(a, (1.0 - smoothstep(0.0, 0.5, d)) * 0.8);
  } else if (vShape < 2.5) {
    a = step(abs(p.x), 0.85) * step(abs(p.y), 0.42);
  } else if (vShape < 3.5) {
    a = 1.0 - smoothstep(0.0, 0.14, abs(d - 0.8));
  } else if (vShape < 4.5) {
    a = 1.0 - smoothstep(0.78, 1.0, d);
  } else {
    // leaf: pointed ellipse with a darker midrib
    float w = 0.42 * (1.0 - p.x * p.x);
    a = (1.0 - smoothstep(w - 0.06, w, abs(p.y))) * step(abs(p.x), 0.98);
    a *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.05, abs(p.y)));
  }
  a = clamp(a, 0.0, 1.0) * clamp(vColor.a, 0.0, 1.0);
  if (!(a >= 0.01)) discard;
  gl_FragColor = vec4(max(vColor.rgb, vec3(0.0)), a);
}`;

class ParticleSystem {
  constructor(scene, capacity, blending) {
    this.cap = capacity;
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.siz = new Float32Array(capacity);
    this.shp = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('shape', new THREE.BufferAttribute(this.shp, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 } },
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 20 : 10;
    scene.add(this.points);
    // simulation state (struct of arrays)
    const F = (k = 1) => new Float32Array(capacity * k);
    this.p = F(3); this.v = F(3); this.life = F(); this.max = F();
    this.s0 = F(); this.s1 = F(); this.c = F(4); this.a1 = F();
    this.grav = F(); this.drag = F(); this.shape = F(); this.r = F(); this.rv = F();
  }

  spawn(o) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z || 0;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    this.life[i] = this.max[i] = o.life;
    this.s0[i] = o.size; this.s1[i] = o.sizeEnd ?? 0;
    this.c[i * 4] = o.r; this.c[i * 4 + 1] = o.g; this.c[i * 4 + 2] = o.b; this.c[i * 4 + 3] = o.a ?? 1;
    this.a1[i] = o.alphaEnd ?? 0;
    this.grav[i] = o.gravity || 0; this.drag[i] = o.drag || 0;
    this.shape[i] = o.shape || 0; this.r[i] = o.rot ?? Math.random() * 6.28; this.rv[i] = o.spin || 0;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      const dk = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3] *= dk; this.v[i * 3 + 1] = this.v[i * 3 + 1] * dk - this.grav[i] * dt; this.v[i * 3 + 2] *= dk;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.r[i] += this.rv[i] * dt;
      i++;
    }
    for (let j = 0; j < this.n; j++) {
      const t = 1 - this.life[j] / this.max[j];
      this.pos[j * 3] = this.p[j * 3]; this.pos[j * 3 + 1] = this.p[j * 3 + 1]; this.pos[j * 3 + 2] = this.p[j * 3 + 2];
      this.siz[j] = this.s0[j] + (this.s1[j] - this.s0[j]) * t;
      this.col[j * 4] = this.c[j * 4]; this.col[j * 4 + 1] = this.c[j * 4 + 1]; this.col[j * 4 + 2] = this.c[j * 4 + 2];
      const a0 = this.c[j * 4 + 3];
      this.col[j * 4 + 3] = a0 + (this.a1[j] - a0) * t * t;
      this.shp[j] = this.shape[j];
      this.rot[j] = this.r[j];
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'shape', 'rot']) this.geo.attributes[k].needsUpdate = true;
  }

  _kill(i) {
    const l = --this.n;
    if (i === l) return;
    const cp = (arr, k) => { for (let q = 0; q < k; q++) arr[i * k + q] = arr[l * k + q]; };
    cp(this.p, 3); cp(this.v, 3); cp(this.c, 4);
    for (const arr of [this.life, this.max, this.s0, this.s1, this.a1, this.grav, this.drag, this.shape, this.r, this.rv]) arr[i] = arr[l];
  }

  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

// ---------------------------------------------------------------------------
// Instanced 3D shards (egg shell fragments, rock chips).
// ---------------------------------------------------------------------------
class Shards {
  constructor(scene, cap = 500) {
    const geo = new THREE.TetrahedronGeometry(1, 0);
    geo.scale(1, 0.35, 0.8);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0, vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    this.cap = cap;
    this.list = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  spawn(o) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({
      x: o.x, y: o.y, z: o.z || 0, vx: o.vx, vy: o.vy, vz: o.vz || 0,
      rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
      sx: (Math.random() - 0.5) * 20, sy: (Math.random() - 0.5) * 20, sz: (Math.random() - 0.5) * 20,
      size: o.size, life: o.life, max: o.life, color: new THREE.Color(o.color), floor: o.floor ?? -100,
    });
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const s = L[i];
      s.life -= dt;
      if (s.life <= 0) { L.splice(i, 1); continue; }
      s.vy -= 30 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < s.floor && s.vy < 0) { s.y = s.floor; s.vy *= -0.4; s.vx *= 0.6; s.vz *= 0.6; s.sx *= 0.5; s.sz *= 0.5; }
      s.rx += s.sx * dt; s.ry += s.sy * dt; s.rz += s.sz * dt;
    }
    const n = Math.min(L.length, this.cap);
    for (let i = 0; i < n; i++) {
      const s = L[i];
      const k = Math.min(1, s.life / (s.max * 0.3));
      this._p.set(s.x, s.y, s.z);
      this._q.setFromEuler(this._e.set(s.rx, s.ry, s.rz));
      this._s.setScalar(s.size * k);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, s.color);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.list.length = 0; this.mesh.count = 0; }
}

// ---------------------------------------------------------------------------
// Expanding shockwave rings
// ---------------------------------------------------------------------------
class Rings {
  // Meshes and materials are pooled rather than disposed: disposing the last
  // material that uses a shader program deletes the program, which would force
  // a recompile (a visible stall on D3D) the next time a ring appears.
  constructor(scene) {
    this.scene = scene;
    this.geos = new Map();
    this.pool = [];
    this.list = [];
  }

  _geo(width) {
    const k = Math.round(width * 10);
    if (!this.geos.has(k)) this.geos.set(k, new THREE.RingGeometry(1 - 0.18 * (k / 10), 1, 48));
    return this.geos.get(k);
  }

  spawn({ x, y, z = 0.2, color = 0xffffff, size = 3, life = 0.4, flat = false, width = 1 }) {
    const m = this.pool.pop() || new THREE.Mesh(this._geo(1), new THREE.MeshBasicMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.geometry = this._geo(width);
    m.material.color.set(color);
    m.material.opacity = 1;
    m.position.set(x, y, z);
    m.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    m.scale.setScalar(0.1);
    m.renderOrder = 25;
    this.scene.add(m);
    this.list.push({ m, t: 0, life, size });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        this.scene.remove(r.m);
        this.pool.push(r.m);
        this.list.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      r.m.scale.setScalar(0.1 + e * r.size);
      r.m.material.opacity = 1 - k;
    }
  }

  clear() { for (const r of this.list) { this.scene.remove(r.m); this.pool.push(r.m); } this.list.length = 0; }
}

// ---------------------------------------------------------------------------
// Floating DOM text anchored to world positions
// ---------------------------------------------------------------------------
class Popups {
  constructor(container) {
    this.root = container;
    this.list = [];
    this._v = new THREE.Vector3();
  }

  spawn(text, x, y, cls = '', life = 1.0, rise = 1.6) {
    const el = document.createElement('div');
    el.className = 'popup ' + cls;
    el.textContent = text;
    this.root.appendChild(el);
    this.list.push({ el, x, y, z: 0.5, t: 0, life, rise });
  }

  update(dt, camera, w, h) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { p.el.remove(); this.list.splice(i, 1); continue; }
      const ease = 1 - Math.pow(1 - Math.min(1, k * 2.2), 3);
      this._v.set(p.x, p.y + ease * p.rise, p.z).project(camera);
      const sx = (this._v.x * 0.5 + 0.5) * w;
      const sy = (-this._v.y * 0.5 + 0.5) * h;
      const pop = k < 0.12 ? 0.4 + (k / 0.12) * 0.9 : k < 0.2 ? 1.3 - ((k - 0.12) / 0.08) * 0.3 : 1;
      p.el.style.transform = `translate(-50%, -50%) translate(${sx}px, ${sy}px) scale(${pop})`;
      p.el.style.opacity = k > 0.7 ? String(1 - (k - 0.7) / 0.3) : '1';
    }
  }

  clear() { for (const p of this.list) p.el.remove(); this.list.length = 0; }
}

// ---------------------------------------------------------------------------
// FX facade: presets for the game's juicy moments.
// ---------------------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
const TMP = new THREE.Color();

export class FX {
  constructor(scene, popupRoot) {
    this.add = new ParticleSystem(scene, 5000, THREE.AdditiveBlending);
    this.norm = new ParticleSystem(scene, 3000, THREE.NormalBlending);
    this.shards = new Shards(scene);
    this.rings = new Rings(scene);
    this.popups = new Popups(popupRoot);
    this.trauma = 0;
    this.shakeTime = 0;
    this.shakeOffset = new THREE.Vector3();
    this.shakeRoll = 0;
  }

  setViewport(h, fovDeg) {
    const s = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.add.mat.uniforms.uScale.value = s;
    this.norm.mat.uniforms.uScale.value = s;
  }

  shake(t) { this.trauma = Math.min(1.2, this.trauma + t); if (this.onShake) this.onShake(t); }

  updateShake(dt) {
    this.shakeTime += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    const t = this.shakeTime * 32;
    const n = (a) => Math.sin(t * 1.0 + a) * 0.5 + Math.sin(t * 2.3 + a * 3.1) * 0.3 + Math.sin(t * 4.7 + a * 1.7) * 0.2;
    this.shakeOffset.set(n(0) * 0.9 * s, n(10) * 0.9 * s, 0);
    this.shakeRoll = n(20) * 0.05 * s;
  }

  update(dt) {
    this.add.update(dt);
    this.norm.update(dt);
    this.shards.update(dt);
    this.rings.update(dt);
  }

  clear() {
    this.add.clear(); this.norm.clear(); this.shards.clear(); this.rings.clear(); this.popups.clear();
  }

  // ---- presets --------------------------------------------------------
  _col(c) { return TMP.set(c); }

  burst(x, y, { count = 20, color = '#ffffff', colors = null, speed = [3, 8], size = [0.2, 0.5], life = [0.3, 0.7], gravity = 0, drag = 2, shape = SHAPE.GLOW, additive = true, z = 0.3, spread = Math.PI * 2, angle = 0, sizeEnd = 0, alpha = 1, spin = 0, zs = 0 } = {}) {
    const sys = additive ? this.add : this.norm;
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const sp = rand(speed[0], speed[1]);
      const c = this._col(colors ? colors[(Math.random() * colors.length) | 0] : color);
      const sz = rand(size[0], size[1]);
      sys.spawn({
        x, y, z: z + (Math.random() - 0.5) * zs, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * sp * 0.5,
        life: rand(life[0], life[1]), size: sz, sizeEnd: sizeEnd * sz, r: c.r, g: c.g, b: c.b, a: alpha, alphaEnd: 0,
        gravity, drag, shape, spin: (Math.random() - 0.5) * spin,
      });
    }
  }

  sparks(x, y, color = '#ffe066', n = 18, power = 1) {
    this.burst(x, y, { count: n, color, speed: [5 * power, 13 * power], size: [0.12, 0.28], life: [0.2, 0.5], drag: 3, gravity: 8, sizeEnd: 0.2 });
  }

  stars(x, y, n = 8, colors = ['#fff6a8', '#ffd23a', '#ffffff']) {
    this.burst(x, y, { count: n, colors, speed: [3, 7], size: [0.4, 0.8], life: [0.4, 0.8], drag: 2.5, gravity: 4, shape: SHAPE.STAR, spin: 10, sizeEnd: 0.2 });
  }

  glow(x, y, color = '#ffffff', size = 3, life = 0.25, z = 0.4) {
    const c = this._col(color);
    this.add.spawn({ x, y, z, life, size, sizeEnd: size * 1.6, r: c.r, g: c.g, b: c.b, a: 1, alphaEnd: 0, shape: SHAPE.GLOW });
  }

  dust(x, y, n = 8, dir = 0) {
    for (let i = 0; i < n; i++) {
      const s = rand(0.25, 0.5);
      const c = this._col('#e8dcc0');
      this.norm.spawn({
        x: x + rand(-0.3, 0.3), y: y + 0.05, z: rand(-0.3, 0.5), vx: (dir || (Math.random() - 0.5) * 2) * rand(1, 3.5), vy: rand(0.4, 1.8), vz: rand(-0.5, 0.5),
        life: rand(0.35, 0.6), size: s, sizeEnd: s * 2.2, r: c.r, g: c.g, b: c.b, a: 0.55, alphaEnd: 0, drag: 3, shape: SHAPE.DISC,
      });
    }
  }

  smoke(x, y, n = 10, color = '#ffffff', spread = 1, size = [0.6, 1.2], life = [0.6, 1.1]) {
    for (let i = 0; i < n; i++) {
      const s = rand(size[0], size[1]);
      const c = this._col(color);
      const a = Math.random() * Math.PI * 2;
      const sp = rand(1, 4) * spread;
      this.norm.spawn({
        x, y, z: rand(-0.3, 0.6), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 0.8, vz: rand(-1, 1),
        life: rand(life[0], life[1]), size: s, sizeEnd: s * 2.4, r: c.r, g: c.g, b: c.b, a: 0.7, alphaEnd: 0, drag: 2.5, shape: SHAPE.DISC,
      });
    }
  }

  confetti(x, y, n = 40, power = 1) {
    const colors = ['#ff3f7a', '#ffd23a', '#6c5cf5', '#3ad8ff', '#7cff5a', '#ff8a1c', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const c = this._col(colors[(Math.random() * colors.length) | 0]);
      const a = Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = rand(6, 15) * power;
      this.norm.spawn({
        x, y, z: rand(-0.5, 1.5), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(-2, 2),
        life: rand(1.2, 2.2), size: rand(0.18, 0.3), sizeEnd: 0.15, r: c.r, g: c.g, b: c.b, a: 1, alphaEnd: 0.6,
        gravity: 9, drag: 2.2, shape: SHAPE.CONFETTI, spin: (Math.random() - 0.5) * 20,
      });
    }
  }

  shell(x, y, n = 14, power = 1, floor = -100) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(3, 9) * power;
      this.shards.spawn({
        x: x + rand(-0.3, 0.3), y: y + rand(-0.3, 0.3), z: rand(-0.3, 0.3),
        vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a)) * sp + 3, vz: rand(-3, 3),
        size: rand(0.08, 0.18), life: rand(0.9, 1.5), color: Math.random() < 0.25 ? '#9a4cff' : '#fffaf0', floor,
      });
    }
  }

  ring(x, y, color = '#ffffff', size = 3, life = 0.4, width = 1) {
    this.rings.spawn({ x, y, color, size, life, width });
  }

  text(t, x, y, cls = '', life = 1.0, rise = 1.6) { this.popups.spawn(t, x, y, cls, life, rise); }
}
