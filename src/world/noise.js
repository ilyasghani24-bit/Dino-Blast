import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// CPU value-noise for displacing background geometry at build time.
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), xf), l(h(0, 1, 0), h(1, 1, 0), xf), yf),
    l(l(h(0, 0, 1), h(1, 0, 1), xf), l(h(0, 1, 1), h(1, 1, 1), xf), yf),
    zf,
  );
}

export function fbm3(x, y, z, oct = 4) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x, y, z);
    n += a;
    x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1;
    a *= 0.5;
  }
  return s / n;
}

/**
 * Displace a geometry along a direction field and rebuild smooth normals.
 * dirFn(v) returns the unit push direction for a vertex position (e.g. radial);
 * since it depends only on position, duplicated seam vertices stay welded.
 */
export function displace(geo, { amount = 0.2, freq = 1, seed = 0, oct = 5, dirFn = (v) => v.clone().normalize() } = {}) {
  let g = geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g = mergeVertices(g, 1e-4);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * freq + seed * 17.1, v.y * freq + seed * 3.7, v.z * freq - seed * 5.3, oct) - 0.5;
    v.addScaledVector(dirFn(v), n * amount * 2);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Low-poly look: unweld every triangle so each face gets its own flat normal. */
export function facet(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

/**
 * Zig-zag grass "teeth" hanging off the rim of an elliptical grass cap: one
 * small tetrahedron per tooth, faces oriented outward, flat normals.
 */
export function dripRing({ rx = 1, rz = 1, y = 0, n = 16, lmin = 0.2, lmax = 0.6, depth = 0.25, seed = 1 } = {}) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pos = [];
  const tri = (a, b, c, ctr) => {
    const ab = b.clone().sub(a), ac = c.clone().sub(a);
    const nrm = ab.cross(ac);
    const mid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (nrm.dot(mid.sub(ctr)) < 0) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const P = (a, r = 1) => new THREE.Vector3(Math.cos(a) * rx * r, y, Math.sin(a) * rz * r);
    const out = new THREE.Vector3(Math.cos(am), 0, Math.sin(am));
    const w = 0.8 + rnd() * 0.2;
    const p0 = P(am - (am - a0) * w, 1.01), p1 = P(am + (a1 - am) * w, 1.01);
    const back = P(am, 1).addScaledVector(out, -depth);
    const tip = P(am + (rnd() - 0.5) * (a1 - a0) * 0.4, 1.02);
    tip.y -= lmin + rnd() * (lmax - lmin);
    const ctr = p0.clone().add(p1).add(back).add(tip).multiplyScalar(0.25);
    tri(p0, p1, tip, ctr); tri(p1, back, tip, ctr); tri(back, p0, tip, ctr); tri(p0, back, p1, ctr);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
