import * as THREE from 'three';
import * as A from '../assets.js';
import { stepBody, rand, damp, clamp } from './physics.js';
import { Plasma } from './shot.js';

const TYPES = {
  basic: { speed: 2.3, jump: 0.3, helmet: '#2848d6', bulb: '#ffd21a', jumpV: 16.8 },
  jumper: { speed: 2.9, jump: 0.8, helmet: '#9a2cff', bulb: '#3ad8ff', jumpV: 17.8 },
  shooter: { speed: 1.9, jump: 0.2, helmet: '#e02848', bulb: '#ff3a3a', jumpV: 16.8, shoots: true },
};
const EGG_H = 1.45;
export const BALL_R = 0.63;
const ROLL_SPEED = 14.5;
const HATCH_TIME = 7.5;
const FACE_R = -0.55, FACE_L = Math.PI + 0.55;
const beamGeo = new THREE.CylinderGeometry(0.75, 0.75, 18, 24, 1, true);
const ANGRY = new THREE.Color('#ff3030');

export class Enemy {
  constructor(g, type, x, y, { delay = 0, dropIn = false } = {}) {
    this.g = g;
    this.type = type;
    this.cfg = TYPES[type];
    this.x = x; this.y = y; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.hw = 0.37; this.h = 1.15;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.grounded = false; this.groundSeg = null;
    this.state = dropIn ? 'air' : 'spawn';
    this.spawnT = 0.9 + delay;
    this.cov = 0; this.covVis = 0; this.covV = 0; this.decayT = 0; this.eggT = 0;
    this.think = rand(0.3, 1.2); this.edgeRoll = null;
    this.shootCd = rand(2, 4); this.charge = 0;
    this.angry = false; this.flash = 0; this.sq = 0; this.sqV = 0; this.pop = 0; this.popV = 0;
    this.t = Math.random() * 10; this.phase = 0;
    this.combo = 0; this.rollT = 0; this.wallHits = 0; this.rollDir = 1;
    this.dead = false; this.shown = dropIn;

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.model = A.cloneUnique('Alien');
    this.model.scale.setScalar(0.8);
    this.pivot.add(this.model);
    const n = (k) => this.model.getObjectByName(k);
    this.parts = {
      body: n('Alien_Body'), head: n('Alien_Head'), antenna: n('Alien_Antenna'),
      armL: n('Alien_ArmL'), armR: n('Alien_ArmR'), legL: n('Alien_LegL'), legR: n('Alien_LegR'),
    };
    this.base = {};
    for (const [k, o] of Object.entries(this.parts)) this.base[k] = { p: o.position.clone(), r: o.rotation.clone() };
    this.helmetMats = A.findMat(this.model, 'Alien_Helmet');
    this.bulbMats = A.findMat(this.model, 'Alien_Bulb');
    this.skinMats = A.findMat(this.model, 'Alien_Skin');
    for (const m of this.helmetMats) m.color.set(this.cfg.helmet);
    for (const m of this.bulbMats) { m.color.set(this.cfg.bulb); m.emissive.set(this.cfg.bulb); m.userData.baseEmissive.set(this.cfg.bulb); }

    // egg shell, revealed bottom-up with a world-space clipping plane
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.eggSpin = new THREE.Group();
    this.eggSpin.position.y = BALL_R;
    this.eggTip = new THREE.Group();
    this.eggSpin.add(this.eggTip);
    this.egg = A.cloneUnique('Egg');
    this.egg.scale.setScalar(1.12);
    this.egg.position.y = -0.58 * 1.12;
    this.eggTip.add(this.egg);
    for (const m of this.egg.userData.mats) { m.clippingPlanes = [this.clip]; m.clipShadows = true; m.side = THREE.DoubleSide; }
    this.eggSpin.visible = false;
    this.root.add(this.eggSpin);

    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: this.cfg.bulb, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, alphaMap: g.bg.beamTex }));
    this.beam.position.y = 9;
    this.beam.rotation.x = Math.PI;
    this.root.add(this.beam);
    this.model.visible = dropIn;
    g.scene.add(this.root);
    this._sync();
  }

  get cy() { return this.state === 'egg' || this.state === 'roll' ? this.y + BALL_R : this.y + this.h * 0.5; }
  get alive() { return this.state !== 'dying' && !this.dead; }
  get harmful() { return this.state === 'walk' || this.state === 'air'; }

  hitTest(x, y, r) {
    switch (this.state) {
      case 'walk': case 'air': case 'stuck':
        return Math.abs(x - this.x) < this.hw + r && y > this.y - r && y < this.y + this.h + r;
      case 'egg':
        return Math.hypot(x - this.x, y - (this.y + BALL_R)) < BALL_R + r;
      default:
        return false;
    }
  }

  hitByShot(shot) {
    const g = this.g;
    if (this.state === 'walk' || this.state === 'air' || this.state === 'stuck') {
      this.addCoverage(shot.power, shot.dir);
      return true;
    }
    if (this.state === 'egg') {
      this.vx += shot.dir * 3.4;
      this.eggT = Math.max(0, this.eggT - 1.2);
      this.flash = 0.6;
      this.sq = -0.12;
      g.sfx.play('push');
      g.fx.burst(this.x - shot.dir * 0.5, this.y + BALL_R, { count: 6, colors: ['#ffffff', '#c9a8ff'], speed: [2, 4], size: [0.15, 0.3], life: [0.2, 0.3] });
      return true;
    }
    return false;
  }

  addCoverage(n, dir) {
    const g = this.g;
    this.cov = Math.min(4, Math.floor(this.cov + 0.001) + n);
    this.decayT = 0;
    this.flash = 1;
    this.sq = -0.25;
    this.vx = dir * 2;
    this.covV += 6;
    g.sfx.play('hit', { stage: this.cov });
    g.fx.shell(this.x, this.y + 0.6, 4, 0.5, this.y);
    g.fx.burst(this.x, this.y + 0.6, { count: 10, colors: ['#ffffff', '#e0d0ff', '#9a4cff'], speed: [2, 6], size: [0.2, 0.4], life: [0.2, 0.4], drag: 4 });
    g.addScore(10);
    if (this.cov >= 4) this.encase(dir);
    else this.state = 'stuck';
  }

  encase(dir) {
    const g = this.g;
    this.state = 'egg';
    this.cov = 4;
    this.eggT = 0;
    this.hw = BALL_R;
    this.vx = dir * 1.5;
    this.popV = 9;
    g.sfx.play('capture');
    g.fx.ring(this.x, this.y + 0.6, '#ffffff', 2.6, 0.35);
    g.fx.stars(this.x, this.y + 0.9, 10);
    g.fx.burst(this.x, this.y + 0.6, { count: 24, colors: ['#ffffff', '#c9a8ff', '#9a4cff'], speed: [4, 10], size: [0.2, 0.45], life: [0.3, 0.6], drag: 3 });
    g.fx.shake(0.18);
    g.hitstop(0.06);
    g.fx.text('EGGED!', this.x, this.y + 1.5, 'green', 0.8);
    g.addScore(100);
    g.onCapture(this);
  }

  kick(dir, by = null) {
    const g = this.g;
    this.state = 'roll';
    this.hw = BALL_R;
    this.rollDir = dir;
    this.vx = dir * ROLL_SPEED;
    this.vy = 4;
    this.rollT = 0;
    this.wallHits = 0;
    if (by) this.combo = 0;
    this.model.visible = false;
    g.sfx.play('kick');
    g.fx.shake(by ? 0.35 : 0.25);
    g.hitstop(by ? 0.07 : 0.04);
    g.post.kick({ aberration: 0.01, bloom: 0.35 });
    g.fx.ring(this.x - dir * 0.3, this.y + BALL_R, '#ffe066', 3, 0.3, 1.4);
    g.fx.sparks(this.x - dir * 0.4, this.y + BALL_R, '#ffe066', 22, 1.2);
    g.fx.dust(this.x, this.y, 10, -dir);
    if (by) {
      g.fx.text('KICK!', this.x, this.y + 1.6, 'gold', 0.6);
      g.cameraPunch(0.5);
    }
  }

  killBy(dir, combo, cause = 'roll') {
    const g = this.g;
    if (!this.alive) return;
    this.state = 'dying';
    this.dieT = 0;
    this.vx = dir * rand(6, 10);
    this.vy = rand(13, 17);
    this.vz = rand(5, 8);
    this.spinDir = dir;
    this.flash = 1;
    this.model.visible = true;
    this.eggSpin.visible = false;
    for (const m of this.skinMats) m.color.set('#b8ff7a');
    g.sfx.play('kill', { combo });
    g.fx.sparks(this.x, this.cy, '#ffffff', 26, 1.4);
    g.fx.ring(this.x, this.cy, combo > 2 ? '#ff8ae0' : '#ffffff', 2.5 + combo * 0.4, 0.35);
    g.fx.glow(this.x, this.cy, '#ffffff', 3.5, 0.2);
    g.fx.stars(this.x, this.cy, 6 + combo * 2);
    g.hitstop(Math.min(0.14, 0.05 + combo * 0.015));
    g.fx.shake(0.25 + Math.min(0.4, combo * 0.08));
    g.onKill(this, combo, cause);
  }

  shatter() {
    const g = this.g;
    const cx = this.x, cy = this.y + BALL_R;
    g.sfx.play('break');
    g.fx.shell(cx, cy, 30, 1.4, this.y);
    g.fx.confetti(cx, cy, 30, 0.9);
    g.fx.ring(cx, cy, '#ffd23a', 4.5, 0.45, 1.3);
    g.fx.smoke(cx, cy, 5, '#f4ecff', 1.2, [0.4, 0.7]);
    g.post.kick({ flash: 0.15, bloom: 0.6 });
    this.combo++;
    g.onShatter(this);
    this.killBy(-this.rollDir, this.combo, 'shatter');
  }

  hatch() {
    const g = this.g;
    this.state = 'air';
    this.cov = 0; this.covVis = 0;
    this.hw = 0.37;
    this.angry = true;
    this.vy = 11;
    this.model.visible = true;
    this.eggTip.rotation.z = 0;
    for (const m of this.helmetMats) m.color.lerp(ANGRY, 0.6);
    for (const m of this.bulbMats) { m.emissive.set('#ff2020'); m.userData.baseEmissive.set('#ff2020'); m.color.set('#ff2020'); }
    g.sfx.play('break');
    g.fx.shell(this.x, this.y + 0.6, 22, 1.0, this.y);
    g.fx.ring(this.x, this.y + 0.6, '#ff5050', 2.6, 0.3);
    g.fx.text('GRRR!', this.x, this.y + 1.5, 'pink', 0.8);
    g.fx.shake(0.15);
  }

  enrage() {
    if (this.angry || !this.alive) return;
    this.angry = true;
    for (const m of this.helmetMats) m.color.lerp(ANGRY, 0.6);
  }

  jump() {
    this.vy = this.cfg.jumpV * (this.angry ? 1.03 : 1);
    this.sq = 0.25;
    this.g.fx.dust(this.x, this.y, 4);
  }

  update(dt) {
    const g = this.g;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    switch (this.state) {
      case 'spawn': this._spawn(dt); break;
      case 'walk': case 'air': this._walk(dt); break;
      case 'stuck': this._stuck(dt); break;
      case 'egg': this._egg(dt); break;
      case 'roll': this._roll(dt); break;
      case 'dying': this._dying(dt); break;
    }
    if (!this.dead) this._visual(dt);
    return !this.dead;
  }

  _spawn(dt) {
    const g = this.g;
    this.spawnT -= dt;
    const k = this.spawnT;
    if (k < 0.9) {
      const p = (0.9 - k) / 0.9;
      this.beam.material.opacity = Math.sin(p * Math.PI) * 0.85;
      this.beam.scale.set(1 - p * 0.6, 1, 1 - p * 0.6);
      if (Math.random() < 0.5) g.fx.burst(this.x + rand(-0.6, 0.6), this.y + rand(0, 2.5), { count: 1, color: this.cfg.bulb, speed: [0.5, 2], angle: -Math.PI / 2, spread: 0.5, size: [0.2, 0.35], life: [0.3, 0.5], shape: 1, spin: 8 });
    }
    if (k < 0.4 && !this.shown) {
      this.shown = true;
      this.model.visible = true;
      this.popV = 12;
      this.pop = -0.9;
      g.sfx.play('teleport');
      g.fx.ring(this.x, this.y + 0.5, this.cfg.bulb, 2, 0.3);
      g.fx.stars(this.x, this.y + 0.6, 6, [this.cfg.bulb, '#ffffff']);
    }
    if (k <= 0) {
      this.state = 'air';
      this.beam.visible = false;
    }
  }

  _walk(dt) {
    const g = this.g, cfg = this.cfg, p = g.player;
    const spd = cfg.speed * (this.angry ? 1.5 : 1) * g.difficulty;
    if (this.grounded) {
      if (this.charge > 0) {
        this.vx = damp(this.vx, 0, 12, dt);
        this.charge -= dt;
        this.flash = 0.35 + Math.sin(this.t * 40) * 0.35;
        if (this.charge <= 0) {
          g.hazards.push(new Plasma(g, this.x + this.dir * 0.5, this.y + 0.75, this.dir * 6.5 * (this.angry ? 1.3 : 1), 0));
          g.sfx.play('plasma');
          this.sq = -0.2;
        }
      } else {
        this.vx = damp(this.vx, this.dir * spd, 10, dt);
        const ahead = this.x + this.dir * (this.hw + 0.2);
        if (!g.level.groundAt(ahead, this.y)) {
          if (this.edgeRoll === null) this.edgeRoll = Math.random();
          if (this.edgeRoll > 0.5) { this.dir = -this.dir; this.edgeRoll = null; }
        } else this.edgeRoll = null;
        this.think -= dt;
        if (this.think <= 0) {
          this.think = rand(0.5, 1.3) / (this.angry ? 1.5 : 1);
          const above = g.level.platformAbove(this.x, this.y);
          const chase = p.state === 'alive' && p.y > this.y + 1.5;
          if (above && ((chase && Math.random() < 0.45 + cfg.jump * 0.4) || Math.random() < cfg.jump * 0.45)) this.jump();
          else if (Math.random() < 0.35) this.dir = p.x > this.x ? 1 : -1;
          else if (Math.random() < 0.1) this.dir = -this.dir;
        }
        if (cfg.shoots) {
          this.shootCd -= dt;
          if (this.shootCd <= 0 && p.state === 'alive' && Math.abs(p.y - this.y) < 1.2 && Math.abs(p.x - this.x) < 12) {
            this.dir = p.x > this.x ? 1 : -1;
            this.charge = 0.55;
            this.shootCd = rand(2.6, 4.2) / g.difficulty;
            g.sfx.play('charge', { dur: 0.5 });
          }
        }
      }
    }
    const res = stepBody(this, g.level, dt);
    if (res.wall) this.dir = -res.wall;
    if (res.landed) { this.sq = -0.22; this.edgeRoll = null; }
    this.state = this.grounded ? 'walk' : 'air';
  }

  _stuck(dt) {
    const g = this.g;
    this.vx = damp(this.vx, 0, 8, dt);
    stepBody(this, g.level, dt);
    this.decayT += dt;
    if (this.decayT > 2.4) {
      this.cov -= dt * 0.75;
      if (Math.random() < dt * 5) {
        g.fx.shell(this.x, this.y + (this.cov / 4) * EGG_H, 1, 0.4, this.y);
        g.sfx.play('crack');
      }
      if (this.cov <= 0) {
        this.cov = 0;
        this.state = 'walk';
        this.jump();
      }
    }
  }

  _egg(dt) {
    const g = this.g, p = g.player;
    this.vx = damp(this.vx, 0, 4, dt);
    const res = stepBody(this, g.level, dt);
    if (res.wall) this.vx = -this.vx * 0.3;
    if (res.landed && res.landV < -7) {
      this.vy = -res.landV * 0.3;
      this.sq = -0.25;
      g.fx.dust(this.x, this.y, 6);
      g.sfx.play('bounce');
    }
    this.eggT += dt;
    const warn = HATCH_TIME - 2;
    if (this.eggT > warn) {
      const k = (this.eggT - warn) / 2;
      this.eggTip.rotation.z = Math.sin(this.t * (20 + k * 30)) * 0.12 * (0.3 + k);
      if (Math.random() < dt * (3 + k * 10)) { g.sfx.play('wobble'); g.fx.shell(this.x, this.y + 1.1, 1, 0.3, this.y); }
    } else this.eggTip.rotation.z = damp(this.eggTip.rotation.z, 0, 10, dt);
    if (this.eggT > HATCH_TIME) { this.hatch(); return; }
    // player pushes the egg by walking into it
    if (p.state === 'alive' && Math.abs(p.y - this.y) < 0.7) {
      const dx = this.x - p.x;
      const minD = BALL_R + p.hw;
      if (Math.abs(dx) < minD) {
        const s = Math.sign(dx) || p.facing;
        if (Math.sign(p.vx) === s && Math.abs(p.vx) > 0.5) {
          this.vx = s * 2.8;
          p.pushing = 0.1;
          this.spinPush = (this.spinPush || 0) + s * dt * 5;
          if (Math.random() < dt * 8) { g.fx.dust(this.x - s * 0.4, this.y, 1, -s); }
        }
        p.x = this.x - s * minD;
      }
    }
  }

  _roll(dt) {
    const g = this.g;
    this.rollT += dt;
    this.vx = this.rollDir * ROLL_SPEED;
    const res = stepBody(this, g.level, dt);
    if (res.wall) {
      this.rollDir = -res.wall;
      this.wallHits++;
      this.sq = -0.3;
      g.fx.dust(this.x + res.wall * BALL_R, this.y + BALL_R, 8, -res.wall);
      g.fx.ring(this.x + res.wall * BALL_R, this.y + BALL_R, '#ffffff', 2, 0.25);
      g.fx.shake(0.22);
      g.sfx.play('bounce');
      const onFloor = this.grounded && this.groundSeg && this.groundSeg.floor;
      if ((this.wallHits >= 3 && onFloor) || this.wallHits >= 6) { this.shatter(); return; }
    }
    if (res.landed && res.landV < -6) {
      this.vy = -res.landV * 0.32;
      this.sq = -0.25;
      g.fx.dust(this.x, this.y, 10);
      g.fx.shake(0.15);
      g.sfx.play('bounce');
    }
    if (this.rollT > 9) { this.shatter(); return; }
    // trail
    if (Math.random() < 0.9) g.fx.burst(this.x - this.rollDir * 0.3, this.y + BALL_R + rand(-0.3, 0.3), { count: 1, colors: ['#ffe066', '#ffffff', '#ff8ae0'], speed: [0.5, 2], size: [0.3, 0.6], life: [0.2, 0.4], angle: this.rollDir > 0 ? Math.PI : 0, spread: 0.6 });
    if (this.grounded && Math.random() < 0.5) g.fx.dust(this.x, this.y, 1, -this.rollDir);
    // plough through other aliens
    const cx = this.x, cy = this.y + BALL_R;
    for (const e of g.enemies) {
      if (e === this || !e.alive) continue;
      if (e.state === 'walk' || e.state === 'air' || e.state === 'stuck') {
        if (Math.abs(e.x - cx) < BALL_R + e.hw && cy > e.y - BALL_R && cy < e.y + e.h + BALL_R) {
          this.combo++;
          e.killBy(this.rollDir, this.combo);
        }
      } else if (e.state === 'egg') {
        if (Math.hypot(e.x - cx, e.y + BALL_R - cy) < BALL_R * 2) {
          this.combo++;
          const d = Math.sign(e.x - cx) || this.rollDir;
          e.combo = this.combo;
          e.kick(d);
          e.vy = 9;
          g.fx.text('CHAIN!', e.x, e.y + 1.6, 'cyan', 0.7);
        }
      }
    }
    // bounce the player (harmless ride)
    const p = g.player;
    if (p.state === 'alive' && !p.bounced && p.vy <= 2 && Math.abs(p.x - cx) < BALL_R + p.hw && p.y < cy + BALL_R && p.y + p.h > cy - BALL_R) {
      p.bounceOff(this.rollDir);
    }
    // the boss can be struck
    if (g.boss && g.boss.hitTest(cx, cy, BALL_R)) {
      this.combo++;
      g.boss.damage(6 + this.combo, cx, cy, 'egg');
      this.shatter();
    }
  }

  _dying(dt) {
    const g = this.g;
    this.dieT += dt;
    this.vy -= 24 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.root.rotation.z += dt * 13 * this.spinDir;
    this.root.rotation.x += dt * 6;
    if (Math.random() < 0.7) g.fx.burst(this.x, this.y + 0.5, { count: 1, colors: ['#ffffff', '#ffe066', '#ff8ae0'], speed: [0, 1], size: [0.4, 0.8], life: [0.2, 0.4], z: this.z });
    if (this.dieT > 1.15) {
      g.fx.glow(this.x, this.y + 0.5, '#ffffff', 6, 0.35, this.z);
      g.fx.burst(this.x, this.y + 0.5, { count: 14, colors: ['#ffffff', '#ffe066'], speed: [4, 9], size: [0.4, 0.9], life: [0.3, 0.6], shape: 1, spin: 8, z: this.z });
      g.sfx.play('ko');
      this.remove();
    }
  }

  _visual(dt) {
    const P = this.parts, B = this.base, t = this.t;
    const encased = this.state === 'egg' || this.state === 'roll';
    const target = encased ? 4 : this.cov;
    this.covV += ((target - this.covVis) * 240 - this.covV * 16) * dt;
    this.covVis += this.covV * dt;
    if (target === 0 && this.covVis < 0.05) { this.covVis = 0; this.covV = 0; }
    const showEgg = this.covVis > 0.04 && this.state !== 'dying' && this.state !== 'spawn';
    this.eggSpin.visible = showEgg;
    this.clip.constant = encased && this.covVis > 3.85 ? 1e5 : this.y + clamp(this.covVis / 4, 0, 1.08) * EGG_H;
    if (encased && this.covVis > 3.85) this.model.visible = false;
    else if (this.state !== 'spawn') this.model.visible = true;

    // egg orientation: tipped on its side while rolling, spinning with travel
    this.eggTip.rotation.x = damp(this.eggTip.rotation.x, this.state === 'roll' ? Math.PI / 2 : 0, 14, dt);
    if (this.state === 'roll') this.eggSpin.rotation.z -= (this.vx * dt) / BALL_R;
    else if (this.state === 'egg') this.eggSpin.rotation.z = damp(this.eggSpin.rotation.z, -(this.spinPush || 0) * 0.3, 6, dt);
    else this.eggSpin.rotation.z = 0;

    // pops and squash
    this.popV += (-this.pop * 260 - this.popV * 14) * dt;
    this.pop += this.popV * dt;
    this.sqV += (-this.sq * 260 - this.sqV * 15) * dt;
    this.sq += this.sqV * dt;
    const sy = 1 + this.sq;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    this.pivot.scale.set(sxz * (1 + this.pop * 0.3), sy * (1 + this.pop * 0.3), sxz * (1 + this.pop * 0.3));
    this.eggSpin.scale.set((1 + this.pop * 0.12) * sxz, (1 + this.pop * 0.12) * sy, (1 + this.pop * 0.12) * sxz);
    if (this.state === 'spawn') this.pivot.scale.multiplyScalar(this.shown ? 1 : 0.001);

    // facing
    const yaw = this.dir > 0 ? FACE_R : FACE_L;
    this.model.rotation.y = damp(this.model.rotation.y, yaw, 12, dt);

    // procedural animation
    for (const k in P) { P[k].position.copy(B[k].p); P[k].rotation.copy(B[k].r); }
    const speed = Math.abs(this.vx);
    this.phase += dt * speed * 3.2;
    const s = Math.sin(this.phase);
    P.antenna.rotation.z = Math.sin(t * 6) * 0.15 - this.vx * 0.04;
    if (this.state === 'stuck') {
      const f = t * 34;
      P.armL.rotation.z = 2.4 + Math.sin(f) * 0.5;
      P.armR.rotation.z = 2.4 + Math.sin(f + 1.5) * 0.5;
      P.armL.rotation.x = -0.4; P.armR.rotation.x = 0.4;
      P.head.rotation.z = Math.sin(f * 0.5) * 0.15;
      P.body.position.x += Math.sin(f) * 0.025;
      P.antenna.rotation.z = Math.sin(f) * 0.5;
    } else if (this.state === 'air' || this.state === 'dying') {
      P.armL.rotation.z = 2.6; P.armR.rotation.z = 2.4;
      P.legL.rotation.z = 0.5; P.legR.rotation.z = -0.3;
    } else if (this.state === 'walk') {
      P.legL.rotation.z = s * 0.7;
      P.legR.rotation.z = -s * 0.7;
      P.armL.rotation.z = -s * 0.6;
      P.armR.rotation.z = s * 0.6;
      P.body.position.y += Math.abs(Math.cos(this.phase)) * 0.06;
      P.head.rotation.z = Math.sin(this.phase) * 0.06;
      P.body.rotation.z = -0.08 * Math.min(1, speed / 3);
      if (this.charge > 0) { P.armL.rotation.z = 1.4; P.armR.rotation.z = 1.4; P.head.rotation.z = -0.25; }
    }
    if (this.angry && this.state === 'walk') P.head.rotation.x = Math.sin(t * 25) * 0.05;
    A.setFlash(this.model, this.flash);
    A.setFlash(this.egg, this.flash * 0.7);
    this._sync();
  }

  _sync() {
    this.root.position.set(this.x, this.y, this.z);
  }

  remove() {
    if (this.dead) return;
    this.dead = true;
    this.g.scene.remove(this.root);
    for (const m of [...this.model.userData.mats, ...this.egg.userData.mats]) m.dispose();
    this.beam.material.dispose();
  }
}
