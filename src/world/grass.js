import * as THREE from 'three';
import { LOW } from '../quality.js';
import { mulberry } from './level.js';

// Instanced grass: each instance is a clump of curved, tapered blades. Wind and
// "pushers" (the dino, aliens, rolling eggs) bend the blades in the vertex shader.
const MAX_PUSH = 8;

function clumpGeometry() {
  const pos = [], nrm = [], hgt = [];
  const blades = [
    [0.0, 0.0, 0.0, 1.0], [0.05, 0.03, 2.1, 0.78], [-0.045, -0.02, 4.1, 0.9],
    [0.02, -0.05, 1.1, 0.66], [-0.03, 0.05, 5.3, 0.72],
  ];
  const segs = 2; // two bends per blade: reads as a chunky, faceted tuft
  for (const [ox, oz, rot, hs] of blades) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (x, y, z) => [ox + x * c + z * s, y, oz - x * s + z * c];
    const rows = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.055 * Math.pow(1 - t, 0.9) + 0.002;
      const lean = 0.28 * t * t * hs;
      rows.push([P(-w, t * hs, lean), P(w, t * hs, lean), t * hs]);
    }
    for (let i = 0; i < segs; i++) {
      const [a0, a1, ha] = rows[i], [b0, b1, hb] = rows[i + 1];
      for (const [v, h] of [[a0, ha], [a1, ha], [b1, hb], [a0, ha], [b1, hb], [b0, hb]]) {
        pos.push(...v); nrm.push(0, 1, 0); hgt.push(h);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hgt, 1));
  return g;
}

let sharedGeo = null;
// One material + uniform block shared by every grass field, never disposed, so
// its shader program survives stage changes (no recompile stall per stage).
let sharedMat = null;
let sharedUniforms = null;

export class Grass {
  /** Grass along every platform of a level (skipping the rope bridge). */
  static fromLevel(level, { density = 46, seed = 7 } = {}) {
    const rnd = mulberry(seed + level.stage.name.length * 31);
    const spots = [];
    for (const s of level.segments) {
      const ext = s.floor ? 0 : 0.14;
      const x0 = s.x0 - ext, x1 = s.x1 + ext;
      const n = Math.round((x1 - x0) * density);
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd() * (x1 - x0);
        if (s.floor && x > -3.05 && x < 3.05) continue; // rope bridge
        // patchy: tufts gather in clumps with bare turf between them
        const patch = Math.sin(x * 1.7 + s.y * 3.1) * 0.5 + Math.sin(x * 0.63 + s.y) * 0.5;
        if (patch < -0.15 && rnd() < 0.85) continue;
        const z = -0.98 + rnd() * 1.96;
        // keep the walking lane readable: shorter blades around z = 0
        const lane = 1 - 0.45 * Math.exp(-(z * z) / 0.08);
        const front = z > 0.75 ? 1.25 : 1;
        spots.push([x, s.y + 0.02, z, (0.2 + rnd() * 0.22) * lane * front, rnd() * Math.PI * 2]);
      }
    }
    return new Grass(spots, { seed });
  }

  /** spots: [x, y, z, height, yaw, widthScale?] */
  constructor(spots, { seed = 7, shade = 1 } = {}) {
    sharedGeo ||= clumpGeometry();
    const rnd = mulberry(seed * 13 + spots.length);
    this.uniforms = (sharedUniforms ||= {
      uTime: { value: 0 },
      uPush: { value: Array.from({ length: MAX_PUSH }, () => new THREE.Vector4(0, -100, 0, 0)) },
    });
    if (!sharedMat) {
    const mat = sharedMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.62, side: THREE.DoubleSide, sheen: LOW ? 0 : 0.22, sheenRoughness: 0.5, sheenColor: new THREE.Color('#a8e070') });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aH;
          uniform float uTime;
          uniform vec4 uPush[${MAX_PUSH}];
          varying float vH;`)
        .replace('#include <project_vertex>', `
          vH = aH;
          vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float k = aH * aH;
          float wind = sin(uTime * 1.9 + root.x * 0.7 + root.z * 0.9) * 0.6
                     + sin(uTime * 3.3 + root.x * 1.9) * 0.3
                     + sin(uTime * 0.55 + root.x * 0.15) * 0.6;
          wp.x += wind * 0.07 * k;
          wp.z += sin(uTime * 2.4 + root.x * 1.3) * 0.025 * k;
          for (int i = 0; i < ${MAX_PUSH}; i++) {
            vec4 P = uPush[i];
            if (P.w <= 0.0) continue;
            vec2 d = root.xz - P.xz;
            float dist = length(d);
            float f = (1.0 - smoothstep(P.w * 0.25, P.w, dist)) * (1.0 - smoothstep(0.0, 0.7, abs(root.y - P.y)));
            vec2 dir = dist > 0.001 ? d / dist : vec2(1.0, 0.0);
            wp.xz += dir * f * k * 0.3;
            wp.y -= f * aH * 0.1;
          }
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float hn = clamp(vH / 0.9, 0.0, 1.0);
          diffuseColor.rgb *= mix(0.22, 1.18, smoothstep(0.0, 1.0, hn));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.15, 0.6), smoothstep(0.65, 1.0, hn) * 0.55);`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.75));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * 0.12 * smoothstep(0.3, 1.0, vH);`);
    };
    mat.customProgramCacheKey = () => 'grass-blades';
    }
    const mat = sharedMat;

    this.mesh = new THREE.InstancedMesh(sharedGeo, mat, spots.length);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const palette = ['#6fc23a', '#5aae2e', '#86cc44', '#9cc84a', '#4f9f2a', '#7dbb36'].map((c) => new THREE.Color(c));
    const col = new THREE.Color();
    spots.forEach(([x, y, z, h, r, ws = 1], i) => {
      q.setFromEuler(e.set((rnd() - 0.5) * 0.25, r, (rnd() - 0.5) * 0.25));
      sc.set((1 + rnd() * 0.4) * ws, h, (1 + rnd() * 0.4) * ws);
      m.compose(v.set(x, y, z), q, sc);
      this.mesh.setMatrixAt(i, m);
      col.copy(palette[(rnd() * palette.length) | 0]).multiplyScalar((0.85 + rnd() * 0.3) * shade);
      this.mesh.setColorAt(i, col);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  /** pushers: [{x, y, r}] */
  update(t, pushers) {
    this.uniforms.uTime.value = t;
    const arr = this.uniforms.uPush.value;
    for (let i = 0; i < MAX_PUSH; i++) {
      const p = pushers[i];
      if (p) arr[i].set(p.x, p.y, 0, p.r);
      else arr[i].set(0, -100, 0, 0);
    }
  }

  dispose() { this.mesh.dispose(); }
}
