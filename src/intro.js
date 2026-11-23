// The opening cinematic: "The Rift". Told with the game's own scene, cats and rules,
// so it doubles as a 20-second tutorial. Click / Space skips a scene, Esc skips everything.
import * as THREE from 'three';
import { makeBoard, applyMove, EMPTY, hexDist } from './rules.js';

class Skip extends Error {}

export async function playIntro(R, sfx, onDone) {
  const $ = (s) => document.querySelector(s);
  const ui = $('#cine');
  const cap = $('#cine-cap'), word = $('#cine-word'), wordSub = $('#cine-word-sub'), title = $('#cine-title');
  let skipAll = false, skipScene = false;
  const extras = []; // scene objects to clean up

  const onKey = (e) => {
    if (e.key === 'Escape') skipAll = true;
    else if (e.key === ' ' || e.key === 'Enter') { skipScene = true; e.preventDefault(); }
  };
  const onClick = (e) => { if (e.target.id !== 'cine-skip') skipScene = true; };
  addEventListener('keydown', onKey);
  ui.addEventListener('click', onClick);
  $('#cine-skip').onclick = () => { skipAll = true; };

  const check = () => { if (skipAll || skipScene) throw new Skip(); };
  const sleep = async (ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end) { check(); await new Promise((r) => setTimeout(r, 30)); }
  };
  const type = async (text, hold = 1800) => {
    cap.textContent = ''; cap.classList.add('on');
    for (let k = 0; k < text.length; k++) {
      cap.textContent = text.slice(0, k + 1);
      if (text[k] !== ' ' && k % 2 === 0) sfx.tick?.();
      await sleep(text[k] === ',' || text[k] === '.' || text[k] === ':' ? 160 : 26);
    }
    await sleep(hold);
  };
  // Only the newest camera move drives the camera; a cut or a new move retires older ones.
  let camId = 0;
  const camTo = (pos, target, ms, e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)) => {
    const id = ++camId;
    const p0 = R.camera.position.clone(), t0 = R.controls.target.clone();
    return R.tween(ms, (t) => {
      if (id !== camId) return;
      R.camera.position.lerpVectors(p0, pos, t);
      R.controls.target.lerpVectors(t0, target, t);
    }, e, true);
  };
  const cut = (pos, target) => { camId++; R.camera.position.copy(pos); R.controls.target.copy(target); };
  const add = (o) => { R.scene.add(o); extras.push(o); return o; };
  const bigCat = (p, scale) => {
    const c = R.catProto[p].clone();
    c.scale.multiplyScalar(scale);
    return add(c);
  };

  // ---- setup ----
  R.setTheme('cats');
  R.controls.enabled = false;
  // OrbitControls still clamps distance and tilt in update(), even when disabled; free them
  // so the cinematic camera can roam, and restore the gameplay limits afterwards.
  const C = R.controls;
  const limits = { minDistance: C.minDistance, maxDistance: C.maxDistance, minPolarAngle: C.minPolarAngle, maxPolarAngle: C.maxPolarAngle, enableDamping: C.enableDamping };
  Object.assign(C, { minDistance: 0, maxDistance: Infinity, minPolarAngle: 0, maxPolarAngle: Math.PI, enableDamping: false });
  const prevSpeed = R.speed; R.speed = 1;
  ui.classList.remove('hidden', 'out');
  document.body.classList.add('cinematic');

  const board = makeBoard('compact', 2, 1);
  const s = new Int8Array(board.start.length); // empty board: the demo places its own cats
  R.build(board, s);
  R.tweens = []; // cancel build()'s camera fly-in; we direct the camera ourselves
  Object.assign(C, { minDistance: 0, maxDistance: Infinity }); // build() re-fits these
  const finals = R.tiles.map((t) => t && t.position.clone());
  R.tiles.forEach((t) => t && (t.visible = false));
  if (R.island) { R.island.visible = false; R.island.position.y = -40; }
  sfx.music?.('off');
  const idx = (q, r) => board.cells.findIndex((c) => c.q === q && c.r === r);

  const scenes = [
    // 1. The rift
    async () => {
      cut(new THREE.Vector3(0, 6, 70), new THREE.Vector3(0, 4, -100));
      sfx.pad([110, 164.8, 220, 261.6], 9, 0.06);
      camTo(new THREE.Vector3(0, 5, 34), new THREE.Vector3(0, 6, -100), 9000);
      // the tear: lightning rips down the seam between the two skies
      for (let k = 0; k < 5; k++) {
        R.wait(500 + k * 420).then(() => {
          const x = (Math.random() - 0.5) * 10, z = -90 - Math.random() * 20;
          R.bolt(new THREE.Vector3(x, 60, z), new THREE.Vector3(x + (Math.random() - 0.5) * 16, -30, z), { color: k % 2 ? 0xc8a8ff : 0xd8ffb0, width: 0.7, branches: 5, life: 520, flicker: 4, rough: 0.25, light: 0 });
          R.skyFlash = 1;
          sfx.thunder?.(0.55 + k * 0.08, 0.15);
        });
      }
      await sleep(900);
      await type('In the beginning, the universe tore in two…', 2200);
    },
    // 2. Galactic Cats
    async () => {
      cut(new THREE.Vector3(-12, 10, -6), new THREE.Vector3(-62, 22, -80));
      camTo(new THREE.Vector3(-20, 12, -20), new THREE.Vector3(-62, 22, -80), 7000);
      sfx.pad([174.6, 220, 261.6, 349.2], 8, 0.05);
      const cat = bigCat(1, 2.4);
      const a = new THREE.Vector3(-34, 13, -27), b = new THREE.Vector3(-22, 15.5, -37);
      cat.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      R.tween(5200, (t) => {
        cat.position.lerpVectors(a, b, t);
        cat.position.y += Math.sin(t * 9) * 0.25;
        cat.rotation.z = Math.sin(t * 6) * 0.2;
        if (Math.random() < 0.6) R.burst(cat.position.clone(), [0xb07aff, 0x6ff6ff, 0xffffff][Math.floor(Math.random() * 3)], 3, 0.6);
      }, (t) => t, true);
      await sleep(700); sfx.meow(1, 1.1);
      await type('On one side: the GALACTIC CATS. Born in starlight. Curious about absolutely everything.', 1600);
    },
    // 3. Dino Cats
    async () => {
      const cam = new THREE.Vector3(25, 2, -25), look = new THREE.Vector3(64, -2, -78);
      cut(cam.clone().add(new THREE.Vector3(-6, 4, 6)), look);
      camTo(cam, look, 2200);
      sfx.pad([146.8, 220, 293.7], 8, 0.05);
      const at = new THREE.Vector3(35.6, 0.6, -39.4);
      const rock = add(new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.2, 7), new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 1, flatShading: true })));
      rock.rotation.x = Math.PI; rock.position.copy(at).add(new THREE.Vector3(0, -1.7, 0));
      const dino = bigCat(2, 3);
      dino.position.copy(at).add(new THREE.Vector3(0, 0.9, 0));
      dino.rotation.y = Math.atan2(cam.x - at.x, cam.z - at.z);
      await sleep(1400);
      // the volcano erupts, the Dino Cat answers it
      const crater = R.crater.getWorldPosition(new THREE.Vector3());
      for (let k = 0; k < 14; k++) R.wait(k * 90).then(() => R.burst(crater, k % 2 ? 0xff5a00 : 0xffd040, 30, 9));
      sfx.boom?.(); R.shake(900, 0.6);
      await sleep(600);
      sfx.roar();
      for (let k = 0; k < 4; k++) R.wait(k * 140).then(() => R.shock(dino.position.clone().add(new THREE.Vector3(0, -0.6, 0)), k % 2 ? 0xffb02e : 0x8dff4a, 4 + k * 2));
      R.tween(900, (t) => dino.scale.setScalar(3 * 1.45 * (1 + Math.sin(t * Math.PI) * 0.15)), (t) => t, true);
      await type('On the other: the DINO CATS. Ancient. Scaly. Convinced the floor belongs to them.', 1600);
    },
    // 4. The Rift assembles
    async () => {
      cut(new THREE.Vector3(0, 34, 34), new THREE.Vector3(0, 0, 0));
      camTo(new THREE.Vector3(0, 12, 13), new THREE.Vector3(0, 0, 0.4), 4200);
      sfx.riser(3.4);
      // the island rises out of the dark while the tiles fly in to meet it
      if (R.island) {
        R.island.visible = true;
        R.tween(2600, (k) => { R.island.position.y = -40 * (1 - k); R.island.rotation.y = (1 - k) * 1.2; }, (k) => 1 - Math.pow(1 - k, 3), true);
      }
      sfx.pad([130.8, 196, 261.6, 329.6], 7, 0.05);
      R.tiles.forEach((t, i) => {
        if (!t) return;
        const fin = finals[i];
        const c = board.cells[i];
        const dir = new THREE.Vector3(Math.cos(i * 2.4), 0, Math.sin(i * 2.4));
        const start = fin.clone().addScaledVector(dir, 22).add(new THREE.Vector3(0, 14 + (i % 5) * 3, 0));
        t.position.copy(start); t.visible = true;
        R.wait(c.d * 380 + (i % 6) * 40).then(() => R.tween(1100, (k) => {
          t.position.lerpVectors(start, fin, k);
          t.rotation.y = (1 - k) * 4; t.rotation.x = (1 - k) * 2;
        }, (k) => 1 - Math.pow(1 - k, 4), true).then(() => {
          t.rotation.set(0, 0, 0);
          if (c.d === 0 || i % 3 === 0) { R.burst(fin.clone().setY(0.3), 0x8b7bff, 6, 1.2); sfx.tick?.(); }
        }));
      });
      await sleep(600);
      await type('Between them drifts the RIFT: a lattice of hexes, the last relic of the old world. Whoever covers it… rules everything.', 1400);
      R.tiles.forEach((t, i) => t && t.position.copy(finals[i]) && t.rotation.set(0, 0, 0));
    },
    // 5. How to play, shown with real moves
    async () => {
      cap.classList.remove('on');
      cut(new THREE.Vector3(0, 12, 13), new THREE.Vector3(0, 0, 0.4));
      const G1 = idx(-2, 1), D1 = idx(2, -1), D2 = idx(1, 1);
      for (const [i, p] of [[G1, 1], [D1, 2], [D2, 2]]) {
        s[i] = p;
        const pc = R.makePiece(i, p);
        const fin = pc.obj.position.clone();
        pc.obj.position.y += 9;
        R.tween(600, (t) => { pc.obj.position.y = fin.y + (1 - t) * 9; }, (t) => t * t, true).then(() => {
          pc.hop = 1; R.shock(fin, 0xffffff, 1.2); sfx.land();
        });
        await sleep(250);
      }
      await sleep(700);
      const rules = { merge: true };
      const demo = async (big, small, m, p) => {
        word.textContent = big; wordSub.textContent = small;
        word.parentElement.classList.remove('show'); void word.offsetWidth; word.parentElement.classList.add('show');
        sfx.kick(0, 0.4);
        await sleep(500);
        const res = applyMove(board, s, m, p, rules);
        await R.animateMove(m, p, res, sfx, s);
        R.sync(s);
        await sleep(900);
      };
      await demo('CLONE', 'Step one hex: your cat copies itself', { from: G1, to: idx(-1, 1), jump: false }, 1);
      await demo('LEAP', 'Or leap two hexes (the cat moves instead)', { from: D1, to: idx(2, 1), jump: true }, 2);
      await demo('CONVERT', 'Land next to enemies and they join your side', { from: idx(-1, 1), to: idx(0, 1), jump: false }, 1);
      await demo('MERGE', 'Fuse twins into a crowned cat: a crown shrugs off one conversion', { from: idx(0, 1), to: idx(1, 1), jump: false, merge: true }, 1);
      word.parentElement.classList.remove('show');
    },
    // 6. Title
    async () => {
      cap.classList.remove('on');
      camTo(new THREE.Vector3(0, 15, 19), new THREE.Vector3(0, 0, 0.4), 900);
      sfx.riser(1);
      await sleep(900);
      sfx.impact();
      sfx.pad([130.8, 196, 261.6, 329.6, 392], 5, 0.07);
      $('#cine-flash').classList.remove('go'); void $('#cine-flash').offsetWidth; $('#cine-flash').classList.add('go');
      title.classList.add('show');
      R.shake(700, 0.5);
      // the title lands with lightning striking the four corners of the Rift
      [[-4, 0, 3], [4, 0, 3], [-4, 0, -3], [4, 0, -3]].forEach(([x, y, z], k) => R.wait(k * 120).then(() => R.strike(new THREE.Vector3(x, 0.4, z), k % 2 ? 0xd8ffb0 : 0xc8a8ff, k === 0 ? sfx : null)));
      R.skyFlash = 1;
      for (let k = 0; k < 8; k++) R.wait(k * 90).then(() => R.burst(new THREE.Vector3((Math.random() - 0.5) * 8, 2 + Math.random() * 2, (Math.random() - 0.5) * 6), [0xb07aff, 0x8dff4a, 0xffd23f][k % 3], 40, 5));
      R.shock(new THREE.Vector3(0, 0.1, 0), 0xffd23f, 6);
      await sleep(3200);
    },
  ];

  try {
    for (const scene of scenes) {
      if (skipAll) break;
      skipScene = false;
      try { await scene(); } catch (e) { if (!(e instanceof Skip)) throw e; }
      cap.classList.remove('on');
    }
  } finally {
    removeEventListener('keydown', onKey);
    ui.removeEventListener('click', onClick);
    for (const o of extras) R.scene.remove(o);
    if (R.island) { R.island.visible = true; R.island.position.y = 0; R.island.rotation.y = 0; }
    R.tweens.forEach((t) => t.resolve()); R.tweens = [];
    Object.assign(R.controls, limits);
    R.controls.enabled = true;
    R.speed = prevSpeed;
    ui.classList.add('out');
    word.parentElement.classList.remove('show');
    setTimeout(() => { ui.classList.add('hidden'); title.classList.remove('show'); document.body.classList.remove('cinematic'); }, 600);
    try { localStorage.setItem('hx.seenIntro', '1'); } catch {}
    void EMPTY; void hexDist;
    onDone();
  }
}
