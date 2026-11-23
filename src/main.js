import { Renderer, PLAYER_COLORS } from './render.js';
import { Sfx } from './audio.js';
import { LEVELS } from './ai.js';
import { playIntro } from './intro.js';
import { initJourney } from './journey-ui.js';
import { crownsOf } from './journey.js';
import { autoQuality } from './gfx.js';
import {
  makeBoard, SHAPES, applyMove, targetsFrom, resolveNext, fillEmpty, shiftRings,
  counts, standings, visibleMask, mulberry32, EMPTY, QUIET_LIMIT, own, lvl,
} from './rules.js';

const $ = (s) => document.querySelector(s);
const THEMES = {
  gems: [null, { name: 'Ruby', css: '#ff4d6d' }, { name: 'Pearl', css: '#d9e6ff' }, { name: 'Jade', css: '#3dffb0' }],
  cats: [null, { name: 'Galactic Cat', css: '#b98cff' }, { name: 'Dino Cat', css: '#9be65a' }, { name: 'Robo Cat', css: '#5ad8ff' }],
};
let PLAYERS = THEMES.cats;
/** Faction faces are rendered from the real 3D models, once per theme, and cached. */
function ensurePortraits(theme) {
  const T = THEMES[theme];
  if (T[1].img) return;
  const urls = R.portraits(theme);
  for (let p = 1; p <= 3; p++) T[p].img = urls[p];
}
const icon = (p, cls = 'face') => `<img class="${cls}" src="${PLAYERS[p].img || ''}" alt="">`;
function applyTheme(theme) {
  theme = theme in THEMES ? theme : 'cats';
  ensurePortraits(theme);
  PLAYERS = THEMES[theme];
  R.setTheme(theme);
}
const CONTROLLERS = { human: 'Human', easy: 'AI · Easy', medium: 'AI · Medium', hard: 'AI · Hard', master: 'AI · Master' };

const MUTATORS = {
  cascade: { name: 'Cascade', icon: '✦', desc: 'Captures chain: an enemy left touching 4+ of your pieces flips too, wave after wave.' },
  tectonic: { name: 'Tectonic', icon: '⟳', desc: 'Every two rounds the outer ring turns clockwise and the inner ring turns back, carrying pieces with it.' },
  fog: { name: 'Fog of War', icon: '☁', desc: 'You only see within two hexes of your own pieces.' },
  blitz: { name: 'Blitz', icon: '⚡', desc: '60 s each, +2 s per move. Run out and you are out.' },
  misere: { name: 'Misère', icon: '↯', desc: 'Inverted: finish with the FEWEST pieces. No jumping, clones only, so every move grows you.' },
  merge: { name: 'Merge', icon: '★', desc: 'Step onto your own equal-level neighbour to fuse into a crowned piece (★2, ★3). Crowns are worth their level and survive a hit by losing a level. Merging converts nothing, but it frees a hex.' },
};

const MODES = {
  classic: { title: 'Origin', tag: 'the pure game', desc: 'No twists: clone one step, leap two, convert everything you land next to. Most power wins.', players: 2, board: 'classic', rules: {} },
  triad: { title: 'Triad', tag: '3 players', desc: 'A three-way war for the Grand board. Every alliance is temporary.', players: 3, board: 'grand', rules: {}, ctrl: ['human', 'medium', 'medium'] },
  cascade: { title: 'Cascade', tag: 'chain reactions', desc: MUTATORS.cascade.desc, players: 2, board: 'classic', rules: { cascade: true } },
  tectonic: { title: 'Tectonic', tag: 'moving rings', desc: MUTATORS.tectonic.desc, players: 2, board: 'grand', rules: { tectonic: true } },
  fog: { title: 'Fog of War', tag: 'hidden info', desc: MUTATORS.fog.desc, players: 2, board: 'grand', rules: { fog: true } },
  blitz: { title: 'Blitz', tag: 'chess clock', desc: MUTATORS.blitz.desc, players: 2, board: 'classic', rules: { blitz: true } },
  misere: { title: 'Misère', tag: 'lose to win', desc: MUTATORS.misere.desc, players: 2, board: 'classic', rules: { misere: true } },
  catclash: { title: 'Cat Clash', tag: 'Galactic vs Dino', glyph: '★', desc: 'Galactic Cat calls down meteors. Dino Cat roars the board flat. Merge twins into crowned cats; cascades chain captures.', players: 2, board: 'grand', rules: { cascade: true, merge: true }, theme: 'cats', ctrl: ['human', 'medium', 'medium'] },
  hyperspace: { title: 'Hyperspace', tag: '3D · stacked layers', desc: 'Three boards stacked into a spire. Clone up, down or sideways; captures reach across layers.', players: 2, board: 'spire', rules: {}, ctrl: ['human', 'medium', 'medium'] },
  tesseract: { title: 'Tesseract', tag: '4D · parallel worlds', desc: 'Two worlds of three layers each. Every hex has a twin in the other world, one step away.', players: 2, board: 'tesseract', rules: {}, ctrl: ['human', 'medium', 'medium'] },
  daily: { title: 'Daily Rift', tag: 'new every day', desc: 'A seeded board and twist, the same for everyone today, against the Master AI.', daily: true },
};

const BLITZ_MS = 60000, BLITZ_INC = 2000;

// ---------- persistent settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('hx.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hx.' + k, JSON.stringify(v)); } catch {} },
};
const cfg = store.get('cfg', { mode: 'catclash', players: 2, board: 'grand', ctrl: ['human', 'medium', 'medium'], rules: { cascade: true, merge: true }, speed: 1, theme: 'cats' });

const sfx = new Sfx();
// Phones and tablets: touch-first input, lighter rendering, vibration feedback.
const MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const IN_APP = location.hostname === 'appassets.androidplatform.net'; // running inside the Android app
const R = new Renderer($('#scene'), { mobile: MOBILE });
R.storm = true; // distant lightning rolls through the Rift's sky
R.sfx = sfx;     // so ambient strikes can thunder
const gfxTier = () => (!cfg.gfx || cfg.gfx === 'auto' ? autoQuality(MOBILE) : cfg.gfx);
R.setQuality(gfxTier());
R.speed = cfg.speed || 1;
// The AI thinks in a Web Worker so animations stay smooth. Some embedded browsers (older
// Android WebViews) can't start module workers from packaged files; then it thinks on the
// main thread instead, so the game always works.
let worker = null, workerOk = true;
try { worker = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' }); } catch { workerOk = false; }
let aiSeq = 0;
const pending = new Map(); // id -> { res, msg }
async function thinkLocally(id, msg) {
  const { think } = await import('./ai.js');
  await new Promise((r) => setTimeout(r, 30)); // let the current frame paint first
  let move = null;
  try { move = think(msg.board, msg.state, msg.me, msg.n, msg.rules, msg.level); } catch (e) { console.error(e); }
  const job = pending.get(id); pending.delete(id); job?.res(move);
}
if (worker) {
  worker.onmessage = (e) => { const job = pending.get(e.data.id); pending.delete(e.data.id); job?.res(e.data.move); };
  worker.onerror = () => { workerOk = false; for (const [id, job] of pending) thinkLocally(id, job.msg); };
}
function askAI(level, player) {
  const id = ++aiSeq;
  const msg = { id, board: G.board, state: G.s.slice(), me: player, n: G.n, rules: G.rules, level };
  return new Promise((res) => {
    pending.set(id, { res, msg });
    if (workerOk) worker.postMessage(msg); else thinkLocally(id, msg);
  });
}

let G = null; // the current game

// ---------- daily ----------
function dailySetup() {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const rnd = mulberry32(seed * 7 + 3);
  const twists = [{}, { cascade: true }, { tectonic: true }, { fog: true }, { cascade: true, tectonic: true }, { misere: true }];
  const rules = twists[Math.floor(rnd() * twists.length)];
  return { seed, rules, label: `${d.toISOString().slice(0, 10)}` };
}

// ---------- the one transition: a hex iris closes, the world changes, it opens ----------
// The screen fills with hexes rippling out from the centre; the world changes behind them;
// then the hexes shatter outwards, spinning away like shards.
let wiping = false, hexCells = null, hexKey = '';
function buildHexes() {
  const el = $('#wipe');
  const W = innerWidth, H = innerHeight, size = Math.max(64, Math.min(W, H) / 7);
  const key = `${W}x${H}`;
  if (hexKey === key) return hexCells;
  hexKey = key;
  el.querySelectorAll('.wh').forEach((h) => h.remove());
  const w = size, h = size * 1.1547, cols = Math.ceil(W / w) + 2, rows = Math.ceil(H / (h * 0.75)) + 2;
  hexCells = [];
  for (let r = -1; r < rows; r++) for (let c = -1; c < cols; c++) {
    const x = c * w + (r % 2 ? w / 2 : 0), y = r * h * 0.75;
    const d = document.createElement('i');
    d.className = 'wh';
    d.style.cssText = `left:${x - 1}px;top:${y - 1}px;width:${w + 2}px;height:${h + 2}px`;
    const dx = x + w / 2 - W / 2, dy = y + h / 2 - H / 2;
    hexCells.push({ d, dist: Math.hypot(dx, dy) / Math.hypot(W, H), ang: Math.atan2(dy, dx) });
    el.appendChild(d);
  }
  return hexCells;
}
function wipe(change) {
  if (wiping) return change();
  wiping = true;
  const el = $('#wipe');
  const cells = buildHexes();
  sfx.whoosh?.();
  el.className = 'show';
  // in: hexes pop in, rippling outward from the centre
  for (const h of cells) {
    h.d.style.transition = `transform .32s cubic-bezier(.3,1.4,.5,1) ${h.dist * 0.36}s, opacity .2s ${h.dist * 0.36}s`;
    h.d.style.transform = 'scale(1.04)'; h.d.style.opacity = '1';
  }
  setTimeout(() => {
    el.classList.add('full');
    try { change(); } catch (e) { console.error(e); }
    setTimeout(() => {
      el.classList.remove('full');
      // out: shatter, each shard flying away from the centre, spinning
      for (const h of cells) {
        const fly = 140 + Math.random() * 220;
        h.d.style.transition = `transform .62s cubic-bezier(.5,0,.75,0) ${h.dist * 0.22}s, opacity .5s ${h.dist * 0.22 + 0.12}s`;
        h.d.style.transform = `translate(${Math.cos(h.ang) * fly}px, ${Math.sin(h.ang) * fly + 60}px) rotate(${(Math.random() - 0.5) * 240}deg) scale(${0.3 + Math.random() * 0.4})`;
        h.d.style.opacity = '0';
      }
      setTimeout(() => {
        el.className = '';
        for (const h of cells) { h.d.style.transition = 'none'; h.d.style.transform = 'scale(0)'; h.d.style.opacity = '0'; }
        wiping = false;
      }, 1000);
    }, 140);
  }, 700);
}

// ---------- game lifecycle ----------
function newGame(opts) {
  if (opts.fromMenu !== false && !$('#menu').classList.contains('hidden')) return wipe(() => newGame({ ...opts, fromMenu: false }));
  if (G) { G.token++; G.over = true; G.attract = false; }
  for (const id of pending.keys()) pending.delete(id);
  const n = opts.players;
  const board = makeBoard(opts.board, n, opts.seed ?? Math.floor(Math.random() * 1e9));
  G = {
    mode: opts.mode, n, board, s: Int8Array.from(board.start), cur: 1, ply: 0,
    ctrl: opts.ctrl.slice(0, n), rules: { ...opts.rules }, daily: opts.daily || null,
    history: [], over: false, busy: false, selected: -1, targets: [], token: 0,
    clocks: [0, BLITZ_MS, BLITZ_MS, BLITZ_MS], usedUndo: false, lastMove: null, viewer: null,
    stats: { captures: [0, 0, 0, 0], merges: [0, 0, 0, 0], moves: [0, 0, 0, 0], combo: 0 },
    journey: opts.journey || null, usedHint: false,
  };
  // journey bosses (and anything else) can bend the starting position
  if (opts.setup) opts.setup(board, G.s);
  G.theme = opts.theme || 'cats';
  applyTheme(G.theme);
  if (!opts.journey) R.setSky('rift');
  R.build(board, G.s);
  buildHud();
  hideMenu();
  $('#gameover').classList.add('hidden');
  sfx.music?.('game');
  const g = G;
  const title = opts.journey ? `Stage ${opts.journey.id} · ${opts.journey.title}` : opts.daily ? `Daily Rift · ${opts.daily.label}` : MODES[opts.mode]?.title || 'Custom game';
  versusIntro(n);
  setTimeout(() => { if (G === g) { toast(title, describeRules(G.rules)); startTurn(); } }, 2800);
}

/** Fighting-game style VERSUS splash, with the factions' real faces. */
function versusIntro(n) {
  const el = $('#vs');
  el.innerHTML = Array.from({ length: n }, (_, k) => {
    const p = k + 1;
    return `<div class="vs-side s${p}" style="--c:${PLAYERS[p].css}">${icon(p, '')}<div class="vs-name">${PLAYERS[p].name}</div><div class="vs-ctrl">${CONTROLLERS[G.ctrl[k]]}</div></div>` +
      (k < n - 1 ? '<div class="vs-x">VS</div>' : '');
  }).join('');
  el.classList.remove('hidden', 'play'); void el.offsetWidth; el.classList.add('play');
  sfx.ensure();
  if (G.theme === 'cats') { sfx.meow(1); setTimeout(() => sfx.roar(), 650); if (n > 2) setTimeout(() => sfx.meow(3), 1200); }
  else { sfx.impact?.(); }
  setTimeout(() => el.classList.add('hidden'), 2600);
}

function describeRules(rules) {
  const on = Object.keys(MUTATORS).filter((k) => rules[k]);
  return on.length ? on.map((k) => MUTATORS[k].icon + ' ' + MUTATORS[k].name).join('  ·  ') : 'Pure rules';
}

const humans = () => G.ctrl.map((c, k) => (c === 'human' ? k + 1 : 0)).filter(Boolean);
const isHuman = (p) => G.ctrl[p - 1] === 'human';

function fogViewer() {
  if (!G.rules.fog) return null;
  const hs = humans();
  if (hs.length === 0) return null;
  if (hs.length === 1) return hs[0];
  return isHuman(G.cur) ? G.cur : G.viewer;
}

function refreshView() {
  if (!G) return;
  const v = fogViewer();
  G.viewer = v;
  R.setFog(v ? visibleMask(G.board, G.s, v) : null, G.s);
  R.updateGlow(G.s);
  updateHud();
}

async function startTurn() {
  if (!G || G.over) return;
  const token = G.token;
  G.selected = -1;
  G.targets = [];
  R.clearMarks();
  if (G.lastMove && !G.rules.fog) { R.mark(G.lastMove.from, 0x6677aa, 0.35); R.mark(G.lastMove.to, 0x66ddff, 0.5); }
  // hot-seat fog: hide the board while the device changes hands
  if (G.rules.fog && humans().length > 1 && isHuman(G.cur) && G.viewer !== G.cur) {
    R.setFog(new Uint8Array(G.s.length), G.s);
    await curtain(`${PLAYERS[G.cur].name}'s turn`, 'Pass the device. No peeking.');
    if (token !== G.token) return;
  }
  refreshView();
  G.turnStart = performance.now();
  G.clockRunning = true;
  if (isHuman(G.cur)) {
    G.busy = false;
    turnBanner();
    coach();
    return;
  }
  coach();
  G.busy = true;
  const t0 = performance.now();
  const move = await askAI(G.ctrl[G.cur - 1], G.cur);
  if (token !== G.token || G.over) return;
  const wait = 450 / R.speed - (performance.now() - t0);
  if (wait > 0) await R.wait(wait);
  if (token !== G.token) return;
  if (move) await play(move);
}

async function play(m) {
  const token = G.token;
  G.busy = true;
  chargeClock();
  G.clockRunning = false;
  if (G.rules.blitz) G.clocks[G.cur] += BLITZ_INC;
  G.history.push({ s: G.s.slice(), cur: G.cur, ply: G.ply, quiet: G.quiet || 0, minEmpty: G.minEmpty, clocks: G.clocks.slice(), lastMove: G.lastMove });
  const res = applyMove(G.board, G.s, m, G.cur, G.rules);
  if (G.stats) {
    G.stats.captures[G.cur] += res.total;
    G.stats.moves[G.cur]++;
    if (m.merge) G.stats.merges[G.cur]++;
    if (isHuman(G.cur)) G.stats.combo = Math.max(G.stats.combo, res.total);
  }
  const hidden = G.viewer && !visibleMask(G.board, G.s, G.viewer)[m.to] && !visibleMask(G.board, G.history.at(-1).s, G.viewer)[m.to];
  if (!hidden && res.total >= 3) setTimeout(() => R.punch(Math.min(2, res.total / 3)), 500 / R.speed);
  // touch feedback: a tap for a move, a rumble that grows with the capture, a double pulse for a merge
  if (isHuman(G.cur) || res.total >= 3) buzz(m.merge ? [30, 60, 50] : res.total ? [20 + Math.min(80, res.total * 15)] : 12);
  if (!hidden) await R.animateMove(m, G.cur, res, sfx, G.s);
  if (token !== G.token) return;
  R.sync(G.s);
  scorePops(G.history.at(-1).s, G.s);
  if (res.waves.length > 1) toast(`Cascade ×${res.waves.length - 1}`, `${res.total} pieces converted`, 1400);
  G.lastMove = m;
  G.ply++;
  // Stall rule: count moves since the board was last fuller than ever before. Classic play
  // resets it on every clone; with Merge, clone-merge-clone loops can't refill it forever.
  const empties = counts(G.s, G.n)[0];
  if (empties < (G.minEmpty ?? Infinity)) { G.minEmpty = empties; G.quiet = 0; } else G.quiet = (G.quiet || 0) + 1;
  refreshView();
  if (G.rules.tectonic && G.ply % (G.n * 2) === 0) {
    toast('Tectonic shift', 'The rings are turning', 1500);
    await R.wait(300);
    const moves = shiftRings(G.board, G.s);
    await R.shiftPieces(moves, sfx);
    R.sync(G.s);
    refreshView();
  }
  if (token !== G.token) return;
  await advance();
}

async function advance() {
  if (G.quiet >= QUIET_LIMIT) {
    toast('Stalemate', `${QUIET_LIMIT} moves without the board filling up`, 1800);
    return finish(`${QUIET_LIMIT} moves without the board filling any further: it is called as it stands.`);
  }
  const r = resolveNext(G.board, G.s, G.cur, G.n, G.rules);
  for (const p of r.skipped) if (counts(G.s, G.n)[p] > 0 && !r.over) toast(`${PLAYERS[p].name} is stuck`, 'Turn skipped', 1300);
  if (r.over) {
    if (r.filler) {
      const filled = fillEmpty(G.s, r.filler);
      if (filled.length) {
        toast(`${PLAYERS[r.skipped[0] || 0]?.name || 'Nobody'} can't move`, `${PLAYERS[r.filler].name} claims every empty cell`, 1800);
        sfx.fill();
        R.setFog(null, G.s);
        await R.fillAnim(filled, r.filler);
      }
    }
    return finish();
  }
  G.cur = r.next;
  startTurn();
}

function finish(reason) {
  G.over = true; G.busy = true; G.clockRunning = false;
  if (G.attract) { const g = G; setTimeout(() => { if (G === g) attract(); }, 2500); return; }
  R.setFog(null, G.s);
  R.sync(G.s);
  R.clearMarks();
  updateHud();
  coach();
  const { order, cnt } = standings(G.s, G.n, G.rules.misere);
  const top = order[0];
  const draw = order.length > 1 && cnt[order[1]] === cnt[top];
  const hs = humans();
  const humanWon = hs.includes(top) && !draw;
  if (hs.length === 1 && hs.length < G.n) {
    humanWon ? sfx.win() : sfx.lose();
    const key = G.daily ? 'daily' : G.mode;
    const st = store.get('stats', {});
    const rec = (st[key] = st[key] || { w: 0, l: 0, d: 0 });
    draw ? rec.d++ : humanWon ? rec.w++ : rec.l++;
    store.set('stats', st);
    if (G.daily && humanWon) {
      const best = store.get('daily', {});
      const margin = cnt[hs[0]] - Math.max(...order.filter((p) => p !== hs[0]).map((p) => cnt[p]));
      if (!best[G.daily.label] || best[G.daily.label] < Math.abs(margin)) { best[G.daily.label] = Math.abs(margin); store.set('daily', best); }
    }
  } else sfx.win();
  sfx.music?.('menu');
  const el = $('#gameover');
  const winnerImg = el.querySelector('.winner');
  winnerImg.src = draw ? '' : PLAYERS[top].img || '';
  winnerImg.classList.toggle('hidden', draw);
  const quips = G.theme === 'cats'
    ? { 1: 'The cosmos purrs in approval.', 2: 'The age of the Dino Cat has begun.', 3: 'All cats have been upgraded.' }
    : { 1: 'Brilliant cut.', 2: 'Lustre wins the day.', 3: 'Evergreen.' };
  const youLost = hs.length === 1 && hs.length < G.n && !humanWon && !draw;
  el.querySelector('h2').textContent = draw ? "It's a draw" : youLost ? `${PLAYERS[top].name} wins` : hs.length === 1 && G.n > 1 ? 'Victory!' : `${PLAYERS[top].name} wins!`;
  el.querySelector('h2').style.color = draw ? '#fff' : PLAYERS[top].css;
  el.querySelector('.sub').textContent = reason || (G.rules.misere ? 'Fewest pieces takes it.' : draw ? 'Perfectly balanced.' : youLost ? 'So close. One more?' : quips[top]);
  el.querySelector('.final').innerHTML = order.map((p) => `<div class="fs" style="--c:${PLAYERS[p].css}">${icon(p)}<span class="nm">${PLAYERS[p].name}</span><b>${cnt[p]}</b></div>`).join('');
  const me = hs.length === 1 ? hs[0] : top;
  const S = G.stats;
  el.querySelector('.stats').innerHTML = S
    ? `<div><b>${S.captures[me]}</b>captures</div><div><b>${S.merges[me]}</b>merges</div><div><b>${S.combo}</b>best combo</div><div><b>${G.ply}</b>${G.ply === 1 ? 'move' : 'moves'}</div>`
    : '';
  // Journey battles score their star objectives and offer Continue / Retry / Map.
  const jbox = el.querySelector('.jres');
  jbox.classList.add('hidden');
  $('#btn-next').classList.add('hidden');
  $('#btn-rematch').innerHTML = '<svg class="ico"><use href="#i-play"/></svg>Rematch';
  $('#btn-rematch').classList.toggle('btn-gold', !G.journey); // in the Journey, Continue is the one loud button
  $('#btn-tomenu').textContent = 'Menu';
  if (G.journey) {
    const stage = G.journey;
    const others = order.filter((p) => p !== 1).map((p) => cnt[p]);
    const r = {
      won: top === 1 && !draw, margin: cnt[1] - Math.max(...others), moves: S.moves[1], captures: S.captures[1],
      merges: S.merges[1], combo: S.combo, undo: G.usedUndo, hint: G.usedHint, crowns: crownsOf(G.s, 1), clockLeft: G.clocks[1],
    };
    const out = J.result(stage, r);
    el.querySelector('h2').textContent = r.won ? (stage.boss ? 'Boss defeated!' : 'Stage clear!') : 'Defeated';
    el.querySelector('.sub').textContent = r.won ? `Stage ${stage.id} · ${stage.title}` : reason || 'The Rift resists. Try a new approach.';
    el.querySelector('.stats').innerHTML = '';
    $('#btn-rematch').innerHTML = '<svg class="ico"><use href="#i-undo"/></svg>Retry';
    $('#btn-tomenu').textContent = 'Map';
    if (r.won) $('#btn-next').classList.remove('hidden');
  }
  if (!draw) {
    // victory lap: the winning side bounces under fireworks before the results card
    R.celebrate(top);
    if (G.theme === 'cats') { sfx.meow(top); setTimeout(() => (top === 2 ? sfx.roar() : sfx.meow(top, 1.3)), 700); }
  }
  setTimeout(() => el.classList.remove('hidden'), draw ? 700 : 2600);
}

// ---------- clocks ----------
function chargeClock() {
  if (!G.rules.blitz || G.turnStart == null) return;
  G.clocks[G.cur] -= performance.now() - G.turnStart;
  G.turnStart = performance.now();
}
let lastWarn = 0;
setInterval(() => {
  if (!G || G.over || !G.rules.blitz || !G.clockRunning) return;
  const left = G.clocks[G.cur] - (performance.now() - G.turnStart);
  updateClocks(left);
  if (left < 10000 && isHuman(G.cur) && performance.now() - lastWarn > 1000) { lastWarn = performance.now(); sfx.tick(); }
  if (left <= 0) timeout(G.cur);
}, 100);

async function timeout(p) {
  G.clockRunning = false;
  G.clocks[p] = 0;
  G.token++;
  sfx.warn();
  if (G.n === 2) {
    // flag fall: the other side wins outright
    const other = 3 - p;
    for (let i = 0; i < G.s.length; i++) if (own(G.s[i]) === p) G.s[i] = EMPTY;
    toast(`${PLAYERS[p].name} flagged`, 'Out of time', 1600);
    await R.eliminate(G.board.cells.map((_, i) => i).filter((i) => R.pieces[i]?.owner === p));
    fillEmpty(G.s, other);
    R.sync(G.s);
    return finish(`${PLAYERS[p].name} ran out of time.`);
  }
  const cells = [];
  for (let i = 0; i < G.s.length; i++) if (own(G.s[i]) === p) { G.s[i] = EMPTY; cells.push(i); }
  toast(`${PLAYERS[p].name} flagged`, 'Their pieces crumble', 1600);
  G.busy = true;
  await R.eliminate(cells);
  G.turnStart = performance.now();
  await advance();
}

// ---------- input ----------
R.on('click', (i) => {
  if (!G || G.over || G.busy || !isHuman(G.cur)) return;
  sfx.ensure();
  if (G.selected >= 0) {
    const m = G.targets.find((t) => t.to === i);
    if (m) { G.selected = -1; return play(m); }
  }
  if (i >= 0 && own(G.s[i]) === G.cur) return select(i);
  deselect();
});
R.on('rightClick', () => deselect());
R.on('hover', (i) => {
  if (!G || G.busy || G.selected < 0) return;
  // reset previews
  R.clearLabels();
  for (const t of G.targets) R.mark(t.to, targetColor(t), t.jump ? 0.55 : 0.85);
  R.mark(G.selected, PLAYER_COLORS[G.cur], 1, 1);
  const m = G.targets.find((t) => t.to === i);
  if (!m) { R.clearAim(); R.lookTarget = R.at(G.selected, 0.6); return; }
  R.aim(G.selected, i, targetColor(m));
  R.lookTarget = R.at(i, 0.3);
  sfx.aim?.();
  const c = G.s.slice();
  const res = applyMove(G.board, c, m, G.cur, G.rules);
  const vis = G.viewer ? visibleMask(G.board, G.s, G.viewer) : null;
  res.waves.forEach((w, k) => w.forEach((j) => { if (!vis || vis[j]) R.mark(j, k ? 0xffa020 : 0xff3355, 0.95, 1); }));
  const gain = res.total + (m.jump || m.merge ? 0 : 1);
  res.cracked.forEach((j) => { if (!vis || vis[j]) R.mark(j, 0x7ad8ff, 0.95, 1); });
  const cracks = res.cracked.length ? ` ⛨${res.cracked.length}` : '';
  if (m.merge) R.label(i, `MERGE → ★${lvl(G.s[i]) + 1}`, '#d9a6ff');
  else R.label(i, `${m.jump ? '⤳' : '+'}${gain}${cracks}`, m.jump ? '#5effc0' : '#ffe27a');
});

/** Target colours: clone gold, jump green, merge violet. */
const targetColor = (t) => (t.merge ? 0xc77dff : t.jump ? 0x22ffaa : 0xffd23f);

function focusLayer(z) {
  if (z >= G.board.L) return;
  R.setFocus(z);
  document.querySelectorAll('#layerbar [data-layer]').forEach((b) => b.classList.toggle('on', +b.dataset.layer === z));
  if (G.selected >= 0 && R.layerShown(G.board.cells[G.selected].z)) select(G.selected);
  else if (G.selected >= 0) deselect(true);
}

function toggleSpread() {
  const wide = R.spread < 1.4;
  R.setSpread(wide ? 1.9 : 1);
  $('#btn-spread')?.classList.toggle('on', wide);
}

// With stacked layers a click ray crosses several cells: prefer your own pieces and legal targets.
R.pickFilter = (cell) => !!G && !G.over && isHuman(G.cur) &&
  (own(G.s[cell]) === G.cur || (G.selected >= 0 && G.targets.some((t) => t.to === cell)));

function select(i) {
  deselect(true);
  G.selected = i;
  G.targets = targetsFrom(G.board, G.s, i, G.rules);
  R.links(i, G.targets);
  R.lift(i, true);
  R.lookTarget = R.at(i, 0.6); // the whole board turns to look at the cat you picked
  R.mark(i, PLAYER_COLORS[G.cur], 1, 1);
  for (const t of G.targets) R.mark(t.to, targetColor(t), t.jump ? 0.55 : 0.85);
  sfx.select();
  buzz(8);
  coach();
}
function deselect(silent) {
  if (G && G.selected >= 0 && !silent) sfx.deselect();
  if (G) { G.selected = -1; G.targets = []; }
  R.clearMarks();
  if (G?.lastMove && !G.rules.fog && !G.busy) { R.mark(G.lastMove.from, 0x6677aa, 0.35); R.mark(G.lastMove.to, 0x66ddff, 0.5); }
  if (!silent) coach();
}

// ---------- drag and drop: press on your piece, release on a glowing hex ----------
R.on('down', (i) => {
  if (!G || G.over || G.busy || !isHuman(G.cur) || i < 0) return false;
  if (own(G.s[i]) !== G.cur || (G.selected >= 0 && G.targets.some((t) => t.to === i))) return false; // merge targets are own pieces too
  sfx.ensure();
  if (G.selected !== i) select(i);
  return true; // capture the pointer: no camera orbit while dragging a piece
});
R.on('drop', (i) => {
  if (!G || G.busy || G.selected < 0) return;
  const m = G.targets.find((t) => t.to === i);
  if (m) { G.selected = -1; play(m); }
});

// ---------- coaching: one line that always says what you can do right now ----------
let coachOn = store.get('coach', true);
function coach() {
  const el = $('#coach');
  if (!G || G.attract || !coachOn) { el.classList.add('off'); return; }
  el.classList.remove('off');
  const P = PLAYERS[G.cur];
  const piece = G.theme === 'cats' ? 'cat' : 'piece';
  const dot = (c) => `<span class="k" style="background:${c}"></span>`;
  let html;
  if (G.over) html = 'Game over. <b>Rematch</b> or head to the menu.';
  else if (!isHuman(G.cur)) html = `<span style="color:${P.css}">${P.name}</span> is plotting…`;
  else if (G.selected < 0) {
    const who = humans().length > 1 ? `<span style="color:${P.css}">${P.name}</span>: ` : '';
    html = MOBILE ? `${who}Tap or drag one of your ${piece}s. Stuck? Tap the bulb.` : `${who}Tap or drag one of your ${piece}s. <b>H</b> for a hint.`;
  } else {
    const kinds = new Set(G.targets.map((t) => (t.merge ? 'm' : t.jump ? 'j' : 'c')));
    const parts = [];
    if (kinds.has('c')) parts.push(`${dot('#ffd23f')}<b>clone</b> +1`);
    if (kinds.has('j')) parts.push(`${dot('#22ffaa')}<b>leap</b>`);
    if (kinds.has('m')) parts.push(`${dot('#c77dff')}<b>merge</b> into a crowned ★ (armour)`);
    html = parts.length ? parts.join(' ') + ' · enemies touching where you land join you' : `This ${piece} is boxed in. Pick another.`;
  }
  $('#coach-txt').innerHTML = html;
}
$('#coach-x').onclick = () => { coachOn = false; store.set('coach', false); coach(); toast('Tips hidden', 'Turn them back on from How to play', 1400); };

function turnBanner() {
  if (!G || G.attract) return;
  const hs = humans();
  if (hs.length === 0) return;
  const el = $('#turnbanner');
  el.textContent = hs.length > 1 ? `${PLAYERS[G.cur].name.toUpperCase()}'S TURN` : 'YOUR TURN';
  el.style.color = PLAYERS[G.cur].css;
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  sfx.turn?.();
}

/** Floating +N / −N on each player's chip when their power changes. */
function scorePops(before, after) {
  if (!G || G.attract) return;
  const a = counts(before, G.n), b = counts(after, G.n);
  for (let p = 1; p <= G.n; p++) {
    const d = b[p] - a[p];
    if (!d || (G.viewer && p !== G.viewer)) continue;
    const chip = document.querySelector(`.pcard[data-p="${p}"]`);
    if (!chip) continue;
    const el = document.createElement('span');
    el.className = 'delta'; el.textContent = (d > 0 ? '+' : '−') + Math.abs(d);
    el.style.color = d > 0 ? PLAYERS[p].css : '#ff5470';
    chip.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }
}

function undo() {
  if (!G || !G.history.length) return;
  if (G.busy && !G.over && isHuman(G.cur)) return; // mid-animation
  let snap;
  do { snap = G.history.pop(); } while (snap && !isHuman(snap.cur) && G.history.length);
  if (!snap || !isHuman(snap.cur)) { if (snap) G.history.push(snap); return; }
  G.token++;
  G.usedUndo = true;
  G.s = snap.s; G.cur = snap.cur; G.ply = snap.ply; G.quiet = snap.quiet; G.minEmpty = snap.minEmpty; G.clocks = snap.clocks; G.lastMove = snap.lastMove;
  G.over = false; G.busy = false;
  for (const p of pending.keys()) pending.delete(p);
  $('#gameover').classList.add('hidden');
  R.tweens.forEach((t) => t.resolve()); R.tweens = [];
  R.sync(G.s);
  G.viewer = null;
  startTurn();
}

async function hint() {
  if (!G || G.busy || G.over || !isHuman(G.cur)) return;
  const token = G.token;
  $('#btn-hint').classList.add('thinking');
  G.usedHint = true;
  const m = await askAI('hard', G.cur);
  $('#btn-hint').classList.remove('thinking');
  if (!m || token !== G.token || G.busy) return;
  select(m.from);
  R.mark(m.to, 0x4dffea, 1, 1);
  R.label(m.to, 'try this', '#4dffea');
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { if (G && G.selected >= 0) deselect(); else toggleMenu(); }
  else if (k === 'u' || k === 'backspace' || (e.ctrlKey && k === 'z')) undo();
  else if (k === 'h') hint();
  else if (k === 'm') toggleMute();
  else if (k === 'p' && G && !G.attract) setPhoto(!R.photo);
  else if (/^[0-9]$/.test(k) && G && R.multi) focusLayer(k === '0' ? -1 : +k - 1);
  else if (k === 'x' && G && R.multi) toggleSpread();
  else if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
});

// ---------- HUD ----------
function buildHud() {
  // Player cards: P1 on the left, everyone else on the right, mirrored like a fighting game.
  const L = $('#players-l'), Rr = $('#players-r');
  L.innerHTML = ''; Rr.innerHTML = '';
  for (let p = 1; p <= G.n; p++) {
    const d = document.createElement('div');
    d.className = 'pcard' + (p > 1 ? ' right' : ''); d.dataset.p = p; d.style.setProperty('--c', PLAYERS[p].css);
    const who = G.ctrl[p - 1] === 'human' ? (humans().length > 1 ? `Player ${p}` : 'You') : CONTROLLERS[G.ctrl[p - 1]].replace('AI · ', 'AI ');
    d.innerHTML = `<div class="pc-portrait">${icon(p, '')}</div>
      <div class="pc-body"><div class="pc-name">${PLAYERS[p].name}</div><div class="pc-sub">${who}<span class="think"><i></i><i></i><i></i></span><span class="pc-clock"></span></div></div>
      <div class="pc-score">0</div>`;
    (p === 1 ? L : Rr).appendChild(d);
  }
  $('#tug').innerHTML = Array.from({ length: G.n }, (_, k) => `<i data-p="${k + 1}" style="background:linear-gradient(180deg, color-mix(in srgb, ${PLAYERS[k + 1].css} 80%, #fff), ${PLAYERS[k + 1].css})"></i>`).join('') + '<i class="empty"></i>';
  // keep the empty share in the middle for two players, so each side grows from its own end
  if (G.n === 2) $('#tug').insertBefore($('#tug .empty'), $('#tug [data-p="2"]'));
  const bar = $('#layerbar');
  bar.innerHTML = '';
  bar.classList.toggle('hidden', !R.multi);
  if (R.multi) {
    const dims = 2 + (G.board.L > 1 ? 1 : 0) + (G.board.W > 1 ? 1 : 0);
    bar.innerHTML = `<span class="dimtag">${dims}D</span>` +
      `<button data-layer="-1" class="btn on" title="Show every layer (0)">All</button>` +
      Array.from({ length: G.board.L }, (_, z) => `<button data-layer="${z}" class="btn" title="Show only layer ${z + 1} (${z + 1})">L${z + 1}</button>`).join('') +
      `<button id="btn-spread" class="btn" title="Spread the layers apart (X)">Spread</button>`;
    bar.querySelectorAll('[data-layer]').forEach((b) => (b.onclick = () => focusLayer(+b.dataset.layer)));
    $('#btn-spread').onclick = () => toggleSpread();
  }
  $('#mutators').innerHTML = Object.keys(MUTATORS).filter((k) => G.rules[k]).map((k) => `<span class="mut" title="${MUTATORS[k].desc}">${MUTATORS[k].icon} ${MUTATORS[k].name}</span>`).join('');
  const hud = $('#hud');
  hud.classList.remove('hidden', 'show'); void hud.offsetWidth; hud.classList.add('show');
  updateHud();
}

function updateHud() {
  if (!G || G.attract) return;
  const cnt = counts(G.s, G.n);
  const v = G.viewer;
  for (const el of document.querySelectorAll('.pcard')) {
    const p = +el.dataset.p;
    el.classList.toggle('active', p === G.cur && !G.over);
    el.classList.toggle('thinking', p === G.cur && !G.over && !isHuman(p));
    el.classList.toggle('out', cnt[p] === 0);
    const hide = v && p !== v && !G.over;
    const sc = el.querySelector('.pc-score');
    const txt = hide ? '?' : String(cnt[p]);
    if (sc.textContent !== txt) { sc.textContent = txt; sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }
    el.querySelector('.pc-clock').textContent = G.rules.blitz ? fmt(G.clocks[p]) : '';
  }
  // tug-of-war: each side's share of the board's total power, empties in between
  let sum = cnt[0];
  for (let p = 1; p <= G.n; p++) sum += v && p !== v && !G.over ? 0 : cnt[p];
  for (const seg of document.querySelectorAll('#tug i')) {
    const p = +seg.dataset.p || 0;
    const val = seg.classList.contains('empty') ? cnt[0] + (v && !G.over ? cnt.slice(1).reduce((a, c, k) => a + (k + 1 !== v ? c : 0), 0) : 0) : v && p !== v && !G.over ? 0 : cnt[p];
    seg.style.flexGrow = Math.max(0, val) / Math.max(1, sum);
  }
  let status;
  if (G.over) status = 'Game over';
  else if (isHuman(G.cur)) status = humans().length > 1 ? `${PLAYERS[G.cur].name}'s move` : 'Your move';
  else status = `${PLAYERS[G.cur].name} is thinking`;
  if (G.rules.tectonic && !G.over) {
    const every = G.n * 2, left = every - (G.ply % every);
    status += `  ·  shift in ${left}`;
  }
  $('#status').textContent = status;
  $('#status').style.color = G.over ? '#fff' : PLAYERS[G.cur].css;
  sfx.intensity?.(tension(cnt));
}

/** 0 = calm (lopsided or early), 1 = knife-edge late game. Drives the music. */
function tension(cnt) {
  const total = G.s.filter((x) => x >= 0).length;
  const fill = 1 - cnt[0] / Math.max(1, total);
  const sorted = cnt.slice(1).sort((a, b) => b - a);
  const close = 1 - Math.min(1, Math.abs(sorted[0] - (sorted[1] || 0)) / Math.max(4, total * 0.25));
  return Math.max(0, Math.min(1, fill * 0.6 + close * fill * 0.6));
}

function updateClocks(left) {
  const el = document.querySelector(`.pcard[data-p="${G.cur}"] .pc-clock`);
  if (el) { el.textContent = fmt(left); el.classList.toggle('low', left < 10000); }
}const fmt = (ms) => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

let toastTimer;
function toast(title, sub = '', ms = 1600) {
  if (G?.attract) return;
  const el = $('#toast');
  el.querySelector('b').textContent = title;
  el.querySelector('span').textContent = sub;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function curtain(title, sub) {
  return new Promise((res) => {
    const el = $('#curtain');
    el.querySelector('h2').textContent = title;
    el.querySelector('p').textContent = sub;
    el.classList.remove('hidden');
    el.querySelector('button').onclick = () => { el.classList.add('hidden'); res(); };
  });
}

/** One button, three states: everything on → music off → silent. */
function toggleMute() {
  const st = sfx.cycle ? sfx.cycle() : (sfx.toggle() ? 'mute' : 'all');
  paintSound(st);
  toast(st === 'all' ? 'Sound on' : st === 'sfx' ? 'Music off' : 'Muted', '', 900);
}
function paintSound(st = sfx.state ? sfx.state() : (sfx.muted ? 'mute' : 'all')) {
  const use = $('#btn-sound use');
  use.setAttribute('href', st === 'mute' ? '#i-mute' : st === 'sfx' ? '#i-sound' : '#i-music');
  $('#btn-sound').dataset.tip = st === 'mute' ? 'Muted · M' : st === 'sfx' ? 'Effects only · M' : 'Music + effects · M';
}
// ---------- menu ----------
function buildMenu() {
  const grid = $('#modes');
  grid.innerHTML = '';
  for (const [key, m] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.className = 'mode'; b.dataset.mode = key;
    const [glyph, col] = MODE_LOOK[key] || ['◆', '#a66bff'];
    b.style.setProperty('--c', col);
    b.innerHTML = `<span class="glyph">${glyph}</span><div class="mtitle">${m.title}</div><div class="mtag">${m.tag}</div><div class="mdesc">${m.desc}</div>`;
    b.onclick = () => { sfx.ensure(); sfx.select(); applyPreset(key); };
    grid.appendChild(b);
  }
  const bsel = $('#opt-board');
  bsel.innerHTML = Object.entries(SHAPES).map(([k, s]) => `<option value="${k}">${s.name} — ${s.desc}</option>`).join('');
  $('#mutator-toggles').innerHTML = Object.entries(MUTATORS).map(([k, m]) => `<label class="tog" title="${m.desc}"><input type="checkbox" data-mut="${k}"><span>${m.icon} ${m.name}</span></label>`).join('');
  $('#opt-players').onchange = () => { cfg.players = +$('#opt-players').value; cfg.mode = 'custom'; renderCfg(); };
  bsel.onchange = () => { cfg.board = bsel.value; cfg.mode = 'custom'; renderCfg(); };
  $('#opt-speed').onchange = () => { cfg.speed = +$('#opt-speed').value; R.speed = cfg.speed; store.set('cfg', cfg); };
  $('#opt-theme').onchange = () => { cfg.theme = $('#opt-theme').value; renderCfg(); };
  $('#opt-gfx').onchange = () => { cfg.gfx = $('#opt-gfx').value; store.set('cfg', cfg); R.setQuality(gfxTier()); toast(`Graphics: ${$('#opt-gfx').selectedOptions[0].text.replace('Graphics: ', '')}`, '', 1200); };
  for (const cb of document.querySelectorAll('[data-mut]')) cb.onchange = () => { cfg.rules[cb.dataset.mut] = cb.checked; cfg.mode = 'custom'; renderCfg(); };
  $('#btn-start').onclick = () => { sfx.ensure(); closeSheet($('#adv')); startFromCfg(); };
  $('#btn-resume').onclick = () => hideMenu();
  // one-click starts: the menu's job is to get you playing in a second
  const quick = (ctrl) => {
    sfx.ensure();
    const m = MODES.catclash;
    // on phones the 61-cell board keeps every hex a comfortable finger-sized target
    newGame({ mode: 'catclash', players: 2, board: MOBILE ? 'classic' : m.board, rules: { ...m.rules }, ctrl, theme: 'cats' });
  };
  $('#btn-quick').onclick = () => quick(['human', 'medium']);
  $('#btn-duo').onclick = () => quick(['human', 'human']);
  $('#btn-intro').onclick = () => { sfx.ensure(); runIntro(); };
  $('#btn-menu').onclick = () => toggleMenu();
  $('#btn-undo').onclick = () => undo();
  $('#btn-hint').onclick = () => hint();
  $('#btn-sound').onclick = () => toggleMute();
  paintSound();
  $('#btn-photo').onclick = () => setPhoto(true);
  $('#ph-exit').onclick = () => setPhoto(false);
  $('#ph-dof').onclick = (e) => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); R.setPhotoDof(on); };
  for (const b of document.querySelectorAll('#photo [data-filter]')) b.onclick = () => {
    document.querySelectorAll('#photo [data-filter]').forEach((x) => x.classList.toggle('on', x === b));
    R.setFilter(b.dataset.filter);
  };
  $('#ph-shot').onclick = () => capturePhoto();
  $('#shot-close').onclick = () => $('#shot').classList.add('hidden');
  $('#btn-rematch').onclick = () => {
    $('#gameover').classList.add('hidden');
    const stage = G?.journey;
    wipe(() => (stage ? startStage(stage) : startFromCfg()));
  };
  $('#btn-tomenu').onclick = () => {
    $('#gameover').classList.add('hidden');
    const fromJourney = !!G?.journey;
    wipe(() => { attract(); showMenu(); if (fromJourney) J.open(); });
  };
  $('#btn-next').onclick = () => { $('#gameover').classList.add('hidden'); J.after(G.journey); };
  $('#btn-journey').onclick = () => { sfx.ensure(); J.open(); };
  $('#btn-rules').onclick = () => openSheet('#howto');
  $('#btn-modes').onclick = () => openSheet('#adv');
  // sheets close on their ✕ / 'Got it' buttons or a click on the backdrop
  for (const sh of document.querySelectorAll('.sheet')) {
    sh.addEventListener('click', (e) => {
      if (sh.id === 'curtain' || sh.id === 'gameover') return;
      if (e.target === sh || e.target.closest('[data-close]')) closeSheet(sh);
    });
  }
  renderCfg();
}

function openSheet(sel) { sfx.ensure(); sfx.select(); $(sel).classList.remove('hidden'); }
function closeSheet(el) { el.classList.add('hidden'); }

/** Each mode's badge: a glyph on a hex in its own colour. */
const MODE_LOOK = {
  classic: ['⬢', '#7a6cff'], triad: ['▲', '#ff7ad9'], cascade: ['✦', '#ffb22e'], tectonic: ['⟳', '#ff8a3d'], fog: ['◐', '#6f8cff'],
  blitz: ['ϟ', '#ffd21a'], misere: ['↯', '#ff5a7a'], catclash: ['★', '#b98cff'], hyperspace: ['▤', '#5ad8ff'], tesseract: ['◈', '#3dffb0'], daily: ['☀︎', '#ffcf3d'],
};

function applyPreset(key) {
  const m = MODES[key];
  cfg.mode = key;
  if (m.daily) {
    const d = dailySetup();
    cfg.players = 2; cfg.board = 'random'; cfg.rules = { ...d.rules }; cfg.ctrl = ['human', 'master', cfg.ctrl[2] || 'medium'];
  } else {
    cfg.players = m.players; cfg.board = m.board; cfg.rules = { ...m.rules };
    if (m.theme) cfg.theme = m.theme;
    if (m.ctrl) cfg.ctrl = m.ctrl.slice();
    else if (cfg.ctrl[0] !== 'human' && cfg.ctrl[1] !== 'human') cfg.ctrl = ['human', 'hard', 'medium'];
  }
  renderCfg();
}

function renderCfg() {
  store.set('cfg', cfg);
  for (const b of document.querySelectorAll('.mode')) b.classList.toggle('sel', b.dataset.mode === cfg.mode);
  const daily = cfg.mode === 'daily';
  $('#opt-players').value = cfg.players;
  $('#opt-board').value = cfg.board;
  $('#opt-speed').value = cfg.speed || 1;
  $('#opt-theme').value = cfg.theme || 'cats';
  $('#opt-gfx').value = cfg.gfx || 'auto';
  ensurePortraits(cfg.theme || 'cats');
  PLAYERS = THEMES[cfg.theme] || THEMES.cats;
  $('#opt-players').disabled = daily; $('#opt-board').disabled = daily;
  for (const cb of document.querySelectorAll('[data-mut]')) { cb.checked = !!cfg.rules[cb.dataset.mut]; cb.disabled = daily; }
  const pc = $('#player-ctrl');
  pc.innerHTML = '';
  for (let p = 1; p <= cfg.players; p++) {
    const row = document.createElement('label');
    row.className = 'prow'; row.style.setProperty('--c', PLAYERS[p].css);
    row.innerHTML = `${icon(p)}<span class="pn">${PLAYERS[p].name}</span><select ${daily ? 'disabled' : ''}>${Object.entries(CONTROLLERS).map(([k, v]) => `<option value="${k}" ${cfg.ctrl[p - 1] === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
    row.querySelector('select').onchange = (e) => { cfg.ctrl[p - 1] = e.target.value; store.set('cfg', cfg); };
    pc.appendChild(row);
  }
  let info = '';
  if (daily) {
    const d = dailySetup();
    const best = store.get('daily', {})[d.label];
    info = `Today: <b>${d.label}</b> · ${describeRules(d.rules)}${best ? ` · your best margin <b>+${best}</b>` : ''}`;
  } else {
    const st = store.get('stats', {})[cfg.mode];
    if (st) info = `Your record in ${MODES[cfg.mode]?.title || cfg.mode}: <b>${st.w}</b>W · <b>${st.l}</b>L · <b>${st.d}</b>D`;
  }
  $('#cfg-info').innerHTML = info;
  // the PLAY button shows the two factions you are about to play with
  ensurePortraits('cats');
  $('#hero-a').src = THEMES.cats[1].img; $('#hero-b').src = THEMES.cats[2].img;
  const all = store.get('stats', {});
  let w = 0, l = 0;
  for (const k in all) { w += all[k].w; l += all[k].l; }
  $('#record').textContent = w + l ? `Your record: ${w} won · ${l} lost` : 'New here? Hit Play. The coach will guide you.';
  if (typeof J !== 'undefined') {
    const js = J.summary();
    $('#jh-progress').textContent = js.stars ? `${js.stars}/${js.max} ★ · ${js.rank}` : '15 stages · a story · stars to earn';
  }
}

// ---------- photo mode: freeze the moment, free the camera, pick a look, capture ----------
function setPhoto(on) {
  if (on && (!G || G.attract)) return;
  R.setPhoto(on);
  document.body.classList.toggle('photo', on);
  $('#photo').classList.toggle('hidden', !on);
  $('#photo-hint').classList.toggle('hidden', !on);
  if (on) { $('#coach').classList.add('off'); sfx.select?.(); } else coach();
  document.querySelectorAll('#photo [data-filter]').forEach((x) => x.classList.toggle('on', x.dataset.filter === 'natural'));
  $('#ph-dof').classList.remove('on');
}
function capturePhoto() {
  const url = R.capture();
  const fl = $('#flashcap'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  sfx.tick?.();
  const box = $('#shot');
  box.querySelector('img').src = url;
  $('#shot-save').href = url;
  // inside the Android app there is no download manager: long-press the image instead
  $('#shot-save').classList.toggle('hidden', IN_APP);
  $('#shot-hint').textContent = IN_APP ? 'Long-press the image to save or share it.' : 'Your shot, HUD-free.';
  box.classList.remove('hidden');
}

function startFromCfg() {
  const daily = cfg.mode === 'daily' ? dailySetup() : null;
  newGame({
    mode: cfg.mode, players: cfg.players, board: cfg.board, rules: cfg.rules, ctrl: cfg.ctrl, theme: cfg.theme,
    seed: daily ? daily.seed : undefined, daily,
  });
}

function showMenu() {
  const menu = $('#menu');
  menu.classList.remove('hidden', 'show'); void menu.offsetWidth; menu.classList.add('show');
  if (!G || G.attract) $('#hud').classList.add('hidden');
  sfx.music?.('menu');
  $('#btn-resume').classList.toggle('hidden', !G || G.over || !!G.attract);
  $('#coach').classList.add('off');
  renderCfg();
}
function hideMenu() {
  $('#menu').classList.add('hidden');
  if (G) PLAYERS = THEMES[G.theme] || THEMES.cats; // the menu may have previewed another theme
}
function toggleMenu() { $('#menu').classList.contains('hidden') ? showMenu() : G && hideMenu(); }

// ---------- boot: an AI-vs-AI exhibition plays behind the menu ----------
function attract() {
  applyTheme(cfg.theme || 'cats');
  R.setSky('rift');
  G = null;
  const board = makeBoard('random', 3, Math.floor(Math.random() * 1e9));
  G = {
    mode: 'attract', n: 3, board, s: Int8Array.from(board.start), cur: 1, ply: 0, ctrl: ['easy', 'easy', 'easy'],
    rules: { cascade: true }, history: [], over: false, busy: true, selected: -1, targets: [], token: 0,
    clocks: [0, 0, 0, 0], lastMove: null, viewer: null, attract: true, theme: cfg.theme || 'cats',
  };
  R.build(board, G.s);
  startTurn();
}
// The exhibition game behind the menu plays without effects (the menu music keeps going).
// Only the in-game effect voices are wrapped; the audio engine's own helpers never are.
for (const k of ['deselect', 'clone', 'jump', 'land', 'capture', 'cascade', 'shift', 'fill', 'tick', 'warn', 'meow', 'roar',
  'pew', 'boom', 'zap', 'merge', 'crack', 'spin', 'beam', 'bonk', 'swoon', 'turn', 'win', 'lose', 'laser', 'crackle', 'aim']) {
  if (typeof sfx[k] !== 'function') continue;
  const f = sfx[k].bind(sfx);
  sfx[k] = (...a) => (G?.attract ? undefined : f(...a));
}

// ---------- the Journey ----------
/** Start a journey stage: you are always Nova's Galactic Cats (player 1). */
function startStage(stage) {
  R.setSky(['shore', 'wilds', 'veil'][stage.ch] || 'rift'); // each chapter has its own sky and storm
  newGame({
    mode: 'journey', players: stage.players || 2, board: stage.board, rules: { ...stage.rules }, ctrl: stage.ctrl,
    theme: 'cats', setup: stage.setup, seed: stage.seed, journey: stage,
  });
}
const J = initJourney({
  portrait: (f) => { ensurePortraits('cats'); return THEMES.cats[f]?.img; },
  sfx, startStage, wipe,
  showMenu: () => { attract(); showMenu(); },
});
buildMenu();
// Debug handle for the console: clowder.R is the renderer, clowder.G the current game.
window.clowder = { R, J, startStage, get G() { return G; } };

/** Play the story cinematic, then land on the menu with a live exhibition game behind it. */
function runIntro() {
  if (G) { G.token++; G.over = true; G.attract = false; }
  G = null;
  hideMenu();
  $('#hud').classList.add('hidden');
  $('#gameover').classList.add('hidden');
  playIntro(R, sfx, () => { attract(); showMenu(); });
}

// Boot: the splash stays up until the fonts are in and the world has rendered, so nothing
// ever pops in half-styled. A first visit then asks for a tap (browsers only allow sound
// after a gesture) and plays the story; returning players go straight to the menu.
let seenIntro = false;
try { seenIntro = localStorage.getItem('hx.seenIntro') === '1'; } catch {}
const boot = $('#boot');
Promise.all([document.fonts.ready, new Promise((r) => setTimeout(r, 700))]).then(() => {
  if (!seenIntro) {
    boot.classList.add('ready', 'first');
    $('#gate-go').onclick = () => { sfx.ensure(); boot.classList.add('gone'); runIntro(); };
  } else {
    attract();
    showMenu();
    boot.classList.add('ready');
    requestAnimationFrame(() => boot.classList.add('gone'));
    // the first click anywhere unlocks audio and starts the menu theme
    addEventListener('pointerdown', () => { sfx.ensure(); sfx.music?.($('#menu').classList.contains('hidden') ? 'game' : 'menu'); }, { once: true });
  }
});

// ---------- mobile and the Android app ----------
/** Vibration (Android phones and the app; silently ignored elsewhere). Respects mute. */
function buzz(pattern) {
  if (!MOBILE || sfx.state?.() === 'mute') return;
  try { navigator.vibrate?.(pattern); } catch {}
}

/**
 * The Android back button. The app asks the page first; returning false lets the app close.
 * Order: skip the story, close a sheet, drop a selection, open the menu, return to the game.
 */
window.clowderBack = () => {
  if (!$('#shot').classList.contains('hidden')) { $('#shot').classList.add('hidden'); return true; }
  if (R.photo) { setPhoto(false); return true; }
  if (!$('#dialog').classList.contains('hidden')) { $('#dlg-skip').click(); return true; }
  if (!$('#stagecard').classList.contains('hidden')) { closeSheet($('#stagecard')); return true; }
  if (J.isOpen()) { J.close(); return true; }
  if (!$('#cine').classList.contains('hidden')) { dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true; }
  for (const id of ['#howto', '#adv']) if (!$(id).classList.contains('hidden')) { closeSheet($(id)); return true; }
  if (!$('#gameover').classList.contains('hidden')) { $('#btn-tomenu').click(); return true; }
  if (G && !G.attract && G.selected >= 0) { deselect(); return true; }
  const menuOpen = !$('#menu').classList.contains('hidden');
  if (!menuOpen && G && !G.attract) { showMenu(); return true; }
  if (menuOpen && G && !G.attract && !G.over) { hideMenu(); return true; }
  return false;
};

// Going to the background pauses the music; coming back resumes it.
document.addEventListener('visibilitychange', () => {
  const ctx = sfx.ctx;
  if (!ctx) return;
  if (document.hidden) ctx.suspend?.(); else ctx.resume?.();
});

// As a website, register the service worker so the game installs and plays offline.
// (Inside the Android app the files are already on the device.)
if ('serviceWorker' in navigator && !IN_APP && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (IN_APP) document.documentElement.classList.add('in-app');
if (MOBILE) $('#cine-hint').textContent = 'tap: next scene';
