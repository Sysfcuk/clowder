// Board topology and rules. Pure functions: shared by the game and the AI worker.
//
// Cells use axial hex coordinates (q, r); distance = max(|q|, |r|, |q+r|).
// The state is an Int8Array: -1 hole, 0 empty, 1..3 player pieces.

export const HOLE = -1;
export const EMPTY = 0;
export const CASCADE_THRESHOLD = 4; // an enemy touching this many of your pieces flips in a cascade

export const hexDist = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
const rot60 = ([q, r]) => [-r, q + r];
const sym3 = (list) => list.flatMap((h) => { const a = rot60(rot60(h)); return [h, a, rot60(rot60(a))]; });
const sym6 = (list) => list.flatMap((h) => { const out = [h]; for (let k = 0; k < 5; k++) out.push(rot60(out[out.length - 1])); return out; });

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SHAPES = {
  classic: { name: 'Classic', desc: 'The 1993 layout: 58 cells, three holes', radius: 4, holes: sym3([[-1, 0]]) },
  compact: { name: 'Compact', desc: '37 cells, quick and brutal', radius: 3, holes: [] },
  grand: { name: 'Grand', desc: '85 cells around a broken ring', radius: 5, holes: sym6([[2, -1]]) },
  halo: { name: 'Halo', desc: 'A ring with a void at its heart', radius: 5, holes: [[0, 0], ...sym6([[1, 0]])] },
  random: { name: 'Rift', desc: 'Procedural symmetric holes, new every game', radius: 0, holes: [] },
  // Multi-dimensional boards. Cells are (q, r, layer, world); distance is
  // hex distance + |Δlayer| + |Δworld|, so a cell's 8 clone neighbours are the 6 in
  // its plane plus the cells straight above and below (and its twin in the other world).
  spire: { name: 'Spire (3D)', desc: '3 stacked layers, 111 cells', radius: 3, layers: 3,
    holes: [[0, 0, 1], ...sym3([[-1, 0]]).map(([q, r]) => [q, r, 0]), ...sym3([[0, -1]]).map(([q, r]) => [q, r, 2])] },
  tower: { name: 'Tower (3D)', desc: '5 narrow layers, 95 cells', radius: 2, layers: 5, holes: [[0, 0, 1], [0, 0, 3]] },
  tesseract: { name: 'Tesseract (4D)', desc: '2 parallel worlds × 3 layers, 114 cells', radius: 2, layers: 3, worlds: 2,
    holes: [[0, 0, 1, 0], [0, 0, 1, 1]] },
};

export const cornersOf = (R) => [[R, 0], [R, -R], [0, -R], [-R, 0], [-R, R], [0, R]];

function randomHoles(R, rnd) {
  const corners = cornersOf(R);
  const nearCorner = (q, r) => corners.some(([cq, cr]) => hexDist(q - cq, r - cr) <= 1);
  const pool = [];
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    const d = hexDist(q, r);
    if (d >= 1 && d <= R && !nearCorner(q, r)) pool.push([q, r]);
  }
  const six = rnd() < 0.45;
  const count = six ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 3);
  const picks = [];
  for (let k = 0; k < count; k++) picks.push(pool[Math.floor(rnd() * pool.length)]);
  const holes = six ? sym6(picks) : sym3(picks);
  if (rnd() < 0.3) holes.push([0, 0]);
  return holes;
}

export function makeBoard(shapeKey = 'classic', numPlayers = 2, seed = 1) {
  const def = SHAPES[shapeKey] || SHAPES.classic;
  let R = def.radius, holes = def.holes;
  if (shapeKey === 'random') {
    const rnd = mulberry32(seed);
    R = rnd() < 0.5 ? 4 : 5;
    holes = randomHoles(R, rnd);
  }
  const L = def.layers || 1, W = def.worlds || 1;
  const cells = [], idx = new Map();
  const key = (q, r, z = 0, w = 0) => `${q},${r},${z},${w}`;
  for (let w = 0; w < W; w++) for (let z = 0; z < L; z++)
    for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
      if (hexDist(q, r) <= R) { idx.set(key(q, r, z, w), cells.length); cells.push({ q, r, z, w, d: hexDist(q, r) }); }
    }
  const n1 = cells.map(() => []), n2 = cells.map(() => []);
  for (let i = 0; i < cells.length; i++) for (let j = 0; j < cells.length; j++) {
    if (i === j) continue;
    const a = cells[i], b = cells[j];
    const d = hexDist(b.q - a.q, b.r - a.r) + Math.abs(b.z - a.z) + Math.abs(b.w - a.w);
    if (d === 1) n1[i].push(j); else if (d === 2) n2[i].push(j);
  }
  const start = new Int8Array(cells.length);
  for (const [q, r, z = 0, w = 0] of holes) { const i = idx.get(key(q, r, z, w)); if (i !== undefined) start[i] = HOLE; }
  if (L === 1 && W === 1) {
    cornersOf(R).forEach(([q, r], k) => {
      start[idx.get(key(q, r))] = numPlayers === 2 ? (k % 2) + 1 : (k % 3) + 1;
    });
  } else {
    // Corners of the top plane and of the opposite (bottom, last world) plane, offset by one
    // so the position is symmetric under a 60° turn plus flipping every extra axis.
    cornersOf(R).forEach(([q, r], k) => {
      start[idx.get(key(q, r, 0, 0))] = (k % numPlayers) + 1;
      start[idx.get(key(q, r, L - 1, W - 1))] = ((k + 1) % numPlayers) + 1;
    });
  }
  // Rings for the tectonic rule, ordered by angle, one per plane; neighbouring planes counter-rotate.
  const ringOf = (d, z, w) => cells.map((c, i) => ({ c, i })).filter((o) => o.c.d === d && o.c.z === z && o.c.w === w)
    .sort((a, b) => angle(a.c) - angle(b.c)).map((o) => o.i);
  const rings = [];
  for (let w = 0; w < W; w++) for (let z = 0; z < L; z++) {
    const dir = (z + w) % 2 ? -1 : 1;
    rings.push({ cells: ringOf(R, z, w), dir });
    if (R >= 4) rings.push({ cells: ringOf(2, z, w), dir: -dir });
  }
  return { R, L, W, cells, n1, n2, start, rings, shape: shapeKey, seed };
}

export const worldX = (c) => 1.5 * c.q;
export const worldZ = (c) => Math.sqrt(3) * (c.r + c.q / 2);
const angle = (c) => Math.atan2(worldZ(c), worldX(c));

// ---- Pieces and levels ----
// A cell value > 0 packs owner and level: owner | (level - 1) << 2. Level 1 pieces are just
// the owner number, so boards without the Merge rule look exactly like classic ones.
export const MAX_LEVEL = 3;
export const own = (v) => (v > 0 ? v & 3 : v);
export const lvl = (v) => (v > 0 ? (v >> 2) + 1 : 0);
export const piece = (p, l = 1) => p | ((l - 1) << 2);
const opt = (o) => (o && typeof o === 'object' ? o : { misere: !!o });

/** Per-player power: the sum of piece levels (out[0] = empty cells). */
export function counts(s, n) {
  const out = new Array(n + 1).fill(0);
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (v === 0) out[0]++;
    else if (v > 0) out[v & 3] += (v >> 2) + 1;
  }
  return out;
}

/** Number of pieces (not power) per player. */
export function pieceCounts(s, n) {
  const out = new Array(n + 1).fill(0);
  for (let i = 0; i < s.length; i++) if (s[i] > 0) out[s[i] & 3]++;
  return out;
}

// Stall rule: the game is called when this many plies pass without the board reaching a new
// record-low number of empty cells. Without Merge that means "no clone"; with Merge it also
// stops clone-merge-clone loops, which free a cell as fast as they fill one.
export const QUIET_LIMIT = 50;

/** Merge: step onto a neighbouring piece of your own with the same level to fuse them. */
function mergeOK(s, i, j) {
  return s[j] > 0 && (s[j] & 3) === (s[i] & 3) && s[j] >> 2 === s[i] >> 2 && lvl(s[i]) < MAX_LEVEL;
}

export function genMoves(board, s, p, dedupe = true, rules = {}) {
  const r = opt(rules);
  const moves = [];
  const seen = dedupe ? new Uint8Array(s.length) : null;
  for (let i = 0; i < s.length; i++) {
    if (s[i] <= 0 || (s[i] & 3) !== p) continue;
    for (const j of board.n1[i]) {
      if (s[j] === EMPTY) {
        if (seen) { if (seen[j]) continue; seen[j] = 1; }
        moves.push({ from: i, to: j, jump: false });
      } else if (r.merge && mergeOK(s, i, j)) moves.push({ from: i, to: j, jump: false, merge: true });
    }
    if (!r.misere) for (const j of board.n2[i]) if (s[j] === EMPTY) moves.push({ from: i, to: j, jump: true });
  }
  return moves;
}

export function targetsFrom(board, s, i, rules = {}) {
  const r = opt(rules);
  const out = [];
  for (const j of board.n1[i]) {
    if (s[j] === EMPTY) out.push({ from: i, to: j, jump: false });
    else if (r.merge && mergeOK(s, i, j)) out.push({ from: i, to: j, jump: false, merge: true });
  }
  if (!r.misere) for (const j of board.n2[i]) if (s[j] === EMPTY) out.push({ from: i, to: j, jump: true });
  return out;
}

export function hasMove(board, s, p, rules = {}) {
  const r = opt(rules);
  for (let i = 0; i < s.length; i++) {
    if (s[i] <= 0 || (s[i] & 3) !== p) continue;
    for (const j of board.n1[i]) if (s[j] === EMPTY || (r.merge && mergeOK(s, i, j))) return true;
    if (!r.misere) for (const j of board.n2[i]) if (s[j] === EMPTY) return true;
  }
  return false;
}

/** Hit an enemy piece: a level 2+ piece loses a level (its armour cracks), a level 1 piece converts. */
function strike(s, j, p, flipped, cracked) {
  if (s[j] >> 2 > 0) { s[j] -= 4; cracked.push(j); } else { s[j] = p; flipped.push(j); }
}

/** Applies a move in place. Returns { waves: [[converted directly], [cascade 1], ...], cracked, total }.
 *  Clones create a level 1 piece, jumps carry the piece's level, merges fuse two equal pieces into
 *  one a level higher. Every move then strikes each enemy touching its destination. */
export function applyMove(board, s, m, p, rules = {}) {
  // A merge is a pure upgrade: it fuses twins into one armoured piece but strikes nothing.
  // (If merges also converted, clone-merge-clone loops would churn without the board filling.)
  if (m.merge) { s[m.to] = s[m.to] + 4; s[m.from] = EMPTY; return { waves: [[]], cracked: [], total: 0 }; }
  else if (m.jump) { s[m.to] = s[m.from]; s[m.from] = EMPTY; }
  else s[m.to] = p;
  const first = [], cracked = [];
  const hit = [];
  for (const j of board.n1[m.to]) if (s[j] > 0 && (s[j] & 3) !== p) hit.push(j);
  for (const j of hit) strike(s, j, p, first, cracked);
  const waves = [first];
  let total = first.length;
  if (rules.cascade) {
    let frontier = first;
    while (frontier.length) {
      const cand = [];
      for (const c of frontier) for (const j of board.n1[c]) {
        if (s[j] <= 0 || (s[j] & 3) === p || cand.includes(j)) continue;
        let friends = 0;
        for (const k of board.n1[j]) if (s[k] > 0 && (s[k] & 3) === p) friends++;
        if (friends >= CASCADE_THRESHOLD) cand.push(j);
      }
      const next = [];
      for (const j of cand) strike(s, j, p, next, cracked);
      if (next.length) { waves.push(next); total += next.length; }
      frontier = next;
    }
  }
  return { waves, cracked, total };
}
/** Tectonic shift: outer ring turns one step clockwise, inner ring one step back.
 *  Holes stay put; pieces and empty cells ride the ring. Mutates s, returns piece moves. */
export function shiftRings(board, s) {
  const moves = [];
  const turn = (ring, dir) => {
    const live = ring.filter((i) => s[i] !== HOLE);
    if (live.length < 2) return;
    const vals = live.map((i) => s[i]);
    live.forEach((i, k) => {
      const to = live[(k + dir + live.length) % live.length];
      if (vals[k] > 0) moves.push({ from: i, to });
    });
    live.forEach((i, k) => { s[live[(k + dir + live.length) % live.length]] = vals[k]; });
  };
  for (const ring of board.rings) turn(ring.cells, ring.dir);
  return moves;
}

/** Decide who moves after `cur`. Returns { over, next, filler, skipped }.
 *  Classic rule: if the side to move is stuck, the other side takes every empty cell. */
export function resolveNext(board, s, cur, n, rules = {}) {
  const cnt = counts(s, n);
  const alive = [];
  for (let p = 1; p <= n; p++) if (cnt[p] > 0) alive.push(p);
  if (alive.length <= 1) return { over: true, filler: alive[0] || 0, skipped: [] };
  if (cnt[0] === 0) return { over: true, filler: 0, skipped: [] };
  if (n === 2) {
    const other = 3 - cur;
    if (hasMove(board, s, other, rules)) return { over: false, next: other, skipped: [] };
    return { over: true, filler: cur, skipped: [other] };
  }
  const movable = alive.filter((p) => hasMove(board, s, p, rules));
  if (movable.length === 0) return { over: true, filler: 0, skipped: [] };
  if (movable.length === 1) return { over: true, filler: movable[0], skipped: alive.filter((p) => p !== movable[0]) };
  const skipped = [];
  for (let k = 1; k <= n; k++) {
    const p = ((cur - 1 + k) % n) + 1;
    if (movable.includes(p)) return { over: false, next: p, skipped };
    if (cnt[p] > 0) skipped.push(p);
  }
  return { over: true, filler: 0, skipped };
}

export function fillEmpty(s, p) {
  const filled = [];
  for (let i = 0; i < s.length; i++) if (s[i] === EMPTY) { s[i] = p; filled.push(i); }
  return filled;
}

/** Ranking at game end: array of players best-first, ties share a rank. */
export function standings(s, n, misere) {
  const cnt = counts(s, n);
  const ps = Array.from({ length: n }, (_, k) => k + 1);
  ps.sort((a, b) => (misere ? cnt[a] - cnt[b] : cnt[b] - cnt[a]));
  return { order: ps, cnt };
}

export function visibleMask(board, s, p) {
  const vis = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) if (s[i] > 0 && (s[i] & 3) === p) {
    vis[i] = 1;
    for (const j of board.n1[i]) vis[j] = 1;
    for (const j of board.n2[i]) vis[j] = 1;
  }
  return vis;
}
