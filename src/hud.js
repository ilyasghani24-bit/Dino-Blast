import { POWER_INFO } from './entities/player.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), score: $('score'), lives: $('lives'), hearts: $('hearts'), coins: $('coins'), eggs: $('eggs'),
      powerups: $('powerups'), bossBar: $('boss-bar'), bossFill: $('boss-fill'), bossLag: $('boss-lag'),
      banner: $('banner'), bannerMain: $('banner-main'), bannerSub: $('banner-sub'), combo: $('combo'),
      portrait: $('portrait-img'), coinImg: $('coin-img'), eggImg: $('egg-img'),
    };
    this.heartIcon = '';
    this.bannerTimer = null;
    this.comboTimer = null;
    this.shown = 0;
    this.target = 0;
  }

  setIcons({ portrait, coin, egg, heart }) {
    this.el.portrait.src = portrait;
    this.el.coinImg.src = coin;
    this.el.eggImg.src = egg;
    this.heartIcon = heart;
  }

  show(b) { this.el.hud.classList.toggle('hidden', !b); }

  score(n) {
    this.target = n;
    this.el.score.classList.add('bump');
    clearTimeout(this._sb);
    this._sb = setTimeout(() => this.el.score.classList.remove('bump'), 90);
  }

  /** Rolling score counter, called every frame. */
  tick(dt) {
    if (this.shown !== this.target) {
      const diff = this.target - this.shown;
      this.shown += Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 12)));
      if ((diff > 0 && this.shown > this.target) || (diff < 0 && this.shown < this.target)) this.shown = this.target;
      this.el.score.textContent = String(this.shown).padStart(7, '0');
    }
  }

  resetScore() { this.shown = this.target = 0; this.el.score.textContent = '0000000'; }

  lives(n) { this.el.lives.textContent = Math.max(0, n); }

  hearts(n, max) {
    const h = this.el.hearts;
    const prev = h.children.length;
    if (prev !== max) {
      h.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const d = document.createElement('div');
        d.className = 'heart';
        d.style.backgroundImage = `url(${this.heartIcon})`;
        h.appendChild(d);
      }
    }
    [...h.children].forEach((d, i) => {
      const was = d.classList.contains('empty');
      d.classList.toggle('empty', i >= n);
      if (was && i < n) { d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); }
    });
  }

  coins(n) { this._counter(this.el.coins, n); }
  eggs(n) { this._counter(this.el.eggs, n); }
  _counter(el, n) {
    el.textContent = n;
    const box = el.parentElement;
    box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
  }

  powerups(p) {
    const root = this.el.powerups;
    root.innerHTML = '';
    for (const [k, v] of Object.entries(p)) {
      if (v <= 0) continue;
      const info = POWER_INFO[k];
      const d = document.createElement('div');
      d.className = 'pu';
      d.style.color = info.color;
      d.innerHTML = `<span>${info.label}</span><span class="bar"><i data-k="${k}" style="width:${(v / 15) * 100}%"></i></span>`;
      root.appendChild(d);
    }
  }

  tickPowerups(p) {
    for (const i of this.el.powerups.querySelectorAll('i[data-k]')) i.style.width = `${Math.max(0, p[i.dataset.k] / 15) * 100}%`;
  }

  boss(frac) {
    if (frac === null) { this.el.bossBar.classList.add('hidden'); return; }
    this.el.bossBar.classList.remove('hidden');
    this.el.bossFill.style.width = `${frac * 100}%`;
    this.el.bossLag.style.width = `${frac * 100}%`;
  }

  banner(main, sub = '', dur = 1.5) {
    const b = this.el.banner;
    this.el.bannerMain.textContent = main;
    this.el.bannerSub.textContent = sub;
    b.classList.remove('hidden', 'show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    if (dur > 0) this.bannerTimer = setTimeout(() => b.classList.add('hidden'), dur * 1000);
  }

  hideBanner() { this.el.banner.classList.add('hidden'); }

  combo(n) {
    const c = this.el.combo;
    const words = ['', '', 'NICE!', 'GREAT!', 'AWESOME!', 'AMAZING!', 'INCREDIBLE!', 'EGG-STREME!', 'LEGENDARY!'];
    c.innerHTML = `${n}x COMBO<small>${words[Math.min(n, words.length - 1)]}</small>`;
    c.classList.remove('hidden', 'pop');
    void c.offsetWidth;
    c.classList.add('pop');
    clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => c.classList.add('hidden'), 1600);
  }
}
