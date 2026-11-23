// Plays complete AI-vs-AI games under every rule set and reports invariants.
import * as R from '../src/rules.js';
import { think } from '../src/ai.js';

// Optional ?only=merge filters configs whose rules mention the word.
const only = new URLSearchParams(self.location.search).get('only');
const ALL = [
  ['classic', 2, {}, ['hard', 'easy']],
  ['classic', 2, { cascade: true }, ['medium', 'medium']],
  ['grand', 3, {}, ['medium', 'easy', 'easy']],
  ['grand', 2, { tectonic: true }, ['medium', 'easy']],
  ['random', 2, { misere: true }, ['medium', 'easy']],
  ['halo', 3, { cascade: true, tectonic: true }, ['easy', 'easy', 'easy']],
  ['spire', 2, {}, ['medium', 'easy']],
  ['tower', 3, { cascade: true }, ['easy', 'easy', 'easy']],
  ['tesseract', 2, { tectonic: true }, ['medium', 'easy']],
  ['classic', 2, { merge: true }, ['hard', 'medium']],
  ['grand', 2, { merge: true, cascade: true }, ['medium', 'medium']],
  ['grand', 3, { merge: true, cascade: true }, ['medium', 'easy', 'easy']],
  ['spire', 2, { merge: true }, ['medium', 'easy']],
  ['compact', 2, {}, ['master', 'medium']],
];
const CONFIGS = only ? ALL.filter((c) => JSON.stringify(c[2]).includes(only)) : ALL;

for (const [shape, n, rules, lv] of CONFIGS) {
  const b = R.makeBoard(shape, n, 42);
  const s = Int8Array.from(b.start);
  const holes0 = s.filter((v) => v < 0).length;
  let stalled = false, merges = 0, quiet = 0, minEmpty = Infinity, cur = 1, ply = 0, maxT = 0, casc = 0, err = '';
  while (ply < 500) {
    const t0 = performance.now();
    const m = think(b, s, cur, n, rules, lv[cur - 1]);
    maxT = Math.max(maxT, performance.now() - t0);
    if (!m) { err = 'AI returned no move while resolveNext said it could move'; break; }
    if (R.own(s[m.from]) !== cur || (m.merge ? R.own(s[m.to]) !== cur : s[m.to] !== 0)) { err = 'illegal move ' + JSON.stringify(m); break; }
    if (m.merge) merges++;
    const r = R.applyMove(b, s, m, cur, rules);
    if (r.waves.length > 1) casc++;
    ply++;
    if (rules.tectonic && ply % (n * 2) === 0) R.shiftRings(b, s);
    if (s.filter((v) => v < 0).length !== holes0) { err = 'hole count changed'; break; }
    const empties = R.counts(s, n)[0];
    if (empties < minEmpty) { minEmpty = empties; quiet = 0; } else quiet++;
    if (quiet >= R.QUIET_LIMIT) { stalled = true; break; }
    const nx = R.resolveNext(b, s, cur, n, rules);
    if (nx.over) { if (nx.filler) R.fillEmpty(s, nx.filler); break; }
    cur = nx.next;
  }
  const st = R.standings(s, n, rules.misere);
  self.postMessage(`${shape.padEnd(8)} n=${n} ${JSON.stringify(rules).padEnd(34)} ${lv.join('/').padEnd(20)} plies=${String(ply).padStart(3)} final=${R.counts(s, n).join('/')} winner=P${st.order[0]} maxThink=${maxT.toFixed(0)}ms cascades=${casc} merges=${merges} maxLvl=${Math.max(...Array.from(s, R.lvl))} cells=${b.cells.length} holes=${holes0}${stalled ? ' (stall rule)' : ''}${ply >= 500 ? ' PLY CAP' : ''} ${err ? 'ERROR: ' + err : 'ok'}`);
}
self.postMessage('DONE');
