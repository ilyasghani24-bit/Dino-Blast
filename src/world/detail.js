import * as THREE from 'three';
import { LOW } from '../quality.js';

// ---------------------------------------------------------------------------
// Procedural micro-detail for untextured materials.
//
// Every surface samples 3D value-noise in *world space*, so tiles, mirrored
// instances and merged geometry all get unique, seamless detail with no UVs or
// textures. The same height field drives albedo variation and a derivative
// bump (screen-space dFdx/dFdy, like three's bumpMap) that perturbs the normal.
// ---------------------------------------------------------------------------

export const NOISE_GLSL = /* glsl */`
float dh_hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dh_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dh_hash(i + vec3(0, 0, 0)), dh_hash(i + vec3(1, 0, 0)), f.x),
                 mix(dh_hash(i + vec3(0, 1, 0)), dh_hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dh_hash(i + vec3(0, 0, 1)), dh_hash(i + vec3(1, 0, 1)), f.x),
                 mix(dh_hash(i + vec3(0, 1, 1)), dh_hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float dh_fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * dh_noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.9375;
}`;

// Each kind writes: col (albedo, linear), h (0..1 height for bump), rgh (roughness delta).
// Inputs: p = world position, n = world normal.
const KINDS = {
  stone: {
    bump: 0.05, fade: [28, 70],
    code: `
      float big = dh_fbm(p * 2.2);
      float mid = dh_noise(p * 7.0);
      float fine = dh_noise(p * 17.0);
      h = big * 0.55 + mid * 0.3 + fine * 0.15;
      col *= 0.6 + 0.75 * big;
      col *= mix(0.5, 1.08, smoothstep(0.26, 0.58, h));
      col *= 0.9 + 0.2 * mid;
      col *= 1.0 - 0.25 * smoothstep(0.8, 0.92, dh_noise(p * 29.0));
      float moss = smoothstep(0.52, 0.72, dh_fbm(p * 1.1 + 5.0)) * smoothstep(-0.1, 0.7, n.y);
      col = mix(col, vec3(0.09, 0.2, 0.03), moss * 0.6);
      float lichen = smoothstep(0.8, 0.9, dh_noise(p * 5.0 + 11.0));
      col = mix(col, vec3(0.55, 0.52, 0.3), lichen * 0.3);
      rgh = (fine - 0.5) * 0.2 - moss * 0.05;`,
  },
  grass: {
    bump: 0.018, fade: [28, 70],
    code: `
      float n1 = dh_fbm(p * 1.8);
      float blades = dh_noise(p * vec3(26.0, 5.0, 26.0));
      h = blades * 0.7 + n1 * 0.3;
      col *= 0.72 + 0.55 * n1;
      float dry = smoothstep(0.55, 0.8, dh_fbm(p * 0.6 + 3.0));
      col = mix(col, col * vec3(1.35, 1.1, 0.45), dry * 0.55);
      col *= 0.8 + 0.32 * blades;
      col *= mix(0.62, 1.0, smoothstep(-0.2, 0.7, n.y));
      rgh = (blades - 0.5) * 0.15;`,
  },
  dirt: {
    bump: 0.035, fade: [28, 70],
    code: `
      float n1 = dh_fbm(p * 3.0);
      float peb = smoothstep(0.68, 0.8, dh_noise(p * 9.0));
      h = n1 * 0.5 + peb * 0.5;
      col *= 0.65 + 0.6 * n1;
      col = mix(col, vec3(0.3, 0.25, 0.19), peb * 0.55);
      rgh = 0.05;`,
  },
  wood: {
    bump: 0.022, fade: [28, 70],
    code: `
      float g = dh_fbm(vec3(p.x * 18.0, p.y * 18.0, p.z * 1.4));
      float rings = 0.5 + 0.5 * sin((p.x * 3.0 + p.y * 2.0) * 25.0 + g * 9.0);
      h = g * 0.6 + rings * 0.4;
      col *= 0.7 + 0.38 * g + 0.12 * rings;
      col *= 1.0 - 0.4 * smoothstep(0.8, 0.9, dh_noise(p * vec3(6.0, 6.0, 1.5)));
      rgh = (0.5 - g) * 0.2;`,
  },
  bark: {
    bump: 0.035, fade: [40, 120],
    code: `
      float g = dh_fbm(vec3(p.x * 9.0, p.y * 1.2, p.z * 9.0));
      float furrow = smoothstep(0.35, 0.6, dh_noise(vec3(p.x * 14.0, p.y * 0.8, p.z * 14.0)));
      h = g * 0.5 + furrow * 0.5;
      col *= 0.55 + 0.65 * h;
      col = mix(col, vec3(0.08, 0.18, 0.03), smoothstep(0.6, 0.75, dh_fbm(p * 1.5 + 2.0)) * 0.4);`,
  },
  strata: {
    bump: 0.06, fade: [90, 260],
    code: `
      float warp = dh_fbm(p * 0.25);
      float band = 0.5 + 0.5 * sin(p.y * 2.2 + warp * 7.0);
      float n1 = dh_fbm(p * 1.3);
      h = band * 0.55 + n1 * 0.45;
      col *= 0.68 + 0.3 * band + 0.28 * n1;
      col = mix(col, col * vec3(1.15, 1.0, 0.8), smoothstep(0.6, 0.8, dh_fbm(p * 0.5 + 9.0)));
      float moss = smoothstep(0.45, 0.65, dh_fbm(p * 0.8 + 3.0)) * smoothstep(0.3, 0.9, n.y);
      col = mix(col, vec3(0.1, 0.24, 0.05), moss * 0.75);
      col *= 1.0 - 0.2 * smoothstep(0.55, 0.7, dh_noise(vec3(p.x * 6.0, p.y * 0.3, p.z * 6.0)));`,
  },
  leaf: {
    bump: 0.03, fade: [40, 160],
    code: `
      float n1 = dh_fbm(p * 3.0);
      float sp = dh_noise(p * 11.0);
      h = n1 * 0.6 + sp * 0.4;
      col *= 0.7 + 0.5 * n1;
      col = mix(col, col * vec3(1.2, 1.25, 0.6), smoothstep(0.62, 0.8, n1) * 0.5);
      col *= mix(0.62, 1.0, smoothstep(-0.4, 0.5, n.y));`,
  },
  moss: {
    bump: 0.02, fade: [28, 70],
    code: `
      float n1 = dh_fbm(p * 6.0);
      h = n1;
      col *= 0.7 + 0.5 * n1;`,
  },
  meadow: {
    bump: 0.05, fade: [60, 180],
    code: `
      float n1 = dh_fbm(p * 0.9);
      float n2 = dh_noise(p * vec3(10.0, 3.0, 10.0));
      h = n1 * 0.5 + n2 * 0.5;
      col *= 0.55 + 0.75 * n1;
      col *= 1.0 - 0.3 * smoothstep(0.55, 0.75, dh_noise(p * 3.0));
      col = mix(col, col * vec3(1.3, 1.1, 0.5), smoothstep(0.6, 0.8, dh_fbm(p * 0.35)) * 0.5);
      col *= 0.8 + 0.35 * n2;
      col *= mix(0.7, 1.0, smoothstep(-0.2, 0.6, n.y));`,
  },
};

const NAME_KIND = {
  Stone_A: 'stone', Stone_B: 'stone', Stone_C: 'stone',
  Dirt: 'dirt', Grass: 'grass', Grass_Dark: 'grass', Moss: 'moss', Vine: 'moss',
  Wood: 'wood', Wood_Dark: 'wood', Bark: 'bark',
  Leaf_A: 'leaf', Leaf_B: 'leaf', Leaf_C: 'leaf', Fern_Mat: 'leaf', RedLeaf_Mat: 'leaf',
  Island_Rock: 'strata', Island_RockDark: 'strata', Volcano_Rock: 'strata', Volcano_RockDark: 'strata',
};

export function applyDetail(mat, kind) {
  if (LOW) return mat; // per-pixel value noise + derivative bump: desktop only
  const K = KINDS[kind];
  if (!K || mat.userData.detail) return mat;
  mat.userData.detail = kind;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDWorld;\nvarying vec3 vDWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vDWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDWorld;
        varying vec3 vDWN;
        float gDH = 0.0;
        float gDR = 0.0;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vDWorld; vec3 n = normalize(vDWN);
          vec3 col = diffuseColor.rgb; float h = 0.0; float rgh = 0.0;
          ${K.code}
          diffuseColor.rgb = col; gDH = h; gDR = rgh;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + gDR, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float fade = 1.0 - smoothstep(${K.fade[0].toFixed(1)}, ${K.fade[1].toFixed(1)}, length(vViewPosition));
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float dhx = dFdx(gDH) * ${K.bump} * fade, dhy = dFdy(gDH) * ${K.bump} * fade;
          vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1) * faceDirection;
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`);
  };
  mat.customProgramCacheKey = () => 'detail-' + kind;
  mat.needsUpdate = true;
  return mat;
}

/** Patch every material of the loaded asset library by name. */
export function patchLibrary(lib) {
  const seen = new Set();
  for (const root of Object.values(lib)) {
    root.traverse((o) => {
      if (!o.isMesh || seen.has(o.material)) return;
      seen.add(o.material);
      const kind = NAME_KIND[o.material.name];
      if (kind) applyDetail(o.material, kind);
    });
  }
}

/**
 * Global height fog: adds low-lying valley mist that only kicks in at a
 * distance, so the playfield stays crisp while the background gets depth.
 * Must run before any material compiles.
 */
export function installHeightFog() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
    varying float vFogDepth;
    varying float vFogHeight;
  #endif`;
  // world-space y from the view-space position (view matrix is rigid)
  C.fog_vertex = `#ifdef USE_FOG
    vFogDepth = - mvPosition.z;
    vFogHeight = dot(mvPosition.xyz - viewMatrix[3].xyz, viewMatrix[1].xyz);
  #endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor;
    varying float vFogDepth;
    varying float vFogHeight;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear;
      uniform float fogFar;
    #endif
  #endif`;
  C.fog_fragment = `#ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    float hMist = (1.0 - smoothstep(-2.0, 18.0, vFogHeight)) * smoothstep(38.0, 170.0, vFogDepth);
    fogFactor = max(fogFactor, hMist * 0.5);
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif`;
}
