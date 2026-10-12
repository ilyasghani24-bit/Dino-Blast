import * as THREE from 'three';
import * as A from '../assets.js';
import { damp, rand, clamp } from './physics.js';
import { Enemy } from './enemy.js';
import { Plasma } from './shot.js';

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
beamGeo.translate(0, -0.5, 0);

function makeBeam(g, color) {
  const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, alphaMap: g.bg.beamTex,
  }));
  m.visible = false;
  m.renderOrder = 22;
  return m;
}

/** Hurry-up hunter: an invulnerable saucer that stalks the player with a tractor beam. */
export class Hunter {
  constructor(g) {
    this.g = g;
    this.x = g.player.x; this.y = 19;
    this.state = 'track'; this.t = 0; this.stateT = 2.5;
    this.root = new THREE.Group();
    this.ufo = A.clone('UFO');
    this.ufo.scale.setScalar(1.25);
    this.root.add(this.ufo);
    this.lights = this.ufo.getObjectByName('UFO_Lights');
    this.beam = makeBeam(g, '#ff4ae0');
    this.root.add(this.beam);
    g.scene.add(this.root);
    this.leaving = false;
    this.dead = false;
  }

  update(dt) {
    const g = this.g, p = g.player;
    this.t += dt;
    if (this.leaving) {
      this.y += dt * 12;
      if (this.y > 26) { this.remove(); return false; }
    } else {
      this.y = damp(this.y, 13.2, 2, dt);
      this.stateT -= dt;
      if (this.state === 'track') {
        this.x = damp(this.x, p.x, 1.6, dt);
        if (this.stateT <= 0) { this.state = 'charge'; this.stateT = 0.9; g.sfx.play('charge', { dur: 0.9 }); }
      } else if (this.state === 'charge') {
        if (this.stateT <= 0) { this.state = 'fire'; this.stateT = 0.7; g.sfx.play('beam'); g.fx.shake(0.2); }
      } else if (this.state === 'fire') {
        if (p.state === 'alive' && Math.abs(p.x - this.x) < 1.0) p.hurt(this.x);
        if (Math.random() < 0.6) g.fx.sparks(this.x + rand(-0.8, 0.8), g.level.land(this.x, 0.5, this.y, -5) ?? 0, '#ff4ae0', 2);
        if (this.stateT <= 0) { this.state = 'track'; this.stateT = 2.4; }
      }
    }
    const b = this.beam;
    const ground = g.level.land(this.x, 0.3, this.y - 0.5, -5) ?? 0;
    const len = this.y - 0.3 - ground;
    b.position.y = -0.3;
    if (this.state === 'charge') {
      b.visible = true;
      b.scale.set(0.12, len, 0.12);
      b.material.opacity = 0.4 + Math.sin(this.t * 50) * 0.4;
    } else if (this.state === 'fire') {
      b.visible = true;
      b.scale.set(1.0 + Math.sin(this.t * 40) * 0.08, len, 1.0);
      b.material.opacity = 0.85;
    } else b.visible = false;
    if (this.lights) this.lights.rotation.y = this.t * 4;
    this.ufo.rotation.z = Math.sin(this.t * 2) * 0.08;
    this.root.position.set(this.x, this.y + Math.sin(this.t * 3) * 0.2, 0.3);
    return true;
  }

  leave() { this.leaving = true; this.beam.visible = false; }
  remove() { this.dead = true; this.g.scene.remove(this.root); }
}

/** Final boss: Mothership Zorgax. */
export class Boss {
  constructor(g) {
    this.g = g;
    this.maxHp = 40 * (0.8 + g.difficulty * 0.2);
    this.hp = this.maxHp;
    this.x = 0; this.y = 22;
    this.state = 'enter';
    this.t = 0; this.flash = 0; this.phase = 1;
    this.atkT = 2.5; this.atk = null; this.atkStep = 0; this.pattern = 0;
    this.swoop = 0; this.targetY = 10.9; this.targetX = 0;
    this.invul = 0; this.dead = false;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.ufo = A.cloneUnique('UFO');
    this.ufo.scale.setScalar(2.5);
    this.tilt.add(this.ufo);
    this.lights = this.ufo.getObjectByName('UFO_Lights');
    this.lightMats = A.findMat(this.ufo, 'UFO_Light');
    this.pilot = A.cloneUnique('Alien');
    this.pilot.scale.setScalar(1.05);
    this.pilot.position.set(0, 0.05, 0);
    this.pilot.rotation.y = 0.3;
    for (const m of A.findMat(this.pilot, 'Alien_Helmet')) m.color.set('#ff2a8a');
    this.tilt.add(this.pilot);
    this.pilotHead = this.pilot.getObjectByName('Alien_Head');
    this.pilotArmL = this.pilot.getObjectByName('Alien_ArmL');
    this.pilotArmR = this.pilot.getObjectByName('Alien_ArmR');
    this.beam = makeBeam(g, '#5aff9a');
    this.root.add(this.beam);
    // under-glow sprite (a real light would change the light count and force
    // every material in the scene to recompile)
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: g.bg.glowTex, color: '#5aff9a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.glow.scale.set(9, 4, 1);
    this.glow.position.y = -0.9;
    this.root.add(this.glow);
    g.scene.add(this.root);
    this.root.position.set(this.x, this.y, 0);
  }

  hitTest(x, y, r) {
    if (this.state !== 'fight') return false;
    const ex = (x - this.x) / (3.0 + r), ey = (y - this.y) / (1.0 + r);
    return ex * ex + ey * ey < 1;
  }

  damage(n, x, y, src) {
    const g = this.g;
    if (this.state !== 'fight') return;
    if (src === 'egg') {
      if (this.invul > 0) return;
      this.invul = 0.25;
      g.sfx.play('bosshit');
      g.fx.shake(0.6);
      g.hitstop(0.13);
      g.post.kick({ aberration: 0.02, flash: 0.2, bloom: 0.8, color: '#ffffff' });
      g.fx.sparks(x, y, '#ffe066', 28, 1.5);
      g.fx.ring(x, y, '#ffffff', 5, 0.45, 1.3);
      g.fx.text('-' + Math.round(n) + '!', x, y + 1, 'big pink', 1.0);
      g.cameraPunch(0.8);
      this.flash = 1;
      this.tilt.rotation.z += (x < this.x ? -1 : 1) * 0.35;
    } else {
      g.sfx.play('hit', { stage: 1 });
      g.fx.sparks(x, y, '#ffffff', 5, 0.6);
      this.flash = Math.max(this.flash, 0.4);
    }
    this.hp = Math.max(0, this.hp - n);
    g.hud.boss(this.hp / this.maxHp);
    if (this.hp <= 0) return this.die();
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      g.fx.text('ENRAGED!', this.x, this.y + 2, 'big pink', 1.4);
      g.sfx.play('hurry');
      for (const m of this.lightMats) { m.color.set('#ff2a2a'); m.emissive.set('#ff2a2a'); m.userData.baseEmissive.set('#ff2a2a'); }
      this.glow.material.color.set('#ff3a5a');
      this.beam.material.color.set('#ff4a6a');
    }
  }

  die() {
    const g = this.g;
    this.state = 'dying';
    this.dieT = 0;
    this.beam.visible = false;
    g.sfx.play('explode', { dur: 1.5 });
    g.slowmo(0.25, 1.4);
    g.focusOn(this.x, this.y, 2.2);
    g.post.kick({ flash: 0.7, radial: 0.35, aberration: 0.04 });
    g.fx.text('K.O.!', this.x, this.y + 2, 'big gold', 2.0);
    for (const e of g.enemies) if (e.alive && e.state !== 'spawn') e.killBy(e.x > this.x ? 1 : -1, 1);
    for (const h of g.hazards) h.destroy && h.destroy(false);
  }

  update(dt) {
    const g = this.g, p = g.player;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.invul -= dt;
    if (this.state === 'enter') {
      this.y = damp(this.y, 10.9, 1.4, dt);
      if (Math.random() < dt * 8) g.fx.shake(0.05);
      if (this.y < 11.2) { this.state = 'fight'; g.hud.boss(1); }
    } else if (this.state === 'fight') {
      this._fight(dt);
    } else if (this.state === 'dying') {
      this.dieT += dt;
      this.y -= dt * 1.2;
      this.tilt.rotation.z = Math.sin(this.t * 30) * 0.15 + this.dieT * 0.4;
      if (Math.random() < dt * 14) {
        const ex = this.x + rand(-2.5, 2.5), ey = this.y + rand(-0.8, 0.8);
        g.fx.burst(ex, ey, { count: 16, colors: ['#ffffff', '#ffd23a', '#ff6a00'], speed: [3, 9], size: [0.5, 1.1], life: [0.3, 0.6] });
        g.fx.smoke(ex, ey, 3, '#3a3040', 1, [0.8, 1.4]);
        g.fx.ring(ex, ey, '#ffb000', 2.5, 0.3);
        g.sfx.play('kill', { combo: 1 + ((Math.random() * 8) | 0) });
        g.fx.shake(0.3);
      }
      if (this.dieT > 3.0) {
        g.fx.burst(this.x, this.y, { count: 120, colors: ['#ffffff', '#ffd23a', '#ff6a00', '#ff3fa0', '#5aff9a'], speed: [6, 22], size: [0.5, 1.4], life: [0.6, 1.4], drag: 1.5 });
        g.fx.confetti(this.x, this.y, 140, 1.4);
        g.fx.shell(this.x, this.y, 40, 2);
        g.fx.ring(this.x, this.y, '#ffffff', 14, 0.8, 1.2);
        g.fx.ring(this.x, this.y, '#ffd23a', 9, 0.6, 1.6);
        g.fx.shake(1.2);
        g.post.kick({ flash: 1, radial: 0.4, aberration: 0.05, bloom: 1.5 });
        g.sfx.play('explode', { dur: 2.2 });
        for (let i = 0; i < 30; i++) g.dropLoot(this.x + rand(-2, 2), this.y, 'coin');
        this.remove();
        g.onBossDefeated();
        return false;
      }
    }
    // presentation
    this.root.position.set(this.x, this.y + Math.sin(this.t * 1.6) * 0.15, 0);
    this.tilt.rotation.z = damp(this.tilt.rotation.z, clamp(-(this.targetX - this.x) * 0.05, -0.25, 0.25), 3, dt);
    if (this.lights) this.lights.rotation.y = this.t * (this.phase === 2 ? 6 : 3);
    this.pilotHead.rotation.z = Math.sin(this.t * 3) * 0.1;
    this.pilotArmL.rotation.z = 1.2 + Math.sin(this.t * 8) * 0.3;
    this.pilotArmR.rotation.z = 1.2 + Math.sin(this.t * 8 + 2) * 0.3;
    this.pilot.rotation.y = p.x > this.x ? -0.5 : Math.PI + 0.5;
    A.setFlash(this.ufo, this.flash);
    A.setFlash(this.pilot, this.flash);
    this.glow.material.opacity = 0.7 + Math.sin(this.t * 6) * 0.2;
    return true;
  }

  _fight(dt) {
    const g = this.g, p = g.player;
    const fast = this.phase === 2 ? 1.45 : 1;
    // cruising
    if (!this.atk || this.atk === 'volley' || this.atk === 'drop') {
      this.targetX = Math.sin(this.t * 0.45 * fast) * 6.3;
    }
    this.x = damp(this.x, this.targetX, this.atk === 'beam' ? 3.5 : 1.3, dt);
    this.y = damp(this.y, this.swoop > 0 ? 4.7 : 10.9, 1.8, dt);
    if (this.swoop > 0) {
      this.swoop -= dt;
      this.targetX = clamp(this.targetX + Math.sign(p.x - this.targetX) * dt * 2.5, -6.5, 6.5);
      if (Math.random() < dt * 10) g.fx.dust(this.x + rand(-2, 2), Math.max(0, this.y - 4.5), 1);
    }
    // contact damage
    if (p.state === 'alive') {
      const ex = (p.cx - this.x) / 2.6, ey = (p.cy - this.y) / 1.0;
      if (ex * ex + ey * ey < 1) p.hurt(this.x);
    }
    // attack scheduler
    this.atkT -= dt;
    if (!this.atk && this.atkT <= 0) {
      const seq = ['drop', 'volley', 'beam', 'swoop', 'volley', 'drop', 'beam'];
      this.atk = seq[this.pattern++ % seq.length];
      this.atkStep = 0;
      this.atkClock = 0;
    }
    if (!this.atk) return;
    this.atkClock += dt;
    const c = this.atkClock;
    switch (this.atk) {
      case 'drop': {
        const alive = g.enemies.filter((e) => e.alive).length;
        const max = this.phase === 2 ? 4 : 3;
        if (alive < max) {
          const types = ['basic', 'jumper', 'shooter'];
          const e = new Enemy(g, types[(Math.random() * (this.phase === 2 ? 3 : 2)) | 0], this.x, this.y - 1.2, { dropIn: true });
          e.vy = 3; e.vx = rand(-3, 3);
          g.enemies.push(e);
          g.sfx.play('teleport');
          g.fx.ring(this.x, this.y - 1, '#5aff9a', 2.5, 0.3);
          this.beam.visible = true;
          this.flashBeam = 0.3;
        }
        this._end(1.6);
        break;
      }
      case 'volley': {
        const n = this.phase === 2 ? 3 : 2;
        const interval = 0.55;
        if (this.atkStep < n && c > this.atkStep * interval + 0.4) {
          const k = this.phase === 2 ? 7 : 5;
          for (let i = 0; i < k; i++) {
            const a = -Math.PI / 2 + (i / (k - 1) - 0.5) * 2.2 + (this.atkStep % 2) * 0.12;
            g.hazards.push(new Plasma(g, this.x, this.y - 0.8, Math.cos(a) * 6.2, Math.sin(a) * 6.2, this.phase === 2 ? '#ff3a5a' : '#ff3fd0'));
          }
          g.sfx.play('laser');
          g.fx.ring(this.x, this.y - 0.8, '#ff8ae0', 2, 0.25);
          this.atkStep++;
        }
        if (c > n * interval + 0.8) this._end(1.4);
        break;
      }
      case 'beam': {
        if (this.atkStep === 0) {
          this.targetX = clamp(p.x, -7, 7);
          if (c > 0.8) { this.atkStep = 1; g.sfx.play('charge', { dur: 0.9 }); }
        } else if (this.atkStep === 1) {
          if (c > 1.7) { this.atkStep = 2; g.sfx.play('beam'); g.fx.shake(0.35); }
        } else if (this.atkStep === 2) {
          if (this.phase === 2) this.targetX = clamp(this.targetX + Math.sign(p.x - this.targetX) * dt * 3, -7, 7);
          if (p.state === 'alive' && Math.abs(p.x - this.x) < 1.25 && p.y < this.y) p.hurt(this.x);
          if (Math.random() < 0.8) g.fx.sparks(this.x + rand(-1.2, 1.2), 0.1, this.phase === 2 ? '#ff4a6a' : '#5aff9a', 2);
          if (c > 2.8) this._end(1.2);
        }
        break;
      }
      case 'swoop': {
        if (this.atkStep === 0) { this.swoop = 3.6; this.atkStep = 1; g.fx.text('INCOMING!', this.x, this.y - 1.5, 'pink', 1); g.sfx.play('hurry'); }
        if (this.swoop <= 0) this._end(1.0);
        break;
      }
    }
    // beam visual
    const b = this.beam;
    const len = this.y - 0.6;
    b.position.y = -0.6;
    if (this.atk === 'beam' && this.atkStep === 1) {
      b.visible = true; b.scale.set(0.14, len, 0.14); b.material.opacity = 0.4 + Math.sin(this.t * 50) * 0.4;
    } else if (this.atk === 'beam' && this.atkStep === 2) {
      b.visible = true; b.scale.set(1.25 + Math.sin(this.t * 40) * 0.1, len, 1.25); b.material.opacity = 0.9;
    } else if (this.flashBeam > 0) {
      this.flashBeam -= dt;
      b.visible = true; b.scale.set(0.8, 2, 0.8); b.material.opacity = this.flashBeam * 2;
    } else b.visible = false;
  }

  _end(cool) {
    this.atk = null;
    this.atkT = cool / (this.phase === 2 ? 1.4 : 1);
  }

  remove() {
    this.dead = true;
    this.g.scene.remove(this.root);
  }
}
