// Journey screens: the star map, the stage briefing card, dialogue scenes and the
// stage-results panel. Game flow (starting a battle, the menu) is passed in by main.js.
import { CAST, CHAPTERS, STAGES, loadProgress, saveProgress, totalStars, chapterStars, rankOf, nextRank, isOpen, score } from './journey.js';

const $ = (s) => document.querySelector(s);
const NODE_X = ['-34%', '8%', '30%', '-6%', '0%']; // the path winds left and right
const STAR = (on) => `<i class="${on ? 'on' : ''}">★</i>`;

export function initJourney(api) {
  // api: { portrait(faction) -> url, sfx, startStage(stage), showMenu(), wipe(fn) }
  let progress = loadProgress();
  let current = null;

  const face = (who) => {
    const c = CAST[who];
    return c.faction ? api.portrait(c.faction) : null;
  };

  // ---------- map ----------
  function render() {
    progress = loadProgress();
    const stars = totalStars(progress);
    $('#j-stars').textContent = stars;
    $('#j-rankname').textContent = rankOf(stars);
    const nr = nextRank(stars);
    $('#j-next').textContent = nr ? `${nr[0] - stars}★ to ${nr[1]}` : 'Highest rank reached';
    const next = STAGES.find((s) => isOpen(progress, s) && !progress.stars[s.id]);
    $('#j-chapters').innerHTML = CHAPTERS.map((ch, ci) => {
      const locked = stars < ch.need;
      const nodes = STAGES.filter((s) => s.ch === ci).map((s, k) => {
        const got = progress.stars[s.id] || 0;
        const open = isOpen(progress, s);
        const cls = ['j-node', s.boss ? 'boss' : '', !open ? 'locked' : '', got ? 'done' : '', next === s ? 'next' : ''].join(' ');
        const inner = s.boss ? `<img src="${face(s.foe) || ''}" alt="">` : `<b>${s.id}</b>`;
        return `<button class="${cls}" data-id="${s.id}" style="--x:${NODE_X[k]}" ${open ? '' : 'disabled'}>
          <span class="j-hex">${inner}</span>
          <span class="j-label"><span class="j-name">${s.title}</span><span class="j-stars">${[0, 1, 2].map((n) => STAR(n < got)).join('')}</span></span>
        </button>`;
      }).join('');
      return `<section class="j-ch ${locked ? 'locked' : ''}" style="--h:${ch.hue}">
        <header><small>Chapter ${ci + 1}</small><h2>${ch.name}</h2><p>${ch.tag}</p>
          <span class="j-chstars">${chapterStars(progress, ci)}/15 ★</span></header>
        <div class="j-path">${nodes}</div>
        ${locked ? `<div class="j-lock"><b>Locked</b>Earn ${ch.need}★ to enter · you have ${stars}★</div>` : ''}
      </section>`;
    }).join('');
    for (const b of document.querySelectorAll('.j-node:not([disabled])')) b.onclick = () => brief(STAGES.find((s) => s.id === b.dataset.id));
    // bring the next stage into view
    requestAnimationFrame(() => document.querySelector('.j-node.next')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  function open() {
    render();
    const el = $('#journey');
    el.classList.remove('hidden', 'show'); void el.offsetWidth; el.classList.add('show');
    api.sfx.select?.();
  }
  function close() { $('#journey').classList.add('hidden'); }

  // ---------- stage briefing ----------
  function brief(stage) {
    current = stage;
    const got = progress.stars[stage.id] || 0;
    const foe = stage.foe || (stage.players === 3 ? 'U' : 'R');
    $('#sc-foe').src = face(foe) || '';
    $('#sc-id').textContent = `${stage.boss ? 'Boss · ' : ''}Stage ${stage.id}`;
    $('#sc-title').textContent = stage.title;
    $('#sc-blurb').textContent = stage.blurb;
    const chips = [stage.players === 3 ? '3-way war' : 'Duel', `AI: ${stage.ctrl.slice(1).join(' & ')}`, boardName(stage.board), ...Object.keys(stage.rules).filter((k) => stage.rules[k]).map(cap)];
    $('#sc-chips').innerHTML = chips.map((c) => `<span class="mut">${c}</span>`).join('');
    const best = progress.best?.[stage.id] || [];
    $('#sc-goals').innerHTML = stage.goals.map((g, k) => `<li class="${best[k] ? 'ok' : ''}">${STAR(best[k] || (k === 0 && got))}<span>${g.t}</span></li>`).join('');
    $('#sc-play').onclick = () => play(stage);
    $('#stagecard').classList.remove('hidden');
    api.sfx.select?.();
  }

  async function play(stage) {
    $('#stagecard').classList.add('hidden');
    await dialogue(stage.pre);
    close();
    api.startStage(stage);
  }

  // ---------- dialogue ----------
  /** Plays lines of [speakerKey, text]. Tap / click / Space advances; Skip ends it. */
  function dialogue(lines) {
    if (!lines?.length) return Promise.resolve();
    const el = $('#dialog');
    el.classList.remove('hidden');
    return new Promise((resolve) => {
      let i = 0, typing = null, full = '';
      const show = () => {
        const [who, text] = lines[i];
        const c = CAST[who];
        el.dataset.side = c.side;
        el.style.setProperty('--c', c.color);
        const img = face(who);
        $('#dlg-face').src = img || '';
        $('#dlg-face').classList.toggle('emblem-face', !img);
        $('#dlg-name').textContent = c.name;
        const box = $('#dlg-text');
        box.textContent = '';
        full = text;
        let k = 0;
        clearInterval(typing);
        typing = setInterval(() => {
          box.textContent = full.slice(0, ++k);
          if (k % 3 === 0) api.sfx.tick?.();
          if (k >= full.length) { clearInterval(typing); typing = null; }
        }, 22);
        const card = $('#dlg-card');
        card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
      };
      const next = () => {
        if (typing) { clearInterval(typing); typing = null; $('#dlg-text').textContent = full; return; } // first tap finishes the line
        if (++i >= lines.length) return done();
        show();
      };
      const done = () => {
        clearInterval(typing);
        el.classList.add('hidden');
        el.onclick = null; $('#dlg-skip').onclick = null;
        removeEventListener('keydown', key);
        resolve();
      };
      const key = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); } else if (e.key === 'Escape') done(); };
      el.onclick = (e) => { if (e.target.id !== 'dlg-skip') next(); };
      $('#dlg-skip').onclick = (e) => { e.stopPropagation(); done(); };
      addEventListener('keydown', key);
      show();
    });
  }

  // ---------- results ----------
  /** Called by main.js when a journey battle ends. Fills the results card; returns stars earned. */
  function result(stage, r) {
    const { earned, stars } = score(stage, r);
    progress = loadProgress();
    const before = progress.stars[stage.id] || 0;
    const totalBefore = totalStars(progress);
    progress.stars[stage.id] = Math.max(before, stars);
    progress.best = progress.best || {};
    progress.best[stage.id] = (progress.best[stage.id] || [false, false, false]).map((b, k) => b || earned[k]);
    saveProgress(progress);
    const totalAfter = totalStars(progress);

    const box = $('#gameover .jres');
    box.classList.remove('hidden');
    box.querySelector('.jstars').innerHTML = [0, 1, 2].map((k) => `<i class="${earned[k] ? 'on' : ''}" style="--d:${0.5 + k * 0.35}s">★</i>`).join('');
    box.querySelector('.jgoals').innerHTML = stage.goals.map((g, k) => `<li class="${earned[k] ? 'ok' : ''}">${earned[k] ? '✓' : '✕'}<span>${g.t}</span></li>`).join('');
    // what this result unlocked
    const unlocks = [];
    if (rankOf(totalAfter) !== rankOf(totalBefore)) unlocks.push(`New rank: ${rankOf(totalAfter)}`);
    CHAPTERS.forEach((ch, ci) => { if (totalBefore < ch.need && totalAfter >= ch.need) unlocks.push(`Chapter ${ci + 1} unlocked: ${ch.name}`); });
    const nxt = STAGES[STAGES.indexOf(stage) + 1];
    if (r.won && before === 0 && nxt && isOpen(progress, nxt)) unlocks.push(`Next: ${nxt.title}`);
    box.querySelector('.junlock').innerHTML = unlocks.map((u) => `<span>${u}</span>`).join('');
    earned.forEach((on, k) => { if (on) setTimeout(() => api.sfx.capture?.(k + 2, 0), 500 + k * 350); });
    return { stars, won: r.won, next: nxt && isOpen(progress, nxt) ? nxt : null };
  }

  /** After a win: the closing scene, then back to the map with the next stage highlighted. */
  async function after(stage) {
    await dialogue(stage.post);
    if (stage.id === STAGES.at(-1).id) await dialogue([['E', 'THE END… of the beginning. Thank you for playing Clowder.']]);
    api.wipe(() => { api.showMenu(); open(); });
  }

  const boardName = (b) => ({ compact: 'Compact board', classic: 'Classic board', grand: 'Grand board', halo: 'Halo board', random: 'Shattered board', spire: '3D Spire', tower: '3D Tower', tesseract: '4D Tesseract' })[b] || b;
  const cap = (k) => ({ cascade: 'Cascade', tectonic: 'Tectonic', fog: 'Fog of war', blitz: 'Blitz clock', misere: 'Misère', merge: 'Merge' })[k] || k;

  $('#j-back').onclick = () => { close(); api.sfx.deselect?.(); };

  return {
    open, close, brief, play, result, after, dialogue,
    isOpen: () => !$('#journey').classList.contains('hidden'),
    summary: () => { const p = loadProgress(); const s = totalStars(p); return { stars: s, max: STAGES.length * 3, rank: rankOf(s) }; },
  };
}
