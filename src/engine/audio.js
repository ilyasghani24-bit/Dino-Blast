// Fully synthesized audio: every SFX and the music are generated with WebAudio.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];

const SONGS = {
  main: {
    bpm: 144,
    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
    lead: [
      72, 0, 76, 0, 79, 0, 76, 0, 77, 0, 76, 0, 74, 0, 72, 0,
      69, 0, 72, 0, 76, 0, 0, 0, 74, 0, 72, 0, 69, 0, 0, 0,
      65, 0, 69, 0, 72, 0, 77, 0, 76, 0, 74, 0, 72, 0, 69, 0,
      71, 0, 74, 0, 79, 0, 0, 0, 77, 0, 76, 0, 74, 0, 71, 0,
      79, 0, 0, 79, 77, 0, 76, 0, 72, 0, 76, 0, 79, 0, 84, 0,
      81, 0, 0, 0, 79, 0, 76, 0, 72, 0, 74, 0, 76, 0, 0, 0,
      77, 0, 0, 77, 76, 0, 74, 0, 72, 0, 74, 0, 77, 0, 81, 0,
      79, 0, 0, 0, 83, 0, 0, 0, 86, 0, 83, 0, 79, 0, 74, 0,
    ],
  },
  boss: {
    bpm: 168,
    chords: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]],
    lead: [
      69, 0, 72, 69, 76, 0, 74, 72, 69, 0, 72, 0, 76, 0, 79, 0,
      77, 0, 76, 0, 72, 0, 69, 0, 72, 0, 76, 0, 77, 0, 76, 0,
      74, 0, 77, 74, 81, 0, 79, 77, 74, 0, 72, 0, 74, 0, 77, 0,
      76, 0, 80, 0, 83, 0, 80, 0, 76, 0, 74, 0, 71, 0, 68, 0,
    ],
    driving: true,
  },
  title: {
    bpm: 110,
    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
    lead: [
      72, 0, 0, 0, 76, 0, 0, 0, 79, 0, 0, 0, 76, 0, 0, 0,
      69, 0, 0, 0, 72, 0, 0, 0, 76, 0, 0, 0, 74, 0, 0, 0,
      65, 0, 0, 0, 69, 0, 0, 0, 72, 0, 0, 0, 77, 0, 0, 0,
      71, 0, 0, 0, 74, 0, 0, 0, 79, 0, 0, 0, 0, 0, 0, 0,
    ],
    soft: true,
  },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.song = null;
    this.timer = null;
    this.intensity = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.3;
    this.music.connect(this.master);
    // echo on the lead for a bit of space
    this.echo = ctx.createDelay(1.0);
    this.echo.delayTime.value = 0.31;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.echo.connect(fb);
    fb.connect(this.echo);
    this.echo.connect(wet);
    wet.connect(this.music);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  // ---- primitives ------------------------------------------------------
  tone({ type = 'square', f = 440, f1 = 0, dur = 0.1, vol = 0.2, attack = 0.004, delay = 0, out = null, t0 = null }) {
    const ctx = this.ctx;
    const t = (t0 ?? ctx.currentTime) + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out || this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return g;
  }

  noise({ dur = 0.2, vol = 0.3, f = 1000, f1 = 0, q = 1, type = 'bandpass', delay = 0, out = null, attack = 0.002, t0 = null }) {
    const ctx = this.ctx;
    const t = (t0 ?? ctx.currentTime) + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl);
    fl.connect(g);
    g.connect(out || this.sfx);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.05);
  }

  // ---- sound effects ---------------------------------------------------
  play(name, p = {}) {
    if (!this.ctx || this.muted) return;
    const T = (o) => this.tone(o);
    const N = (o) => this.noise(o);
    switch (name) {
      case 'jump':
        T({ type: 'square', f: 280, f1: 720, dur: 0.13, vol: 0.09 });
        T({ type: 'triangle', f: 140, f1: 360, dur: 0.13, vol: 0.14 });
        break;
      case 'land':
        N({ type: 'lowpass', f: 500, dur: 0.08, vol: 0.18 });
        break;
      case 'shoot':
        T({ type: 'sine', f: 950, f1: 320, dur: 0.09, vol: 0.26 });
        N({ type: 'highpass', f: 3000, dur: 0.04, vol: 0.08 });
        break;
      case 'hit':
        T({ type: 'square', f: 240 + (p.stage || 0) * 90, f1: 140, dur: 0.08, vol: 0.12 });
        N({ type: 'bandpass', f: 2200, dur: 0.06, vol: 0.18, q: 2 });
        break;
      case 'capture':
        [523, 659, 784, 1046, 1318].forEach((f, i) => T({ type: 'triangle', f, dur: 0.12, vol: 0.18, delay: i * 0.045 }));
        T({ type: 'sine', f: 2093, dur: 0.4, vol: 0.08, delay: 0.22 });
        break;
      case 'kick':
        T({ type: 'sine', f: 170, f1: 45, dur: 0.2, vol: 0.7 });
        N({ type: 'lowpass', f: 1200, f1: 120, dur: 0.16, vol: 0.5 });
        N({ type: 'bandpass', f: 400, f1: 2600, dur: 0.32, vol: 0.18, q: 0.8, delay: 0.02 });
        break;
      case 'bounce':
        T({ type: 'sine', f: 130, f1: 55, dur: 0.14, vol: 0.45 });
        N({ type: 'lowpass', f: 700, dur: 0.07, vol: 0.2 });
        break;
      case 'kill': {
        const c = Math.min(p.combo || 1, SCALE.length) - 1;
        N({ type: 'lowpass', f: 3200, f1: 180, dur: 0.45, vol: 0.45 });
        T({ type: 'sine', f: 110, f1: 40, dur: 0.35, vol: 0.5 });
        const f = mtof(76 + SCALE[c]);
        T({ type: 'square', f, dur: 0.2, vol: 0.12, delay: 0.03 });
        T({ type: 'triangle', f: f * 2, dur: 0.3, vol: 0.12, delay: 0.03 });
        T({ type: 'sine', f: f * 3, dur: 0.4, vol: 0.05, delay: 0.08 });
        break;
      }
      case 'coin':
        T({ type: 'square', f: 988, dur: 0.07, vol: 0.08 });
        T({ type: 'square', f: 1319, dur: 0.28, vol: 0.08, delay: 0.065 });
        break;
      case 'hurt':
        T({ type: 'sawtooth', f: 520, f1: 70, dur: 0.4, vol: 0.22 });
        N({ type: 'bandpass', f: 900, dur: 0.25, vol: 0.2 });
        break;
      case 'power':
        [0, 4, 7, 12, 16, 19, 24, 28].forEach((s, i) => T({ type: 'square', f: mtof(64 + s), dur: 0.1, vol: 0.08, delay: i * 0.04 }));
        break;
      case 'heal':
        [0, 7, 12, 19].forEach((s, i) => T({ type: 'triangle', f: mtof(72 + s), dur: 0.2, vol: 0.16, delay: i * 0.07 }));
        break;
      case 'clear':
        [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [79, 0.54], [84, 0.66]].forEach(([m, d]) => {
          T({ type: 'square', f: mtof(m), dur: 0.22, vol: 0.1, delay: d });
          T({ type: 'triangle', f: mtof(m - 12), dur: 0.22, vol: 0.14, delay: d });
        });
        T({ type: 'triangle', f: mtof(88), dur: 0.9, vol: 0.12, delay: 0.8 });
        break;
      case 'gameover':
        [72, 67, 64, 60, 55].forEach((m, i) => T({ type: 'triangle', f: mtof(m), dur: 0.35, vol: 0.18, delay: i * 0.22 }));
        break;
      case 'break':
        N({ type: 'highpass', f: 2500, dur: 0.28, vol: 0.35 });
        for (let i = 0; i < 6; i++) T({ type: 'square', f: 1200 + Math.random() * 1800, dur: 0.04, vol: 0.05, delay: Math.random() * 0.15 });
        break;
      case 'crack':
        N({ type: 'highpass', f: 3000, dur: 0.06, vol: 0.2 });
        T({ type: 'square', f: 1800 + Math.random() * 600, dur: 0.03, vol: 0.05 });
        break;
      case 'laser':
        T({ type: 'sawtooth', f: 1400, f1: 180, dur: 0.25, vol: 0.12 });
        break;
      case 'charge':
        T({ type: 'sine', f: 180, f1: 900, dur: p.dur || 0.6, vol: 0.12 });
        T({ type: 'square', f: 90, f1: 450, dur: p.dur || 0.6, vol: 0.04 });
        break;
      case 'beam':
        N({ type: 'bandpass', f: 600, dur: 0.7, vol: 0.3, q: 3 });
        T({ type: 'sawtooth', f: 110, dur: 0.7, vol: 0.12 });
        break;
      case 'bosshit':
        T({ type: 'square', f: 180, f1: 55, dur: 0.25, vol: 0.3 });
        N({ type: 'lowpass', f: 2000, f1: 200, dur: 0.3, vol: 0.4 });
        break;
      case 'explode':
        N({ type: 'lowpass', f: 1800, f1: 50, dur: p.dur || 1.2, vol: 0.8 });
        T({ type: 'sine', f: 90, f1: 28, dur: 0.9, vol: 0.7 });
        break;
      case 'select':
        T({ type: 'square', f: 660, dur: 0.06, vol: 0.1 });
        T({ type: 'square', f: 990, dur: 0.12, vol: 0.1, delay: 0.06 });
        break;
      case 'hurry':
        for (let i = 0; i < 4; i++) {
          T({ type: 'square', f: 880, dur: 0.12, vol: 0.1, delay: i * 0.3 });
          T({ type: 'square', f: 660, dur: 0.12, vol: 0.1, delay: i * 0.3 + 0.15 });
        }
        break;
      case 'ready':
        T({ type: 'triangle', f: mtof(67), dur: 0.15, vol: 0.18 });
        break;
      case 'go':
        [60, 64, 67, 72].forEach((m) => T({ type: 'square', f: mtof(m + 12), dur: 0.45, vol: 0.07 }));
        T({ type: 'triangle', f: mtof(48), dur: 0.5, vol: 0.25 });
        break;
      case 'teleport':
        T({ type: 'sine', f: 300, f1: 1800, dur: 0.35, vol: 0.07 });
        T({ type: 'triangle', f: 1200, f1: 2400, dur: 0.25, vol: 0.04, delay: 0.1 });
        break;
      case 'whee':
        T({ type: 'triangle', f: 400, f1: 1300, dur: 0.3, vol: 0.18 });
        break;
      case 'push':
        N({ type: 'lowpass', f: 300, dur: 0.05, vol: 0.06 });
        break;
      case 'wobble':
        T({ type: 'sine', f: 300 + Math.random() * 80, f1: 220, dur: 0.08, vol: 0.08 });
        break;
      case 'ko':
        T({ type: 'sine', f: 2200, f1: 3200, dur: 0.25, vol: 0.08 });
        T({ type: 'triangle', f: 1600, dur: 0.4, vol: 0.06, delay: 0.05 });
        break;
      case 'plasma':
        T({ type: 'sawtooth', f: 600, f1: 250, dur: 0.18, vol: 0.08 });
        T({ type: 'sine', f: 1200, f1: 400, dur: 0.18, vol: 0.08 });
        break;
      case 'erupt':
        N({ type: 'lowpass', f: 300, f1: 80, dur: 1.4, vol: 0.25, attack: 0.1 });
        break;
      case 'extralife':
        [0, 4, 7, 12, 7, 12, 16, 24].forEach((s, i) => T({ type: 'square', f: mtof(72 + s), dur: 0.12, vol: 0.09, delay: i * 0.08 }));
        break;
    }
  }

  // ---- music -----------------------------------------------------------
  playMusic(name) {
    if (!this.ctx) return;
    if (this.song === SONGS[name]) return;
    this.stopMusic();
    this.song = SONGS[name];
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
  }

  _schedule() {
    const s = this.song;
    if (!s || !this.ctx) return;
    const spb = 60 / s.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this._step(this.step, this.nextTime, spb);
      this.nextTime += spb;
      this.step = (this.step + 1) % s.lead.length;
    }
  }

  _step(step, t, spb) {
    const s = this.song;
    const out = this.music;
    const i = step % 16;
    const bar = Math.floor(step / 16) % s.chords.length;
    const chord = s.chords[bar];
    const soft = !!s.soft;
    // drums
    if (!soft) {
      if (i % 4 === 0 || (s.driving && i === 10)) this.tone({ type: 'sine', f: 160, f1: 42, dur: 0.14, vol: 0.55, out, t0: t });
      if (i === 4 || i === 12) {
        this.noise({ type: 'bandpass', f: 1900, dur: 0.12, vol: 0.22, out, t0: t, q: 0.8 });
        this.tone({ type: 'triangle', f: 210, f1: 140, dur: 0.08, vol: 0.12, out, t0: t });
      }
      if (i % 2 === 1 || s.driving) this.noise({ type: 'highpass', f: 8000, dur: 0.03, vol: i % 2 ? 0.07 : 0.04, out, t0: t });
    } else if (i === 0) {
      this.tone({ type: 'sine', f: 120, f1: 50, dur: 0.2, vol: 0.3, out, t0: t });
    }
    // bass
    if (i % 2 === 0 || s.driving) {
      const oct = (i % 4 === 2) ? 12 : 0;
      this.tone({ type: 'triangle', f: mtof(chord[0] - 24 + oct), dur: spb * 1.8, vol: soft ? 0.18 : 0.28, out, t0: t });
    }
    // arpeggio
    if (!soft || i % 2 === 0) {
      const n = chord[i % 3] + 12 + (i % 6 === 5 ? 12 : 0);
      this.tone({ type: 'square', f: mtof(n), dur: spb * 0.8, vol: soft ? 0.018 : 0.026, out, t0: t });
    }
    // lead
    const m = s.lead[step];
    if (m) {
      const g1 = this.tone({ type: 'square', f: mtof(m), dur: spb * 2.6, vol: soft ? 0.05 : 0.065, out, t0: t, attack: 0.01 });
      g1.connect(this.echo);
      this.tone({ type: 'triangle', f: mtof(m - 12), dur: spb * 2.6, vol: 0.05, out, t0: t });
    }
  }
}
