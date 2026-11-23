// Computer players. Alpha-beta minimax; with three players it is "paranoid"
// (both rivals are assumed to gang up on the AI), which plays solidly in Triad.
import { genMoves, applyMove, counts, hasMove, EMPTY } from './rules.js';

export const LEVELS = {
  easy:   { name: 'Easy',   depth: 1, noise: 2.6, time: 400 },
  medium: { name: 'Medium', depth: 2, noise: 0.9, time: 800 },
  hard:   { name: 'Hard',   depth: 4, noise: 0, time: 1500 },
  master: { name: 'Master', depth: 6, noise: 0, time: 1800 },
};

const WIN = 10000;
class Abort extends Error {}

export function think(board, state, me, n, rules, levelKey, rngSeed = Math.random() * 1e9) {
  const L = LEVELS[levelKey] || LEVELS.medium;
  const s0 = Int8Array.from(state);
  const sign = rules.misere ? -1 : 1;
  const deadline = performance.now() + L.time;
  let nodes = 0;
  let seed = rngSeed | 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) % 100000) / 100000; };

  const nextOf = (s, p, cnt) => {
    for (let k = 1; k <= n; k++) { const q = ((p - 1 + k) % n) + 1; if (cnt[q] > 0) return q; }
    return p;
  };

  // Static evaluation from `me`'s point of view. `cnt` is power (sum of levels). With Merge on,
  // occupying more cells still matters (more places to clone from), so pieces add a small bonus.
  function evaluate(s, cnt) {
    let others = 0, maxOther = 0;
    for (let p = 1; p <= n; p++) if (p !== me) { others += cnt[p]; maxOther = Math.max(maxOther, cnt[p]); }
    let mat = n === 2 ? cnt[me] - others : cnt[me] - (others / (n - 1) + maxOther) / 2;
    if (rules.merge) {
      let mine = 0, theirs = 0;
      for (let i = 0; i < s.length; i++) if (s[i] > 0) ((s[i] & 3) === me ? mine++ : theirs++);
      mat += 0.25 * (mine - theirs / (n - 1));
    }
    return sign * mat;
  }

  function terminal(s, cnt, filler) {
    const c = cnt.slice();
    if (filler) { c[filler] += c[0]; c[0] = 0; }
    let best = true, worst = true;
    for (let p = 1; p <= n; p++) if (p !== me) {
      if (rules.misere ? c[p] <= c[me] : c[p] >= c[me]) best = false;
      if (rules.misere ? c[p] > c[me] : c[p] < c[me]) worst = false;
    }
    const e = evaluate(s, c);
    if (best) return WIN + e;
    if (worst && !best) return -WIN + e;
    return e;
  }

  function quickGain(s, m, p) {
    let g = m.jump ? 0 : m.merge ? 0.2 : 1;
    for (const j of board.n1[m.to]) if (s[j] > 0 && (s[j] & 3) !== p) g += 1;
    if (m.jump || m.merge) for (const j of board.n1[m.from]) if (s[j] > 0 && (s[j] & 3) === p) g -= 0.3; // leaving a hole near friends
    return g;
  }

  function ordered(s, p) {
    const moves = genMoves(board, s, p, true, rules);
    for (const m of moves) m.g = quickGain(s, m, p);
    moves.sort((a, b) => (rules.misere ? a.g - b.g : b.g - a.g));
    return moves;
  }

  function search(s, p, depth, alpha, beta) {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Abort();
    const cnt = counts(s, n);
    let alive = 0; for (let q = 1; q <= n; q++) if (cnt[q] > 0) alive++;
    if (alive <= 1 || cnt[0] === 0) return terminal(s, cnt, alive === 1 ? [1, 2, 3].find((q) => cnt[q] > 0) : 0);
    if (depth === 0) return evaluate(s, cnt);
    const moves = ordered(s, p);
    if (!moves.length) {
      if (n === 2) return terminal(s, cnt, 3 - p);
      const movers = [];
      for (let q = 1; q <= n; q++) if (cnt[q] > 0 && hasMove(board, s, q, rules)) movers.push(q);
      if (movers.length <= 1) return terminal(s, cnt, movers[0] || 0);
      return search(s, nextOf(s, p, cnt), depth - 1, alpha, beta);
    }
    const maxing = p === me;
    let v = maxing ? -Infinity : Infinity;
    for (const m of moves) {
      const c = s.slice();
      applyMove(board, c, m, p, rules);
      const val = search(c, nextOf(c, p, counts(c, n)), depth - 1, alpha, beta);
      if (maxing) { if (val > v) v = val; if (v > alpha) alpha = v; }
      else { if (val < v) v = val; if (v < beta) beta = v; }
      if (alpha >= beta) break;
    }
    return v;
  }

  const rootMoves = ordered(s0, me);
  if (!rootMoves.length) return null;
  if (rootMoves.length === 1) return strip(rootMoves[0]);

  let best = rootMoves[0];
  let scored = rootMoves.map((m) => ({ m, v: m.g }));
  const cnt0 = counts(s0, n);
  for (let depth = 1; depth <= L.depth; depth++) {
    try {
      const res = [];
      // Easy/medium need exact scores for every move so noise can pick among them;
      // stronger levels use a narrowing window.
      let alpha = -Infinity;
      for (const { m } of scored) {
        const c = s0.slice();
        applyMove(board, c, m, me, rules);
        const v = search(c, nextOf(c, me, counts(c, n)), depth - 1, L.noise > 0.5 ? -Infinity : alpha - 1e-6, Infinity);
        res.push({ m, v });
        if (v > alpha) alpha = v;
      }
      res.sort((a, b) => b.v - a.v);
      scored = res;
      best = res[0].m;
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      break;
    }
    if (Math.abs(scored[0].v) >= WIN) break;
  }
  if (L.noise > 0.02) {
    let top = -Infinity;
    for (const o of scored) {
      const v = o.v + (rnd() - 0.5) * 2 * L.noise;
      if (v > top) { top = v; best = o.m; }
    }
  } else {
    // break exact ties randomly so games differ
    const ties = scored.filter((o) => o.v === scored[0].v);
    best = ties[Math.floor(rnd() * ties.length)].m;
  }
  void cnt0; void EMPTY;
  return strip(best, nodes);
}

const strip = (m, nodes = 0) => ({ from: m.from, to: m.to, jump: m.jump, merge: !!m.merge, nodes });
