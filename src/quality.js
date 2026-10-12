import { isTouchDevice } from './engine/touch.js';

// Render quality tier, fixed at startup. Phones and tablets get LOW: lighter
// scenery meshes, cheaper shaders (no per-pixel noise, no triplanar normal
// maps, no sheen), smaller shadows. Override with ?q=low or ?q=high.
const q = new URLSearchParams(location.search).get('q');
export const LOW = q === 'low' || (q !== 'high' && isTouchDevice());

/** Pick a value by tier: lo(high, low). */
export const lo = (high, low) => (LOW ? low : high);
