import { ARENA } from '../world/level.js';

export const GRAVITY = 42;

export const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/**
 * Integrate a body with {x, y, vx, vy, hw} against the level.
 * Returns { wall: -1|0|1, landed: bool, landV: number }.
 */
export function stepBody(b, level, dt, { gravity = GRAVITY, maxFall = 22, ignorePlatforms = false, walls = true } = {}) {
  b.vy = Math.max(b.vy - gravity * dt, -maxFall);
  const prevY = b.y, prevX = b.x;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  let wall = 0;
  if (walls && level.walls && level.walls.length) wall = level.collideWalls(b, prevX, prevY);
  if (walls) {
    if (b.x < ARENA.x0 + b.hw) { b.x = ARENA.x0 + b.hw; wall = -1; }
    else if (b.x > ARENA.x1 - b.hw) { b.x = ARENA.x1 - b.hw; wall = 1; }
  }
  if (b.y > ARENA.top && b.vy > 0) { b.y = ARENA.top; b.vy = 0; }
  const wasGrounded = b.grounded;
  b.grounded = false;
  let landed = false, landV = 0;
  if (b.vy <= 0) {
    const top = level.land(b.x, b.hw, prevY, b.y, ignorePlatforms);
    if (top !== null) {
      landV = b.vy;
      b.y = top;
      b.vy = 0;
      b.grounded = true;
      landed = !wasGrounded;
      b.groundSeg = level.groundAt(b.x, top) || b.groundSeg;
    }
  }
  if (b.y < -3) { b.y = 0; b.vy = 0; b.grounded = true; }
  return { wall, landed, landV };
}
