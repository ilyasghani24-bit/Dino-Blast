import * as THREE from 'three';
import * as A from '../assets.js';
import { ARENA } from '../world/level.js';

export class Shot {
  constructor(g, x, y, dir, power, range, inheritVx = 0) {
    this.g = g;
    this.x = x; this.y = y;
    this.dir = dir;
    this.vx = dir * 15 + inheritVx * 0.3;
    this.vy = 2.2;
    this.life = range;
    this.power = power;
    this.r = power > 1 ? 0.32 : 0.24;
    this.dead = false;
    this.mesh = A.clone('Egg');
    this.mesh.scale.setScalar(power > 1 ? 0.46 : 0.32);
    this.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.spin = new THREE.Group();
    this.spin.add(this.mesh);
    this.mesh.position.y = -0.58 * this.mesh.scale.y;
    g.scene.add(this.spin);
    this._sync();
  }

  update(dt) {
    const g = this.g;
    this.life -= dt;
    this.vy -= 16 * dt;
    const prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin.rotation.z -= this.dir * dt * 16;
    if (Math.random() < 0.8) {
      g.fx.burst(this.x, this.y, { count: 1, colors: this.power > 1 ? ['#3ad8ff', '#ffffff'] : ['#ffffff', '#c9a8ff'], speed: [0, 0.5], size: [0.25, 0.45], life: [0.12, 0.25], z: 0 });
    }
    for (const e of g.enemies) {
      if (e.hitTest(this.x, this.y, this.r) && e.hitByShot(this)) { this.pop(true); return; }
    }
    if (g.boss && g.boss.hitTest(this.x, this.y, this.r)) { g.boss.damage(0.5, this.x, this.y, 'shot'); this.pop(true); return; }
    for (const h of g.hazards) {
      if (h.kind === 'plasma' && !h.dead && Math.hypot(h.x - this.x, h.y - this.y) < this.r + h.r) {
        h.destroy(true);
        g.addScore(50, this.x, this.y);
        this.pop(true);
        return;
      }
    }
    if (this.x < ARENA.x0 + 0.1 || this.x > ARENA.x1 - 0.1 || g.level.wallAt(this.x, this.y, this.r * 0.6)) { this.pop(false); return; }
    if (this.vy < 0 && g.level.land(this.x, 0.05, prevY, this.y) !== null) { this.pop(false); return; }
    if (this.life <= 0) { this.pop(false); return; }
    this._sync();
  }

  pop(hit) {
    if (this.dead) return;
    this.dead = true;
    const g = this.g;
    g.scene.remove(this.spin);
    g.fx.shell(this.x, this.y, hit ? 6 : 4, 0.6);
    g.fx.glow(this.x, this.y, hit ? '#ffffff' : '#e8dcff', hit ? 1.8 : 1.0, 0.18);
    if (!hit) g.fx.burst(this.x, this.y, { count: 6, color: '#ffffff', speed: [1, 3], size: [0.1, 0.2], life: [0.2, 0.35] });
  }

  _sync() { this.spin.position.set(this.x, this.y, 0); }
}

const plasmaGeo = new THREE.SphereGeometry(0.2, 16, 12);
// shared per colour and never disposed (keeps the shader program alive)
const plasmaMats = new Map();
const plasmaMat = (c) => {
  if (!plasmaMats.has(c)) plasmaMats.set(c, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3) }));
  return plasmaMats.get(c);
};

export class Plasma {
  constructor(g, x, y, vx, vy, color = '#ff3fd0') {
    this.g = g;
    this.kind = 'plasma';
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.r = 0.24;
    this.life = 4;
    this.dead = false;
    this.color = color;
    this.mesh = new THREE.Mesh(plasmaGeo, plasmaMat(color));
    g.scene.add(this.mesh);
    this.mesh.position.set(x, y, 0);
  }

  update(dt) {
    const g = this.g;
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.mesh.position.set(this.x, this.y, 0);
    const s = 1 + Math.sin(this.life * 30) * 0.15;
    this.mesh.scale.setScalar(s);
    g.fx.burst(this.x, this.y, { count: 1, colors: [this.color, '#ffffff'], speed: [0, 0.8], size: [0.4, 0.7], life: [0.15, 0.3], z: 0 });
    const p = g.player;
    if (p.state === 'alive' && Math.abs(p.cx - this.x) < p.hw + this.r * 0.7 && Math.abs(p.cy - this.y) < p.h * 0.5 + this.r * 0.7) {
      p.hurt(this.x);
      this.destroy(true);
      return;
    }
    if (this.life <= 0 || this.x < ARENA.x0 || this.x > ARENA.x1 || this.y < -1 || g.level.wallAt(this.x, this.y, this.r * 0.5)) this.destroy(false);
  }

  destroy(big) {
    if (this.dead) return;
    this.dead = true;
    this.g.scene.remove(this.mesh);
    this.g.fx.sparks(this.x, this.y, this.color, big ? 14 : 6);
    this.g.fx.glow(this.x, this.y, this.color, 1.6, 0.2);
  }
}
