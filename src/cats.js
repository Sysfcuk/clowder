// Procedural cat pieces for Clowder, built from primitives and canvas textures (no model files).
//
// Every cat faces +z with its paws on y = -0.32 (model units; the prototype is scaled up).
// Parts that animate get their own named group: rig (breathing), head, earL/earR, eyes
// (blinking), a chain of tail segments, and faction extras (antenna, thrusters, visor...).
// At build time every group's static meshes are merged per material, so a cat costs a
// couple of dozen draw calls however detailed it is. Board pieces are clones that share
// geometry and materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addRim } from './gfx.js';

// ---------- textures ----------
function canvasTex(draw, w = 256, h = 256, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function blob(g, x, y, r, color) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
}
/** Seeded randomness, so every load paints identical cats. */
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function textures() {
  let r = rng(7);
  const cosmic = canvasTex((g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#2a0b5c'); grd.addColorStop(0.5, '#5a1fae'); grd.addColorStop(1, '#1d0844');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 22; k++) blob(g, r() * w, r() * h, 22 + r() * 54, ['rgba(255,90,210,0.32)', 'rgba(90,210,255,0.28)', 'rgba(170,100,255,0.4)'][k % 3]);
  });
  r = rng(11);
  const stars = canvasTex((g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 24; k++) blob(g, r() * w, r() * h, 14 + r() * 30, ['rgba(255,70,200,0.16)', 'rgba(70,200,255,0.16)'][k % 2]);
    for (let k = 0; k < 240; k++) {
      const s = r() < 0.07 ? 2.6 : 1.1;
      g.fillStyle = ['#fff', '#c8ecff', '#ffd6f6'][k % 3];
      g.beginPath(); g.arc(r() * w, r() * h, s, 0, 7); g.fill();
    }
    // a few four-pointed sparkles
    g.strokeStyle = '#fff'; g.lineWidth = 1.4;
    for (let k = 0; k < 7; k++) { const x = r() * w, y = r() * h, s = 4 + r() * 4; g.beginPath(); g.moveTo(x - s, y); g.lineTo(x + s, y); g.moveTo(x, y - s); g.lineTo(x, y + s); g.stroke(); }
  });
  r = rng(23);
  const scales = canvasTex((g, w, h) => {
    g.fillStyle = '#47a834'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h + 12; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < w + 12; x += 12) {
      g.fillStyle = `rgba(${30 + r() * 30},${100 + r() * 40},${30 + r() * 20},0.9)`;
      g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI); g.fill();
      g.strokeStyle = 'rgba(15,60,15,0.45)'; g.lineWidth = 1; g.stroke();
    }
    for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(20,75,25,0.55)'; g.beginPath(); g.ellipse(r() * w, r() * h, 10 + r() * 16, 6 + r() * 9, r() * 3, 0, 7); g.fill(); }
  });
  const belly = canvasTex((g, w, h) => {
    g.fillStyle = '#f7dc8a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 20) { g.fillStyle = 'rgba(200,150,60,0.35)'; g.fillRect(0, y, w, 3); }
  });
  r = rng(41);
  const metal = canvasTex((g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#c4cedc'); grd.addColorStop(1, '#8e9aae');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(40,50,70,0.55)'; g.lineWidth = 2;
    for (let y = 18; y < h; y += 46) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let x = 30; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let k = 0; k < 50; k++) { g.fillStyle = 'rgba(50,60,80,0.8)'; g.beginPath(); g.arc(r() * w, r() * h, 1.8, 0, 7); g.fill(); }
  });
  return { cosmic, stars, scales, belly, metal };
}

/** Painted iris: base colour ring, darker rim, pupil (round or slit) and two catchlights. */
function irisTex(inner, outer, slit, starGlint = false) {
  return canvasTex((g, w, h) => {
    const cx = w / 2, cy = h / 2;
    g.fillStyle = '#0c0614'; g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(cx, cy * 1.1, 4, cx, cy, w * 0.48);
    grd.addColorStop(0, inner); grd.addColorStop(0.75, outer); grd.addColorStop(1, '#0c0614');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, w * 0.47, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
    for (let k = 0; k < 28; k++) { const a = (k / 28) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * w * 0.2, cy + Math.sin(a) * w * 0.2); g.lineTo(cx + Math.cos(a) * w * 0.4, cy + Math.sin(a) * w * 0.4); g.stroke(); }
    g.fillStyle = '#05020a';
    g.beginPath();
    if (slit) g.ellipse(cx, cy, w * 0.07, h * 0.36, 0, 0, 7); else g.arc(cx, cy, w * 0.2, 0, 7);
    g.fill();
    g.fillStyle = '#fff';
    if (starGlint) {
      const x = cx - w * 0.16, y = cy - h * 0.17, s = w * 0.11;
      g.beginPath(); g.moveTo(x, y - s); g.quadraticCurveTo(x, y, x + s, y); g.quadraticCurveTo(x, y, x, y + s); g.quadraticCurveTo(x, y, x - s, y); g.quadraticCurveTo(x, y, x, y - s); g.fill();
    } else { g.beginPath(); g.ellipse(cx - w * 0.15, cy - h * 0.17, w * 0.1, h * 0.08, -0.6, 0, 7); g.fill(); }
    g.globalAlpha = 0.8; g.beginPath(); g.arc(cx + w * 0.14, cy + h * 0.16, w * 0.045, 0, 7); g.fill();
  }, 128, 128);
}

// ---------- geometry helpers ----------
const SEG = 14; // sphere detail: plenty at board scale, and keeps a full board of cats light
const sph = (r, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, SEG, Math.round(SEG * 0.7)).scale(sx, sy, sz);
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

/** Add a mesh to a group at a position, with optional rotation (x, y, z). */
function put(group, geo, mat, [x, y, z], rot = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  group.add(m);
  return m;
}

/** Merge each group's direct static meshes per material into one mesh (draw-call economy). */
function bake(root) {
  const groups = [];
  root.traverse((o) => { if (o.isGroup || o === root) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.children.length || c.name) continue;
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      byMat.get(c.material).push(c);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => { m.updateMatrix(); const geo = m.geometry.index ? m.geometry.clone() : m.geometry.clone(); return geo.applyMatrix4(m.matrix); });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      list.forEach((m) => g.remove(m));
      g.add(new THREE.Mesh(merged, mat));
    }
  }
}

// ---------- the cat ----------
/**
 * Build one cat. `m` holds materials (fur, belly, inner, nose, dark, iris, whisker),
 * `o` options: slit pupils, tail thickness, ear style, and an `extras` hook for faction gear.
 */
function buildCat(m, o = {}) {
  const cat = new THREE.Group();
  const rig = new THREE.Group(); rig.name = 'rig'; cat.add(rig);

  // body: chest + hips make a bean; a soft belly patch and a neck ruff
  put(rig, sph(0.215, 1, 0.93, 1.08), m.fur, [0, 0.02, 0.1]);
  put(rig, sph(0.2, 1, 0.94, 1.1), m.fur, [0, 0.0, -0.13]);
  put(rig, sph(0.17, 0.9, 0.8, 1.25), m.belly, [0, -0.06, 0.04]);
  put(rig, sph(0.15, 1.05, 1, 0.9), m.fur, [0, 0.13, 0.21]);
  put(rig, sph(0.11, 1.2, 0.9, 0.7), m.belly, [0, 0.07, 0.29]);

  // front legs and paws
  for (const s of [1, -1]) {
    put(rig, cap(0.055, 0.15), m.fur, [0.105 * s, -0.17, 0.2]);
    put(rig, sph(0.068, 1, 0.55, 1.3), m.belly, [0.105 * s, -0.285, 0.225]);
    // haunch, shin, back paw
    put(rig, sph(0.115, 0.75, 1, 1.15), m.fur, [0.135 * s, -0.06, -0.15]);
    put(rig, cap(0.048, 0.07), m.fur, [0.14 * s, -0.215, -0.19], [0.35, 0, 0]);
    put(rig, sph(0.065, 1, 0.55, 1.3), m.belly, [0.14 * s, -0.285, -0.155]);
  }

  // head
  const head = new THREE.Group(); head.name = 'head'; head.position.set(0, 0.25, 0.31); rig.add(head);
  put(head, sph(0.195, 1.12, 0.95, 0.98), m.fur, [0, 0, 0]);
  for (const s of [1, -1]) put(head, sph(0.095, 1.15, 0.8, 0.9), m.fur, [0.12 * s, -0.07, 0.05]);    // cheek fluff
  for (const s of [1, -1]) put(head, sph(0.055, 1.1, 0.85, 0.9), m.belly, [0.036 * s, -0.075, 0.165]); // whisker pads
  put(head, sph(0.04, 1.2, 0.8, 1), m.belly, [0, -0.115, 0.14]);                                       // chin
  put(head, sph(0.022, 1.45, 0.9, 0.85), m.nose, [0, -0.044, 0.198]);                                  // nose
  // the little "w" mouth
  const mouth = new THREE.CatmullRomCurve3([[-0.042, -0.098, 0.192], [-0.021, -0.112, 0.205], [0, -0.1, 0.212], [0.021, -0.112, 0.205], [0.042, -0.098, 0.192]].map((p) => new THREE.Vector3(...p)));
  put(head, new THREE.TubeGeometry(mouth, 16, 0.0055, 5), m.dark, [0, 0, 0]);

  // ears: rounded, flattened cones with a pink inner, pivoting from the base
  for (const s of [1, -1]) {
    const ear = new THREE.Group(); ear.name = s > 0 ? 'earR' : 'earL';
    ear.position.set(0.112 * s, 0.13, -0.02);
    ear.rotation.set(-0.12, 0, -0.32 * s);
    head.add(ear);
    put(ear, new THREE.ConeGeometry(0.085, 0.19, 14).scale(1, 1, 0.5).translate(0, 0.095, 0), m.fur, [0, 0, 0]);
    put(ear, new THREE.ConeGeometry(0.055, 0.13, 12).scale(1, 1, 0.4).translate(0, 0.07, 0), m.inner, [0, 0.005, 0.022]);
    if (o.earExtra) o.earExtra(ear, s);
  }

  // eyes: a dark socket, a painted iris disc that follows the head's curve; blink = squash
  const eyes = new THREE.Group(); eyes.name = 'eyes'; eyes.position.set(0, 0.02, 0.15); head.add(eyes);
  for (const s of [1, -1]) {
    const e = new THREE.Group(); e.position.set(0.075 * s, 0, 0); e.rotation.set(0, 0.32 * s, 0); eyes.add(e);
    put(e, sph(0.056, 1, 1.15, 0.55), m.dark, [0, 0, 0]);
    const iris = put(e, new THREE.CircleGeometry(0.05, 24).scale(1, 1.14, 1), m.iris, [0, 0, 0.0305]);
    iris.name = 'iris';
  }

  // whiskers: three per side, gently curved
  const wp = [];
  for (const s of [1, -1]) for (const [dy, dz] of [[0.008, 0], [-0.012, -0.004], [-0.03, -0.01]]) {
    const a = new THREE.Vector3(0.06 * s, -0.078 + dy, 0.185 + dz);
    const mid = new THREE.Vector3(0.17 * s, -0.07 + dy * 1.8, 0.17 + dz);
    const b = new THREE.Vector3(0.27 * s, -0.08 + dy * 3, 0.13 + dz);
    const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(6);
    for (let k = 0; k < pts.length - 1; k++) wp.push(pts[k], pts[k + 1]);
  }
  const whiskers = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wp), m.whisker);
  whiskers.name = 'whiskers';
  head.add(whiskers);

  // tail: a chain of tapering segments, each a child of the last, so it can wave like a real tail
  const tail = new THREE.Group(); tail.name = 'tail'; tail.position.set(0, 0.04, -0.3); tail.rotation.x = -1.15; rig.add(tail);
  const N = 7, segLen = 0.075, r0 = o.tailThick || 0.042;
  let parent = tail;
  for (let k = 0; k < N; k++) {
    const seg = new THREE.Group(); seg.name = 'tailseg';
    seg.position.y = k === 0 ? 0 : segLen;
    seg.rotation.x = k === 0 ? 0 : -0.2; // a gentle upward curl
    parent.add(seg);
    const rad = r0 * (1 - k / (N + 2));
    put(seg, cap(rad, segLen * 0.8).translate(0, segLen / 2, 0), m.tailMat || m.fur, [0, 0, 0]);
    if (o.tailExtra) o.tailExtra(seg, k, rad);
    parent = seg;
  }
  const tip = new THREE.Group(); tip.name = 'tailtip'; tip.position.y = segLen; parent.add(tip);

  if (o.extras) o.extras({ cat, rig, head, tail, tip, put });
  bake(cat);
  cat.scale.setScalar(1.75);
  return cat;
}

export function buildCatModels() {
  const T = textures();
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  const fur = (opts) => new THREE.MeshPhysicalMaterial({ roughness: 0.78, metalness: 0, sheen: 1, sheenRoughness: 0.55, ...opts });
  const glow = (c, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
  const shared = {
    dark: std({ color: 0x120a1c, roughness: 0.35 }),
    whisker: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  };
  const iris = (tex) => std({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0 });

  // ---- Galactic Cat: starry nebula fur, bubble helmet, jetpack, comet tail ----
  const thrusterMat = glow(0x7ff4ff, 2.2);
  const galactic = buildCat({
    ...shared,
    fur: addRim(fur({ map: T.cosmic, emissiveMap: T.stars, emissive: 0xffffff, emissiveIntensity: 1.1, sheenColor: new THREE.Color(0xc9a6ff) }), 0xd2a8ff, 0.7),
    belly: addRim(fur({ color: 0xb79ae8, emissive: 0x2a1060, emissiveIntensity: 0.25, sheenColor: new THREE.Color(0xffffff) }), 0xe6d6ff, 0.5),
    inner: std({ color: 0xff9be0, emissive: 0x6a1a5a, emissiveIntensity: 0.4, roughness: 0.6 }),
    nose: std({ color: 0xff7ad9, emissive: 0x80205a, roughness: 0.3 }),
    iris: iris(irisTex('#bffcff', '#6a4bff', false, true)),
  }, {
    extras: ({ rig, head, tip, put }) => {
      // glass bubble helmet with a metal collar
      const helmet = put(head, sph(0.3, 1.05, 1, 1.02), new THREE.MeshPhysicalMaterial({ color: 0xc8eaff, transparent: true, opacity: 0.09, roughness: 0.02, clearcoat: 1, envMapIntensity: 1.4, depthWrite: false }), [0, 0.03, 0.02]);
      helmet.name = 'helmet';
      const steel = std({ color: 0xd8dcf0, metalness: 0.85, roughness: 0.28 });
      steel.userData.reflective = true;
      put(head, new THREE.TorusGeometry(0.165, 0.024, 8, 28), steel, [0, -0.16, -0.04], [Math.PI / 2 + 0.2, 0, 0]);
      // jetpack: two tanks with glowing thrusters
      const pack = std({ color: 0xeef0ff, metalness: 0.6, roughness: 0.3 });
      pack.userData.reflective = true;
      const trim = std({ color: 0x6a4bff, metalness: 0.4, roughness: 0.4, emissive: 0x2a1080, emissiveIntensity: 0.6 });
      for (const s of [1, -1]) {
        put(rig, cap(0.045, 0.13), pack, [0.06 * s, 0.17, -0.08], [-0.25, 0, 0]);
        put(rig, new THREE.CylinderGeometry(0.048, 0.048, 0.02, 14), trim, [0.06 * s, 0.24, -0.06], [-0.25, 0, 0]);
        const flame = put(rig, new THREE.ConeGeometry(0.035, 0.11, 10).translate(0, -0.055, 0), thrusterMat, [0.06 * s, 0.08, -0.105], [-0.25, 0, 0]);
        flame.name = 'flame';
      }
      put(rig, new THREE.BoxGeometry(0.1, 0.13, 0.03), pack, [0, 0.17, -0.06], [-0.25, 0, 0]);
      // antenna with a glowing bead
      const ant = new THREE.Group(); ant.name = 'antenna'; ant.position.set(0.1, 0.27, -0.06); head.add(ant);
      put(ant, new THREE.CylinderGeometry(0.007, 0.007, 0.16, 6).translate(0, 0.08, 0), steel, [0, 0, 0]);
      put(ant, sph(0.03), glow(0xff5ad6, 1.6), [0, 0.17, 0]);
      // a little comet star at the tail tip
      const star = put(tip, new THREE.OctahedronGeometry(0.06, 0), glow(0x9ff8ff, 2), [0, 0.03, 0]);
      star.name = 'tailstar';
    },
  });

  // ---- Dino Cat: scaly hide, stegosaurus plates, horns, fangs, slit eyes ----
  const plate = std({ color: 0xff8a1f, emissive: 0x7a2a00, emissiveIntensity: 0.45, roughness: 0.45, flatShading: true });
  const plate2 = std({ color: 0xffc23a, emissive: 0x7a4a00, emissiveIntensity: 0.35, roughness: 0.45, flatShading: true });
  const bone = std({ color: 0xfff6dc, roughness: 0.35 });
  const plateGeo = (sz) => new THREE.ConeGeometry(0.06 * sz, 0.13 * sz, 4).scale(1, 1, 0.35).translate(0, 0.06 * sz, 0);
  const dino = buildCat({
    ...shared,
    fur: addRim(fur({ map: T.scales, roughness: 0.62, sheen: 0.3, sheenColor: new THREE.Color(0xc8ff8a) }), 0xd8ff8a, 0.5),
    belly: addRim(fur({ map: T.belly, roughness: 0.75, sheen: 0.2, sheenColor: new THREE.Color(0xffffff) }), 0xfff0b0, 0.4),
    inner: std({ color: 0x2f6b22, roughness: 0.7 }),
    nose: std({ color: 0x1f4a18, roughness: 0.5 }),
    iris: iris(irisTex('#fff38a', '#ff9a1a', true)),
  }, {
    tailThick: 0.058,
    tailExtra: (seg, k, rad) => { if (k < 6) put(seg, plateGeo(0.75 - k * 0.08), k % 2 ? plate2 : plate, [0, 0.04, -rad * 0.6], [-1.1, 0, 0]); },
    extras: ({ rig, head, put }) => {
      // plates down the spine, alternating colours and sizes
      const spine = [[0.31, 0.27, 0.8], [0.2, 0.25, 1.05], [0.08, 0.24, 1.2], [-0.05, 0.22, 1.1], [-0.17, 0.2, 0.9], [-0.27, 0.15, 0.7]];
      spine.forEach(([z, y, sz], k) => put(rig, plateGeo(sz), k % 2 ? plate2 : plate, [0, y, z], [-0.15 + z * 0.4, 0, 0]));
      // horns and a nose nub
      for (const s of [1, -1]) put(head, new THREE.ConeGeometry(0.024, 0.09, 8).translate(0, 0.045, 0), bone, [0.055 * s, 0.155, 0.07], [0.5, 0, -0.3 * s]);
      put(head, new THREE.ConeGeometry(0.016, 0.045, 8).translate(0, 0.022, 0), bone, [0, -0.03, 0.2], [1.2, 0, 0]);
      // fangs over the lip
      for (const s of [1, -1]) put(head, new THREE.ConeGeometry(0.012, 0.045, 6), bone, [0.03 * s, -0.135, 0.19], [Math.PI + 0.15, 0, 0]);
      // claws on the front paws
      for (const s of [1, -1]) for (const dx of [-0.03, 0, 0.03]) put(rig, new THREE.ConeGeometry(0.009, 0.03, 5), bone, [0.105 * s + dx, -0.3, 0.3], [1.4, 0, 0]);
    },
  });

  // ---- Robo Cat (third player): chrome panels, joints, visor, chest light, antenna ears ----
  // brushed rather than mirror chrome, so it reads silver instead of black away from bright reflections
  const chrome = addRim(std({ map: T.metal, metalness: 0.55, roughness: 0.38, color: 0xdfe6f2 }), 0x9ff0ff, 0.35);
  chrome.userData.reflective = true; // gets live scene reflections on High/Ultra
  const joint = std({ color: 0x2a3140, metalness: 0.8, roughness: 0.35 });
  const robo = buildCat({
    ...shared,
    fur: chrome,
    belly: std({ color: 0x3a4250, metalness: 0.75, roughness: 0.35 }),
    inner: joint,
    nose: glow(0xff3355, 1.4),
    iris: iris(irisTex('#bff8ff', '#26b8ff', false)),
    tailMat: joint,
  }, {
    tailExtra: (seg, k, rad) => put(seg, new THREE.TorusGeometry(rad * 1.05, 0.009, 6, 16), chrome, [0, 0.0, 0], [Math.PI / 2, 0, 0]),
    earExtra: (ear) => {
      const a = new THREE.Group(); a.name = 'antenna'; a.position.set(0, 0.19, 0); ear.add(a);
      put(a, new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6).translate(0, 0.04, 0), joint, [0, 0, 0]);
      put(a, sph(0.018), glow(0xff3355, 1.6), [0, 0.085, 0]);
    },
    extras: ({ rig, head, put }) => {
      // a curved visor across the eyes
      const visor = put(head, new THREE.CylinderGeometry(0.205, 0.205, 0.07, 28, 1, true, -0.85, 1.7), glow(0x26f0ff, 1.6), [0, 0.02, -0.005]);
      visor.name = 'visor';
      head.getObjectByName('eyes').visible = false;
      for (const s of [1, -1]) {
        put(rig, sph(0.05), joint, [0.105 * s, -0.08, 0.2]); // shoulders
        put(rig, sph(0.055), joint, [0.15 * s, -0.12, -0.17]); // hips
      }
      const light = put(rig, new THREE.CircleGeometry(0.035, 20), glow(0x26f0ff, 1.8), [0, 0.06, 0.348]);
      light.name = 'chestlight';
      put(rig, new THREE.TorusGeometry(0.04, 0.01, 8, 20), joint, [0, 0.06, 0.345]);
    },
  });

  return [null, galactic, dino, robo];
}

/** Find the animatable parts on a cloned cat. */
export function catParts(cat) {
  const get = (n) => cat.getObjectByName(n);
  const tailSegs = [], flames = [], antennas = [], irises = [];
  cat.traverse((o) => {
    if (o.name === 'iris') irises.push(o);
    else if (o.name === 'tailseg') tailSegs.push(o);
    else if (o.name === 'flame') flames.push(o);
    else if (o.name === 'antenna') antennas.push(o);
  });
  return {
    rig: get('rig'), head: get('head'), tail: get('tail'), eyes: get('eyes'), earL: get('earL'), earR: get('earR'),
    tailSegs, flames, antennas, irises, tailstar: get('tailstar'), visor: get('visor'), chestlight: get('chestlight'),
  };
}

const VISOR = new THREE.Color(0x26f0ff);

/** Idle life: breathing, a wave travelling down the tail, glances, blinks, ear flicks, gadgets. */
export function animateCat(p, T, excite = 0) {
  const P = p.parts, ph = p.phase;
  if (!P.rig) return;
  const breathe = Math.sin(T * 2.6 + ph);
  P.rig.scale.set(1 - breathe * 0.01, 1 + breathe * 0.022, 1 + breathe * 0.008);
  // tail: a travelling wave, faster and wider when excited (selected)
  const speed = 2.1 + excite * 5, amp = 0.16 + excite * 0.22;
  P.tailSegs.forEach((s, k) => {
    s.rotation.z = Math.sin(T * speed + ph - k * 0.55) * amp;
    if (k) s.rotation.x = -0.2 + Math.sin(T * 1.1 + ph - k * 0.4) * 0.06;
  });
  // head: slow glances with the occasional curious tilt
  // when something is happening (a selection, a hovered move) the cat turns to watch it
  const lw = p.lookW || 0;
  const idleYaw = Math.sin(T * 0.55 + ph * 2) * 0.32 + Math.sin(T * 1.7 + ph) * 0.04;
  // gaze values come from Renderer.gaze(): head spring, body shuffle, irises take the rest
  const hy = p.headYaw || 0;
  P.head.rotation.y = idleYaw * (1 - lw) + hy * lw;
  P.rig.rotation.y = (p.bodyYaw || 0) * lw;
  for (const ir of P.irises) { ir.position.x = (p.lookX || 0) * 0.014 * lw; ir.position.y = (p.lookY || 0) * 0.011 * lw; }
  // a curious tilt that grows while it's watching something
  P.head.rotation.z = Math.sin(T * 0.35 + ph * 3) * 0.08 * (1 - lw * 0.5) - hy * 0.12 * lw;
  P.head.rotation.x = Math.sin(T * 0.8 + ph) * 0.06 * (1 - lw * 0.6) - excite * 0.18 * (1 - lw) - (p.headPitch || 0) * lw;
  // blink every few seconds (a quick squash of the eyes), and on big glances
  if (P.eyes) {
    const cyc = ((T + ph * 3) % 4.1) / 4.1;
    p.blink = Math.max(0, (p.blink || 0) - 1 / 60 / 0.11);
    P.eyes.scale.y = cyc < 0.035 || p.blink > 0 ? 0.1 : 1;
  }
  // ear flicks, each ear on its own clock
  const flick = (t) => (t % 3.3 < 0.12 ? Math.sin((t % 3.3) / 0.12 * Math.PI) * 0.45 : 0);
  if (P.earL) P.earL.rotation.z = 0.32 + flick(T * 0.8 + ph);
  if (P.earR) P.earR.rotation.z = -0.32 - flick(T * 0.7 + ph * 1.7 + 1);
  // gadgets
  for (const a of P.antennas) a.rotation.z = Math.sin(T * 4 + ph) * 0.22;
  for (const f of P.flames) f.scale.set(1, 0.7 + Math.random() * 0.6 + excite * 0.6, 1);
  if (P.tailstar) { P.tailstar.rotation.y = T * 3; P.tailstar.scale.setScalar(1 + Math.sin(T * 6 + ph) * 0.25); }
  if (P.visor) P.visor.material.color.copy(VISOR).multiplyScalar(1.2 + Math.abs(Math.sin(T * 2)) * 0.8);
  if (P.chestlight) P.chestlight.visible = (T + ph) % 1.6 > 0.25;
}
