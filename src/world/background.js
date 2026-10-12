import * as THREE from 'three';
import * as A from '../assets.js';
import { mulberry } from './level.js';
import { applyDetail } from './detail.js';
import { LOW, lo } from '../quality.js';
import { Grass } from './grass.js';
import { Backdrop3D } from './backdrop3d.js';
import { pbrMaterial } from './pbr.js';
import { displace, fbm3, facet, dripRing } from './noise.js';

// Painted 3D backdrop (assets/v2/, see backdrop3d.js) instead of the procedural 3D scenery.
// Set to false to bring back the 3D sky, mountains, volcano, UFOs and lake.
export const PAINTED_BACKDROP = true;
// per-theme brightness of the painting: day, day, afternoon, sunset, alien night
const BACKDROP_LIGHT = [1, 1, 0.95, 0.72, 0.38];

const CLOUD_AMOUNT = [0.45, 0.4, 0.3, 0.55, 0.4];

// grade: 0 = pure HDRI sky, 1 = procedural gradient. env: IBL intensity.
export const THEMES = [
  { // morning
    top: '#1352d0', mid: '#3f9cff', hor: '#9fd4ff', fog: '#a8d0f0', sun: '#fff2dc', sunI: 2.5, hemiSky: '#d6ecff', hemiGround: '#8a7a5a', hemiI: 0.25,
    water: ['#0a7aa0', '#28d4dc'], rim: '#bfe0ff', stars: 0, grade: 0.85, skyExp: 1.0, skyTint: '#ffffff', env: 1.0,
  },
  { // bright day
    top: '#155ad6', mid: '#5aaeff', hor: '#d4eeff', fog: '#b4d4ee', sun: '#ffffff', sunI: 2.8, hemiSky: '#dcefff', hemiGround: '#8a7a5a', hemiI: 0.25,
    water: ['#0a7298', '#26ccd8'], rim: '#cfe8ff', stars: 0, grade: 0.55, skyExp: 1.1, skyTint: '#f4f8ff', env: 1.1,
  },
  { // golden afternoon
    top: '#3570cc', mid: '#9cd0ff', hor: '#ffe9c4', fog: '#e6dcc8', sun: '#ffe0a8', sunI: 2.7, hemiSky: '#ffe8cc', hemiGround: '#8a6a3a', hemiI: 0.3,
    water: ['#16708a', '#4cc8bc'], rim: '#ffd8a0', stars: 0, grade: 0.12, skyExp: 0.95, skyTint: '#ffe6c4', env: 0.95,
  },
  { // sunset
    top: '#2a2f86', mid: '#ff8a62', hor: '#ffd28a', fog: '#e89a80', sun: '#ffb070', sunI: 2.3, hemiSky: '#ffb890', hemiGround: '#4a2a3a', hemiI: 0.5,
    water: ['#3a4a8a', '#ff9a7a'], rim: '#ff9acc', stars: 0.3, grade: 0.55, skyExp: 0.65, skyTint: '#ffb080', env: 0.55,
  },
  { // alien night
    top: '#07061e', mid: '#2a1660', hor: '#8a2a8a', fog: '#3a2560', sun: '#b8c0ff', sunI: 1.35, hemiSky: '#6a5acd', hemiGround: '#1a1030', hemiI: 0.75,
    water: ['#1a1a5a', '#8a3ad8'], rim: '#ff5ae0', stars: 1, grade: 0.88, skyExp: 0.1, skyTint: '#8070ff', env: 0.22,
  },
];

const EQ_UV = /* glsl */`
vec2 eqUV(vec3 d) {
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
}`;

const NOISE2 = /* glsl */`
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.02 + vec2(3.1, 1.7); a *= 0.5; }
  return s;
}`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// gradient sky + sun + twinkling stars + fbm cloud deck lit from the sun side
const SKY_FRAG = /* glsl */`
uniform vec3 uTop, uMid, uHor, uSun, uCloudLit, uCloudDark;
uniform vec3 uSunDir;
uniform float uStars, uTime, uCloud;
uniform sampler2D uSkyTex;
uniform float uSkyExp, uGrade;
uniform vec3 uSkyTint;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
${NOISE2}
${EQ_UV}
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 c = mix(uHor, uMid, smoothstep(-0.02, 0.1, h));
  c = mix(c, uTop, smoothstep(0.1, 0.5, h));
  vec3 L = normalize(uSunDir);
  float s = max(0.0, dot(dir, L));
  c += uSun * (pow(s, 64.0) * 1.5 + pow(s, 6.0) * 0.25);
  // photographic HDRI sky, graded toward the procedural sky for dusk/night
  vec3 hdr = texture2D(uSkyTex, eqUV(dir)).rgb * uSkyExp * uSkyTint;
  c = mix(hdr, c * mix(1.0, 0.6 + 0.8 * dot(hdr, vec3(0.3)), 0.25), uGrade);
  if (uStars > 0.0) {
    vec3 q = floor(vDir * 260.0);
    float st = step(0.9965, hash(q));
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + hash(q + 1.0) * 30.0);
    c += vec3(st * tw * uStars * smoothstep(0.05, 0.4, h));
  }
  if (h > 0.0 && uCloud > 0.0) {
    vec2 cuv = vDir.xz / (h + 0.1) * 0.8 + vec2(uTime * 0.01, uTime * 0.003);
    float d = fbm2(cuv);
    float cov = smoothstep(0.62 - uCloud * 0.22, 0.92, d) * smoothstep(0.0, 0.12, h);
    float lit = clamp((d - fbm2(cuv + normalize(L.xz + 1e-4) * 0.07)) * 7.0 + 0.55, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    cc += uSun * pow(s, 10.0) * 0.8;
    c = mix(c, cc, cov * 0.92);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// streaky, wobbling water column with churning foam at the lip and the base
const WATERFALL_FRAG = /* glsl */`
uniform float uTime;
varying vec2 vUv;
#include <fog_pars_fragment>
${NOISE2}
void main() {
  vec2 uv = vUv;
  uv.x += (n2(vec2(uv.y * 6.0 - uTime * 2.0, uv.x * 3.0)) - 0.5) * 0.06;
  float ci = floor(uv.x * 22.0);
  float hh = fract(sin(ci * 91.7) * 437.1);
  float s = fract(uv.y * (1.2 + hh * 2.0) + uTime * (1.3 + hh * 0.9));
  float streak = smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.2, 1.0, s));
  float foamTop = smoothstep(0.9, 1.0, uv.y);
  float foamBot = 1.0 - smoothstep(0.0, 0.14, uv.y);
  float churn = n2(vec2(uv.x * 20.0, uv.y * 30.0 + uTime * 6.0));
  vec3 c = mix(vec3(0.45, 0.8, 0.95), vec3(1.0), clamp(streak * 0.8 + (foamTop + foamBot) * churn, 0.0, 1.0));
  float edge = smoothstep(0.0, 0.18, uv.x) * (1.0 - smoothstep(0.82, 1.0, uv.x));
  float a = edge * (0.55 + 0.35 * streak + foamBot * 0.3);
  gl_FragColor = vec4(c * 0.9, a * 0.75);
  #include <fog_fragment>
}`;
const BASIC_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
// animated normals from layered noise, fresnel sky reflection, sun glitter
const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uDeep, uShallow, uSky, uSunCol, uSunDir, uSkyTint;
uniform sampler2D uSkyTex;
uniform float uSkyExp, uGrade;
varying vec2 vUv;
varying vec3 vW;
#include <fog_pars_fragment>
${NOISE2}
${EQ_UV}
float wave(vec2 p) {
  return n2(p * 0.35 + vec2(uTime * 0.12, uTime * 0.05)) * 0.55
       + n2(p * 0.9 + vec2(-uTime * 0.2, uTime * 0.13)) * 0.3
       + n2(p * 2.4 + vec2(uTime * 0.35, -uTime * 0.25)) * 0.15;
}
void main() {
  vec2 p = vW.xz;
  float e = 0.12;
  float w0 = wave(p), wx = wave(p + vec2(e, 0.0)), wz = wave(p + vec2(0.0, e));
  vec3 n = normalize(vec3(-(wx - w0) / e * 1.4, 1.0, -(wz - w0) / e * 1.4));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  float farK = smoothstep(-5.0, -150.0, vW.z);
  vec3 body = mix(uShallow, uDeep, clamp(farK * 0.8 + w0 * 0.3, 0.0, 1.0));
  vec3 R = reflect(-V, n);
  vec3 Rs = normalize(vec3(R.x, abs(R.y) + 0.02, R.z));
  vec3 refl = mix(texture2D(uSkyTex, eqUV(Rs)).rgb * uSkyExp * uSkyTint, uSky, uGrade);
  vec3 col = mix(body, refl, clamp(0.06 + fres * 0.95, 0.0, 0.9));
  float sd = max(dot(R, normalize(uSunDir)), 0.0);
  col += uSunCol * (pow(sd, 250.0) * 4.0 + pow(sd, 24.0) * 0.18);
  col += smoothstep(0.62, 0.72, w0) * 0.2;
  gl_FragColor = vec4(col, 0.94);
  #include <fog_fragment>
}`;
// drifting low mist banks
const MIST_FRAG = /* glsl */`
uniform float uTime, uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vW;
${NOISE2}
void main() {
  float n = fbm2(vec2(vW.x * 0.05 + uTime * 0.015, vW.y * 0.15 - uTime * 0.01));
  float v = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  float edge = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
  gl_FragColor = vec4(uColor, uOpacity * v * edge * smoothstep(0.25, 0.75, n));
}`;

/** Physical foliage material: soft sheen plus procedural leaf variation. */
function leafMaterial(color) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.62, sheen: lo(0.5, 0), sheenRoughness: 0.45, sheenColor: new THREE.Color('#d8ffb0') });
  return applyDetail(m, 'leaf');
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Background {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.rnd = mulberry(1234);
    this.anim = [];
    this._lights();
    this._sky();
    this._far();
    this._mid();
    this._forest();
    this._rays();
    this._mist();
    this._near();
    this._arenaFrame();
    this._foreground();
    this.eruptTimer = 6;
    if (PAINTED_BACKDROP) this._painted();
    this.setTheme(0);
  }

  /**
   * V2 painted backdrop: the concept painting split into sky, far, mid and near
   * layers placed at their own depths in the scene, with animated smoke, mist,
   * clouds, waterfalls, lake sparkle and UFO beams between them (backdrop3d.js).
   * The side walls and pterodactyls stay as live 3D models in front of it.
   */
  _painted() {
    this.painted = true;
    this.backdrop = new Backdrop3D(this.scene, {
      onFail: (url) => { console.warn('Backdrop image failed to load (' + url + '), using the 3D scenery'); this._unpaint(); },
    });
    this.scene.background = new THREE.Color('#5aa8f0'); // only ever seen past the painting's edges
    const keep = new Set([this.frame, ...this.pteros]);
    this._hiddenScenery = this.group.children.filter((c) => !keep.has(c) && c.visible);
    for (const c of this._hiddenScenery) c.visible = false;
  }

  /** Give up on the painted backdrop and bring the 3D scenery back. */
  _unpaint() {
    if (!this.painted) return;
    this.painted = false;
    this.backdrop.group.visible = false;
    for (const c of this._hiddenScenery) c.visible = true;
    this.scene.background = null;
    if (this.themeIndex !== undefined) this.setTheme(this.themeIndex);
  }

  _lights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.position.set(-8, 18, 14);
    this.sun.target.position.set(0, 5, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 14; sc.bottom = -10; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    s.add(this.sun, this.sun.target);
    this.rim = new THREE.DirectionalLight(0x9fd8ff, 1.6);
    this.rim.position.set(6, 8, -12);
    s.add(this.rim);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.5);
    this.fill.position.set(4, 3, 10);
    s.add(this.fill);
  }

  _sky() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(-0.4, 0.35, -1) },
        uStars: { value: 0 }, uTime: { value: 0 },
        uCloud: { value: 0.6 }, uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
        uSkyTex: { value: null }, uSkyExp: { value: 1 }, uSkyTint: { value: new THREE.Color(1, 1, 1) }, uGrade: { value: 1 },
      },
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    sky.renderOrder = -10;
    this.group.add(sky);

    // moons: faceted rock spheres hanging in the sky (as in the concept art)
    const moonTex = canvasTex(512, 256, (g, w, h) => {
      const rr = mulberry(21);
      g.fillStyle = '#c9d4ee'; g.fillRect(0, 0, w, h);
      // soft maria
      for (let i = 0; i < 14; i++) {
        const x = rr() * w, y = h * 0.2 + rr() * h * 0.6, rad = 20 + rr() * 50;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, 'rgba(120,140,190,0.45)'); grd.addColorStop(1, 'rgba(120,140,190,0)');
        g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      // craters: dark floor, bright rim
      for (let i = 0; i < 90; i++) {
        const x = rr() * w, y = h * 0.1 + rr() * h * 0.8, rad = 2 + Math.pow(rr(), 3) * 22;
        g.fillStyle = 'rgba(110,128,175,0.55)'; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
        g.strokeStyle = 'rgba(245,248,255,0.7)'; g.lineWidth = Math.max(1, rad * 0.22);
        g.beginPath(); g.arc(x - rad * 0.12, y - rad * 0.12, rad, 3.6, 6.6); g.stroke();
      }
    });
    moonTex.wrapS = THREE.RepeatWrapping;
    this.moonMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: moonTex, roughness: 1, emissive: '#8a9ad0', emissiveMap: moonTex, emissiveIntensity: 0.55, fog: false });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(31, 48, 32), this.moonMat);
    moon.position.set(-125, 140, -520);
    moon.rotation.set(0.2, -0.6, 0.1);
    this.group.add(moon);
    const moon2 = new THREE.Mesh(new THREE.SphereGeometry(8, 32, 20), this.moonMat);
    moon2.position.set(-88, 132, -540);
    this.group.add(moon2);
    this.moons = [moon, moon2];

    // clouds
    const cloudTex = canvasTex(256, 128, (g, w, h) => {
      const r = mulberry(4);
      for (let i = 0; i < 26; i++) {
        const x = w * 0.15 + r() * w * 0.7, y = h * 0.45 + (r() - 0.5) * h * 0.35, rad = 18 + r() * 30;
        const grd = g.createRadialGradient(x, y - rad * 0.3, 2, x, y, rad);
        grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.6, 'rgba(245,248,255,0.75)'); grd.addColorStop(1, 'rgba(230,236,255,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      }
    });
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: true, opacity: 0.95 }));
      const z = -160 - this.rnd() * 300;
      const s = 50 + this.rnd() * 90;
      m.scale.set(s, s, 1);
      m.position.set((this.rnd() - 0.5) * 700, 25 + this.rnd() * 110, z);
      m.userData.speed = 1 + this.rnd() * 2;
      this.clouds.push(m);
      this.group.add(m);
    }
  }

  _far() {
    // high-poly mountain ranges (displaced heightfields) instead of flat silhouettes
    this.ridges = [];
    const ridge = (z, base, amp, seed, depth) => {
      const geo = new THREE.PlaneGeometry(1600, depth, 130, 16); // coarse grid: big readable facets
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const r = mulberry(seed);
      const ph = r() * 100;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), zz = pos.getZ(i);
        const across = 1 - Math.min(1, Math.abs(zz) / (depth * 0.5));
        const massif = 0.55 + 0.45 * Math.sin(x * 0.006 + ph);
        const n = fbm3(x * 0.012 + ph, zz * 0.03, seed, 4);
        const crags = Math.abs(fbm3(x * 0.05, zz * 0.08 + ph, seed * 2, 4) - 0.5) * 0.5;
        const y = (base + amp * (n * 1.25 - 0.25 + crags) * massif) * Math.pow(across, 1.2) - 4;
        pos.setY(i, y);
      }
      const m = new THREE.Mesh(facet(geo), pbrMaterial('cliff', { scale: 0.035, tint: '#b8b0a8', moss: 0.6, macro: 0.3 }));
      m.position.z = z;
      this.group.add(m);
      this.ridges.push(m);
      return m;
    };
    ridge(-470, 30, 80, 3, 140);
    ridge(-330, 14, 55, 5, 110);

    // volcano
    this.volcano = A.clone('Volcano');
    this.volcano.scale.setScalar(21);
    this.volcano.position.set(16, -10, -300);
    this.volcano.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; if (o.material && /Lava/.test(o.material.name)) { o.material = o.material.clone(); o.material.emissiveIntensity = o.material.name === 'Lava_Hot' ? 2.4 : 1.8; } } });
    this.group.add(this.volcano);
    this.crater = new THREE.Vector3(16, -10 + 4.05 * 21, -300);
    const glowTex = canvasTex(128, 128, (g, w) => {
      const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,220,120,1)'); grd.addColorStop(0.3, 'rgba(255,120,20,0.6)'); grd.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
    });
    this.glowTex = glowTex;
    this.craterGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    this.craterGlow.scale.set(60, 40, 1);
    this.craterGlow.position.copy(this.crater).add(new THREE.Vector3(0, 3, 5));
    this.group.add(this.craterGlow);
    // smoke plume: chunky faceted puffs that swell and shrink as they rise
    this.puffGeo = facet(displace(new THREE.IcosahedronGeometry(1, 1), { amount: 0.22, freq: 1.4, seed: 4, oct: 2 }));
    const smokeMat = new THREE.MeshStandardMaterial({ color: '#b4a8ae', roughness: 1 });
    this.smoke = [];
    const nSmoke = lo(16, 10);
    for (let i = 0; i < nSmoke; i++) {
      const sp = new THREE.Mesh(this.puffGeo, smokeMat);
      sp.userData.t = i / nSmoke;
      sp.userData.spin = new THREE.Vector3(this.rnd() * 6, this.rnd() * 6, 0);
      this.smoke.push(sp);
      this.group.add(sp);
    }

    // UFO fleet
    const beamTex = canvasTex(8, 128, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });
    this.beamTex = beamTex;
    this.ufos = [];
    const spots = [[40, 40, -160, 5.5], [74, 46, -200, 5], [-92, 40, -230, 3.5]];
    for (const [x, y, z, s] of spots) {
      const u = A.clone('UFO');
      u.scale.setScalar(s);
      u.position.set(x, y, z);
      u.rotation.x = 0.25;
      u.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 2.4, 9, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x5aff9a, alphaMap: beamTex, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      beam.position.y = -4.7;
      u.add(beam);
      u.userData = { base: new THREE.Vector3(x, y, z), phase: this.rnd() * 6, lights: u.getObjectByName('UFO_Lights'), beam };
      this.ufos.push(u);
      this.group.add(u);
    }
  }

  _mid() {
    const r = this.rnd;
    const raw = new THREE.Group();
    // karst pinnacles with jungle tops
    const rockMat = pbrMaterial('cliff', { scale: 0.11, tint: '#f2e2cc', moss: 0.65 });
    const rockMat2 = pbrMaterial('cliff', { scale: 0.11, tint: '#c8b8a4', moss: 0.65 });
    const capMat = pbrMaterial('grass', { scale: 0.3, tint: '#b0c8a0' });
    const bushMats = ['#3f9a3a', '#2f7d34', '#56ad3c'].map((c) => leafMaterial(c));
    const vineMat = pbrMaterial('grass', { scale: 1.2, tint: '#6a8a50' });
    const bushGeos = [0, 1, 2].map((k) => facet(displace(new THREE.IcosahedronGeometry(1, 1), { amount: 0.2, freq: 1.6, seed: k + 3, oct: 2 })));
    const pin = [];
    // concept-art layout seen from the fixed camera: tall karst clusters on both
    // sides receding into haze, low jungle plateaus in the middle so the lake and
    // the volcano stay in view between them
    const places = [
      [-30, -48, 34], [-20, -78, 44], [-44, -96, 52], [-56, -58, 38], [-12, -125, 34],
      [30, -52, 32], [44, -100, 50], [58, -64, 36], [-70, -140, 58], [76, -150, 58],
      [-4, -85, 13], [14, -110, 16], [-24, -150, 26], [24, -76, 40],
    ];
    this.waterfalls = [];
    for (const [x, z, h0] of places) {
      const rad = 3.6 + r() * 3.4;
      const h = h0 * 0.58; // tops stay well below the moon and the open sky
      // flat-topped mesa: few sides, few rings, chiselled into big facets
      const seed = r() * 50;
      const sides = 8 + ((r() * 3) | 0);
      const geo = facet(displace(new THREE.CylinderGeometry(rad * 0.92, rad * 1.22, h, sides, Math.max(3, Math.round(h / 4.5)), true), {
        amount: rad * 0.2, freq: 0.3, seed, oct: 3,
        dirFn: (v) => new THREE.Vector3(v.x, 0, v.z).normalize(),
      }));
      const m = new THREE.Mesh(geo, r() < 0.5 ? rockMat : rockMat2);
      m.position.set(x, h / 2 - 2, z);
      // oval, turned and slightly leaning: no two mesas share a silhouette
      const sx = 0.8 + r() * 0.45, sz = 0.8 + r() * 0.45, ry = r() * 6.28;
      m.scale.set(sx, 1, sz);
      m.rotation.set((r() - 0.5) * 0.06, ry, (r() - 0.5) * 0.06);
      raw.add(m);
      pin.push({ x, z, top: h - 2, rad });
      // grass table-top with zig-zag teeth spilling over the rim
      const cap = new THREE.Mesh(facet(new THREE.CylinderGeometry(rad * 1.1, rad * 1.02, 0.7, sides)), capMat);
      cap.position.set(x, h - 1.85, z);
      cap.scale.set(sx, 1, sz);
      cap.rotation.y = ry;
      raw.add(cap);
      const drip = new THREE.Mesh(dripRing({ rx: rad * 1.08, rz: rad * 1.08, n: sides * 2, lmin: 0.35, lmax: 1.3, depth: 0.45, seed: seed * 7 }), capMat);
      drip.position.set(x, h - 1.55, z);
      drip.scale.set(sx, 1, sz);
      drip.rotation.y = ry;
      raw.add(drip);
      if (r() < 0.35) {
        // a smaller second tier on top
        const t2 = rad * (0.35 + r() * 0.2), th = 2 + r() * 4;
        const tier = new THREE.Mesh(facet(displace(new THREE.CylinderGeometry(t2 * 0.9, t2 * 1.1, th, 7, 2, true), {
          amount: t2 * 0.2, freq: 0.5, seed: seed + 3, oct: 2, dirFn: (v) => new THREE.Vector3(v.x, 0, v.z).normalize(),
        })), rockMat2);
        const ox = (r() - 0.5) * rad * 0.6, oz = (r() - 0.5) * rad * 0.6;
        tier.position.set(x + ox, h - 1.6 + th / 2, z + oz);
        raw.add(tier);
        const tcap = new THREE.Mesh(facet(new THREE.CylinderGeometry(t2 * 1.15, t2 * 1.05, 0.5, 7)), capMat);
        tcap.position.set(x + ox, h - 1.5 + th, z + oz);
        raw.add(tcap);
      }
      // shrubs clinging to ledges on the camera-facing side, with vines hanging below
      const nBush = 3 + ((r() * 4) | 0);
      for (let k = 0; k < nBush; k++) {
        const a = Math.PI / 2 + (r() - 0.5) * 2.4;
        const by = -2 + h * (0.25 + r() * 0.65);
        const bs = 0.7 + r() * 1.3;
        const bx = x + Math.cos(a) * rad * 1.02, bz = z + Math.sin(a) * rad * 1.02;
        const b = new THREE.Mesh(bushGeos[(r() * 3) | 0], bushMats[(r() * 3) | 0]);
        b.scale.set(bs * 1.4, bs * 0.7, bs);
        b.position.set(bx, by, bz);
        raw.add(b);
        if (r() < 0.6) {
          const len = 2 + r() * 5;
          const pts = [];
          for (let q = 0; q <= 6; q++) pts.push(new THREE.Vector3(bx + Math.sin(q * 1.3) * 0.2, by - (q / 6) * len, bz + 0.3));
          raw.add(new THREE.Mesh(facet(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.08, 3)), vineMat));
        }
      }
      const nTrees = 1 + ((r() * 3) | 0);
      for (let k = 0; k < nTrees; k++) {
        const t = A.clone(['TreeA', 'TreeB', 'TreeC'][(r() * 3) | 0]);
        const s = 1.1 + r() * 1.2;
        t.scale.setScalar(s);
        t.position.set(x + (r() - 0.5) * rad, h - 2.2, z + (r() - 0.5) * rad);
        t.rotation.y = r() * 6;
        raw.add(t);
      }
    }
    // pick a few pinnacles for waterfalls
    const wfMat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT, fragmentShader: WATERFALL_FRAG, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    });
    this.wfMat = wfMat;
    const foamMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, emissive: '#cfe6ff', emissiveIntensity: 0.15 });
    const foam = new THREE.Group();
    for (const i of [0, 1, 5, 13, 6, 3]) {
      const p = pin[i];
      const h = p.top + 1.5;
      const w = 1.2 + p.rad * 0.25;
      const wf = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wfMat);
      wf.position.set(p.x + (i % 2 ? 1 : -1) * 0.5, h / 2 - 1.5, p.z + p.rad * 1.2 + 0.2);
      this.group.add(wf);
      this.waterfalls.push({ x: wf.position.x, z: wf.position.z, w });
      for (let k = 0; k < 4; k++) {
        const f = new THREE.Mesh(this.puffGeo, foamMat);
        const fs = w * (0.55 + r() * 0.5);
        f.scale.set(fs * 1.3, fs * 0.8, fs);
        f.position.set(wf.position.x + (k - 1.5) * w * 0.55, -1.5 + r() * 0.4, wf.position.z + 0.4 + r() * 0.6);
        f.rotation.set(r() * 6, r() * 6, 0);
        foam.add(f);
      }
    }
    this.group.add(A.mergeStatic(foam, { castShadow: false, receiveShadow: false }));
    this.midStatic = A.mergeStatic(raw, { castShadow: false, receiveShadow: false });
    this.group.add(this.midStatic);

    // floating islands (animated, not merged)
    this.islands = [];
    const isl = [[-34, 34, -70, 3.2], [-8, 40, -110, 3.8], [40, 36, -90, 2.8], [-62, 46, -140, 5], [66, 50, -150, 5], [-18, 26, -55, 1.8], [18, 30, -60, 1.6]];
    for (const [x, y, z, s] of isl) {
      const o = A.clone(r() < 0.6 ? 'IslandA' : 'IslandB');
      o.scale.setScalar(s);
      o.position.set(x, y, z);
      o.rotation.y = r() * 6;
      o.traverse((c) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
      o.userData = { y, ph: r() * 6 };
      this.islands.push(o);
      this.group.add(o);
    }

    // water
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT, fragmentShader: WATER_FRAG, transparent: true, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(-0.4, 0.35, -1) },
        uSkyTex: { value: null }, uSkyExp: { value: 1 }, uSkyTint: { value: new THREE.Color(1, 1, 1) }, uGrade: { value: 1 } }]),
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1200, 700, 1, 1), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -1.6, -300);
    this.group.add(water);

    // pterodactyls
    this.pteros = [];
    for (let i = 0; i < 4; i++) {
      const p = A.clone('Ptero');
      p.scale.setScalar(1.4 + r());
      p.traverse((c) => { if (c.isMesh) c.castShadow = false; });
      p.userData = { wl: p.getObjectByName('Ptero_WingL'), wr: p.getObjectByName('Ptero_WingR'), speed: 5 + r() * 4, dir: r() < 0.5 ? 1 : -1, y: 14 + r() * 12, z: -25 - r() * 30, ph: r() * 6 };
      p.position.set((r() - 0.5) * 120, p.userData.y, p.userData.z);
      this.pteros.push(p);
      this.group.add(p);
    }
  }

  /** Distant jungle canopy hugging the water line, with emergent trees. */
  _forest() {
    const r = mulberry(77);
    const raw = new THREE.Group();
    const mats = ['#2f7a34', '#3a8a3a', '#276b2e', '#4a9a3a'].map((c) => leafMaterial(c));
    const geos = [0, 1, 2, 3].map((k) => facet(displace(new THREE.IcosahedronGeometry(1, 1), { amount: 0.2, freq: 1.4, seed: k * 7 + 1, oct: 2 })));
    for (let i = 0; i < 240; i++) {
      const x = -220 + r() * 440;
      const z = -34 - r() * 120;
      const s = 3 + r() * 5;
      if (Math.abs(x) < 34 && z > -95) continue; // keep the lake open behind the arena
      const b = new THREE.Mesh(geos[(r() * geos.length) | 0], mats[(r() * mats.length) | 0]);
      b.scale.set(s * 1.3, s * 0.75, s);
      b.position.set(x, -1.8 + s * 0.2, z);
      raw.add(b);
      if (r() < 0.22 && !(LOW && i % 2)) {
        const t = A.clone(['TreeA', 'TreeB', 'TreeC'][(r() * 3) | 0]);
        t.scale.setScalar(2.5 + r() * 2);
        t.position.set(x, -1.5 + s * 0.3, z);
        t.rotation.y = r() * 6;
        raw.add(t);
      }
    }
    this.group.add(A.mergeStatic(raw, { castShadow: false, receiveShadow: false }));
  }

  /** Soft crepuscular light shafts slanting down from the sun. */
  _rays() {
    const tex = canvasTex(128, 256, (g, w, h) => {
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const v = Math.pow(1 - y / h, 1.4);
        for (let x = 0; x < w; x++) {
          const u = (x / (w - 1)) * 2 - 1;
          const a = Math.exp(-u * u * 5) * v;
          const k = (y * w + x) * 4;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
          img.data[k + 3] = a * 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
    this.rays = [];
    const r = mulberry(31);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.1,
      }));
      const w = 4 + r() * 9, h = 55 + r() * 25;
      m.scale.set(w, h, 1);
      m.rotation.z = 0.42 + (r() - 0.5) * 0.12;
      m.position.set(-40 + i * 11 + r() * 6, 18 + r() * 8, -20 - r() * 40);
      m.userData = { ph: r() * 6, base: 0.06 + r() * 0.07 };
      this.rays.push(m);
      this.group.add(m);
    }
  }

  /** Low drifting mist banks between the depth layers. */
  _mist() {
    this.mistMat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.55 }, uColor: { value: new THREE.Color() } },
    });
    for (const [z, h, y] of [[-42, 14, 2.5], [-78, 22, 4], [-125, 30, 6]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(600, h), this.mistMat);
      m.position.set(0, y - 1.8, z);
      m.renderOrder = 5;
      this.group.add(m);
    }
  }

  _near() {
    // jungle banks directly behind the arena
    const r = this.rnd;
    const raw = new THREE.Group();
    const grassSpots = [];
    const moundMat = pbrMaterial('grass', { scale: 0.45, tint: '#c0d8b0' });
    const rockMat = pbrMaterial('cliff', { scale: 0.22, tint: '#e8d8c4', moss: 0.55 });
    const rockGeos = [0, 1, 2].map((k) => facet(displace(new THREE.IcosahedronGeometry(1, 1), { amount: 0.28, freq: 0.9, seed: k * 5 + 2, oct: 3 })));
    for (let i = 0; i < 16; i++) {
      const x = -40 + i * 5.4 + (r() - 0.5) * 2;
      const z = -9 - r() * 8;
      const s = 3.5 + r() * 3;
      if (Math.abs(x) < 14) continue; // open view onto the lake behind the arena
      const rock = new THREE.Mesh(rockGeos[i % 3], rockMat);
      rock.scale.set(1.3 * s, 0.9 * s, s);
      rock.position.set(x, -1.8 + r() * 1.5, z);
      raw.add(rock);
      const top = new THREE.Mesh(facet(displace(new THREE.SphereGeometry(s * 1.1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), { amount: s * 0.06, freq: 0.5, seed: i, oct: 2 })), moundMat);
      top.scale.set(1.25, 0.35, 0.95);
      top.position.set(x, rock.position.y + s * 0.62, z);
      raw.add(top);
      const md = new THREE.Mesh(dripRing({ rx: s * 1.1 * 1.25, rz: s * 1.1 * 0.95, n: 14, lmin: 0.15, lmax: 0.55, depth: 0.3, seed: i + 3 }), moundMat);
      md.position.set(x, top.position.y + 0.05, z);
      raw.add(md);
      // tufts scattered over the mound's dome
      const ax = s * 1.1 * 1.25, ay = s * 1.1 * 0.35, az = s * 1.1 * 0.95;
      for (let k = 0; k < lo(60, 30); k++) {
        const u = (r() * 2 - 1) * 0.92, v = (r() * 2 - 1) * 0.92;
        const d = u * u + v * v;
        if (d > 0.85) continue;
        const gy = top.position.y + ay * Math.sqrt(1 - d) - 0.05;
        grassSpots.push([x + u * ax, gy, z + v * az, 0.5 + r() * 0.45, r() * 6.28, 2.6]);
      }
      if (Math.abs(x) < 9 && z > -12) continue; // keep the playfield backdrop readable
      const t = A.clone(['TreeA', 'TreeB', 'TreeC'][(r() * 3) | 0]);
      const ts = 1.3 + r() * 1.1;
      t.scale.setScalar(ts);
      t.position.set(x + (r() - 0.5) * 2, top.position.y + 0.1, z);
      t.rotation.y = r() * 6;
      raw.add(t);
      for (let k = 0; k < 2; k++) {
        const f = A.clone(r() < 0.7 ? 'Fern' : 'RedLeaf');
        f.scale.setScalar(1.2 + r());
        f.position.set(x + (r() - 0.5) * s * 1.5, top.position.y, z + s * 0.5);
        f.rotation.y = (r() - 0.5) * 1.5;
        raw.add(f);
      }
    }
    // small rocky islets with palms in the water under the rope bridge:
    // a low faceted rock mound, a grassy dome on top and a dripping turf edge
    const domeGeo = facet(displace(new THREE.SphereGeometry(1, 10, 3, 0, Math.PI * 2, 0, Math.PI / 2), { amount: 0.08, freq: 1.2, seed: 9, oct: 2 }));
    for (const [ix, iz, is] of [[-1.4, -5.2, 1.0], [2.3, -7.6, 1.3], [-6.2, -6.4, 0.8]]) {
      const rock = new THREE.Mesh(rockGeos[(r() * 3) | 0], rockMat);
      rock.scale.set(1.6 * is, 0.7 * is, 1.25 * is);
      rock.position.set(ix, -1.85, iz);
      rock.rotation.y = r() * 6;
      raw.add(rock);
      const top = -1.85 + 0.42 * is;
      const dome = new THREE.Mesh(domeGeo, moundMat);
      dome.scale.set(1.3 * is, 0.32 * is, 1.0 * is);
      dome.position.set(ix, top, iz);
      raw.add(dome);
      const lip = new THREE.Mesh(dripRing({ rx: 1.3 * is, rz: 1.0 * is, n: 11, lmin: 0.1, lmax: 0.35, depth: 0.2, seed: ix * 7 }), moundMat);
      lip.position.set(ix, top + 0.03, iz);
      raw.add(lip);
      if (is > 0.9) {
        const palm = A.clone('TreeB');
        palm.scale.setScalar(0.5 * is);
        palm.position.set(ix + 0.15, top + 0.22 * is, iz);
        palm.rotation.y = r() * 6;
        raw.add(palm);
      } else {
        const bush = A.clone('Bush');
        bush.scale.setScalar(0.9);
        bush.position.set(ix, top + 0.2, iz);
        raw.add(bush);
      }
    }
    this.nearStatic = A.mergeStatic(raw, { castShadow: false, receiveShadow: true });
    this.group.add(this.nearStatic);
    this.bankGrass = new Grass(grassSpots, { seed: 3, shade: 0.72 });
    this.group.add(this.bankGrass.mesh);
  }

  _arenaFrame() {
    const raw = new THREE.Group();
    const r = mulberry(55);
    for (const side of [-1, 1]) {
      // inner face: stacked boulder segments, each resized, nudged and tilted
      for (let y = -2; y < 17;) {
        const sc = 1 + r() * 0.4;
        const w = A.clone(r() < 0.5 ? 'Wall' : 'Wall2');
        w.position.set(side * (10.85 + (sc - 1) * 0.82 + r() * 0.12), y, (r() - 0.5) * 0.35);
        w.scale.set(side * sc, sc * (0.9 + r() * 0.25), 1.25 * (0.92 + r() * 0.2));
        w.rotation.set(0, (r() - 0.5) * 0.16, (r() - 0.5) * 0.1);
        raw.add(w);
        y += 1.5 * sc;
      }
      // outer bulk so the frame reads as a cliff
      for (let y = -2; y < 16;) {
        const sc = 1.5 + r() * 0.5;
        const w = A.clone(r() < 0.5 ? 'Wall' : 'Wall2');
        w.position.set(side * (12.5 + r() * 0.5), y, 0.3 + r() * 0.4);
        w.scale.set(side * sc, sc * (0.95 + r() * 0.3), 1.5);
        w.rotation.set(0, (r() - 0.5) * 0.2, (r() - 0.5) * 0.12);
        raw.add(w);
        y += 1.55 * sc;
      }
      // massive back layer: the wall continues to the edge of the screen
      for (let y = -3; y < 18;) {
        const sc = 2.3 + r() * 0.6;
        const w = A.clone(r() < 0.5 ? 'Wall' : 'Wall2');
        w.position.set(side * (15.2 + r() * 0.8), y, -0.4 + r() * 0.5);
        w.scale.set(side * sc * 1.3, sc * (0.95 + r() * 0.3), 1.8);
        w.rotation.set(0, (r() - 0.5) * 0.2, (r() - 0.5) * 0.12);
        raw.add(w);
        y += 1.55 * sc;
      }
      // boulders bulging out of the wall at random heights
      for (let k = 0; k < 4; k++) {
        const b = A.clone(['Boulder1', 'Boulder2', 'Boulder3'][(r() * 3) | 0]);
        const sc = 0.6 + r() * 0.5;
        b.position.set(side * (10.9 + r() * 0.5), -1 + r() * 15, 0.6 + r() * 0.5);
        b.scale.setScalar(sc);
        b.rotation.set(r() * 0.5, r() * 6, r() * 0.5);
        raw.add(b);
      }
    }
    // phones skip the frame in the shadow pass (it barely shadows the playfield)
    this.frame = A.mergeStatic(raw, { castShadow: !LOW, receiveShadow: true });
    this.group.add(this.frame);
  }

  /**
   * Foreground dressing after the concept art: small static clumps of big
   * leaves, jungle flowers and boulders in front of the floor's corners, and
   * gnarled limbs with hanging vines at the top corners. One merged mesh.
   */
  _foreground() {
    const raw = new THREE.Group();
    const r = mulberry(91);
    // bottom corners: thick jungle clumps growing out of rock piles in front of the
    // floor, big enough to overlap the side walls like the concept art.
    // [model, x, y, z, scale, rotY, rotZ]; mirrored for the right-hand side
    const LEFT = [
      ['Boulder2', -11.2, -1.4, 2.6, 1.5, 0.9, 0.05],
      ['Boulder1', -9.4, -1.1, 2.9, 1.0, 0.4, 0.1],
      ['Boulder3', -12.6, 0.2, 2.2, 1.3, 1.7, 0.2],
      ['FgLeaves2', -11.6, 0.2, 2.8, 1.6, 0.3, -0.3],
      ['FgLeaves', -9.6, -0.2, 3.2, 1.15, -0.2, -0.55],
      ['FgLeaves2', -12.4, 2.2, 2.4, 1.2, 0.1, -0.15],
      ['FgLeaves', -8.2, -0.5, 3.5, 0.8, 0.4, -0.75],
      ['FgFlowerRed', -10.4, 0.0, 3.4, 1.1, 0.2, 0.05],
      ['FgFlowerPink', -8.9, -0.3, 3.6, 0.75, -0.3, -0.1],
      ['RedLeaf', -12.0, 0.8, 3.0, 2.6, 0.4, 0.15],
      ['RedLeaf', -10.0, -0.4, 3.7, 1.8, -0.5, -0.1],
      ['Fern', -7.4, -0.6, 3.8, 1.4, 0.2, -0.2],
    ];
    const RIGHT = [
      ['Boulder1', 11.2, -1.35, 2.6, 1.55, 2.1, -0.05],
      ['Boulder3', 9.5, -1.1, 2.9, 1.0, 1.2, -0.1],
      ['Boulder2', 12.6, 0.3, 2.2, 1.2, 0.7, -0.2],
      ['FgLeaves', 11.6, 0.2, 2.8, 1.6, -0.3, -0.3],
      ['FgLeaves2', 9.6, -0.2, 3.2, 1.1, 0.25, -0.55],
      ['FgLeaves', 12.4, 2.3, 2.4, 1.2, 0.0, -0.15],
      ['FgLeaves2', 8.2, -0.5, 3.5, 0.8, -0.4, -0.75],
      ['FgFlowerRed', 10.3, 0.0, 3.4, 1.15, -0.2, -0.05],
      ['FgFlowerPink', 8.9, -0.3, 3.6, 0.7, 0.3, 0.1],
      ['RedLeaf', 12.0, 0.8, 3.0, 2.6, -0.4, -0.15],
      ['RedLeaf', 10.1, -0.4, 3.7, 1.9, 0.5, 0.1],
      ['Fern', 7.4, -0.6, 3.8, 1.4, -0.2, 0.2],
    ];
    for (const [list, side] of [[LEFT, 1], [RIGHT, -1]]) {
      for (const [name, x, y, z, sc, ry, rz] of list) {
        const o = A.clone(name);
        o.position.set(x, y, z);
        o.scale.set(sc * side, sc, sc); // mirrored on the right so everything leans inward
        o.rotation.set(0, ry * side, rz * side);
        raw.add(o);
      }
    }
    // the canopy arch: one thick, gnarled limb spanning the top of the screen,
    // wrapped in vines, with leaf clusters at both ends and vines hanging down
    const barkMat = pbrMaterial('bark', { scale: 0.6, tint: '#c8a888' });
    const vineMat = leafMaterial('#3f8a2e');
    const leafMats = ['#3f9a3a', '#2f7d34', '#56ad3c'].map((c) => leafMaterial(c));
    const leafGeo = facet(displace(new THREE.IcosahedronGeometry(1, 1), { amount: 0.25, freq: 1.5, seed: 5, oct: 2 }));
    const limbPts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, x = -15 + t * 30;
      limbPts.push(new THREE.Vector3(x, 15.55 - Math.sin(t * Math.PI) * 0.45 + Math.sin(t * 17) * 0.12, 1.6 + Math.sin(t * 9) * 0.25));
    }
    const limbCurve = new THREE.CatmullRomCurve3(limbPts);
    const limb = new THREE.Mesh(displace(new THREE.TubeGeometry(limbCurve, 90, 0.42, 10), { amount: 0.1, freq: 1.6, seed: 2, oct: 3 }), barkMat);
    raw.add(limb);
    // vines spiralling around the limb
    for (let k = 0; k < 2; k++) {
      const pts = [];
      for (let i = 0; i <= 160; i++) {
        const t = i / 160, p = limbCurve.getPoint(t), a = t * 60 + k * Math.PI;
        pts.push(new THREE.Vector3(p.x, p.y + Math.sin(a) * 0.46, p.z + Math.cos(a) * 0.46));
      }
      raw.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 320, 0.05, 4), vineMat));
    }
    // hanging vines: long at the sides, short over the middle of the playfield
    const hang = [[-12.2, 4.5], [-11.0, 3.2], [-9.6, 2.2], [-7.6, 1.3], [-4.8, 0.7], [-1.5, 0.9], [2.2, 0.6], [5.2, 1.0], [7.8, 1.6], [9.8, 2.6], [11.2, 3.6], [12.4, 4.8]];
    for (const [hx, len] of hang) {
      const top = limbCurve.getPoint((hx + 15) / 30);
      const pts = [];
      for (let q = 0; q <= 8; q++) pts.push(new THREE.Vector3(top.x + Math.sin(q * 1.1 + hx) * 0.15, top.y - 0.3 - (q / 8) * len, top.z + 0.35));
      raw.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.045, 4), vineMat));
      // small leaves along the vine
      for (let q = 1; q <= Math.round(len * 2.2); q++) {
        const lf = new THREE.Mesh(leafGeo, leafMats[(r() * 3) | 0]);
        const ls = 0.12 + r() * 0.1;
        lf.scale.set(ls * 1.6, ls * 0.5, ls);
        lf.position.set(top.x + (r() - 0.5) * 0.3, top.y - 0.3 - (q / (len * 2.2 + 1)) * len, top.z + 0.4);
        lf.rotation.set(r() * 3, r() * 3, r() * 3);
        raw.add(lf);
      }
    }
    // leaf masses where the limb meets the walls, and tufts along its back
    for (const side of [-1, 1]) {
      for (const [name, x, y, z, sc, rz] of [
        ['FgLeaves2', 12.0, 15.0, 1.9, 1.5, Math.PI - 0.5], ['FgLeaves', 10.2, 15.4, 2.1, 1.2, Math.PI - 0.2],
        ['FgBranch', 11.6, 14.6, 1.5, 1.2, -0.15], ['FgLeaves', 13.4, 13.0, 1.8, 1.4, Math.PI - 0.9],
      ]) {
        const o = A.clone(side < 0 && name === 'FgBranch' ? 'FgBranch2' : name);
        o.position.set(x * side, y, z);
        o.scale.set(sc * -side, sc, sc);
        o.rotation.set(0, 0, rz * -side);
        raw.add(o);
      }
    }
    for (let i = 0; i < 26; i++) {
      const t = r();
      const p = limbCurve.getPoint(t);
      const b = new THREE.Mesh(leafGeo, leafMats[(r() * 3) | 0]);
      const bs = 0.35 + r() * 0.45 * (1 + Math.abs(t - 0.5) * 2);
      b.scale.set(bs * 1.5, bs * 0.8, bs);
      b.position.set(p.x, p.y + 0.3 + r() * 0.2, p.z - 0.2 + (r() - 0.5) * 0.5);
      raw.add(b);
    }
    this.scene.add(A.mergeStatic(raw, { castShadow: false, receiveShadow: false }));
  }

  /** Plug in the photographic sky: visible dome, water reflections, IBL, sun. */
  setHDRI(hdri) {
    this.hdri = hdri;
    this.skyMat.uniforms.uSkyTex.value = hdri.bg;
    this.waterMat.uniforms.uSkyTex.value = hdri.env;
    this.scene.environment = hdri.envMap;
    this.sun.position.copy(hdri.sunDir).setY(Math.max(hdri.sunDir.y, 0.62)).normalize().multiplyScalar(30);
    this.sun.position.y += 5;
    if (this.themeIndex !== undefined) this.setTheme(this.themeIndex);
  }

  setTheme(i) {
    this.themeIndex = i;
    const th = THEMES[i % THEMES.length];
    this.theme = th;
    const u = this.skyMat.uniforms;
    u.uTop.value.set(th.top); u.uMid.value.set(th.mid); u.uHor.value.set(th.hor); u.uSun.value.set(th.sun);
    u.uStars.value = th.stars;
    u.uCloud.value = CLOUD_AMOUNT[i % CLOUD_AMOUNT.length];
    u.uGrade.value = this.hdri ? th.grade : 1;
    u.uSkyExp.value = th.skyExp;
    u.uSkyTint.value.set(th.skyTint);
    const wu = this.waterMat.uniforms;
    wu.uGrade.value = this.hdri ? th.grade : 1;
    wu.uSkyExp.value = th.skyExp;
    wu.uSkyTint.value.set(th.skyTint);
    this.scene.environmentIntensity = th.env;
    const photo = !this.hdri || th.grade > 0.3;
    for (const c of this.clouds) c.visible = photo && !this.painted;
    if (this.painted) {
      const l = BACKDROP_LIGHT[i % BACKDROP_LIGHT.length];
      this.backdrop.setLight(l);
    }
    const night = i % THEMES.length === 4;
    u.uCloudLit.value.set(night ? '#8a78c8' : '#ffffff').lerp(new THREE.Color(th.sun), 0.25);
    u.uCloudDark.value.set(th.mid).lerp(new THREE.Color(th.top), 0.45).multiplyScalar(night ? 0.6 : 0.95);
    this.waterMat.uniforms.uSky.value.set(th.hor).lerp(new THREE.Color(th.mid), 0.35);
    this.waterMat.uniforms.uSunCol.value.set(th.sun);
    this.mistMat.uniforms.uColor.value.set(th.fog).lerp(new THREE.Color('#ffffff'), night ? 0.05 : 0.35);
    this.mistMat.uniforms.uOpacity.value = night ? 0.3 : 0.16;
    this.rayStrength = night ? 0.3 : i % THEMES.length === 3 ? 0.8 : 0.3;
    for (const ray of this.rays) ray.material.color.set(th.sun);
    this.scene.fog = new THREE.Fog(th.fog, night ? 60 : 140, night ? 520 : 1100);
    this.hemi.color.set(th.hemiSky); this.hemi.groundColor.set(th.hemiGround); this.hemi.intensity = th.hemiI;
    this.sun.color.set(th.sun); this.sun.intensity = th.sunI;
    this.rim.color.set(th.rim);
    this.waterMat.uniforms.uDeep.value.set(th.water[0]);
    this.waterMat.uniforms.uShallow.value.set(th.water[1]);
    for (const r of this.ridges) r.material.color.set('#b8b0a8').lerp(new THREE.Color(th.fog), 0.3);
    for (const c of this.clouds) c.material.color.set(i >= 3 ? (i === 4 ? '#8a70c0' : '#ffc0b0') : '#ffffff');
    this.moonMat.emissiveIntensity = i === 4 ? 1.4 : i === 3 ? 0.9 : 0.45;
  }

  update(dt, cam) {
    this.time += dt;
    if (this.painted) this.backdrop.update(dt, cam);
    const t = this.time;
    this.skyMat.uniforms.uTime.value = t;
    this.wfMat.uniforms.uTime.value = t;
    this.waterMat.uniforms.uTime.value = t;
    this.mistMat.uniforms.uTime.value = t;
    this.bankGrass.update(t, []);
    for (const ray of this.rays) {
      ray.material.opacity = ray.userData.base * this.rayStrength * (0.6 + 0.4 * Math.sin(t * 0.35 + ray.userData.ph));
    }
    // falling leaves drifting through the foreground
    if (Math.random() < dt * 2.2) {
      const c = new THREE.Color(['#5aae2e', '#86cc44', '#c8b040', '#e0702a'][(Math.random() * 4) | 0]);
      this.fx.norm.spawn({
        x: -14 + Math.random() * 28, y: 16, z: 0.8 + Math.random() * 3, vx: 0.4 + Math.random() * 0.8, vy: -0.9 - Math.random() * 0.6,
        life: 12, size: 0.28 + Math.random() * 0.14, sizeEnd: 0.28, r: c.r, g: c.g, b: c.b, a: 1, alphaEnd: 0.8,
        shape: 5, spin: (Math.random() - 0.5) * 3, drag: 0,
      });
    }
    // parallax: sky dome and far layers follow the camera a little
    this.group.children[0].position.copy(cam.position);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 400) c.position.x = -400;
    }
    for (const u of this.ufos) {
      const d = u.userData;
      u.position.x = d.base.x + Math.sin(t * 0.3 + d.phase) * 4;
      u.position.y = d.base.y + Math.sin(t * 1.1 + d.phase) * 1.2;
      u.rotation.z = Math.sin(t * 0.8 + d.phase) * 0.08;
      if (d.lights) d.lights.rotation.y = t * 2;
      d.beam.material.opacity = 0.42 + Math.sin(t * 6 + d.phase) * 0.1;
    }
    for (const o of this.islands) {
      o.position.y = o.userData.y + Math.sin(t * 0.6 + o.userData.ph) * 0.6;
      o.rotation.y += dt * 0.03;
    }
    for (const p of this.pteros) {
      const d = p.userData;
      p.position.x += d.dir * d.speed * dt;
      p.position.y = d.y + Math.sin(t * 0.8 + d.ph) * 1.5;
      p.rotation.y = d.dir > 0 ? 0 : Math.PI;
      const flap = Math.sin(t * 7 + d.ph) * 0.7;
      if (d.wl) d.wl.rotation.x = flap;
      if (d.wr) d.wr.rotation.x = -flap;
      if (Math.abs(p.position.x) > 90) { d.dir *= -1; d.y = 12 + Math.random() * 14; }
    }
    // volcano smoke plume
    for (const s of this.smoke) {
      s.userData.t = (s.userData.t + dt * 0.05) % 1;
      const k = s.userData.t;
      s.position.set(this.crater.x + k * 60 + Math.sin(k * 8 + s.id) * 6, this.crater.y + k * 110, this.crater.z - 10);
      const sz = (7 + k * 30) * (0.25 + 0.75 * Math.sqrt(Math.sin(k * Math.PI)));
      s.scale.set(sz, sz * 0.8, sz);
      s.rotation.set(s.userData.spin.x + k * 1.5, s.userData.spin.y + k, 0);
    }
    this.craterGlow.material.opacity = 0.75 + Math.sin(t * 3) * 0.15 + Math.sin(t * 7.3) * 0.08;
    // eruptions
    this.eruptTimer -= dt;
    if (this.eruptTimer <= 0) {
      this.eruptTimer = 14 + Math.random() * 10;
      this.erupt = 1.2;
      if (this.onErupt) this.onErupt();
    }
    if (this.erupt > 0 && !this.painted) {
      this.erupt -= dt;
      for (let i = 0; i < 4; i++) {
        this.fx.burst(this.crater.x, this.crater.y + 4, {
          count: 1, colors: ['#ffd23a', '#ff6a00', '#ff3a00'], speed: [30, 70], size: [8, 16], life: [1.5, 2.6],
          gravity: 40, drag: 0.3, angle: Math.PI / 2, spread: 1.0, z: this.crater.z + 10, sizeEnd: 0.4,
        });
      }
    }
    // waterfall mist
    if (!this.painted && Math.random() < dt * 12) {
      const w = this.waterfalls[(Math.random() * this.waterfalls.length) | 0];
      this.fx.burst(w.x + (Math.random() - 0.5) * w.w, -1.2, { count: 1, color: '#ffffff', speed: [1, 3], size: [3, 5], life: [1, 1.8], angle: Math.PI / 2, spread: 1.5, z: w.z + 0.5, additive: false, alpha: 0.35, shape: 4, sizeEnd: 2 });
    }
    // fireflies / pollen drifting through the arena
    if (Math.random() < dt * 5) {
      this.fx.burst(-10 + Math.random() * 20, Math.random() * 14, { count: 1, colors: this.theme.stars > 0.5 ? ['#9bff6a', '#ff8ae0'] : ['#fff6a8', '#ffffff'], speed: [0.2, 0.6], size: [0.12, 0.22], life: [3, 5], z: -1 + Math.random() * 2, drag: 0, sizeEnd: 1 });
    }
  }
}
