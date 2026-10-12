import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

// "Spiaggia di Mondello" HDRI (2K DWAA for the visible sky + 1K ZIP for lighting; 4K master in tools/hdri).
// The sun sits at u = 0.6006 in the panorama. We rotate the panorama so the sun
// lands behind / left of the camera (front-lighting the playfield) and the camera
// looks out over the open sea on the horizon.
const SUN_U = 0.6006;
const SUN_ELEV = 25 * (Math.PI / 180);
export const SUN_AZIMUTH = Math.atan2(0.98, -0.19); // world yaw of the sun (xz plane)
const TARGET_U = SUN_AZIMUTH / (Math.PI * 2) + 0.5;
const IBL_CLAMP = 24; // strip the sun disc out of the IBL; a DirectionalLight casts it

function rotateColumns(tex, du) {
  const { data, width, height } = tex.image;
  const ch = data.length / (width * height);
  const shift = ((Math.round(du * width) % width) + width) % width;
  const row = new data.constructor(width * ch);
  for (let y = 0; y < height; y++) {
    const o = y * width * ch;
    row.set(data.subarray(o, o + width * ch));
    for (let x = 0; x < width; x++) {
      const d = o + ((x + shift) % width) * ch;
      const s = x * ch;
      for (let c = 0; c < ch; c++) data[d + c] = row[s + c];
    }
  }
}

export async function loadHDRI(renderer) {
  const [bg, env] = await Promise.all([
    new EXRLoader().setDataType(THREE.HalfFloatType).loadAsync('assets/sky/sky_2k.exr'),
    new EXRLoader().setDataType(THREE.FloatType).loadAsync('assets/sky/sky_1k.exr'),
  ]);
  const du = TARGET_U - SUN_U;
  rotateColumns(bg, du);
  rotateColumns(env, du);

  // Clamp in float, then store as half-float: 32-bit float textures aren't
  // linearly filterable on every GPU (OES_texture_float_linear), and an
  // unfilterable env map samples as black. Half-float filtering is core WebGL2.
  const src = env.image.data;
  const half = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(src[i], IBL_CLAMP));
  env.dispose();
  const envH = new THREE.DataTexture(half, env.image.width, env.image.height, THREE.RGBAFormat, THREE.HalfFloatType);

  for (const t of [bg, envH]) {
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.wrapS = THREE.RepeatWrapping;
    t.needsUpdate = true;
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const envMap = pm.fromEquirectangular(envH).texture;
  pm.dispose();
  const sunDir = new THREE.Vector3(Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEV), Math.sin(SUN_ELEV), Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEV));
  return { bg, env: envH, envMap, sunDir };
}
