// The Journey: Across the Rift. A 15-stage campaign with story scenes, star objectives
// and progression (stage unlocks, chapter gates, rank titles), saved in localStorage.
import { own, lvl, piece, EMPTY } from './rules.js';

// ---------- cast ----------
// faction: which portrait to show (1 Galactic, 2 Dino, 3 Robo, 0 = the Rift's emblem)
export const CAST = {
  N: { name: 'Nova', faction: 1, color: '#b98cff', side: 'left' },
  R: { name: 'Rex', faction: 2, color: '#9be65a', side: 'right' },
  U: { name: 'Unit-9', faction: 3, color: '#5ad8ff', side: 'right' },
  E: { name: 'Elder Comet', faction: 0, color: '#ffcf3d', side: 'left' },
};

// ---------- setup helpers: bosses bend the starting position ----------
/** Every starting cat of player p begins crowned at level l. */
const crowned = (p, l = 2) => (board, s) => { for (let i = 0; i < s.length; i++) if (own(s[i]) === p) s[i] = piece(p, l); };
/** Give player p an extra cat next to each of their starting cats. */
const reinforced = (p) => (board, s) => {
  const starts = []; for (let i = 0; i < s.length; i++) if (own(s[i]) === p) starts.push(i);
  for (const i of starts) { const j = board.n1[i].find((k) => s[k] === EMPTY); if (j !== undefined) s[j] = p; }
};
const both = (...fs) => (board, s) => fs.forEach((f) => f(board, s));

// ---------- objectives ----------
// r: { won, margin, moves, captures, merges, combo, undo, hint, crowns, clockLeft }
const WIN = { t: 'Win the battle', f: (r) => r.won };
const by = (n) => ({ t: `Win by ${n} or more`, f: (r) => r.won && r.margin >= n });
const within = (n) => ({ t: `Win in ${n} moves or fewer`, f: (r) => r.won && r.moves <= n });
const caps = (n) => ({ t: `Convert ${n}+ enemy cats`, f: (r) => r.won && r.captures >= n });
const merges = (n) => ({ t: `Merge ${n}+ times`, f: (r) => r.won && r.merges >= n });
const combo = (n) => ({ t: `Convert ${n}+ cats in one move`, f: (r) => r.won && r.combo >= n });
const pure = { t: 'No undo or hints', f: (r) => r.won && !r.undo && !r.hint };
const crownKept = { t: 'End with a crowned cat', f: (r) => r.won && r.crowns >= 1 };
const fast = (s) => ({ t: `Finish with ${s}s on your clock`, f: (r) => r.won && r.clockLeft >= s * 1000 });

// ---------- the campaign ----------
export const CHAPTERS = [
  { name: 'The Shattered Shore', tag: 'Learn the ways of the clowder', need: 0, hue: '#7a4bff' },
  { name: 'The Shifting Wilds', tag: 'The Rift itself fights back', need: 8, hue: '#ff8a3d' },
  { name: 'Beyond the Veil', tag: 'Where the dimensions fold', need: 20, hue: '#5ad8ff' },
];

export const STAGES = [
  // ---- Chapter 1: The Shattered Shore ----
  { id: '1-1', ch: 0, title: 'First Light', board: 'compact', ctrl: ['human', 'easy'], rules: {},
    blurb: 'A stray patch of the Rift, and a Dino scout who should not be here.',
    pre: [['E', 'The Rift is waking, little one. Every hex you touch will remember your name.'], ['N', 'Then I had better touch a lot of hexes.'], ['E', 'Step once to clone. Land beside a Dino and it joins your clowder. Go.']],
    post: [['N', 'That… was easy?'], ['E', 'That was a scout. Its master will not be so polite.']],
    goals: [WIN, by(6), within(14)] },
  { id: '1-2', ch: 0, title: 'Leap of Faith', board: 'classic', ctrl: ['human', 'easy'], rules: {},
    blurb: 'Open ground. Learn to leap: two hexes at once, behind enemy lines.',
    pre: [['R', 'A Galactic kitten on MY shore? Adorable. Crush it.'], ['N', 'Who was that?'], ['E', 'Rex. Warlord of the Dino Cats. Leap two hexes to strike where he is weak.']],
    post: [['R', 'Lucky landing. It will not happen twice.'], ['N', 'It happened, like, nine times.']],
    goals: [WIN, caps(10), pure] },
  { id: '1-3', ch: 0, title: 'Crowned', board: 'compact', ctrl: ['human', 'easy'], rules: { merge: true },
    blurb: 'Fuse two twins into a crowned cat. A crown shrugs off one conversion.',
    pre: [['E', 'Two cats of equal rank can become one greater cat. Step onto your twin.'], ['N', 'Like a cosmic hug?'], ['E', '…Yes. A cosmic hug. With armour.']],
    post: [['N', 'I look GREAT in a crown.'], ['E', 'Humility is also a kind of armour.']],
    goals: [WIN, merges(2), crownKept] },
  { id: '1-4', ch: 0, title: 'Chain Lightning', board: 'classic', ctrl: ['human', 'medium'], rules: { cascade: true },
    blurb: 'Here, conversions cascade: an enemy wrapped by four of yours falls too.',
    pre: [['R', 'My vanguard has never lost a skirmish!'], ['E', 'On this ground, one capture can topple a wall. Surround, then strike.']],
    post: [['R', 'ENOUGH. You will face me yourself, kitten.'], ['N', 'Finally. I was getting bored of your minions.']],
    goals: [WIN, combo(4), by(10)] },
  { id: '1-5', ch: 0, title: 'Rex, the Tyrant Tail', boss: true, foe: 'R', board: 'classic', ctrl: ['human', 'medium'], rules: { merge: true },
    setup: crowned(2), blurb: 'BOSS · Every one of Rex\'s cats starts crowned. Crack them before they grow.',
    pre: [['R', 'Behold my royal guard. Every one of them wears a crown.'], ['N', 'Then I will just have to knock them off.'], ['E', 'A crown absorbs one blow. Strike twice where it matters.']],
    post: [['R', 'Impossible… beaten by a kitten with a SHOWER CAP.'], ['N', 'It is a space helmet.'], ['E', 'The shore is yours. But the Rift beyond has noticed you.']],
    goals: [WIN, by(5), pure] },

  // ---- Chapter 2: The Shifting Wilds ----
  { id: '2-1', ch: 1, title: 'Fault Lines', board: 'grand', ctrl: ['human', 'medium'], rules: { tectonic: true },
    blurb: 'Every two rounds the outer ring turns, carrying cats with it.',
    pre: [['E', 'These wilds do not stay still. The rings turn, and your cats ride them.'], ['R', 'I know these lands, kitten. The ground itself is my ally!']],
    post: [['N', 'I think I am getting seasick.'], ['R', 'Next time the fog will hide me. You will never see me coming.']],
    goals: [WIN, by(8), caps(14)] },
  { id: '2-2', ch: 1, title: 'Into the Fog', board: 'grand', ctrl: ['human', 'medium'], rules: { fog: true },
    blurb: 'You only see near your own cats. Expand to see, see to survive.',
    pre: [['R', 'Can you hear me, kitten? I am everywhere. And nowhere.'], ['N', 'You are breathing VERY loudly.'], ['E', 'Your cats light the way. Grow, and the fog retreats.']],
    post: [['R', 'You can SMELL us?!'], ['N', 'Dino cats smell like volcano.']],
    goals: [WIN, by(8), pure] },
  { id: '2-3', ch: 1, title: 'The Halo', board: 'halo', ctrl: ['human', 'medium'], rules: { cascade: true, merge: true },
    blurb: 'A ring around a void. Crowns and cascades both in play.',
    pre: [['E', 'The Halo: a ring around nothing. Control the ring and you control everything.'], ['R', 'Crowns AND cascades. Even I am nervous.']],
    post: [['N', 'Round and round and round and… I won!'], ['E', 'A storm gathers at the heart of the wilds. Rex has been feeding it.']],
    goals: [WIN, merges(3), combo(5)] },
  { id: '2-4', ch: 1, title: 'Against the Clock', board: 'classic', ctrl: ['human', 'hard'], rules: { blitz: true },
    blurb: '60 seconds each, plus 2 per move. Think fast, claw faster.',
    pre: [['R', 'The storm will not wait for you, and neither will I. Sixty seconds.'], ['N', 'Plenty of time to win. Probably.']],
    post: [['R', 'You are QUICK, for a kitten. But the storm is quicker.']],
    goals: [WIN, fast(20), by(6)] },
  { id: '2-5', ch: 1, title: 'The Rift Storm', boss: true, foe: 'R', board: 'random', ctrl: ['human', 'hard'], rules: { cascade: true, tectonic: true },
    setup: reinforced(2), seed: 2525, blurb: 'BOSS · A shattered board, turning rings, and Rex starts with twice the army.',
    pre: [['R', 'BEHOLD! The Rift Storm answers to ME now!'], ['E', 'He has torn the board apart and doubled his army. Stay calm. Cascades cut both ways.'], ['N', 'I was born in a storm. Let us dance.']],
    post: [['R', 'The storm… it was never mine to command.'], ['U', 'CORRECTION. THE STORM WAS NEVER YOURS. IT WAS OURS.'], ['N', 'Who said that?!'], ['E', 'Something from beyond the Veil. Something made of metal.']],
    goals: [WIN, by(8), pure] },

  // ---- Chapter 3: Beyond the Veil ----
  { id: '3-1', ch: 2, title: 'Unit-9 Awakens', board: 'grand', players: 3, ctrl: ['human', 'easy', 'medium'], rules: {},
    blurb: 'Three clowders, one board. Rex and Unit-9 fight you and each other.',
    pre: [['U', 'GREETINGS, ORGANIC CATS. YOU WILL BE UPGRADED.'], ['R', 'Kitten, I hate you. But I hate THAT more.'], ['N', 'Everyone against everyone? Sounds fair.']],
    post: [['U', 'ERROR. ERROR. RECALCULATING.'], ['R', 'It is retreating through the Veil. Into the higher layers.']],
    goals: [WIN, by(6), caps(15)] },
  { id: '3-2', ch: 2, title: 'Ascension', board: 'spire', ctrl: ['human', 'medium'], rules: {},
    blurb: 'A 3D spire: hexes touch the ones above and below. Climb, clone, conquer.',
    pre: [['E', 'Beyond the Veil the Rift stacks upon itself. Up and down are just more directions.'], ['R', 'I will guard the stairs. Go, kitten. Up.']],
    post: [['N', 'I can see the whole universe from up here.'], ['U', 'THE WHOLE UNIVERSE IS LOADING. PLEASE WAIT.']],
    goals: [WIN, by(10), within(40)] },
  { id: '3-3', ch: 2, title: 'Two Worlds', board: 'tesseract', ctrl: ['human', 'medium'], rules: {},
    blurb: '4D: two parallel worlds. Every hex has a twin one step away.',
    pre: [['U', 'YOU EXIST IN ONE WORLD. I EXIST IN TWO.'], ['N', 'Then I will beat you twice.']],
    post: [['U', 'DIMENSIONAL ADVANTAGE: NEGATED. HOW?'], ['E', 'Its core lies at the heart of the Rift. One battle remains.']],
    goals: [WIN, by(10), pure] },
  { id: '3-4', ch: 2, title: 'Triad War', board: 'grand', players: 3, ctrl: ['human', 'hard', 'hard'], rules: { cascade: true, merge: true },
    blurb: 'Rex and Unit-9 at full strength, crowns and cascades. Survive the three-way war.',
    pre: [['R', 'Kitten. If we both survive this, I owe you a fish.'], ['U', 'ALLIANCE DETECTED. ALLIANCE WILL BE DELETED.'], ['N', 'Everybody calm down. Then lose.']],
    post: [['R', 'One fish, as promised.'], ['N', 'It is a fossil.'], ['R', 'It is VINTAGE.']],
    goals: [WIN, merges(3), combo(5)] },
  { id: '3-5', ch: 2, title: 'Heart of the Rift', boss: true, foe: 'U', board: 'grand', players: 3, ctrl: ['human', 'medium', 'master'], rules: { cascade: true, merge: true },
    setup: both(crowned(3, 3)), blurb: 'FINALE · Unit-9 arrives as a Legendary: every Robo cat starts at ★3.',
    pre: [['U', 'FINAL FORM ENGAGED. EVERY UNIT: LEGENDARY.'], ['R', 'I will hold its flank. The heart is yours, Nova.'], ['E', 'Everything you have learned, little one. Clone, leap, crown, cascade. Now.']],
    post: [['U', 'SHUTTING… DOWN… MEOW.'], ['R', 'The Rift is quiet. It has chosen you.'], ['E', 'Nova of the Galactic Cats, keeper of the Rift. Your clowder is complete.'], ['N', 'So… what is beyond the Rift?']],
    goals: [WIN, by(5), pure] },
];

export const RANKS = [
  [0, 'Stray'], [4, 'Kitten Scout'], [10, 'Rift Prowler'], [18, 'Star Stalker'], [27, 'Clowder Captain'], [36, 'Legend of the Rift'], [45, 'Rift Sovereign'],
];

// ---------- progress ----------
const KEY = 'hx.journey';
export function loadProgress() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { stars: {}, seen: {} }; } catch { return { stars: {}, seen: {} }; }
}
export function saveProgress(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} }
export const totalStars = (p) => Object.values(p.stars).reduce((a, n) => a + n, 0);
export const chapterStars = (p, ch) => STAGES.filter((s) => s.ch === ch).reduce((a, s) => a + (p.stars[s.id] || 0), 0);
export const rankOf = (stars) => RANKS.filter(([n]) => stars >= n).at(-1)[1];
export const nextRank = (stars) => RANKS.find(([n]) => n > stars);

/** A stage is open when its chapter's star gate is met and the stage before it is cleared. */
export function isOpen(p, stage) {
  if (totalStars(p) < CHAPTERS[stage.ch].need) return false;
  const k = STAGES.indexOf(stage);
  if (k === 0) return true;
  const prev = STAGES[k - 1];
  return prev.ch !== stage.ch || (p.stars[prev.id] || 0) > 0;
}

/** Evaluate a finished game against a stage's objectives. Returns { earned: [bool,bool,bool], stars }. */
export function score(stage, r) {
  const earned = stage.goals.map((g) => !!g.f(r));
  return { earned, stars: earned.filter(Boolean).length };
}

/** Crowned cats a player still has on the board. */
export function crownsOf(s, p) { let n = 0; for (const v of s) if (v > 0 && own(v) === p && lvl(v) >= 2) n++; return n; }
