import * as THREE from 'three';

// World-space window the fixed gameplay camera shows: floor waterline to the
// canopy arch, wall to wall. Shared by the game camera and the painted backdrop,
// which is projected from exactly this view.
export const FRAME = { cy: 7.1, halfH: 8.6, halfHWide: 8.0, halfW: 12.4 };
export const LIFT = 0.4; // camera sits a touch above its aim point: almost dead-on, like the concept art

/** Resting pose of the fixed camera for a given vertical FOV (degrees) and aspect. */
export function fixedView(fov, aspect) {
  const tanV = Math.tan((fov * Math.PI) / 360);
  // phones (very wide screens) crop a little sky and water so the playfield gets more of the screen
  const halfH = aspect > 1.9 ? FRAME.halfHWide : FRAME.halfH;
  const dist = Math.max(halfH / tanV, FRAME.halfW / (tanV * aspect));
  return {
    dist,
    pos: new THREE.Vector3(0, FRAME.cy + LIFT, dist),
    target: new THREE.Vector3(0, FRAME.cy + 0.2, 0),
  };
}
