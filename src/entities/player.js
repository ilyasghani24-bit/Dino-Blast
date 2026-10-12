import * as THREE from 'three';
import * as A from '../assets.js';
import { stepBody, approach, rand, damp } from './physics.js';
import { Shot } from './shot.js';

const RED = new THREE.Color(1, 0.15, 0.2);
const FACE_R = -0.5;
const FACE_L = Math.PI + 0.5;

export const POWER_INFO = {
  speed: { label: 'SPEED', color: '#ff4f7a' },
  power: { label: 'MEGA EGG', color: '#3ad8ff' },
  rapid: { label: 'RAPID', color: '#ffd23a' },
};

export class Player {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.model = A.cloneUnique('Dino');
    this.model.scale.setScalar(0.88);
    this.pivot.add(this.model);
    this.root.add(this.pivot);
    game.scene.add(this.root);
    const n = (k) => this.model.getObjectByName(k);
    this.parts = {
      body: n('Dino_Body'), head: n('Dino_Head'), tail: n('Dino_Tail'),
      armL: n('Dino_ArmL'), armR: n('Dino_ArmR'), legL: n('Dino_LegL'), legR: n('Dino_LegR'),
    };
    this.base = {};
    for (const [k, o] of Object.entries(this.parts)) this.base[k] = { p: o.position.clone(), r: o.rotation.clone() };
    this.hw = 0.38;
    this.h = 1.3;
    this.hearts = 3;
    this.maxHearts = 3;
    this.powers = { speed: 0, power: 0, rapid: 0 };
    this.spawn(0, 0);
  }

  spawn(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.facing = 1; this.yaw = FACE_R;
    this.grounded = true; this.groundSeg = null;
    this.state = 'alive';
    this.invuln = 2.0;
    this.fireCd = 0; this.coyote = 0; this.jumpBuf = 0; this.dropTimer = 0;
    this.shootAnim = 0; this.kickAnim = 0; this.hurtFlash = 0;
    this.sq = 0; this.sqV = 0; this.phase = 0; this.t = 0;
    this.pushing = 0; this.bounced = false;
    this.root.visible = true;
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(x, y, 0);
    this.pivot.scale.setScalar(1);
  }

  get cx() { return this.x; }
  get cy() { return this.y + this.h * 0.5; }

  update(dt, input) {
    const g = this.game;
    this.t += dt;
    if (this.state === 'dead') return this._updateDead(dt);
    if (this.state === 'frozen') { this._animate(dt); this._sync(); return; }

    for (const k in this.powers) {
      if (this.powers[k] > 0) {
        this.powers[k] -= dt;
        if (this.powers[k] <= 0) { this.powers[k] = 0; g.hud.powerups(this.powers); }
      }
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.fireCd -= dt;
    this.jumpBuf -= dt;
    this.dropTimer -= dt;
    this.shootAnim = Math.max(0, this.shootAnim - dt);
    this.kickAnim = Math.max(0, this.kickAnim - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);

    const ax = input ? input.axisX() : 0;
    const speed = this.powers.speed > 0 ? 8.8 : 6.4;
    let target = ax * speed;
    if (this.pushing > 0) { target = ax * 2.6; this.pushing -= dt; }
    const accel = this.grounded ? 75 : 42;
    this.vx = approach(this.vx, target, accel * dt);
    if (ax) this.facing = ax > 0 ? 1 : -1;

    if (input) {
      if (input.pressed('jump')) this.jumpBuf = 0.13;
      if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
        this.jumpBuf = 0;
        this.coyote = 0;
        if (input.down('down') && this.groundSeg && !this.groundSeg.floor) {
          this.dropTimer = 0.22;
          this.y -= 0.02;
          this.vy = -2;
          g.fx.dust(this.x, this.y, 5);
        } else {
          this.vy = 16.6;
          this.bounced = false;
          this.sq = 0.28; this.sqV = 0;
          g.sfx.play('jump');
          g.fx.dust(this.x, this.y, 6);
          g.fx.ring(this.x, this.y + 0.05, '#ffffff', 1.2, 0.25, 1.5);
        }
      }
      if (input.released('jump') && this.vy > 4 && !this.bounced) this.vy *= 0.5;
      if (input.down('fire') && this.fireCd <= 0) this.fire();
    }

    const res = stepBody(this, g.level, dt, { ignorePlatforms: this.dropTimer > 0 });
    if (res.landed) {
      const imp = Math.min(1, -res.landV / 20);
      this.sq = -0.12 - imp * 0.25; this.sqV = 0;
      if (imp > 0.35) {
        g.fx.dust(this.x, this.y, 6 + imp * 8);
        g.sfx.play('land');
        if (imp > 0.8) g.fx.shake(0.12);
      }
      this.bounced = false;
    }
    this.coyote = this.grounded ? 0.1 : this.coyote - dt;

    // running dust
    if (this.grounded && Math.abs(this.vx) > 4 && Math.random() < dt * 14) g.fx.dust(this.x - this.facing * 0.2, this.y, 1, -this.facing);
    // power-up aura
    for (const k in this.powers) {
      if (this.powers[k] > 0 && Math.random() < dt * 18) {
        g.fx.burst(this.x + rand(-0.4, 0.4), this.y + rand(0.1, 1.2), { count: 1, color: POWER_INFO[k].color, speed: [0.5, 1.5], angle: Math.PI / 2, spread: 1, size: [0.15, 0.3], life: [0.4, 0.7], shape: 1, spin: 6 });
      }
    }

    this._animate(dt);
    this._sync();
  }

  fire() {
    const g = this.game;
    // kick a fully encased egg that is right in front of us
    for (const e of g.enemies) {
      if (e.state !== 'egg') continue;
      const dx = e.x - this.x;
      if (Math.abs(e.y - this.y) < 0.7 && Math.abs(dx) < 1.35 && (Math.sign(dx) === this.facing || Math.abs(dx) < 0.4)) {
        e.kick(this.facing, this);
        this.fireCd = 0.3;
        this.kickAnim = 0.25;
        this.vx -= this.facing * 3;
        return;
      }
    }
    const rapid = this.powers.rapid > 0;
    const mega = this.powers.power > 0;
    this.fireCd = rapid ? 0.11 : 0.21;
    this.shootAnim = 0.16;
    const x = this.x + this.facing * 0.7;
    const y = this.y + 1.05;
    g.shots.push(new Shot(g, x, y, this.facing, mega ? 2 : 1, mega ? 0.62 : 0.4, this.vx));
    g.sfx.play('shoot');
    g.fx.burst(x, y, { count: 5, color: '#ffffff', speed: [1, 3], size: [0.15, 0.3], life: [0.15, 0.3], angle: this.facing > 0 ? 0 : Math.PI, spread: 1.2 });
  }

  hurt(fromX) {
    const g = this.game;
    if (this.invuln > 0 || this.state !== 'alive') return;
    this.hearts--;
    g.hud.hearts(this.hearts, this.maxHearts);
    const dir = this.x >= fromX ? 1 : -1;
    this.vx = dir * 9;
    this.vy = 10;
    this.invuln = 1.7;
    this.hurtFlash = 1;
    g.sfx.play('hurt');
    g.fx.shake(0.45);
    g.hitstop(0.12);
    g.post.kick({ aberration: 0.018, flash: 0.25, color: '#ff3050' });
    g.fx.stars(this.x, this.y + 0.8, 10, ['#ff6a8a', '#ffffff', '#ffd23a']);
    g.fx.text('OUCH!', this.x, this.y + 1.4, 'pink', 0.8);
    if (this.hearts <= 0) this.die(dir);
  }

  die(dir) {
    const g = this.game;
    this.state = 'dead';
    this.deadT = 0;
    this.vx = dir * 7;
    this.vy = 18;
    g.sfx.play('explode', { dur: 0.6 });
    g.fx.shake(0.8);
    g.hitstop(0.25);
    g.post.kick({ flash: 0.6, radial: 0.25, aberration: 0.03, color: '#ffffff' });
    g.onPlayerDown();
  }

  _updateDead(dt) {
    this.deadT += dt;
    this.vy -= 30 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.root.position.set(this.x, this.y, Math.min(8, this.deadT * 6));
    this.root.rotation.z += dt * 14;
    this.root.rotation.y += dt * 6;
    if (Math.random() < dt * 30) this.game.fx.stars(this.x, this.y + 0.5, 1);
    if (this.deadT > 1.6) this.root.visible = false;
  }

  bounceOff(dir) {
    // launched by a rolling egg: harmless, fun
    this.vy = 17;
    this.vx = dir * 6;
    this.bounced = true;
    this.sq = 0.35;
    this.game.sfx.play('whee');
    this.game.fx.text('WHEE!', this.x, this.y + 1.5, 'cyan', 0.7);
  }

  addPower(kind) {
    this.powers[kind] = 15;
    this.game.hud.powerups(this.powers);
  }

  _animate(dt) {
    const P = this.parts, B = this.base;
    const t = this.t;
    // facing turn (fast, Smash-style)
    const targetYaw = this.facing > 0 ? FACE_R : FACE_L;
    this.yaw = damp(this.yaw, targetYaw, 18, dt);
    this.model.rotation.y = this.yaw;

    // squash & stretch spring
    this.sqV += (-260 * this.sq - 16 * this.sqV) * dt;
    this.sq += this.sqV * dt;
    const sy = 1 + this.sq;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    this.pivot.scale.set(sxz, sy, sxz);

    const speed = Math.abs(this.vx);
    const running = this.grounded && speed > 0.5;
    this.phase += dt * (running ? speed * 2.3 : 0);
    const s = Math.sin(this.phase);

    const reset = (k) => { P[k].position.copy(B[k].p); P[k].rotation.copy(B[k].r); P[k].scale.setScalar(1); };
    for (const k in P) reset(k);

    let bodyLean = 0, bob = 0;
    if (!this.grounded) {
      const up = this.vy > 0;
      P.legL.rotation.z = up ? 0.7 : 0.25;
      P.legR.rotation.z = up ? -0.2 : -0.35;
      P.armL.rotation.z = 1.1 + Math.sin(t * 20) * 0.1;
      P.armR.rotation.z = 0.9 - Math.sin(t * 20) * 0.1;
      P.tail.rotation.z = up ? -0.3 : 0.25;
      bodyLean = up ? 0.1 : -0.1;
    } else if (running) {
      P.legL.rotation.z = s * 0.85;
      P.legR.rotation.z = -s * 0.85;
      P.armL.rotation.z = -s * 0.6;
      P.armR.rotation.z = s * 0.6;
      P.tail.rotation.y = Math.sin(this.phase * 0.5) * 0.35;
      P.tail.rotation.z = Math.abs(s) * 0.15;
      bob = Math.abs(Math.cos(this.phase)) * 0.07;
      bodyLean = -0.14 * Math.min(1, speed / 6);
      P.head.rotation.z = Math.sin(this.phase * 2) * 0.05;
    } else {
      P.body.scale.set(1, 1 + Math.sin(t * 3) * 0.02, 1);
      P.tail.rotation.y = Math.sin(t * 2) * 0.25;
      P.head.rotation.z = Math.sin(t * 1.5) * 0.06;
      P.armL.rotation.z = Math.sin(t * 3) * 0.08;
      P.armR.rotation.z = -Math.sin(t * 3) * 0.08;
    }
    if (this.shootAnim > 0) {
      const k = this.shootAnim / 0.16;
      P.head.rotation.z -= 0.45 * Math.sin(k * Math.PI);
      P.head.position.x += 0.08 * Math.sin(k * Math.PI);
      P.armL.rotation.z += 1.2 * k;
      P.armR.rotation.z += 1.2 * k;
      bodyLean -= 0.18 * k;
    }
    if (this.kickAnim > 0) {
      const k = this.kickAnim / 0.25;
      P.legL.rotation.z = 1.4 * Math.sin(k * Math.PI);
      P.tail.rotation.z = -0.5 * k;
      bodyLean += 0.25 * k;
    }
    P.body.rotation.z += bodyLean;
    P.body.position.y += bob / 0.88;

    const flash = Math.max(this.hurtFlash, 0);
    A.setFlash(this.model, flash, RED);
  }

  _sync() {
    this.root.position.set(this.x, this.y, 0);
    this.root.visible = this.invuln > 0 && this.state === 'alive' ? Math.floor(this.t * 16) % 2 === 0 || this.invuln > 1.9 : true;
  }
}
