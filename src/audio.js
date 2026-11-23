// Procedural sound: nothing is loaded, everything is synthesised with WebAudio.
//
// Two buses feed one compressor: effects and music. The music is a small generative score
// (pads, bass, an arpeggio, light percussion) on a four-chord loop in D. Its density follows
// the game's tension. Captures and clones play notes from whatever chord is sounding, so
// every move lands in key with the music.

const N = (semis) => 146.83 * Math.pow(2, semis / 12); // semitones above D3
const CHORDS = [
  { root: N(-12), tones: [N(0), N(4), N(7), N(11), N(14)] },  // Dmaj9
  { root: N(-15), tones: [N(-3), N(0), N(4), N(7), N(11)] },  // Bm(add9)
  { root: N(-19), tones: [N(-7), N(-3), N(0), N(4), N(9)] },  // Gmaj7(#11)
  { root: N(-17), tones: [N(-5), N(-1), N(2), N(7), N(9)] },  // A6sus
];
const BPM = 96, STEP = 60 / BPM / 2; // eighth notes; 8 per bar

export class Sfx {
  constructor() {
    this.ctx = null;
    let st = null;
    try { st = localStorage.getItem('hx.sound'); } catch {}
    if (!st) { try { st = localStorage.getItem('hx.muted') === '1' ? 'mute' : 'all'; } catch { st = 'all'; } }
    this._state = st;
    this.muted = st === 'mute';
    this.mode = 'off';
    this.level = 0; // tension 0..1
    this.chord = CHORDS[0];
  }
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 3.5;
        this.master.connect(comp).connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 1;
        this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0;
        this.sfxBus.connect(this.master); this.musicBus.connect(this.master);
        // a long, soft hall for the music and a shorter shimmer for effects
        this.verb = this.makeVerb(1.6, 0.26, this.sfxBus);
        this.hall = this.makeVerb(3.2, 0.5, this.musicBus);
      } catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  makeVerb(seconds, wetLevel, out) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const v = ctx.createConvolver(); v.buffer = buf;
    const wet = ctx.createGain(); wet.gain.value = wetLevel;
    v.connect(wet).connect(out);
    return v;
  }

  // ---- sound state: 'all' (music + effects), 'sfx' (effects only), 'mute' ----
  state() { return this._state; }
  setState(st) {
    this._state = st;
    this.muted = st === 'mute';
    try { localStorage.setItem('hx.sound', st); } catch {}
    this.applyMusicLevel();
  }
  cycle() {
    const next = { all: 'sfx', sfx: 'mute', mute: 'all' }[this._state] || 'all';
    this.setState(next);
    return next;
  }
  toggle() { this.setState(this._state === 'mute' ? 'all' : 'mute'); return this.muted; }

  // ---- generative music ----
  /** 'menu' (sparse, dreamy), 'game' (pulse grows with tension) or 'off'. */
  music(mode) {
    this.mode = mode;
    if (!this.ensure()) return;
    this.applyMusicLevel();
    if (mode !== 'off' && !this.timer) {
      this.nextT = this.ctx.currentTime + 0.1;
      this.step = 0;
      this.timer = setInterval(() => this.schedule(), 40);
    }
  }
  intensity(v) { this.level += (v - this.level) * 0.5; }
  applyMusicLevel() {
    if (!this.ctx) return;
    const on = this._state === 'all' && this.mode !== 'off';
    const target = on ? (this.mode === 'menu' ? 0.55 : 0.42) : 0;
    this.musicBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.6);
  }
  schedule() {
    if (this.mode === 'off' && this.musicBus.gain.value < 0.001) { clearInterval(this.timer); this.timer = null; return; }
    while (this.nextT < this.ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextT);
      this.step++;
      this.nextT += STEP;
    }
  }
  playStep(i, t) {
    const bar = Math.floor(i / 8) % 4, e = i % 8, game = this.mode === 'game', lv = game ? this.level : 0;
    const ch = CHORDS[bar];
    this.chord = ch;
    if (e === 0) {
      this.voice(ch.tones.slice(0, 4), t, STEP * 8.4, { type: 'sawtooth', vol: 0.05, cutoff: 900 + lv * 1400, attack: 0.6, detune: 9 });
      this.voice([ch.root], t, STEP * 3.6, { type: 'sine', vol: 0.16, attack: 0.02 });
    }
    if (e === 4) this.voice([ch.root], t, STEP * 3.2, { type: 'sine', vol: game ? 0.12 : 0.07, attack: 0.02 });
    // arpeggio: a gentle pattern in the menu, busier as the game heats up
    const pattern = game ? [1, 0, 1, 1, 0, 1, 1, lv > 0.5 ? 1 : 0] : [1, 0, 0, 1, 0, 0, 1, 0];
    if (pattern[e] && (game || Math.random() < 0.85)) {
      const tone = ch.tones[(i * 3 + bar) % ch.tones.length] * 2;
      this.voice([tone], t, STEP * 1.6, { type: 'triangle', vol: 0.035 + lv * 0.02, attack: 0.005, cutoff: 3500 });
    }
    if (game && lv > 0.3 && e % 2 === 1) this.hat(t, 0.02 + lv * 0.025);
    if (game && lv > 0.55 && e % 4 === 0) this.kickAt(t, 0.18 + lv * 0.15);
  }
  voice(freqs, t, dur, { type = 'sine', vol = 0.05, attack = 0.01, cutoff = 0, detune = 0 } = {}) {
    const ctx = this.ctx;
    for (const f of freqs) for (const det of detune ? [-detune, detune] : [0]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f; o.detune.value = det;
      let node = o;
      if (cutoff) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; o.connect(lp); node = lp; }
      const v = vol / (detune ? 2 : 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + attack);
      g.gain.setTargetAtTime(0, t + Math.max(attack, dur * 0.55), dur * 0.25);
      node.connect(g); g.connect(this.musicBus); g.connect(this.hall);
      o.start(t); o.stop(t + dur + 1.5);
    }
  }
  hat(t, vol) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(hp).connect(g).connect(this.musicBus); s.start(t);
  }
  kickAt(t, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.musicBus); o.start(t); o.stop(t + 0.35);
  }
  /** A note from the chord that is sounding right now, `step` places up the stack. */
  inKey(step, octave = 2) {
    const tones = this.chord.tones;
    return tones[step % tones.length] * octave * Math.pow(2, Math.floor(step / tones.length));
  }

  tone(freq, dur, { type = 'sine', vol = 0.15, delay = 0, slide = 0, attack = 0.005 } = {}) {
    if (this.muted || !this.ensure()) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { vol = 0.1, delay = 0, freq = 1200, q = 1, sweep = 1 } = {}) {
    if (this.muted || !this.ensure()) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    src.start(t);
  }  select() { this.tone(880, 0.08, { type: 'triangle', vol: 0.08 }); this.tone(1320, 0.1, { vol: 0.05, delay: 0.03 }); }
  deselect() { this.tone(660, 0.08, { type: 'triangle', vol: 0.06, slide: 0.7 }); }
  clone() { const f = this.inKey(1); this.tone(f / 2, 0.18, { type: 'sine', vol: 0.16, slide: 2 }); this.tone(f, 0.25, { type: 'triangle', vol: 0.06, delay: 0.05 }); }
  jump() { this.noise(0.45, { vol: 0.12, freq: 400, sweep: 6, q: 2 }); this.tone(300, 0.4, { type: 'sine', vol: 0.08, slide: 2.5 }); }
  land() { this.tone(180, 0.18, { type: 'sine', vol: 0.18, slide: 0.5 }); }
  /** Each capture in a move climbs the current chord, so multi-captures play a rising arpeggio. */
  capture(k, wave = 0) {
    const f = this.inKey(k + wave * 2);
    this.tone(f, 0.45, { type: 'triangle', vol: 0.09 });
    this.tone(f * 2, 0.3, { type: 'sine', vol: 0.035, delay: 0.02 });
  }
  cascade(w) { for (let i = 0; i < 4; i++) this.tone(this.inKey(i + w * 2, 1), 0.3, { type: 'sawtooth', vol: 0.025, delay: i * 0.05 }); }
  shift() { this.noise(1.4, { vol: 0.2, freq: 90, sweep: 2.5, q: 0.7 }); this.tone(55, 1.4, { type: 'sawtooth', vol: 0.06, slide: 1.5, attack: 0.3 }); }
  fill() { this.noise(0.8, { vol: 0.08, freq: 2000, sweep: 0.3, q: 0.5 }); }
  tick() { this.tone(1800, 0.03, { type: 'square', vol: 0.03 }); }
  warn() { this.tone(220, 0.25, { type: 'square', vol: 0.06 }); this.tone(220, 0.25, { type: 'square', vol: 0.06, delay: 0.3 }); }
  // ---- Cat Clash voices ----
  /** A synthesised "mrrow": a buzzy source through a sweeping formant filter. */
  meow(player = 1, pitch = 1) {
    if (this.muted || !this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const f0 = (player === 2 ? 300 : player === 3 ? 420 : 560) * pitch * (0.93 + Math.random() * 0.14);
    const dur = player === 2 ? 0.55 : 0.45;
    const o = ctx.createOscillator();
    o.type = player === 3 ? 'square' : 'sawtooth';
    if (player === 3) {
      // robot: stepped pitch
      [1, 1.25, 0.9].forEach((m, k) => o.frequency.setValueAtTime(f0 * m, t + k * dur / 3));
    } else {
      o.frequency.setValueAtTime(f0 * 0.85, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.3, t + dur * 0.3);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
    }
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1700, t + dur * 0.35);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(player === 2 ? 0.32 : 0.26, t + 0.04);
    g.gain.setValueAtTime(player === 2 ? 0.3 : 0.24, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    o.start(t); o.stop(t + dur + 0.05);
    if (player === 2) this.noise(dur * 0.8, { vol: 0.05, freq: 500, q: 1.5 }); // growl
    if (player === 1) this.tone(f0 * 2, 0.3, { vol: 0.03, delay: 0.1, slide: 1.5 }); // cosmic shimmer
  }
  roar() {
    this.noise(1.1, { vol: 0.35, freq: 260, sweep: 0.5, q: 0.8 });
    this.tone(110, 1.0, { type: 'sawtooth', vol: 0.16, slide: 0.55, attack: 0.05 });
    this.tone(165, 0.9, { type: 'square', vol: 0.06, slide: 0.6, attack: 0.05 });
    this.meow(2, 0.8);
  }
  pew() { for (let k = 0; k < 3; k++) this.tone(1800, 0.18, { type: 'square', vol: 0.04, slide: 0.25, delay: k * 0.07 }); }
  boom() { this.noise(0.7, { vol: 0.3, freq: 140, sweep: 0.4, q: 0.7 }); this.tone(70, 0.6, { vol: 0.2, slide: 0.5 }); }
  zap() { this.tone(2400, 0.3, { type: 'sawtooth', vol: 0.06, slide: 0.15 }); this.noise(0.25, { vol: 0.08, freq: 4000, sweep: 0.3, q: 3 }); }
  merge(level = 2) {
    const base = level >= 3 ? 392 : 329.6;
    [1, 1.26, 1.5, 2, 2.52].forEach((m, k) => this.tone(base * m, 0.5, { type: 'triangle', vol: 0.09, delay: k * 0.06 }));
    this.tone(base / 2, 0.8, { type: 'sawtooth', vol: 0.05, slide: 2, attack: 0.1 });
    this.noise(0.6, { vol: 0.06, freq: 3000, sweep: 0.3, q: 0.6 });
  }
  crack() {
    this.noise(0.25, { vol: 0.2, freq: 5000, sweep: 0.5, q: 2 });
    [2093, 1568, 2637].forEach((f, k) => this.tone(f, 0.25, { type: 'triangle', vol: 0.05, delay: k * 0.03 }));
  }
  spin() { this.tone(300, 0.7, { type: 'sine', vol: 0.08, slide: 3 }); this.tone(450, 0.7, { type: 'sine', vol: 0.05, slide: 2.5, delay: 0.05 }); }
  beam() {
    this.tone(180, 0.9, { type: 'sawtooth', vol: 0.05, slide: 2.2, attack: 0.15 });
    for (let k = 0; k < 6; k++) this.tone(900 + k * 120, 0.12, { type: 'sine', vol: 0.03, delay: k * 0.12 });
  }
  whoosh() { this.noise(0.35, { vol: 0.12, freq: 800, sweep: 3, q: 1.5 }); }
  bonk() { this.tone(220, 0.15, { type: 'square', vol: 0.1, slide: 0.5 }); this.tone(880, 0.1, { type: 'triangle', vol: 0.06 }); }
  swoon() { [784, 988, 1175].forEach((f, k) => this.tone(f, 0.35, { type: 'sine', vol: 0.06, delay: k * 0.09, slide: 0.9 })); }
  turn() { this.tone(660, 0.12, { type: 'triangle', vol: 0.07 }); this.tone(990, 0.18, { type: 'triangle', vol: 0.06, delay: 0.08 }); }
  // ---- intro score ----
  /** Sustained pad chord; returns nothing (fades itself out). */
  pad(freqs, dur, vol = 0.05, delay = 0) {
    if (this.muted || !this.ensure()) return;
    const t = this.ctx.currentTime + delay;
    for (const f of freqs) for (const det of [-6, 6]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(1800, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(500, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol / freqs.length, t + Math.min(1.5, dur / 3)); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(lp).connect(g); g.connect(this.sfxBus); g.connect(this.verb);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }
  kick(delay = 0, vol = 0.5) { this.tone(140, 0.35, { type: 'sine', vol, slide: 0.3, delay }); this.noise(0.05, { vol: 0.1, freq: 3000, delay }); }
  impact() { this.kick(0, 0.7); this.noise(1.6, { vol: 0.25, freq: 600, sweep: 0.2, q: 0.5 }); this.tone(55, 2, { type: 'sawtooth', vol: 0.1, slide: 0.8, attack: 0.01 }); }
  riser(dur = 2) { this.noise(dur, { vol: 0.08, freq: 300, sweep: 12, q: 1 }); this.tone(110, dur, { type: 'sawtooth', vol: 0.04, slide: 4, attack: dur * 0.8 }); }
  // ---- lasers and lightning ----
  /** Sci-fi laser: a fast falling square sweep over a sine thump, with a little shimmer. */
  laser() {
    this.tone(2200, 0.22, { type: 'square', vol: 0.05, slide: 0.18 });
    this.tone(1650, 0.26, { type: 'sawtooth', vol: 0.04, slide: 0.22, delay: 0.03 });
    this.tone(180, 0.18, { type: 'sine', vol: 0.12, slide: 0.5 });
  }
  /** Electric crackle: bursts of bright noise over a buzzing 60 Hz saw. */
  crackle() {
    for (let k = 0; k < 6; k++) this.noise(0.04 + Math.random() * 0.05, { vol: 0.09, freq: 2500 + Math.random() * 4000, q: 2, delay: k * 0.045 + Math.random() * 0.02 });
    this.tone(62, 0.35, { type: 'sawtooth', vol: 0.05 });
  }
  /** Thunder. `near` (0..1) sets loudness and how sharp the crack is; `delay` is the sound's travel time. */
  thunder(near = 0.5, delay = 0) {
    if (this.muted || !this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + delay, dur = 1.6 + (1 - near) * 1.4;
    const len = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    // brown-ish noise with rumbling amplitude swells
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.08) * 0.995;
      const env = Math.pow(1 - i / len, 1.6) * (0.6 + 0.4 * Math.sin(i / ctx.sampleRate * 9 + Math.sin(i / ctx.sampleRate * 3) * 2));
      d[i] = last * env * 6;
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180 + near * 500;
    const g = ctx.createGain(); g.gain.value = 0.15 + near * 0.4;
    src.connect(lp).connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    src.start(t);
    if (near > 0.6) this.noise(0.18, { vol: 0.25 * near, freq: 3000, sweep: 0.2, q: 0.6, delay });
  }
  /** Soft tick for the laser sight. */
  aim() { this.tone(this.inKey(3, 4), 0.06, { type: 'sine', vol: 0.025 }); }
  win() { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 0.7, { type: 'triangle', vol: 0.1, delay: i * 0.11 })); }
  lose() { [392, 349.2, 311.1, 261.6].forEach((f, i) => this.tone(f, 0.6, { type: 'sine', vol: 0.1, delay: i * 0.16 })); }
}
