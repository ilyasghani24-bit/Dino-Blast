import * as THREE from 'three';
import { NOISE_GLSL, applyDetail } from './detail.js';
import { LOW } from '../quality.js';

// ---------------------------------------------------------------------------
// PBR materials. Baked, tileable texture sets (albedo / normal / ORM) are
// projected tri-planarly in world space, because the procedural meshes have
// no UVs. Normals use Ben Golus' "whiteout" triplanar blend.
// ---------------------------------------------------------------------------
const SETS = ['rock', 'grass', 'dirt', 'wood', 'bark', 'cliff'];
const TEX = {};

export async function loadPBRTextures(renderer) {
  const L = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  await Promise.all(SETS.flatMap((n) => ['albedo', 'normal', 'orm'].map(async (k) => {
    const t = await L.loadAsync(`assets/tex/${n}_${k}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.colorSpace = k === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    (TEX[n] ||= {})[k] = t;
  })));
}

/** Upgrade any standard material to MeshPhysicalMaterial, keeping its params. */
export function toPhysical(m) {
  if (m.isMeshPhysicalMaterial) return m;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.defines = { STANDARD: '', PHYSICAL: '' };
  p.name = m.name;
  return p;
}

/**
 * Triplanar PBR on a physical material.
 * scale: texture repeats per world unit. tint: albedo multiplier.
 * macro: large-scale brightness breakup to hide tiling. moss: moss on up-faces.
 */
export function applyTriplanar(mat, set, { scale = 1, tint = '#ffffff', normalScale = 1, roughMul = 1, macro = 0.22, moss = 0, swapXZ = false } = {}) {
  const T = TEX[set];
  mat.color.set(tint);
  mat.map = null; mat.normalMap = null; mat.roughnessMap = null;
  mat.userData.tri = set;
  const f = (x) => Number(x).toFixed(4);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tAlb = { value: T.albedo };
    sh.uniforms.tNrm = { value: T.normal };
    sh.uniforms.tOrm = { value: T.orm };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTP;\nvarying vec3 vTN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vTP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAlb, tNrm, tOrm;
        varying vec3 vTP;
        varying vec3 vTN;
        vec3 tpW; vec2 tpUX, tpUY, tpUZ;
        float tpAO = 1.0, tpRough = 1.0;
        ${NOISE_GLSL}
        vec3 tri(sampler2D t) {
          return texture2D(t, tpUX).rgb * tpW.x + texture2D(t, tpUY).rgb * tpW.y + texture2D(t, tpUZ).rgb * tpW.z;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vTN);
          tpW = pow(abs(n), vec3(4.0));
          tpW /= (tpW.x + tpW.y + tpW.z);
          vec3 p = vTP * ${f(scale)};
          tpUX = p.zy;
          tpUY = ${swapXZ ? 'p.zx' : 'p.xz'};
          tpUZ = p.xy;
          vec3 alb = tri(tAlb);
          ${LOW ? '' : `float mac = dh_fbm(vTP * 0.35);
          alb *= ${f(1 - macro)} + ${f(2 * macro)} * mac;`}
          diffuseColor.rgb *= alb;
          ${moss > 0 && !LOW ? `float mo = smoothstep(0.5, 0.72, dh_fbm(vTP * 0.9 + 5.0)) * smoothstep(0.15, 0.85, n.y) * ${f(moss)};
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.17, 0.03), mo);` : ''}
          vec3 orm = tri(tOrm);
          tpAO = orm.r;
          tpRough = orm.g;
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = clamp(mix(roughness, tpRough, 0.8) * ${f(roughMul)}, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', LOW ? '' : `{
          vec3 n = normalize(vTN);
          vec3 tx = texture2D(tNrm, tpUX).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(tNrm, tpUY).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(tNrm, tpUZ).xyz * 2.0 - 1.0;
          tx.xy *= ${f(normalScale)}; ty.xy *= ${f(normalScale)}; tz.xy *= ${f(normalScale)};
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
          ${swapXZ
            ? 'ty = vec3(ty.xy + n.zx, abs(ty.z) * n.y); vec3 wy = ty.yzx;'
            : 'ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y); vec3 wy = ty.xzy;'}
          tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          vec3 wn = normalize(tx.zyx * tpW.x + wy * tpW.y + tz.xyz * tpW.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= tpAO;
        reflectedLight.indirectSpecular *= tpAO;
        reflectedLight.directDiffuse *= mix(1.0, tpAO, 0.45);`);
  };
  mat.customProgramCacheKey = () => `tri${LOW ? 'L' : ''}-${set}-${scale}-${swapXZ}-${moss}-${macro}-${normalScale}-${roughMul}`;
  mat.needsUpdate = true;
  return mat;
}

// library material name -> PBR recipe
const LIB = {
  Stone_A: ['rock', { scale: 0.9, tint: '#ffffff', moss: 0.45 }],
  Stone_B: ['rock', { scale: 0.9, tint: '#d9c6b0', moss: 0.45 }],
  Stone_C: ['rock', { scale: 0.9, tint: '#fff3e2', moss: 0.35 }],
  Dirt: ['dirt', { scale: 1.1, tint: '#ffffff' }],
  Grass: ['grass', { scale: 0.7, tint: '#ffffff' }],
  Grass_Dark: ['grass', { scale: 0.7, tint: '#a8c098' }],
  Moss: ['grass', { scale: 1.6, tint: '#86a070' }],
  Vine: ['grass', { scale: 1.6, tint: '#7a9460' }],
  Wood: ['wood', { scale: 0.8, tint: '#ffffff', swapXZ: true }],
  Wood_Dark: ['wood', { scale: 0.8, tint: '#8c7462', swapXZ: true }],
  Bark: ['bark', { scale: 1.4, tint: '#ffffff' }],
  Island_Rock: ['cliff', { scale: 0.3, tint: '#f0e2d0', moss: 0.5 }],
  Island_RockDark: ['cliff', { scale: 0.3, tint: '#a8988a' }],
  Volcano_Rock: ['cliff', { scale: 0.05, tint: '#7a6a70', macro: 0.3 }],
  Volcano_RockDark: ['cliff', { scale: 0.05, tint: '#5a4a52' }],
};

// physically-motivated tweaks for the characters and props
const PHYS = {
  Dino_Purple: { roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.35, sheenRoughness: 0.5, sheenColor: '#b8a8ff' },
  Dino_PurpleDark: { roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.3, sheenColor: '#9080ff' },
  Dino_Belly: { roughness: 0.55, sheen: 0.4, sheenColor: '#ffffff', clearcoat: 0.2 },
  Dino_Spike: { roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  Eye_White: { roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 },
  Dino_Iris: { roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 },
  Alien_Eye: { roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 },
  Pupil: { roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 },
  Alien_Skin: { roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: '#e0ffb0' },
  Alien_Helmet: { roughness: 0.22, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 },
  Alien_Phone: { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 },
  Alien_Boot: { roughness: 0.45, clearcoat: 0.5 },
  Gold: { roughness: 0.2, metalness: 1 },
  Coin_Gold: { roughness: 0.18, metalness: 1, clearcoat: 0.4 },
  Coin_Face: { roughness: 0.28, metalness: 1 },
  Coin_Star: { roughness: 0.15, metalness: 0.8 },
  Egg_Shell: { roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.25, sheen: 0.25, sheenColor: '#ffffff' },
  Egg_Spot: { roughness: 0.35, clearcoat: 0.55, clearcoatRoughness: 0.25 },
  Heart_Red: { roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 },
  UFO_Hull: { roughness: 0.2, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.1 },
  UFO_HullDark: { roughness: 0.3, metalness: 0.9 },
  UFO_Dome: { roughness: 0.03, metalness: 0, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.4, ior: 1.5, specularIntensity: 1 },
  Potion_Glass: { roughness: 0.03, clearcoat: 1, ior: 1.5, iridescence: 0.3 },
  Rope: { roughness: 0.95, sheen: 0.6, sheenColor: '#fff0c0' },
  Ptero_Skin: { roughness: 0.6, sheen: 0.3, sheenColor: '#ffd0b0' },
  Ptero_Wing: { roughness: 0.65, sheen: 0.4, sheenColor: '#ffd0b0' },
};

// tiny facial / trim parts: their shadows are invisible but each costs a draw call
const NO_SHADOW = ['Eye_White', 'Dino_Iris', 'Alien_Eye', 'Pupil', 'Eye_Shine', 'Mouth', 'Alien_Phone', 'Alien_Bulb', 'Gold'];

const LEAVES = ['Leaf_A', 'Leaf_B', 'Leaf_C', 'Fern_Mat', 'RedLeaf_Mat', 'Flower_Petal', 'Flower_PetalRed',
  'Fg_LeafLime', 'Fg_LeafDark', 'FgFlowerRed_Petal', 'FgFlowerPink_Petal'];

function applyPhys(mat, spec) {
  for (const [k, v] of Object.entries(spec)) {
    // sheen and thin-film iridescence are extra BRDF lobes: too costly per pixel on phones
    if (LOW && (k.startsWith('sheen') || k.startsWith('iridescence'))) continue;
    if (k === 'sheenColor') mat.sheenColor.set(v);
    else mat[k] = v;
  }
}

/** Convert every library material to physical PBR and assign its recipe. */
export function patchLibraryPBR(lib) {
  const cache = new Map();
  for (const root of Object.values(lib)) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const old = o.material;
      if (!cache.has(old)) {
        const m = toPhysical(old);
        const tri = LIB[m.name];
        if (tri) applyTriplanar(m, tri[0], tri[1]);
        else if (LEAVES.includes(m.name)) {
          m.side = THREE.DoubleSide;
          applyPhys(m, { roughness: 0.62, sheen: 0.5, sheenRoughness: 0.45, sheenColor: '#d8ffb0' });
          applyDetail(m, 'leaf');
        }
        if (PHYS[m.name]) applyPhys(m, PHYS[m.name]);
        cache.set(old, m);
      }
      o.material = cache.get(old);
      if (NO_SHADOW.includes(o.material.name)) o.castShadow = false;
    });
  }
}

/** Build a new physical triplanar material (for procedural background meshes). */
export function pbrMaterial(set, opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.9, metalness: 0 });
  return applyTriplanar(m, set, opts);
}
