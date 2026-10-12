import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const lib = {};

export async function loadAssets(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  for (const child of [...gltf.scene.children]) {
    child.position.set(0, 0, 0);
    lib[child.name] = child;
    child.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const m = o.material;
        if (m.transparent) { o.castShadow = false; m.depthWrite = false; }
      }
    });
  }
  return lib;
}

export function has(name) { return !!lib[name]; }

/** Shallow clone: geometry and materials are shared. */
export function clone(name) {
  const src = lib[name];
  if (!src) throw new Error('Missing asset ' + name);
  return src.clone(true);
}

/** Clone with per-instance materials so the instance can flash / tint independently. */
export function cloneUnique(name) {
  const o = clone(name);
  const mats = [];
  o.traverse((c) => {
    if (c.isMesh) {
      c.material = c.material.clone();
      c.material.userData.baseEmissive = c.material.emissive ? c.material.emissive.clone() : null;
      c.material.userData.baseEmissiveIntensity = c.material.emissiveIntensity ?? 1;
      mats.push(c.material);
    }
  });
  o.userData.mats = mats;
  return o;
}

const WHITE = new THREE.Color(1, 1, 1);
/** Blend every material of a cloneUnique()'d object toward a hot flash color. */
export function setFlash(obj, f, color = WHITE) {
  for (const m of obj.userData.mats || []) {
    if (!m.emissive) continue;
    m.emissive.copy(m.userData.baseEmissive).lerp(color, f);
    m.emissiveIntensity = m.userData.baseEmissiveIntensity + f * 1.2;
  }
}

export function findMat(obj, name) {
  return (obj.userData.mats || []).filter((m) => m.name === name);
}

/**
 * Bake a group of static meshes into one mesh per material (few draw calls).
 * Works on any hierarchy; world transforms are applied.
 */
export function mergeStatic(group, { castShadow = true, receiveShadow = true } = {}) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const key = o.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [] });
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    const ng = g.index ? g.toNonIndexed() : g;
    if (o.matrixWorld.determinant() < 0) {
      // mirrored instance: restore counter-clockwise winding
      for (const attr of [ng.attributes.position, ng.attributes.normal]) {
        const a = attr.array;
        for (let i = 0; i < a.length; i += 9) {
          for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
        }
      }
    }
    buckets.get(key).geos.push(ng);
  });
  const out = new THREE.Group();
  for (const { mat, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = castShadow && !mat.transparent;
    m.receiveShadow = receiveShadow;
    out.add(m);
    geos.forEach((g) => g.dispose());
  }
  return out;
}

/** Render a model to a transparent PNG data URL (used for HUD icons). */
export function renderIcon(name, { size = 256, yaw = -0.5, pitch = 0.1, fit = 1.0, focus = null, pose = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  // metals and clearcoats need something to reflect, even in a studio icon
  const pmrem = new THREE.PMREMGenerator(r);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight(0xdff0ff, 0x6a5a8a, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.8);
  d.position.set(-2, 4, 5);
  scene.add(d);
  const rim = new THREE.DirectionalLight(0x9fd0ff, 2.0);
  rim.position.set(3, 2, -4);
  scene.add(rim);
  const obj = clone(name);
  obj.rotation.set(pitch, yaw, 0);
  if (pose) pose(obj);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const center = focus ? new THREE.Vector3(...focus) : box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3());
  const radius = Math.max(sz.x, sz.y, sz.z) * 0.5 * fit;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const dist = radius / Math.tan((15 * Math.PI) / 180);
  cam.position.set(center.x, center.y, center.z + dist);
  cam.lookAt(center);
  r.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  scene.environment.dispose();
  pmrem.dispose();
  r.dispose();
  return url;
}
