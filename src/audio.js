// 소리: 효과음은 샘플 단위로 합성해 버퍼로 만들어 두고, 음악은 Web Audio 노드로 실시간 생성한다.
// 외부 음원 파일 없이 동작한다.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

// 단순 1차 필터
function highpass(buf, a = 0.86) {
  let px = 0, py = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = a * (py + x - px);
    px = x;
    py = y;
    buf[i] = y;
  }
}
function lowpass(buf, a = 0.3) {
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i] - y);
    buf[i] = y;
  }
}
function normalize(buf, peak = 0.9) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
}

// 플라스틱 두 번 딸깍: 1차 접촉 + 스터드가 자리 잡는 2차 클릭 + 몸체 공진 + 무게감
export function synthSnap(sr, { pitch = 1, body = 1, weight = 0.5, seed = 1, second = 0.55 }) {
  const r = rng(seed);
  const n = Math.floor(sr * 0.22);
  const out = new Float32Array(n);
  const modes = [
    [2250, 0.016, 0.55],
    [3720, 0.011, 0.4],
    [1380, 0.026, 0.42 * body],
    [5350, 0.007, 0.28],
    [820, 0.034, 0.22 * body],
    [6900, 0.005, 0.18],
  ];
  const clicks = [
    [0, 1],
    [0.011 + r() * 0.009, second],
  ];
  for (const [t0, amp] of clicks) {
    const s0 = Math.floor(t0 * sr);
    const det = 1 + (r() - 0.5) * 0.06;
    for (const [f, d, a] of modes) {
      const ff = f * pitch * det * (1 + (r() - 0.5) * 0.04);
      const ph = r() * TAU;
      const dn = d * sr;
      const len = Math.min(n - s0, Math.floor(dn * 7));
      for (let i = 0; i < len; i++) out[s0 + i] += amp * a * Math.exp(-i / dn) * Math.sin((TAU * ff * i) / sr + ph);
    }
    // 날카로운 접촉 잡음
    const nl = Math.floor(0.004 * sr);
    const nb = new Float32Array(nl);
    for (let i = 0; i < nl; i++) nb[i] = (r() * 2 - 1) * Math.exp(-i / (0.0009 * sr));
    highpass(nb, 0.8);
    for (let i = 0; i < nl && s0 + i < n; i++) out[s0 + i] += amp * 0.9 * nb[i];
  }
  // 무게감(낮은 쿵)
  if (weight > 0) {
    let ph = 0;
    const len = Math.floor(0.09 * sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f = 150 * (0.75 + 0.5 / pitch) * (1 + 0.8 * Math.exp(-t / 0.008));
      ph += (TAU * f) / sr;
      out[i] += weight * 0.5 * Math.exp(-t / 0.028) * Math.sin(ph);
    }
  }
  normalize(out, 0.92);
  return out;
}

export function synthPluck(sr, seed) {
  const r = rng(seed);
  const n = Math.floor(sr * 0.2);
  const out = new Float32Array(n);
  // 빼낼 때의 마찰음
  const fl = Math.floor(0.045 * sr);
  for (let i = 0; i < fl; i++) {
    const t = i / fl;
    out[i] += (r() * 2 - 1) * 0.18 * t * t;
  }
  highpass(out, 0.7);
  const s0 = fl;
  for (const [f, d, a] of [[2900, 0.012, 0.6], [4600, 0.008, 0.4], [1700, 0.02, 0.3]]) {
    const dn = d * sr;
    const ph = r() * TAU;
    for (let i = 0; i < Math.min(n - s0, dn * 7); i++) out[s0 + i] += a * Math.exp(-i / dn) * Math.sin((TAU * f * i) / sr + ph);
  }
  normalize(out, 0.7);
  return out;
}

export function synthThud(sr, seed, rattle = 5) {
  const r = rng(seed);
  const n = Math.floor(sr * 0.35);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < Math.floor(0.14 * sr); i++) {
    const t = i / sr;
    const f = 95 * (1 + 1.2 * Math.exp(-t / 0.01));
    ph += (TAU * f) / sr;
    out[i] += 0.8 * Math.exp(-t / 0.05) * Math.sin(ph);
  }
  const nz = new Float32Array(Math.floor(0.03 * sr));
  for (let i = 0; i < nz.length; i++) nz[i] = (r() * 2 - 1) * Math.exp(-i / (0.006 * sr));
  lowpass(nz, 0.25);
  for (let i = 0; i < nz.length; i++) out[i] += nz[i] * 0.9;
  // 달그락
  for (let k = 0; k < rattle; k++) {
    const s0 = Math.floor((0.02 + r() * 0.12) * sr);
    const f = 1800 + r() * 3200;
    const dn = 0.006 * sr;
    const a = 0.25 * (1 - k / rattle);
    for (let i = 0; i < dn * 6 && s0 + i < n; i++) out[s0 + i] += a * Math.exp(-i / dn) * Math.sin((TAU * f * i) / sr);
  }
  normalize(out, 0.9);
  return out;
}

function synthTick(sr) {
  const n = Math.floor(sr * 0.02);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.exp(-i / (0.0015 * sr)) * Math.sin((TAU * 5200 * i) / sr) * 0.6 + Math.exp(-i / (0.003 * sr)) * Math.sin((TAU * 2600 * i) / sr) * 0.3;
  return out;
}

function synthBonk(sr) {
  const n = Math.floor(sr * 0.16);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = 0.7 * Math.exp(-t / 0.035) * Math.sin(TAU * 310 * t) + 0.3 * Math.exp(-t / 0.02) * Math.sin(TAU * 520 * t);
  }
  return out;
}

function synthTap(sr) {
  const n = Math.floor(sr * 0.05);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * (1500 - 900 * (t / 0.05))) / sr;
    out[i] = Math.exp(-t / 0.009) * Math.sin(ph) * 0.5;
  }
  return out;
}

function makeImpulse(ctx, dur = 1.6, decay = 3) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const r = rng(99);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, decay);
    lowpass(d, 0.35);
  }
  return buf;
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 진행: F장조 — Fmaj9 · Am7 · Dm9 · B♭maj7 · Gm9 · Am7 · B♭maj7 · C6sus
const PROG = [
  { root: 41, tones: [53, 57, 60, 64, 67] },
  { root: 45, tones: [52, 57, 60, 64, 67] },
  { root: 38, tones: [53, 57, 60, 62, 64] },
  { root: 46, tones: [50, 53, 57, 62, 64] },
  { root: 43, tones: [53, 55, 58, 62, 65] },
  { root: 45, tones: [52, 55, 57, 60, 64] },
  { root: 46, tones: [53, 57, 58, 62, 65] },
  { root: 48, tones: [53, 55, 57, 60, 62] },
];
const PENTA = [65, 67, 69, 72, 74, 77, 79, 81];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicVol = 0.55;
    this.sfxVol = 0.9;
    this.bar = 0;
    this.step = 0;
    this.nextTime = 0;
    this.r = rng(1234);
    this.lastTick = 0;
  }

  get ready() {
    return !!this.ctx;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.32;
    this.reverb.connect(this.revGain).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? this.sfxVol : 0;
    this.sfx.connect(this.master);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.12;
    this.sfx.connect(this.sfxSend).connect(this.reverb);

    this.music = ctx.createGain();
    this.music.gain.value = 0;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 6500;
    this.music.connect(warm).connect(this.master);
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 0.35;
    this.music.connect(this.musicSend).connect(this.reverb);

    const sr = ctx.sampleRate;
    const toBuf = (arr) => {
      const b = ctx.createBuffer(1, arr.length, sr);
      b.getChannelData(0).set(arr);
      return b;
    };
    this.buf = {
      snapS: [1, 2, 3, 4].map((s) => toBuf(synthSnap(sr, { pitch: 1.25, body: 0.6, weight: 0.15, seed: s, second: 0.45 }))),
      snapM: [5, 6, 7, 8].map((s) => toBuf(synthSnap(sr, { pitch: 1, body: 1, weight: 0.45, seed: s }))),
      snapL: [9, 10, 11].map((s) => toBuf(synthSnap(sr, { pitch: 0.78, body: 1.3, weight: 0.9, seed: s, second: 0.7 }))),
      pluck: [21, 22, 23].map((s) => toBuf(synthPluck(sr, s))),
      thud: [31, 32].map((s) => toBuf(synthThud(sr, s))),
      tick: toBuf(synthTick(sr)),
      bonk: toBuf(synthBonk(sr)),
      tap: toBuf(synthTap(sr)),
    };
    this.startScheduler();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
    this.setMusic(this.musicOn);
  }

  play(buffer, { gain = 1, rate = 1, pan = 0, when = 0 } = {}) {
    if (!this.ctx || !this.sfxOn) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = src.connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node = node.connect(p);
    }
    node.connect(this.sfx);
    src.start(when || ctx.currentTime);
  }

  choose(list) {
    return list[Math.floor(this.r() * list.length)];
  }

  // size: 부품 질량, height: 쌓인 높이(플레이트), pan: -1..1
  snap({ mass = 6, height = 0, pan = 0, soft = false } = {}) {
    if (!this.ctx) return;
    const set = mass <= 3 ? this.buf.snapS : mass <= 16 ? this.buf.snapM : this.buf.snapL;
    const rate = (1 + (this.r() - 0.5) * 0.08) * (mass > 40 ? 0.92 : 1);
    this.play(this.choose(set), { gain: soft ? 0.45 : 0.9, rate, pan });
    if (this.musicOn && !soft) this.chime(height, pan);
  }

  pluck({ pan = 0 } = {}) {
    if (!this.ctx) return;
    this.play(this.choose(this.buf.pluck), { gain: 0.7, rate: 1 + (this.r() - 0.5) * 0.1, pan });
  }

  thud({ pan = 0, gain = 0.8 } = {}) {
    if (!this.ctx) return;
    this.play(this.choose(this.buf.thud), { gain, rate: 0.95 + this.r() * 0.1, pan });
  }

  tick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTick < 0.03) return;
    this.lastTick = now;
    this.play(this.buf.tick, { gain: 0.1, rate: 0.9 + this.r() * 0.2 });
  }

  bonk() {
    this.play(this.buf?.bonk, { gain: 0.5 });
  }

  tap() {
    this.play(this.buf?.tap, { gain: 0.35, rate: 0.95 + this.r() * 0.1 });
  }

  whoosh(up = true) {
    if (!this.ctx || !this.sfxOn) return;
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * 0.4);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (this.r() * 2 - 1) * Math.sin((Math.PI * i) / n) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(up ? 500 : 2500, t);
    f.frequency.exponentialRampToValueAtTime(up ? 2600 : 450, t + 0.38);
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
  }

  // 부드러운 종소리 (벨/마림바)
  bell(midi, { when = 0, gain = 0.2, dest, decay = 1.4, bright = 1 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = when || ctx.currentTime;
    const f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    const o1 = ctx.createOscillator();
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.frequency.value = f * 4.0;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.25 * bright, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(dest || this.sfx);
    o1.start(t);
    o2.start(t);
    o1.stop(t + decay + 0.05);
    o2.stop(t + decay + 0.05);
  }

  // 현재 화음에 맞는 음을 높이에 따라
  chime(height = 0, pan = 0) {
    if (!this.ctx) return;
    const ch = PROG[this.bar % PROG.length];
    const tones = ch.tones.map((m) => m + 12);
    const idx = Math.min(tones.length - 1, Math.floor(height / 9) % (tones.length + 2));
    const oct = height > 45 ? 12 : 0;
    const note = tones[Math.max(0, idx % tones.length)] + oct;
    void pan;
    this.bell(note, { gain: 0.07, decay: 1.2, dest: this.music, when: this.ctx.currentTime + 0.012 });
  }

  scanSweep(dur = 1.6) {
    if (!this.ctx || !this.sfxOn) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.2);
    g.gain.linearRampToValueAtTime(0.0, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  ping(height = 0, weak = false) {
    if (!this.ctx) return;
    const base = weak ? 64 : 76;
    const m = base + (Math.floor(height / 6) % 5) * 2;
    this.bell(m, { gain: weak ? 0.16 : 0.05, decay: weak ? 0.9 : 0.5, bright: weak ? 0.4 : 1 });
  }

  result(ok) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = ok ? [72, 76, 79, 84] : [67, 63];
    notes.forEach((m, i) => this.bell(m, { when: t + i * (ok ? 0.08 : 0.16), gain: ok ? 0.12 : 0.16, decay: ok ? 1.6 : 0.9 }));
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? this.sfxVol : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(on ? this.musicVol : 0, t, on ? 0.8 : 0.3);
  }

  setMusicVolume(v) {
    this.musicVol = v;
    if (this.ctx && this.musicOn) this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  // ── 음악 스케줄러 ───────────────────────────────────
  startScheduler() {
    const ctx = this.ctx;
    this.bpm = 76;
    this.spb = 60 / this.bpm / 2; // 8분음표 길이
    this.nextTime = ctx.currentTime + 0.2;
    this.step = 0;
    this.bar = 0;
    this.noise = (() => {
      const n = ctx.sampleRate;
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = this.r() * 2 - 1;
      return b;
    })();
    this.phrase = null;
    setInterval(() => this.schedule(), 40);
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.25) {
      if (this.musicOn) this.playStep(this.step, this.nextTime);
      const swing = this.step % 2 === 0 ? 1.12 : 0.88;
      this.nextTime += this.spb * swing;
      this.step++;
      if (this.step >= 8) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  playStep(step, t) {
    const ch = PROG[this.bar % PROG.length];
    const r = this.r;
    const hum = () => (r() - 0.5) * 0.018;
    if (step === 0) {
      this.pad(ch, t, this.spb * 8 * 1.02);
      this.bass(ch.root - 12 + (ch.root < 43 ? 12 : 0), t, 1.2);
      this.kick(t);
      if (this.bar % 4 === 0 && r() < 0.8) this.phrase = this.makePhrase();
      if (this.bar % 4 === 2 && r() < 0.5) this.phrase = null;
    }
    if (step === 5 && r() < 0.6) this.bass(ch.root - 12 + (ch.root < 43 ? 12 : 0) + (r() < 0.5 ? 7 : 12), t + hum(), 0.5);
    if (step === 4) this.brush(t + hum());
    if (step === 6 && r() < 0.35) this.kick(t, 0.5);
    this.shaker(t + hum(), step % 2 ? 0.5 : 0.8);
    // 로즈 피아노: 부서진 화음
    const prob = [0.9, 0.25, 0.55, 0.4, 0.7, 0.3, 0.5, 0.35][step];
    if (r() < prob) {
      const n = ch.tones[Math.floor(r() * ch.tones.length)] + (r() < 0.3 ? 12 : 0);
      this.keys(n, t + hum(), 0.32 + r() * 0.25);
      if (step === 0) {
        for (const m of ch.tones.slice(0, 3)) this.keys(m, t + 0.012 + r() * 0.02, 0.18);
      }
    }
    if (this.phrase) {
      const p = this.phrase[(this.bar % 2) * 8 + step];
      if (p) this.bell(p, { when: t + hum(), gain: 0.055, decay: 1.6, dest: this.music });
    }
  }

  makePhrase() {
    const r = this.r;
    const out = new Array(16).fill(0);
    let i = Math.floor(r() * 5) + 2;
    for (let s = 0; s < 16; s++) {
      if (r() < (s % 2 ? 0.2 : 0.45)) {
        i = Math.max(0, Math.min(PENTA.length - 1, i + Math.floor(r() * 5) - 2));
        out[s] = PENTA[i];
      }
    }
    return out;
  }

  keys(midi, t, vel) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.6, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.7);
    mod.connect(idx).connect(car.frequency);
    const tine = ctx.createOscillator();
    tine.frequency.value = f * 7.02;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(vel * 0.05, t);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.13, t + 0.006);
    g.gain.exponentialRampToValueAtTime(vel * 0.035, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 2.2);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    car.connect(g);
    tine.connect(tg).connect(g);
    if (pan) {
      pan.pan.value = (midi - 62) / 24;
      g.connect(pan).connect(this.music);
    } else g.connect(this.music);
    for (const o of [car, mod, tine]) {
      o.start(t);
      o.stop(t + 2.3);
    }
  }

  pad(ch, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.028, t + 1.1);
    g.gain.setValueAtTime(0.028, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1100, t + dur / 2);
    lp.frequency.linearRampToValueAtTime(750, t + dur);
    lp.Q.value = 0.4;
    lp.connect(g).connect(this.music);
    for (const m of ch.tones.slice(0, 4)) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m - 12);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 1);
      }
    }
  }

  bass(midi, t, len) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(midi);
    const s = ctx.createOscillator();
    s.frequency.value = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.03, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0, t + len);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    o.connect(lp);
    s.connect(lp);
    lp.connect(g).connect(this.music);
    o.start(t);
    s.start(t);
    o.stop(t + len + 0.05);
    s.stop(t + len + 0.05);
  }

  kick(t, v = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.32);
  }

  noiseHit(t, { freq, q, gain, dur, type = 'bandpass' }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(this.music);
    src.start(t, this.r() * 0.5);
    src.stop(t + dur + 0.02);
  }

  brush(t) {
    this.noiseHit(t, { freq: 1800, q: 0.7, gain: 0.05, dur: 0.22 });
  }

  shaker(t, v) {
    this.noiseHit(t, { freq: 7500, q: 1.2, gain: 0.012 * v, dur: 0.05, type: 'highpass' });
  }
}
