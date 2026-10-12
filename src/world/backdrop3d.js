import * as THREE from 'three';
import { fixedView } from './frame.js';
import { lo } from '../quality.js';

// V2 backdrop: the concept painting split into depth layers placed in 3D.
//
//   sky   - sky, moons, smoke column            (far away, 900)
//   far   - the volcano and the mountain range  (~400)
//   mid   - cliffs, pinnacles and waterfalls    (150 -> 55, nearer toward the bottom)
//   near  - the lake, its islands, side cliffs  (a ground plane, 55 -> 30)
//
// Each layer is a grid draped over its own depth surface. Every layer also
// carries filled-in scenery behind the layers in front of it, so when the
// camera drifts and the layers slide against each other there are no holes.
// UFOs and floating islands are separate cut-outs that hover, and animated
// effects (smoke, lava glow, waterfalls, mist, clouds, lake sparkle, UFO beams)
// sit between the layers at their own depths.

const DIR = 'assets/v2/';
const W = 1672, H = 941; // painting size the coordinates below refer to

// cut-out UFOs and floating islands: [name, x0, y0, x1, y1 in the painting, x, y, w, h in the atlas]
const FLOATERS = { AW: 1171, AH: 142, items: [
  ['ufo_big', 1290, 4, 1545, 112, 0, 0, 255, 108],
  ['ufo_r2', 1192, 112, 1300, 182, 258, 0, 108, 70],
  ['ufo_r3', 1560, 104, 1664, 180, 369, 0, 104, 76],
  ['ufo_l', 312, 72, 412, 134, 476, 0, 100, 62],
  ['ufo_s1', 846, 194, 902, 228, 579, 0, 56, 34],
  ['ufo_s2', 746, 266, 822, 314, 638, 0, 76, 48],
  ['isl_l', 166, 62, 256, 164, 717, 0, 90, 102],
  ['isl_2', 400, 146, 520, 266, 810, 0, 120, 120],
  ['isl_c', 708, 108, 846, 250, 933, 0, 138, 142],
  ['isl_r', 1268, 186, 1362, 290, 1074, 0, 94, 104],
] };
// tractor beams under the UFOs: [ufo name, x0, y0, x1, y1]
const BEAMS = [['ufo_big', 1392, 104, 1454, 392], ['ufo_r2', 1230, 172, 1264, 264], ['ufo_l', 350, 126, 374, 206], ['ufo_r3', 1598, 166, 1624, 206], ['ufo_s1', 864, 222, 882, 254]];
// painted waterfalls: [x0, y0, x1, y1, layer]
const FALLS = [
  [206, 428, 280, 602, 'near'], [192, 244, 246, 300, 'near'], [226, 366, 266, 422, 'near'], [430, 450, 476, 502, 'mid'],
  [680, 478, 746, 622, 'mid'], [850, 524, 896, 612, 'mid'], [1060, 654, 1102, 722, 'near'], [1400, 588, 1482, 762, 'near'],
  [1550, 528, 1612, 702, 'near'], [172, 734, 206, 802, 'near'],
];
const CRATER = [1050, 196];

/** View depth of each layer for a painting point (u right, v down, 0..1). */
const DEPTH = {
  sky: () => 900,
  far: (u, v) => 430 - (v - 0.12) * 160,
  mid: (u, v) => THREE.MathUtils.clamp(150 - ((v - 0.2) / 0.52) * 95, 55, 150),
  near: (u, v) => THREE.MathUtils.clamp(23.4 / Math.max(0.026, v - 0.22), 30, 55),
};
const LAYERS = ['sky', 'far', 'mid', 'near'];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const softTex = canvasTex(128, 128, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, w);
});

const cloudTex = canvasTex(256, 128, (g, w, h) => {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 30; i++) {
    const x = w * 0.12 + r() * w * 0.76, y = h * 0.5 + (r() - 0.5) * h * 0.35, rad = 14 + r() * 30;
    const grd = g.createRadialGradient(x, y - rad * 0.3, 2, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.6, 'rgba(240,246,255,0.6)'); grd.addColorStop(1, 'rgba(230,240,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  // fade out toward every edge so the sprite never shows a straight border
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(w / 2, w / 2, w * 0.15, w / 2, w / 2, w / 2);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.setTransform(1, 0, 0, h / w, 0, 0); // squash the circle into an ellipse filling the canvas
  g.fillStyle = fade; g.fillRect(0, 0, w, w);
  g.setTransform(1, 0, 0, 1, 0, 0);
});

const FLOW_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// falling water: bright streaks scrolling down, soft at the sides and the ends
const FALL_FRAG = /* glsl */`
uniform float uTime, uSeed, uLight;
varying vec2 vUv;
float h(float x) { return fract(sin(x * 91.7 + uSeed) * 43758.5); }
void main() {
  float col = floor(vUv.x * 14.0);
  float speed = 0.55 + h(col) * 0.5;
  float y = vUv.y + uTime * speed + h(col + 3.0);
  float streak = smoothstep(0.55, 1.0, sin(y * 18.0 + h(col + 7.0) * 6.0) * 0.5 + 0.5);
  float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
  gl_FragColor = vec4(vec3(uLight), streak * edge * 0.45);
}`;

// UFO tractor beam: a soft column with rings sliding down it
const BEAM_FRAG = /* glsl */`
uniform float uTime, uPulse, uLight;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float rings = smoothstep(0.7, 1.0, sin((vUv.y + uTime * 0.6) * 40.0) * 0.5 + 0.5);
  float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
  float a = (core * core * 0.35 + rings * core * 0.35) * fade * uPulse;
  gl_FragColor = vec4(uColor * uLight, a);
}`;

// drifting mist band
const MIST_FRAG = /* glsl */`
uniform float uTime, uOpacity, uLight;
varying vec2 vUv;
float n(vec2 p) { return sin(p.x * 3.1 + sin(p.y * 2.3)) * 0.5 + sin(p.x * 7.3 - p.y * 1.7) * 0.25; }
void main() {
  vec2 p = vec2(vUv.x * 6.0 + uTime * 0.05, vUv.y * 2.0);
  float body = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.5, vUv.y) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  float a = body * (0.55 + 0.45 * n(p)) * uOpacity;
  gl_FragColor = vec4(vec3(0.94, 0.97, 1.0) * uLight, a);
}`;

export class Backdrop3D {
  /**
   * @param scene   scene to add to
   * @param onReady called once the main layer images have loaded
   * @param onFail  called if a layer image fails to load
   */
  constructor(scene, { onReady, onFail } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.group.visible = false;
    this.time = 0;
    this.light = 1;
    this._key = '';
    let failed = false;
    const manager = new THREE.LoadingManager(
      () => { if (failed) return; this.group.visible = true; this._key = ''; if (onReady) onReady(); },
      undefined,
      (url) => { if (failed) return; failed = true; this.group.visible = false; if (onFail) onFail(url); },
    );
    const loader = new THREE.TextureLoader(manager);
    const tex = (name, srgb = true) => {
      const t = loader.load(DIR + name);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    };

    // painted layers, back to front
    this.layers = LAYERS.map((name, i) => {
      const mat = new THREE.MeshBasicMaterial({ map: tex(name + '.jpg'), fog: false });
      if (name !== 'sky') { mat.alphaMap = tex(name + '_a.png', false); mat.alphaTest = 0.5; }
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -10 + i;
      this.group.add(mesh);
      return { name, mesh, mat };
    });
    // sparkle on the lake: added to the near layer's shader
    this.sparkle = { value: 0 };
    this.layers[3].mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.sparkle;
      sh.fragmentShader = 'uniform float uTime;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float lake = smoothstep(0.3, 0.45, c.b) * smoothstep(0.25, 0.4, c.g) * smoothstep(0.2, 0.08, c.r);
          vec2 q = vMapUv * vec2(520.0, 260.0);
          float s = sin(q.x + uTime * 1.7 + sin(q.y * 0.7 + uTime)) * sin(q.y * 1.3 - uTime * 1.3 + sin(q.x * 0.5));
          float clump = smoothstep(0.2, 0.9, sin(q.x * 0.021 + uTime * 0.21) * sin(q.y * 0.043 - uTime * 0.17) * 0.5 + 0.5);
          float glint = pow(max(s, 0.0), 60.0) * clump * smoothstep(0.62, 0.8, 1.0 - vMapUv.y);
          float wave = 0.04 * sin(q.x * 0.05 + q.y * 0.11 - uTime * 1.2);
          diffuseColor.rgb += lake * (glint * 1.4 + wave) * vec3(0.9, 1.0, 1.0);
        }`);
    };

    // floating cut-outs
    const ftex = tex('floaters.png');
    this.floaterMat = new THREE.MeshBasicMaterial({ map: ftex, transparent: true, depthWrite: false, fog: false, alphaTest: 0.03 });
    this.floaters = FLOATERS.items.map(([name, x0, y0, x1, y1, ax, ay, aw, ah], i) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.floaterMat);
      m.frustumCulled = false;
      m.renderOrder = -3;
      m.userData = { name, rect: [x0, y0, x1, y1], uv: [ax / FLOATERS.AW, 1 - (ay + ah) / FLOATERS.AH, (ax + aw) / FLOATERS.AW, 1 - ay / FLOATERS.AH], ph: i * 1.7, ufo: name.startsWith('ufo') };
      this.group.add(m);
      return m;
    });

    // effects
    this.fx = [];
    // transparent draw order, back to front: clouds and smoke, mist and waterfalls, floaters, beams
    const ORDER = { cloud: -7, smoke: -7, glow: -6, mist: -5, fall: -5, beam: -2 };
    const add = (mesh, kind, data) => { mesh.frustumCulled = false; mesh.renderOrder = ORDER[kind]; mesh.userData = { kind, ...data }; this.fx.push(mesh); return mesh; };
    for (const [ufo, ...rect] of BEAMS) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: FLOW_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPulse: { value: 1 }, uLight: { value: 1 }, uColor: { value: new THREE.Color('#c58cff') } },
      });
      const parent = this.floaters.find((f) => f.userData.name === ufo);
      parent.add(add(new THREE.Mesh(new THREE.BufferGeometry(), mat), 'beam', { rect, ph: rect[0] * 0.01 }));
    }
    FALLS.forEach(([x0, y0, x1, y1, layer], i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: FLOW_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uSeed: { value: i * 3.7 }, uLight: { value: 1 } },
      });
      this.group.add(add(new THREE.Mesh(new THREE.BufferGeometry(), mat), 'fall', { rect: [x0, y0, x1, y1], layer }));
    });
    // mist hiding the seams between layers, and low cloud banks
    for (const [x0, y0, x1, y1, d, op] of [[640, 350, 1420, 430, 260, 0.75], [120, 610, 1600, 700, 60, 0.5], [300, 300, 760, 360, 300, 0.45]]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: FLOW_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: op }, uLight: { value: 1 } },
      });
      this.group.add(add(new THREE.Mesh(new THREE.BufferGeometry(), mat), 'mist', { rect: [x0, y0, x1, y1], d }));
    }
    // clouds drifting across the sky between the moons and the mountains
    for (let i = 0; i < lo(6, 4); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.32 }));
      this.group.add(add(s, 'cloud', { u: i / 6 + 0.05, v: 0.2 + (i % 3) * 0.05, d: 520 + (i % 3) * 120, speed: 0.004 + (i % 2) * 0.003, size: 0.18 + (i % 3) * 0.05 }));
    }
    // volcano: glow in the crater and smoke puffs rolling up the column
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#ff8a2a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    this.group.add(add(this.glow, 'glow', {}));
    for (let i = 0; i < lo(14, 9); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#7a5c66', transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      this.group.add(add(s, 'smoke', { t: i / lo(14, 9), spin: i * 0.7 }));
    }
  }

  /** Rebuild every piece for the current screen shape (the projection depends on it). */
  build(cam) {
    const key = cam.fov.toFixed(2) + '/' + cam.aspect.toFixed(3);
    if (this._key === key) return;
    this._key = key;
    const aspect = cam.aspect;
    const view = fixedView(cam.fov, aspect);
    const pc = new THREE.PerspectiveCamera(cam.fov, aspect, 0.1, 5000);
    pc.position.copy(view.pos);
    pc.lookAt(view.target);
    pc.updateMatrixWorld();
    pc.updateProjectionMatrix();
    const fwd = pc.getWorldDirection(new THREE.Vector3());
    this.f = (window.innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360); // pixels per unit at distance 1
    // cover-crop the painting to the screen; wide screens lose mostly the bottom (behind the floor)
    const ia = W / H;
    let fx = 1, fy = 1, ox = 0, oy = 0;
    if (aspect > ia) { fy = ia / aspect; oy = (1 - fy) * 0.25; } else { fx = aspect / ia; ox = (1 - fx) / 2; }
    const dir = new THREE.Vector3();
    const place = (u, v, d, out = new THREE.Vector3()) => {
      dir.set(((u - ox) / fx) * 2 - 1, 1 - ((v - oy) / fy) * 2, 0.5).unproject(pc).sub(pc.position).normalize();
      return out.copy(pc.position).addScaledVector(dir, d / dir.dot(fwd));
    };
    this.place = place;
    // a quad covering painting rect [x0, y0, x1, y1] at depth d (or d(u, v) per corner)
    const quad = (mesh, [x0, y0, x1, y1], d, uv = [0, 0, 1, 1]) => {
      const u0 = x0 / W, u1 = x1 / W, v0 = y0 / H, v1 = y1 / H;
      const dd = typeof d === 'function' ? d : () => d;
      const c = [[u0, v1], [u1, v1], [u0, v0], [u1, v0]].map(([u, v]) => place(u, v, dd(u, v)));
      const g = mesh.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.flatMap((q) => [q.x, q.y, q.z])), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([uv[0], uv[1], uv[2], uv[1], uv[0], uv[3], uv[2], uv[3]]), 2));
      g.setIndex([0, 1, 2, 2, 1, 3]);
    };

    // layers
    const NX = lo(120, 80), NY = lo(68, 46), M = 0.03;
    for (const L of this.layers) {
      const depth = DEPTH[L.name];
      const pos = new Float32Array((NX + 1) * (NY + 1) * 3), uv = new Float32Array((NX + 1) * (NY + 1) * 2);
      const p = new THREE.Vector3();
      let k = 0;
      for (let j = 0; j <= NY; j++) {
        const v = -M + (j / NY) * (1 + 2 * M);
        for (let i = 0; i <= NX; i++) {
          const u = -M + (i / NX) * (1 + 2 * M);
          place(u, v, depth(u, v), p);
          pos.set([p.x, p.y, p.z], k * 3);
          uv.set([u, 1 - v], k * 2);
          k++;
        }
      }
      const idx = [];
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = L.mesh.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
    }
    // floaters hover in front of the far mountains
    for (const m of this.floaters) {
      const d = m.userData.name === 'ufo_big' ? 240 : m.userData.ufo ? 300 : 330;
      quad(m, m.userData.rect, d, m.userData.uv);
      m.userData.d = d;
      m.userData.amp = d * 0.006;
    }
    for (const m of this.fx) {
      const u = m.userData;
      if (u.kind === 'beam') {
        const parent = this.floaters.find((f) => f.children.includes(m));
        quad(m, u.rect, parent.userData.d + 1);
      } else if (u.kind === 'fall') {
        quad(m, u.rect, (a, b) => DEPTH[u.layer](a, b) - 0.5);
      } else if (u.kind === 'mist') {
        quad(m, u.rect, u.d);
      }
    }
    // a little in front of the volcano everywhere, so its slopes never clip the smoke and glow
    this.crater = place(CRATER[0] / W, CRATER[1] / H, 365);
    this.glow.position.copy(this.crater);
    this.glow.scale.setScalar(62);
    this.smokeTop = place((CRATER[0] - 90) / W, 0.0, 365);
    this.unitsPerU = place(1, 0.2, 600).x - place(0, 0.2, 600).x; // width of the painting at depth 600
  }

  setLight(l) {
    this.light = l;
    for (const L of this.layers) L.mat.color.setScalar(l);
    this.floaterMat.color.setScalar(l);
    for (const m of this.fx) {
      if (m.material.uniforms && m.material.uniforms.uLight) m.material.uniforms.uLight.value = l;
      else if (m.userData.kind === 'cloud') m.material.color.setScalar(l);
    }
  }

  update(dt, cam) {
    this.build(cam);
    if (!this.place) return;
    const t = (this.time += dt);
    this.sparkle.value = t;
    for (const m of this.floaters) {
      const d = m.userData;
      m.position.y = Math.sin(t * (d.ufo ? 0.9 : 0.5) + d.ph) * d.amp;
      m.position.x = d.ufo ? Math.sin(t * 0.35 + d.ph) * d.amp * 1.5 : 0;
      m.rotation.z = d.ufo ? Math.sin(t * 0.7 + d.ph) * 0.004 : 0;
    }
    for (const m of this.fx) {
      const u = m.userData;
      if (u.kind === 'beam') {
        m.material.uniforms.uTime.value = t;
        m.material.uniforms.uPulse.value = 0.75 + 0.25 * Math.sin(t * 3 + u.ph);
      } else if (u.kind === 'fall' || u.kind === 'mist') {
        m.material.uniforms.uTime.value = t;
      } else if (u.kind === 'cloud') {
        u.u += u.speed * dt;
        if (u.u > 1.15) u.u = -0.15;
        this.place(u.u, u.v, u.d, m.position);
        const s = this.unitsPerU * u.size * (u.d / 600);
        m.scale.set(s, s * 0.45, 1);
      } else if (u.kind === 'smoke') {
        u.t = (u.t + dt * 0.045) % 1;
        const k = u.t;
        m.position.lerpVectors(this.crater, this.smokeTop, k);
        m.position.x += Math.sin(k * 7 + u.spin) * 6;
        const s = 27 + k * 60;
        m.scale.setScalar(s);
        m.material.opacity = Math.sin(k * Math.PI) * 0.28;
        m.material.rotation = u.spin + k * 1.5;
      } else if (u.kind === 'glow') {
        m.material.opacity = 0.42 + Math.sin(t * 2.3) * 0.12 + Math.sin(t * 6.1) * 0.06;
      }
    }
  }
}
