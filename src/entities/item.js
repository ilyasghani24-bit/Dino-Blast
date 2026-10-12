import * as THREE from 'three';
import * as A from '../assets.js';
import { stepBody, damp, rand } from './physics.js';
import { POWER_INFO } from './player.js';

const KINDS = {
  coin: { model: 'Coin', scale: 0.85, lift: 0.3 },
  heart: { model: 'Heart', scale: 1.5, lift: 0.35 },
  speed: { model: 'Potion', scale: 1.25, color: '#ff3f6a' },
  power: { model: 'Potion', scale: 1.25, color: '#3ad8ff' },
  rapid: { model: 'Potion', scale: 1.25, color: '#ffd23a' },
};

export class Item {
  constructor(g, kind, x, y, vx = rand(-3, 3), vy = rand(6, 11)) {
    this.g = g;
    this.kind = kind;
    const k = KINDS[kind];
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.hw = 0.2;
    this.life = 11;
    this.t = Math.random() * 6;
    this.dead = false;
    this.grounded = false;
    this.magnet = false;
    this.root = new THREE.Group();
    this.mesh = k.color ? A.cloneUnique(k.model) : A.clone(k.model);
    this.mesh.scale.setScalar(k.scale);
    this.mesh.position.y = k.lift || 0;
    if (k.color) {
      for (const m of A.findMat(this.mesh, 'Potion_Liquid')) { m.color.set(k.color); m.emissive.set(k.color); }
    }
    this.root.add(this.mesh);
    g.scene.add(this.root);
    this.root.position.set(x, y, 0);
  }

  update(dt) {
    const g = this.g, p = g.player;
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.remove(); g.fx.glow(this.x, this.y + 0.3, '#ffffff', 1, 0.2); return false; }
    const dx = p.cx - this.x, dy = p.cy - (this.y + 0.3);
    const dist = Math.hypot(dx, dy);
    if (p.state === 'alive' && (dist < 2.3 || g.state === 'clear') && this.t > 0.4) this.magnet = true;
    if (this.magnet && p.state === 'alive') {
      const pull = g.state === 'clear' ? 60 : 45;
      this.vx = damp(this.vx, (dx / Math.max(dist, 0.01)) * 14, pull * 0.15, dt);
      this.vy = damp(this.vy, (dy / Math.max(dist, 0.01)) * 14, pull * 0.15, dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    } else {
      const res = stepBody(this, g.level, dt, { gravity: 30 });
      if (res.landed && res.landV < -3) { this.vy = -res.landV * 0.45; this.grounded = false; }
      if (this.grounded) this.vx = damp(this.vx, 0, 6, dt);
    }
    if (dist < 0.75 && p.state === 'alive') { this.collect(); return false; }
    // presentation
    this.mesh.rotation.y = this.kind === 'coin' ? this.t * 5 : Math.sin(this.t * 2) * 0.5;
    this.mesh.position.y = (KINDS[this.kind].lift || 0) + (this.grounded ? Math.sin(this.t * 4) * 0.06 + 0.06 : 0);
    this.root.visible = this.life > 2.5 || Math.floor(this.t * 12) % 2 === 0;
    this.root.position.set(this.x, this.y, 0);
    if (this.kind !== 'coin' && Math.random() < dt * 10) {
      g.fx.burst(this.x + rand(-0.3, 0.3), this.y + rand(0, 0.7), { count: 1, color: KINDS[this.kind].color || '#ff6a8a', speed: [0.3, 1], angle: Math.PI / 2, spread: 1, size: [0.12, 0.25], life: [0.4, 0.6], shape: 1, spin: 6 });
    }
    return true;
  }

  collect() {
    const g = this.g, p = g.player;
    const y = this.y + 0.4;
    switch (this.kind) {
      case 'coin':
        g.sfx.play('coin');
        g.addCoins(1);
        g.addScore(100);
        g.fx.burst(this.x, y, { count: 8, colors: ['#ffe066', '#ffffff'], speed: [2, 5], size: [0.15, 0.3], life: [0.2, 0.4], shape: 1, spin: 8 });
        break;
      case 'heart':
        g.sfx.play('heal');
        if (p.hearts < p.maxHearts) {
          p.hearts++;
          g.hud.hearts(p.hearts, p.maxHearts);
          g.fx.text('+1 HEART', this.x, y + 0.5, 'pink', 1);
        } else {
          g.addScore(2000, this.x, y, 'pink');
        }
        g.fx.ring(this.x, y, '#ff6a8a', 2.2, 0.35);
        break;
      default: {
        const info = POWER_INFO[this.kind];
        g.sfx.play('power');
        p.addPower(this.kind);
        g.fx.text(info.label + '!', this.x, y + 0.5, 'cyan', 1.1);
        g.fx.ring(this.x, y, info.color, 3, 0.4);
        g.fx.burst(this.x, y, { count: 20, color: info.color, speed: [3, 8], size: [0.3, 0.6], life: [0.3, 0.6], shape: 1, spin: 10 });
        g.post.kick({ bloom: 0.5, flash: 0.08, color: info.color });
      }
    }
    this.remove();
  }

  remove() {
    if (this.dead) return;
    this.dead = true;
    this.g.scene.remove(this.root);
  }
}
