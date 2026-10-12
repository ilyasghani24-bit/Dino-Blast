import * as THREE from 'three';
import { loadHDRI } from './world/sky.js';
import { loadPBRTextures, patchLibraryPBR } from './world/pbr.js';
import * as A from './assets.js';
import { Input } from './engine/input.js';
import { TouchControls } from './engine/touch.js';
import { LOW } from './quality.js';
import { Sound } from './engine/audio.js';
import { FX } from './engine/fx.js';
import { Post } from './engine/post.js';
import { HUD } from './hud.js';
import { Background } from './world/background.js';
import { Level, STAGES } from './world/level.js';
import { Player } from './entities/player.js';
import { Enemy } from './entities/enemy.js';
import { Item } from './entities/item.js';
import { Plasma, Shot } from './entities/shot.js';
import { Boss, Hunter } from './entities/boss.js';
import { damp, rand, clamp } from './entities/physics.js';
import { installHeightFog } from './world/detail.js';
import { Grass } from './world/grass.js';
import { FRAME, LIFT, fixedView } from './world/frame.js';

// true: fixed full-stage camera matching the concept art. false: the old zoom-to-action camera.
const FIXED_CAMERA = true;

const $ = (id) => document.getElementById(id);
const HURRY_TIME = 50;
const EXTRA_LIFE_SCORE = 30000;

export class Game {
  async init() {
    const canvas = $('game');
    // phones (LOW tier): fewer pixels, lighter scenery, cheaper shaders and shadows
    this.mobile = LOW;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    // resolution scale: starts at the cap and adapts to the measured frame rate
    this.maxPR = Math.min(window.devicePixelRatio, 2);
    this.minPR = Math.min(this.maxPR, LOW ? 1 : 1.25);
    this.pr = this.maxPR;
    this.perf = { sum: 0, n: 0, good: 0 };
    r.setPixelRatio(this.pr);
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    r.localClippingEnabled = true;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;

    installHeightFog();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 2500);
    this.camera.position.set(0, 7, 24);
    const setLoading = (t) => { const el = document.querySelector('.loading-text'); if (el) el.textContent = t; };
    setLoading('Hatching… (loading sky & materials)');
    // PBR: photographic HDRI sky (IBL + skybox) and baked triplanar texture sets
    const [lib, hdri] = await Promise.all([
      A.loadAssets('assets/models.glb'),
      loadHDRI(r),
      loadPBRTextures(r),
    ]);
    patchLibraryPBR(lib);
    setLoading('Hatching… (building the jungle)');

    this.fx = new FX(this.scene, $('popups'));
    this.bg = new Background(this.scene, this.fx);
    this.bg.setHDRI(hdri);
    if (this.mobile) this.bg.sun.shadow.mapSize.set(1024, 1024);
    this.bg.onErupt = () => { if (this.state === 'play') { this.sfx.play('erupt'); this.fx.shake(0.1); } };
    this.post = new Post(r, this.scene, this.camera, { samples: LOW ? 2 : 4 });
    this.input = new Input();
    this.touch = new TouchControls($('touch'));
    this.input.touch = this.touch;
    this.fx.onShake = (t) => { if (t >= 0.3) this.touch.buzz(Math.round(18 + t * 40)); };
    this.sfx = new Sound();
    this.hud = new HUD();
    this.hud.setIcons({
      portrait: A.renderIcon('Dino', { yaw: -0.35, fit: 0.62, focus: [0.25, 1.1, 0] }),
      coin: A.renderIcon('Coin', { yaw: 0.25 }),
      egg: A.renderIcon('Egg', { yaw: 0.3, fit: 0.85 }),
      heart: A.renderIcon('Heart', { yaw: 0, pitch: 0.2 }),
    });

    this.enemies = []; this.shots = []; this.items = []; this.hazards = [];
    this.boss = null; this.hunter = null;
    this.player = new Player(this);
    this.level = null; this.levelMesh = null;

    this.stop = 0; this.slowT = 0; this.slowScale = 1;
    this.camCenter = new THREE.Vector2(0, 6.5);
    this.camDist = 24;
    this.punch = 0;
    this.focus = null;
    this.difficulty = 1;
    this.time = 0;
    try { this.best = Number(localStorage.getItem('degb-best') || 0); } catch { this.best = 0; }

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._bindUI();
    this.loadStage(0, true);
    this.state = 'title';
    this.player.state = 'frozen';
    await this._warmup();
    $('loading').classList.add('hidden');
    this.last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  /**
   * Compile every material variant up front (egg clipping, shadow depth
   * variants, particles, boss lights...). On D3D/ANGLE a first-use compile can
   * stall a frame for most of a second, which would wreck the game feel.
   */
  async _warmup() {
    const cam = this.camera;
    cam.position.set(0, 3, 9);
    cam.lookAt(0, 2, 0);
    const temp = [];
    const e1 = new Enemy(this, 'basic', -2, 1);
    e1.state = 'stuck'; e1.cov = 2; e1.covVis = 2; e1.model.visible = true;
    const e2 = new Enemy(this, 'shooter', 1.5, 1);
    e2.state = 'egg'; e2.cov = 4; e2.covVis = 4;
    for (const e of [e1, e2]) { e._visual(0.016); e.eggSpin.visible = true; }
    temp.push(e1, e2);
    const items = ['coin', 'heart', 'speed', 'power', 'rapid'].map((k, i) => new Item(this, k, -3 + i * 1.3, 3.5, 0, 0));
    const boss = new Boss(this);
    boss.y = 4; boss.root.position.set(0, 5, -4); boss.beam.visible = true; boss.beam.material.opacity = 0.5;
    const hunter = new Hunter(this);
    hunter.root.position.set(4, 5, -2); hunter.beam.visible = true;
    const plasma = new Plasma(this, 0, 2, 0, 0);
    const shot = new Shot(this, -1, 2, 1, 1, 1);
    const shotMega = new Shot(this, 1, 2.5, -1, 2, 1);
    // decorations that are hidden in daytime themes still need their programs
    const hidden = [...this.bg.moons, ...this.bg.clouds].filter((o) => !o.visible);
    hidden.forEach((o) => { o.visible = true; });
    this.fx.burst(0, 2, { count: 5 });
    this.fx.burst(0, 2, { count: 5, additive: false, shape: 4 });
    this.fx.shell(0, 2, 5);
    this.fx.ring(0, 2);
    this.fx.update(0.016);
    if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, cam);
    for (let i = 0; i < 2; i++) this.post.render(0.016);
    // second pass from a wide camera so off-screen foreground/background variants compile too
    cam.position.set(0, 8, 42);
    cam.lookAt(0, 8, 0);
    if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, cam);
    this.post.render(0.016);
    hidden.forEach((o) => { o.visible = false; });
    shot.pop(false); shotMega.pop(false);
    // detach without disposing: disposing the last material that uses a program
    // deletes the program, and the next real enemy would recompile it mid-game
    for (const e of temp) { e.dead = true; this.scene.remove(e.root); }
    this._warmKeep = temp;
    for (const it of items) it.remove();
    boss.remove(); hunter.remove(); plasma.destroy(false);
    this.fx.clear();
    this.post.render(0.016);
  }

  /** Deterministic stepping for automated testing (rAF is throttled when hidden). */
  debugStep(frames = 1, dt = 1 / 60, keys = null) {
    const t0 = this.last;
    for (let i = 0; i < frames; i++) {
      if (keys) { this.input.keys = new Set(typeof keys === 'function' ? keys(i) : keys); }
      this.last = t0;
      this._loop(t0 + dt * 1000, true);
    }
    this.last = performance.now();
  }

  _bindUI() {
    const unlock = () => this.sfx.init();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock); // iOS only unlocks audio on touchend
    $('start-btn').addEventListener('click', () => this.startGame());
    $('restart-btn').addEventListener('click', () => this.startGame());
    $('resume-btn').addEventListener('click', () => this.togglePause(false));
    $('pause-btn').addEventListener('click', () => this.togglePause(true));
    $('mute-btn').addEventListener('click', () => this.setMuted(!this.sfx.muted));
    $('fps-btn').addEventListener('click', () => this.setFps(!this.fpsOn));
    let fpsPref = null;
    try { fpsPref = localStorage.getItem('degb-fps'); } catch { /* storage blocked */ }
    this.setFps(new URLSearchParams(location.search).has('fps') || fpsPref === '1');
    // phones: pause when the app goes to the background (portrait is checked per frame)
    this.portrait = matchMedia('(orientation: portrait)');
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.togglePause(true); });
  }

  /** Performance overlay: FPS, frame time, worst frame, resolution, draw calls. */
  setFps(on) {
    this.fpsOn = on;
    $('fps').classList.toggle('hidden', !on);
    $('fps-btn').textContent = on ? 'FPS: ON' : 'FPS: OFF';
    try { localStorage.setItem('degb-fps', on ? '1' : '0'); } catch { /* storage blocked */ }
    // count every pass of the frame (scene, shadows, bloom...), not just the last one
    this.renderer.info.autoReset = !on;
    this.renderer.info.reset();
    this.fpsStat = { t: 0, n: 0, worst: 0 };
  }

  _fpsTick(ms) {
    const S = this.fpsStat;
    if (!(ms > 0) || ms > 1000) return;
    S.t += ms; S.n++; S.worst = Math.max(S.worst, ms);
    if (S.t < 500) return;
    const fps = (S.n * 1000) / S.t, avg = S.t / S.n;
    const info = this.renderer.info.render;
    const calls = Math.round(info.calls / S.n), tris = info.triangles / S.n;
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const cls = fps >= 50 ? '' : fps >= 30 ? 'mid' : 'bad';
    $('fps').innerHTML = `<b class="${cls}">${fps.toFixed(0)} FPS</b>  ${avg.toFixed(1)} ms  worst ${S.worst.toFixed(0)} ms
`
      + `${LOW ? 'LOW' : 'HIGH'}  res ${this.pr.toFixed(2)}x ${db.x}×${db.y}  ${calls} calls  ${(tris / 1000).toFixed(0)}k tris`;
    this.renderer.info.reset();
    this.fpsStat = { t: 0, n: 0, worst: 0 };
  }

  setMuted(m) {
    this.sfx.setMuted(m);
    $('mute-btn').textContent = m ? 'SOUND: OFF' : 'SOUND: ON';
  }

  _resize() {
    // a hidden or minimised window can report 0x0; never let that reach the camera
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.fx.setViewport(db.y, this.camera.fov);
  }

  // ---------------------------------------------------------------- flow
  startGame() {
    this.sfx.init();
    this.sfx.play('select');
    this.touch.goFullscreen();
    $('title').classList.add('hidden');
    $('gameover').classList.add('hidden');
    this.score = 0; this.coins = 0; this.eggsCaught = 0; this.lives = 3;
    this.nextLifeAt = EXTRA_LIFE_SCORE;
    this.difficulty = 1;
    this.loop = 1;
    this.player.hearts = this.player.maxHearts = 3;
    this.player.powers = { speed: 0, power: 0, rapid: 0 };
    this.hud.resetScore();
    this.hud.lives(this.lives);
    this.hud.hearts(3, 3);
    this.hud.coins(0);
    this.hud.eggs(0);
    this.hud.powerups(this.player.powers);
    this.hud.show(true);
    this.loadStage(0);
  }

  clearEntities() {
    for (const e of this.enemies) e.remove();
    for (const s of this.shots) s.pop(false);
    for (const i of this.items) i.remove();
    for (const h of this.hazards) h.destroy(false);
    if (this.boss) this.boss.remove();
    if (this.hunter) this.hunter.remove();
    this.enemies = []; this.shots = []; this.items = []; this.hazards = [];
    this.boss = null; this.hunter = null;
  }

  loadStage(i, titleMode = false) {
    this.clearEntities();
    this.fx.clear();
    this.stageIndex = i;
    const stage = STAGES[i % STAGES.length];
    this.stage = stage;
    if (this.levelMesh) this.scene.remove(this.levelMesh);
    if (this.grass) { this.scene.remove(this.grass.mesh); this.grass.dispose(); }
    this.level = new Level(stage);
    this.levelMesh = this.level.buildMeshes();
    this.scene.add(this.levelMesh);
    this.grass = Grass.fromLevel(this.level, { density: this.mobile ? 16 : 26 });
    this.scene.add(this.grass.mesh);
    this.bg.setTheme(stage.theme);
    this.player.spawn(this.level.player.x, this.level.player.y);
    this.player.state = 'frozen';
    this.stageTime = 0;
    this.hurry = false;
    this.focus = null;
    this.hud.boss(null);
    if (titleMode) {
      this.sfx.playMusic('title');
      return;
    }
    this.state = 'intro';
    this.introT = 0;
    this.introStage = 0;
    this.camDist = 34;
    this.camCenter.set(0, 9);
    const n = i + 1 + (this.loop - 1) * STAGES.length;
    this.hud.banner(stage.boss ? 'BOSS STAGE' : `STAGE ${n}`, stage.name, 1.6);
    this.sfx.playMusic(stage.boss ? 'boss' : 'main');
    this.level.spawns.forEach((s, k) => {
      this.enemies.push(new Enemy(this, s.type, s.x, s.y, { delay: 0.5 + k * 0.2 }));
    });
    if (stage.boss) this.boss = new Boss(this);
  }

  togglePause(on = this.state !== 'paused') {
    this.touch.reset();
    if (on && this.state === 'play') {
      this.state = 'paused';
      $('pause').classList.remove('hidden');
      this.sfx.play('select');
    } else if (!on && this.state === 'paused') {
      this.state = 'play';
      $('pause').classList.add('hidden');
    }
  }

  stageClear() {
    this.state = 'clear';
    this.clearT = 0;
    if (this.hunter) this.hunter.leave();
    const bonus = Math.max(0, Math.round((60 - this.stageTime) * 100 / 10) * 10);
    this.hud.banner('STAGE CLEAR!', bonus > 0 ? `TIME BONUS +${bonus}` : 'WELL DONE', 2.8);
    if (bonus > 0) this.addScore(bonus);
    this.sfx.play('clear');
    this.player.invuln = 5;
    for (let k = 0; k < 6; k++) setTimeout(() => this.fx.confetti(rand(-8, 8), rand(2, 10), 40), k * 180);
    this.fx.shake(0.2);
  }

  onBossDefeated() {
    this.boss = null;
    this.hud.boss(null);
    this.addScore(50000, 0, 9, 'big gold');
    this.state = 'clear';
    this.clearT = -2;
    this.victory = true;
    this.hud.banner('JUNGLE SAVED!', 'THE ALIENS RETREAT… FOR NOW', 4.5);
    this.sfx.play('clear');
    for (let k = 0; k < 14; k++) setTimeout(() => this.fx.confetti(rand(-9, 9), rand(2, 12), 50, 1.2), k * 200);
  }

  nextStage() {
    let i = this.stageIndex + 1;
    if (i >= STAGES.length) {
      i = 0;
      this.loop++;
      this.difficulty = 1 + (this.loop - 1) * 0.25;
    }
    this.victory = false;
    this.loadStage(i);
  }

  onPlayerDown() {
    this.lives--;
    this.hud.lives(this.lives);
    this.focus = { x: this.player.x, y: this.player.y + 0.6, dist: 9, t: 1.2 };
    this.slowmo(0.3, 0.9);
    setTimeout(() => {
      if (this.state === 'gameover' || this.state === 'title') return;
      if (this.lives < 0) return this.gameOver();
      this.player.hearts = this.player.maxHearts;
      this.hud.hearts(this.player.hearts, this.player.maxHearts);
      this.player.spawn(this.level.player.x, this.level.player.y + 3);
      this.player.invuln = 2.5;
      this.fx.ring(this.player.x, this.player.y + 0.6, '#6c5cf5', 3, 0.4);
      this.fx.stars(this.player.x, this.player.y + 0.8, 12);
      this.sfx.play('teleport');
    }, 2000);
  }

  gameOver() {
    this.state = 'gameover';
    this.sfx.stopMusic();
    this.sfx.play('gameover');
    this.best = Math.max(this.best, this.score);
    try { localStorage.setItem('degb-best', String(this.best)); } catch { /* storage blocked */ }
    $('final-score').textContent = this.score.toLocaleString();
    $('best-score').textContent = this.best.toLocaleString();
    $('gameover-title').textContent = 'GAME OVER';
    setTimeout(() => $('gameover').classList.remove('hidden'), 1200);
  }

  // ----------------------------------------------------- scoring / events
  addScore(n, x, y, cls = 'gold') {
    if (this.state === 'title') return;
    this.score += n;
    this.hud.score(this.score);
    if (x !== undefined) this.fx.text('+' + n.toLocaleString(), x, y, cls, 1.0);
    while (this.score >= this.nextLifeAt) {
      this.nextLifeAt += EXTRA_LIFE_SCORE;
      this.gainLife();
    }
  }

  addCoins(n) {
    this.coins += n;
    this.hud.coins(this.coins);
    if (this.coins % 50 === 0) this.gainLife();
  }

  gainLife() {
    this.lives++;
    this.hud.lives(this.lives);
    this.sfx.play('extralife');
    this.fx.text('1UP!', this.player.x, this.player.y + 2, 'big green', 1.4);
  }

  onCapture() {
    this.eggsCaught++;
    this.hud.eggs(this.eggsCaught);
  }

  onKill(e, combo, cause) {
    const pts = Math.min(16000, 500 * Math.pow(2, combo - 1));
    this.addScore(pts, e.x, e.cy + 0.6, combo >= 3 ? 'big gold' : 'gold');
    if (combo >= 2) {
      this.hud.combo(combo);
      this.post.kick({ aberration: 0.006 * combo, bloom: 0.2 * combo });
    }
    const coins = 2 + combo;
    for (let i = 0; i < coins; i++) this.dropLoot(e.x, e.cy, 'coin');
    const r = Math.random();
    if (r < 0.1 + combo * 0.04) this.dropLoot(e.x, e.cy, ['speed', 'power', 'rapid'][(Math.random() * 3) | 0]);
    else if (r > 0.93) this.dropLoot(e.x, e.cy, 'heart');
    // last alien standing: Smash-style finishing blow
    const remaining = this.enemies.filter((q) => q.alive && q !== e).length;
    if (remaining === 0 && !this.stage.boss && this.state === 'play') {
      this.slowmo(0.2, 1.1);
      this.focus = { x: e.x, y: e.cy, dist: 7.5, t: 1.1 };
      this.post.kick({ flash: 0.35, radial: 0.3, aberration: 0.03 });
      this.fx.text('FINISH!', e.x, e.cy + 2, 'big pink', 1.4);
      this.fx.shake(0.6);
    }
  }

  onShatter(egg) {
    this.fx.text('SMASH!', egg.x, egg.y + 1.8, 'big gold', 0.9);
    this.dropLoot(egg.x, egg.y + 0.6, 'coin');
    this.dropLoot(egg.x, egg.y + 0.6, 'coin');
    if (this.boss && this.boss.state === 'fight' && Math.hypot(egg.x - this.boss.x, egg.y - this.boss.y) < 4) {
      this.boss.damage(3, egg.x, egg.y, 'shot');
    }
  }

  dropLoot(x, y, kind) {
    if (this.items.length > 70) return;
    this.items.push(new Item(this, kind, x, y));
  }

  hitstop(d) { this.stop = Math.max(this.stop, d); }
  slowmo(scale, dur) { this.slowScale = scale; this.slowT = Math.max(this.slowT, dur); }
  cameraPunch(a) { this.punch = Math.min(3, this.punch + a); }
  focusOn(x, y, t) { this.focus = { x, y, dist: 11, t }; }

  // -------------------------------------------------------------- update
  _loop(now, manual = false) {
    if (!manual) requestAnimationFrame((t) => this._loop(t));
    // rAF timestamps can precede the last performance.now() reading: never step backwards
    const realDt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this._adaptResolution(now - this.last, manual);
    if (this.fpsOn && !manual) this._fpsTick(now - this.last);
    this.last = now;
    this.time += realDt;
    const input = this.input;
    input.update();
    if (input.pressed('mute')) this.setMuted(!this.sfx.muted);
    if (input.pressed('fps')) this.setFps(!this.fpsOn);
    // the "turn your phone" overlay is up: never let the game run behind it
    if (this.state === 'play' && this.touch.enabled && this.portrait.matches) this.togglePause(true);

    if (this.state === 'title') {
      if (input.pressed('start')) this.startGame();
    } else if (this.state === 'gameover') {
      if (input.pressed('start') && !$('gameover').classList.contains('hidden')) this.startGame();
    } else if (input.pressed('pause')) {
      this.togglePause();
    } else if (this.state === 'paused' && input.pressed('start')) {
      this.togglePause(false);
    }

    let dt = realDt;
    if (this.state === 'paused') dt = 0;
    if (this.stop > 0) { this.stop -= realDt; dt = 0; }
    if (this.slowT > 0) { this.slowT -= realDt; dt *= this.slowScale; }

    if (dt > 0) {
      const steps = Math.ceil(dt / (1 / 100));
      const sub = dt / steps;
      for (let s = 0; s < steps; s++) this._update(sub, s === 0);
      this.bg.update(dt, this.camera);
      this.fx.update(dt);
      this._updateGrass();
    }
    this.fx.updateShake(realDt);
    this._camera(realDt);
    this.post.update(realDt);
    this.hud.tick(realDt);
    this.fx.popups.update(this.state === 'paused' ? 0 : realDt, this.camera, window.innerWidth, window.innerHeight);
    this.post.render(realDt);
  }

  /**
   * Dynamic resolution: average the frame time over ~1 s windows. Too slow ->
   * drop the pixel ratio a notch; comfortably fast for 3 windows -> raise it.
   * Fill rate is what phones run out of, so this is the knob that matters.
   */
  _adaptResolution(ms, manual) {
    // skip debug stepping and hidden/throttled tabs (huge gaps are not real frames)
    if (manual || !(ms > 0) || ms > 250 || this.state === 'paused') return;
    const P = this.perf;
    P.sum += ms; P.n++;
    if (P.sum < 1000) return;
    const avg = P.sum / P.n;
    P.sum = 0; P.n = 0;
    let pr = this.pr;
    if (avg > 21 && pr > this.minPR) { pr = Math.max(this.minPR, pr - (avg > 30 ? 0.2 : 0.1)); P.good = 0; }
    else if (avg < 17.5 && pr < this.maxPR) { if (++P.good >= 3) { pr = Math.min(this.maxPR, pr + 0.1); P.good = 0; } }
    else P.good = 0;
    if (pr !== this.pr) {
      this.pr = pr;
      this.renderer.setPixelRatio(pr);
      this.post.composer.setPixelRatio(pr);
      this._resize();
    }
  }

  _update(dt, first) {
    const input = first ? this.input : null;
    switch (this.state) {
      case 'title':
        this.player.update(dt, null);
        return;
      case 'intro':
        this._intro(dt);
        break;
      case 'play':
        this.stageTime += dt;
        if (!this.hurry && !this.stage.boss && this.stageTime > HURRY_TIME) {
          this.hurry = true;
          this.hud.banner('HURRY UP!', 'A HUNTER SAUCER APPROACHES', 1.6);
          this.sfx.play('hurry');
          for (const e of this.enemies) e.enrage();
          this.hunter = new Hunter(this);
        }
        break;
    }
    const p = this.player;
    p.update(dt, this.state === 'play' ? (first ? input : this._heldOnly(this.input)) : null);
    if (first && this.state === 'play') this.hud.tickPowerups(p.powers);

    this.enemies = this.enemies.filter((e) => e.update(dt));
    this.shots = this.shots.filter((s) => { s.update(dt); return !s.dead; });
    this.hazards = this.hazards.filter((h) => { h.update(dt); return !h.dead; });
    this.items = this.items.filter((i) => i.update(dt));
    if (this.boss && !this.boss.update(dt)) this.boss = null;
    if (this.hunter && !this.hunter.update(dt)) this.hunter = null;

    // enemy contact damage
    if (p.state === 'alive' && p.invuln <= 0 && this.state === 'play') {
      for (const e of this.enemies) {
        if (!e.harmful) continue;
        if (Math.abs(e.x - p.x) < e.hw + p.hw - 0.12 && e.y < p.y + p.h - 0.15 && e.y + e.h > p.y + 0.15) { p.hurt(e.x); break; }
      }
    }

    if (this.state === 'play' && !this.stage.boss && this.enemies.length === 0) this.stageClear();
    if (this.state === 'clear') {
      this.clearT += dt;
      if (this.clearT > 3.4 && this.items.length === 0 || this.clearT > 6) this.nextStage();
    }
  }

  _updateGrass() {
    const push = [];
    const p = this.player;
    if (p.state !== 'dead') push.push({ x: p.x, y: p.y, r: 0.75 });
    for (const e of this.enemies) {
      if (push.length >= 8) break;
      if (!e.alive || e.state === 'spawn') continue;
      push.push({ x: e.x, y: e.y, r: e.state === 'roll' || e.state === 'egg' ? 0.95 : 0.6 });
    }
    this.grass.update(this.bg.time, push);
  }

  _heldOnly(input) {
    // later sub-steps only see held state (no edge-triggered presses)
    if (!input) return null;
    this._held ||= { axisX: () => this.input.axisX(), down: (a) => this.input.down(a), pressed: () => false, released: () => false };
    return this._held;
  }

  _intro(dt) {
    this.introT += dt;
    if (this.introStage === 0 && this.introT > 1.7) {
      this.introStage = 1;
      this.hud.banner('READY?', '', 0.8);
      this.sfx.play('ready');
    }
    if (this.introStage === 1 && this.introT > 2.5) {
      this.introStage = 2;
      this.hud.banner('GO!', '', 0.7);
      this.sfx.play('go');
      this.fx.shake(0.25);
      this.post.kick({ flash: 0.15, bloom: 0.5 });
      this.state = 'play';
      this.player.state = 'alive';
    }
  }

  // --------------------------------------------------------------- camera
  _camera(dt) {
    const cam = this.camera;
    const vfov = (cam.fov * Math.PI) / 180;
    const tanV = Math.tan(vfov / 2);
    const aspect = cam.aspect;
    const fullDist = Math.max(8.4 / tanV, 12.2 / (tanV * aspect));

    if (this.state === 'title') {
      const t = this.time * 0.15;
      // a gentler orbit over the painted backdrop, which is only correct near the play view
      const k = this.bg.painted ? 0.35 : 1;
      cam.position.set(Math.sin(t) * 9 * k, 5.5 + Math.sin(t * 1.3) * 1.5 * k, 21 + Math.cos(t) * 3 * k + (this.bg.painted ? 3 : 0));
      cam.lookAt(0, 5.5, 0);
      return;
    }

    let cx, cy, dist;
    if (this.focus && this.focus.t > 0) {
      this.focus.t -= dt;
      cx = this.focus.x; cy = this.focus.y; dist = this.focus.dist;
      if (this.focus.t <= 0) this.focus = null;
    } else if (FIXED_CAMERA) {
      // Concept-art framing: one fixed, straight-on shot of the whole stage (Snow Bros style)
      // fit floor-to-canopy vertically, and always keep both side walls in frame
      cx = 0; cy = FRAME.cy; dist = fixedView(cam.fov, aspect).dist;
    } else {
      // Smash-style framing: fit the player and all active combatants
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const add = (x, y, w = 1) => { x0 = Math.min(x0, x - w); x1 = Math.max(x1, x + w); y0 = Math.min(y0, y - 0.3); y1 = Math.max(y1, y + 1.4); };
      const p = this.player;
      if (p.state !== 'dead') add(p.x, p.y);
      for (const e of this.enemies) if (e.alive && e.state !== 'spawn') add(e.x, e.y);
      if (this.boss) add(this.boss.x, this.boss.y, 3.2);
      if (this.hunter && !this.hunter.leaving) add(this.hunter.x, this.hunter.y - 1, 1.3);
      if (this.state === 'intro' || x0 === Infinity) { x0 = -10; x1 = 10; y0 = 0; y1 = 13; }
      const padX = 3.4, padY = 2.4;
      const w = x1 - x0 + padX * 2, h = y1 - y0 + padY * 2;
      dist = Math.max(h / 2 / tanV, w / 2 / (tanV * aspect), 13);
      dist = Math.min(dist, fullDist);
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
      const hw = dist * tanV * aspect, hh = dist * tanV;
      cx = hw >= 12 ? 0 : clamp(cx, -12 + hw, 12 - hw);
      cy = hh >= 8.6 ? 6.6 : clamp(cy, -1.8 + hh, 15 + 0.2 - hh);
    }
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(dist)) { cx = 0; cy = 6.6; dist = fullDist || 24; }
    if (!Number.isFinite(this.camDist) || !Number.isFinite(this.camCenter.x) || !Number.isFinite(this.camCenter.y)) {
      this.camCenter.set(cx, cy);
      this.camDist = dist;
    }
    this.punch = Math.max(0, this.punch - dt * 3);
    const k = this.focus ? 5 : 2.6;
    this.camCenter.x = damp(this.camCenter.x, cx, k, dt);
    this.camCenter.y = damp(this.camCenter.y, cy, k, dt);
    this.camDist = damp(this.camDist, dist, this.focus ? 5 : 2.2, dt);
    const d = this.camDist - this.punch;
    const sway = !FIXED_CAMERA && this.player.state === 'alive' ? (this.player.x - this.camCenter.x) * 0.06 : 0;
    const sh = this.fx.shakeOffset;
    const lift = FIXED_CAMERA ? LIFT : 1.6;
    // fixed camera: drift gently after the player so the layered backdrop shows its depth
    const dr = this.drift || (this.drift = { x: 0, y: 0 });
    const p = this.player;
    const follow = FIXED_CAMERA && p.state === 'alive' && !this.focus;
    // plus a slow idle sway, so the backdrop layers keep sliding even when you stand still
    const idleX = FIXED_CAMERA ? Math.sin(this.time * 0.23) * 0.35 : 0, idleY = FIXED_CAMERA ? Math.sin(this.time * 0.17 + 1) * 0.15 : 0;
    dr.x = damp(dr.x, (follow ? clamp(p.x, -10, 10) * 0.13 : 0) + idleX, 1.6, dt);
    dr.y = damp(dr.y, (follow ? (clamp(p.y, 0, 13) - 6) * 0.06 : 0) + idleY, 1.6, dt);
    cam.position.set(this.camCenter.x + sway + sh.x + dr.x, this.camCenter.y + lift + sh.y + dr.y, d);
    cam.lookAt(this.camCenter.x + dr.x, this.camCenter.y + 0.2 + dr.y, 0);
    cam.rotateZ(this.fx.shakeRoll);
  }
}
