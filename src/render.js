// Three.js scene: glass hex tiles floating over a starfield, gem pieces, bloom and particles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { QUALITY, SKIES, FILTERS, GpuParticles, makeDust, godRaysShader, gradeShader, skyMaterial, paintMaterial } from './gfx.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldX, worldZ, HOLE, own, lvl } from './rules.js';
import { buildCatModels, catParts, animateCat } from './cats.js';

export const PLAYER_COLORS = [null, 0xff2d55, 0xbfe0ff, 0x1dffa0];
const PIECE_Y = 0.52;

const ease = {
  linear: (t) => t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cloudTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let k = 0; k < 14; k++) {
    const x = 34 + Math.random() * 60, y = 34 + Math.random() * 60, r = 18 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(150,140,220,0.22)'); grd.addColorStop(1, 'rgba(150,140,220,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const castAll = (o) => o.traverse((m) => { if (m.isMesh && !m.material.transparent) m.castShadow = true; });

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function hexShape(r) {
  const s = new THREE.Shape();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    k ? s.lineTo(r * Math.cos(a), r * Math.sin(a)) : s.moveTo(r * Math.cos(a), r * Math.sin(a));
  }
  s.closePath();
  return s;
}

function makePieceGeometries() {
  // Ruby: brilliant cut (crown + pavilion), flat shaded.
  const crown = new THREE.CylinderGeometry(0.24, 0.4, 0.16, 8, 1);
  crown.translate(0, 0.08, 0);
  const table = new THREE.CylinderGeometry(0.0, 0.24, 0.001, 8, 1); table.translate(0, 0.16, 0);
  const pav = new THREE.CylinderGeometry(0.4, 0.0, 0.42, 8, 1);
  pav.translate(0, -0.21, 0);
  let ruby = mergeGeometries([crown.toNonIndexed(), table.toNonIndexed(), pav.toNonIndexed()]);
  ruby.computeVertexNormals();
  ruby.translate(0, 0.05, 0);
  const pearl = new THREE.SphereGeometry(0.33, 48, 32);
  const jade = new THREE.IcosahedronGeometry(0.36, 0).toNonIndexed();
  jade.computeVertexNormals();
  for (const g of [ruby, pearl, jade]) g.scale(1.4, 1.4, 1.4);
  return [null, ruby, pearl, jade];
}

function makePieceMaterials() {
  return [
    null,
    new THREE.MeshPhysicalMaterial({ color: 0xe8002e, emissive: 0x5a000f, emissiveIntensity: 1, metalness: 0.25, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, ior: 2.4, envMapIntensity: 1.3, flatShading: true }),
    new THREE.MeshPhysicalMaterial({ color: 0xa9b3cc, emissive: 0x080b18, emissiveIntensity: 1, metalness: 0.0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, iridescence: 1, iridescenceIOR: 1.4, iridescenceThicknessRange: [250, 650], sheen: 1, sheenColor: 0x7fb8ff, sheenRoughness: 0.4, envMapIntensity: 0.8 }),
    new THREE.MeshPhysicalMaterial({ color: 0x00c973, emissive: 0x004a26, emissiveIntensity: 1, metalness: 0.25, roughness: 0.06, clearcoat: 1, ior: 1.6, envMapIntensity: 1.3, flatShading: true }),
  ];
}

export class Renderer {
  constructor(host, { mobile = false } = {}) {
    this.mobile = mobile;
    this.host = host;
    this.speed = 1;
    this.tweens = [];
    this.particles = [];
    this.tiles = [];
    this.rings = [];
    this.mists = [];
    this.pieces = [];
    this.labels = [];
    this.bubbles = [];
    this.theme = 'gems';
    this.layerTags = [];
    this.spread = 1;
    this.focus = -1;
    this.fogMask = null;
    this.pickFilter = null;
    this.handlers = { hover: () => {}, click: () => {}, rightClick: () => {} };
    this.clock = new THREE.Clock();
    this.time = 0;
    this.glowTarget = new THREE.Color(0x3a2a80);

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    // phones have 3x screens but small GPUs: 1.5x looks just as sharp at a fraction of the cost
    this.maxDpr = Math.min(devicePixelRatio, mobile ? 1.5 : 2);
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.dpr);
    r.setSize(host.clientWidth, host.clientHeight);
    // AgX keeps saturated faction colours from clipping to white the way ACES does
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x06041a);
    scene.fog = new THREE.FogExp2(0x0a0626, 0.009);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(36, host.clientWidth / host.clientHeight, 0.1, 400);
    this.camera.position.set(0, 18, 16);
    this.baseFov = 36;
    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.enableDamping = true; c.dampingFactor = 0.08; c.enablePan = false;
    c.minDistance = 9; c.maxDistance = 40; c.minPolarAngle = 0.15; c.maxPolarAngle = 1.2;
    c.rotateSpeed = 0.6; c.zoomSpeed = 0.8;

    // Lighting: warm key with soft shadows (gives everything weight), cool sky fill,
    // and two faction-coloured rims sweeping around the board.
    this.hemi = new THREE.HemisphereLight(0x8a7cff, 0x140a24, 0.55);
    scene.add(this.hemi);
    this.skyFlash = 0;
    this.nextStorm = performance.now() + 4000;
    const key = (this.key = new THREE.DirectionalLight(0xfff0dc, 2.6));
    key.position.set(-7, 16, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    key.shadow.radius = 5;
    key.shadow.blurSamples = 12;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    scene.add(key, key.target);
    this.rimA = new THREE.PointLight(0xb07aff, 55, 40, 1.6); scene.add(this.rimA);
    this.rimB = new THREE.PointLight(0x8dff4a, 40, 40, 1.6); scene.add(this.rimB);

    this.boardGroup = new THREE.Group(); scene.add(this.boardGroup);
    this.pieceGroup = new THREE.Group(); scene.add(this.pieceGroup);
    this.fxGroup = new THREE.Group(); scene.add(this.fxGroup);

    this.addStarfield();
    this.underglow = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,255,255,0.55)'], [0.35, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']]), color: 0x3a2a80, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.underglow.rotation.x = -Math.PI / 2; this.underglow.position.y = -4;
    scene.add(this.underglow);

    // ---- post-processing chain ----
    // scene → ambient occlusion → bloom → depth of field → god rays → tone map → grade
    const W = host.clientWidth, H = host.clientHeight;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, this.camera));
    // ambient occlusion: soft contact shadows in every crease, under every cat (High/Ultra)
    this.gtao = new GTAOPass(scene, this.camera, W, H);
    this.gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 10 });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);
    // bloom at half resolution: it is a blur anyway, and this halves its cost
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.55, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    // depth of field: only during cinematic moments and in photo mode
    this.bokeh = new BokehPass(scene, this.camera, { focus: 20, aperture: 0.0025, maxblur: 0.01 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);
    // god rays: light scattering toward the key light, in linear HDR before tone mapping
    this.rays = new ShaderPass(godRaysShader());
    this.composer.addPass(this.rays);
    this.composer.addPass(new OutputPass());
    // final grade, in display space: vignette, fringing, grain, shockwave ripples, glitch, filters
    this.grade = new ShaderPass(gradeShader());
    this.composer.addPass(this.grade);
    this.fps = { frames: 0, t0: performance.now(), value: 60, slow: 0 };
    this.ripIdx = 0;
    this.glitch = 0;

    // virtual time: animations, particles and idle life run on it, so the director can slow it
    this.timeScale = 1;
    this.vnow = performance.now();

    this.pieceGeo = makePieceGeometries();
    this.pieceMat = makePieceMaterials();
    this.shadowTex = radialTexture([[0, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0)']]);
    this.sparkTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
    // GPU particles (sparks, embers, confetti) and drifting dust motes
    this.gpu = new GpuParticles(24000, this.sparkTex);
    scene.add(this.gpu.points);
    this.dust = makeDust(900, this.sparkTex);
    scene.add(this.dust.points);
    // live reflections: a cube camera snapshots the real scene for glossy surfaces (High/Ultra)
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(0.5, 300, this.cubeRT);
    this.cubeCam.position.set(0, 2.2, 0);
    scene.add(this.cubeCam);
    this.reflectAt = 0;
    this.lookTarget = null;
    this.cloudTex = cloudTexture();
    this.tileGeo = (() => {
      const g = new THREE.ExtrudeGeometry(hexShape(0.8), { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.07, bevelSegments: 3 });
      g.rotateX(-Math.PI / 2); g.translate(0, -0.28, 0);
      return g;
    })();
    this.paintGeo = new THREE.CircleGeometry(0.74, 6); this.paintGeo.rotateX(-Math.PI / 2);
    this.voidTex = radialTexture([[0, 'rgba(0,0,0,1)'], [0.6, 'rgba(10,0,30,0.95)'], [1, 'rgba(60,20,140,0)']]);
    this.ringGeo = new THREE.RingGeometry(0.74, 0.9, 6, 1);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.holeGeo = new THREE.RingGeometry(0.55, 0.88, 6, 1); this.holeGeo.rotateX(-Math.PI / 2);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverCell = -1;
    this.setupInput();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  addStarfield() {
    const N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const tint = [new THREE.Color(0xffffff), new THREE.Color(0xa8c8ff), new THREE.Color(0xffb8d8), new THREE.Color(0xc8a8ff)];
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(70 + Math.random() * 110);
      if (v.y > 25 && Math.random() < 0.6) v.y = -v.y; // more stars below, under the board
      pos.set([v.x, v.y, v.z], i * 3);
      const t = tint[i % 4].clone().multiplyScalar(0.4 + Math.random() * 0.8);
      col.set([t.r, t.g, t.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.7, map: this.sparkTex || radialTexture([[0, '#fff'], [1, 'rgba(255,255,255,0)']]), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.scene.add(this.stars);
  }

  setDpr(v) {
    this.dpr = Math.max(0.75, Math.min(this.maxDpr, v));
    this.renderer.setPixelRatio(this.dpr);
    this.composer.setPixelRatio?.(this.dpr);
    this.resize();
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.updatePointScale();
    this.fitCamera(false);
  }

  /** Point sprites are sized in world units: pixels per unit at distance 1. */
  updatePointScale() {
    const h = this.host.clientHeight * this.renderer.getPixelRatio();
    const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.gpu.uniforms.uScale.value = s;
    this.dust.uniforms.uScale.value = s;
  }

  on(name, fn) { this.handlers[name] = fn; }

  setupInput() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointermove', (e) => {
      this.setPointer(e);
      const c = this.pick();
      if (c !== this.hoverCell) { this.hoverCell = c; this.handlers.hover(c); }
      el.style.cursor = c >= 0 ? 'pointer' : 'grab';
    });
    // Capture phase, so a press on your own piece can switch off camera orbiting before
    // OrbitControls (a bubble-phase listener on the same element) starts a rotation.
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, b: e.button, drag: false };
      if (e.button !== 0) return;
      this.setPointer(e);
      if (this.handlers.down?.(this.pick())) {
        down.drag = true;
        this.controls.enabled = false;
        el.style.cursor = 'grabbing';
      }
    }, { capture: true });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      this.setPointer(e);
      if (moved < 7) {
        if (down.b === 2) this.handlers.rightClick();
        else this.handlers.click(this.pick());
      } else if (down.drag) this.handlers.drop?.(this.pick());
      if (down.drag) this.controls.enabled = true;
      down = null;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // The cats watch the cursor wherever it is on screen, menus included.
    this.cursorNdc = new THREE.Vector2();
    this.cursorAt = 0;
    this.cursorRay = new THREE.Raycaster();
    this.cursorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.45);
    this.cursorPt = new THREE.Vector3();
    const track = (e) => {
      const r = el.getBoundingClientRect();
      this.cursorNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.cursorAt = performance.now();
      this.cursorTouch = e.pointerType === 'touch';
    };
    window.addEventListener('pointermove', track, { passive: true });
    window.addEventListener('pointerdown', track, { passive: true });
    document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) this.cursorAt = 0; });
    window.addEventListener('blur', () => { this.cursorAt = 0; });
  }

  /** Where the cursor points on the board, and how much the cats care (fades once it stops moving). */
  cursorPoint() {
    if (this.photo || !this.cursorAt) return { cursor: null, attention: 0 };
    const idle = performance.now() - this.cursorAt;
    const span = this.cursorTouch ? 2500 : 7000;
    if (idle > span) return { cursor: null, attention: 0 };
    this.cursorRay.setFromCamera(this.cursorNdc, this.camera);
    const hit = this.cursorRay.ray.intersectPlane(this.cursorPlane, this.cursorPt);
    if (!hit) return { cursor: null, attention: 0 };
    // keep far-off points (cursor near the horizon) from dragging every head sideways
    const len = Math.hypot(hit.x, hit.z), cap = 14;
    if (len > cap) hit.multiplyScalar(cap / len).setY(0.45);
    return { cursor: hit, attention: Math.min(1, (span - idle) / (span * 0.35)) };
  }

  /**
   * Natural gaze for one cat. Events (a selection, a move) win over the cursor.
   * The eyes snap toward the target first, then the head follows on a soft spring
   * that overshoots slightly. For a target off to the side the body shuffles round a little.
   * Each cat reacts at its own speed and sometimes gets bored and looks away.
   * Targets behind the cat are out of reach, so it doesn't twist round for them.
   * A cursor right on top of a cat makes it look up at you (the camera).
   */
  gaze(p, cursor, attention, rdt, T) {
    const o = p.obj.position, ph = p.phase || 0;
    const L = (p.lvlScale || 1) * (p.baseScale || 1);
    const headY = o.y + 0.55 * L;
    let tgt = this.lookTarget, want = 0;
    if (tgt) want = 1;
    else if (cursor) {
      tgt = cursor;
      const d = Math.hypot(cursor.x - o.x, cursor.z - o.z);
      if (d < 0.55 * Math.max(1, L)) tgt = this.camera.position; // hovering me: look at the player
      // interest drifts on each cat's own slow clock
      const b = Math.sin(T * 0.21 + ph * 5.1) + Math.sin(T * 0.13 + ph * 2.3) * 0.6;
      const interest = Math.max(0, Math.min(1, (1.25 - b) / 0.35));
      want = attention * interest * (d < 9 ? 1 : 0.7);
    }
    let yaw = 0, pitch = 0;
    if (tgt) {
      const dx = tgt.x - o.x, dz = tgt.z - o.z, dist = Math.hypot(dx, dz);
      if (dist > 0.2) {
        yaw = Math.atan2(dx, dz) - (p.yaw || 0);
        yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      }
      pitch = Math.atan2(tgt.y - headY, Math.max(dist, 0.3));
      const behind = Math.abs(yaw);
      if (behind > 2.0) want *= Math.max(0, (2.5 - behind) / 0.5); // can't see back there
    }
    // weight: quick to notice, slower to lose interest
    const w0 = p.lookW || 0;
    p.lookW = w0 + (want - w0) * Math.min(1, rdt * (want > w0 ? 5 : 1.6));
    if (!tgt) return this.relaxGaze(p, rdt);
    const total = Math.max(-1.7, Math.min(1.7, yaw));
    // eyes: fast, almost a saccade; a big jump earns a blink
    const ex = p.eyeYaw ?? 0;
    if (Math.abs(total - ex) > 0.7 && T - (p.lastBlink || -9) > 0.6 && p.lookW > 0.4) { p.blink = 1; p.lastBlink = T; }
    p.eyeYaw = ex + (total - ex) * Math.min(1, rdt * 16);
    // body: shuffles round only for targets well off to the side
    const bodyWant = Math.sign(total) * Math.max(0, Math.abs(total) - 0.85) * 0.8 * p.lookW;
    p.bodyYaw = (p.bodyYaw || 0) + (bodyWant - (p.bodyYaw || 0)) * Math.min(1, rdt * 1.8);
    // head: a damped spring chasing what the eyes see, minus what the body already turned
    const k = 32 + ((ph * 97) % 1) * 22, c = 2 * Math.sqrt(k) * 0.72;
    const headWant = Math.max(-0.95, Math.min(0.95, p.eyeYaw - p.bodyYaw));
    p.headV = (p.headV || 0) + ((headWant - (p.headYaw || 0)) * k - (p.headV || 0) * c) * Math.min(rdt, 0.05);
    p.headYaw = (p.headYaw || 0) + p.headV * Math.min(rdt, 0.05);
    // looking down hides the eyes behind the brow, so the head dips only a little and the irises do the rest
    const pw = Math.max(-0.22, Math.min(0.5, pitch * (pitch < 0 ? 0.4 : 0.75)));
    p.headPitch = (p.headPitch || 0) + (pw - (p.headPitch || 0)) * Math.min(1, rdt * 6);
    // what's left over after the head turns goes to the irises
    p.lookX = Math.max(-1, Math.min(1, (p.eyeYaw - p.headYaw - p.bodyYaw) / 0.45));
    p.lookY = Math.max(-1, Math.min(1, (pitch - p.headPitch) / 0.4));
  }

  relaxGaze(p, rdt) {
    const r = Math.min(1, rdt * 2.5);
    p.bodyYaw = (p.bodyYaw || 0) * (1 - r);
    p.eyeYaw = (p.eyeYaw || 0) * (1 - r);
    p.lookX = (p.lookX || 0) * (1 - r);
    p.lookY = (p.lookY || 0) * (1 - r);
  }

  setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objs = [
      ...this.tiles.filter((t) => t && t.visible && !t.userData.dim),
      ...this.pieces.filter((p) => p && p.obj.visible).map((p) => p.mesh),
    ];
    const hits = this.raycaster.intersectObjects(objs, false);
    if (!hits.length) return -1;
    // With stacked layers the ray passes through several cells: prefer one the game cares about.
    if (this.pickFilter) {
      const good = hits.find((h) => this.pickFilter(h.object.userData.cell));
      if (good) return good.object.userData.cell;
    }
    return hits[0].object.userData.cell;
  }

  // ---------- multi-dimensional layout ----------
  get layerGap() { return 3.2 * this.spread; }
  worldGap() { return this.board.R * 3.4 + 4.5; }
  /** Floor position of a cell: hex plane, layer height (top layer highest), world side-by-side. */
  posOf(i) {
    const c = this.board.cells[i], B = this.board;
    const y = B.L > 1 ? ((B.L - 1) / 2 - c.z) * this.layerGap : 0;
    const x = B.W > 1 ? (c.w - (B.W - 1) / 2) * this.worldGap() : 0;
    return new THREE.Vector3(worldX(c) * 1.02 + x, y, worldZ(c) * 1.02);
  }
  at(i, dy = 0) { const v = this.posOf(i); v.y += dy; return v; }
  get multi() { return this.board && (this.board.L > 1 || this.board.W > 1); }

  setSpread(v) {
    const from = this.spread;
    this.tween(500, (t) => { this.spread = from + (v - from) * t; this.relayout(); }, ease.inOut, true);
  }

  /** Re-place every board object after the layer spacing changes. */
  relayout() {
    this.board.cells.forEach((_, i) => {
      if (this.tiles[i]) this.tiles[i].position.copy(this.at(i, 0));
      if (this.holes?.[i]) this.holes[i].position.copy(this.at(i, -0.2));
      this.rings[i].position.copy(this.at(i, 0.03));
      this.mists[i].position.copy(this.at(i, 0.6));
      const p = this.pieces[i];
      if (p && !p.moving) p.obj.position.copy(this.at(i, PIECE_Y));
    });
    this.buildPillars();
    for (const t of this.layerTags) t.pos.copy(t.anchor());
  }

  /** Faint columns joining each cell to the one directly above it, so the stacking reads. */
  buildPillars() {
    if (this.pillars) { this.boardGroup.remove(this.pillars); this.pillars.geometry.dispose(); this.pillars = null; }
    if (!this.multi) return;
    const B = this.board, pts = [];
    const byKey = new Map(B.cells.map((c, i) => [`${c.q},${c.r},${c.z},${c.w}`, i]));
    B.cells.forEach((c, i) => {
      const j = byKey.get(`${c.q},${c.r},${c.z + 1},${c.w}`);
      if (j === undefined || !this.layerShown(c.z) || !this.layerShown(c.z + 1)) return;
      pts.push(this.at(i, -0.3), this.at(j, 0.02));
    });
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    this.pillars = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x6a5cff, transparent: true, opacity: 0.16, depthWrite: false }));
    this.boardGroup.add(this.pillars);
  }

  layerShown(z) { return this.focus < 0 || this.focus === z; }

  /** Show only layer z (or every layer with -1). Other layers fade to ghosts and can't be clicked. */
  setFocus(z) {
    this.focus = z;
    this.applyVisibility();
    this.buildPillars();
  }

  applyVisibility() {
    if (!this.board) return;
    const mask = this.fogMask;
    this.board.cells.forEach((c, i) => {
      const shown = this.layerShown(c.z);
      const hidden = mask && !mask[i];
      const t = this.tiles[i];
      if (t) {
        t.userData.dim = !shown;
        t.material.transparent = !shown || this.multi;
        t.material.opacity = !shown ? 0.07 : this.multi ? 0.88 : 1;
        t.material.depthWrite = shown;
        t.children[0].material.opacity = shown ? 0.35 : 0.06;
        t.material.color.copy(t.userData.base).multiplyScalar(hidden ? 0.25 : 1);
      }
      if (this.holes?.[i]) this.holes[i].visible = shown;
      if (this.pieces[i]) this.pieces[i].obj.visible = shown && !hidden;
      const m = this.mists[i];
      m.visible = shown && !!hidden; m.userData.target = hidden ? 0.9 : 0;
      if (!shown) this.rings[i].visible = false;
    });
    for (const t of this.layerTags) t.el.classList.toggle('off', !this.layerShown(t.z));
  }

  /** Glowing threads from a selected cell to targets in other layers / worlds. */
  links(from, list) {
    this.clearLinks();
    const c0 = this.board.cells[from];
    const pts = [];
    for (const { to, jump } of list) {
      const c = this.board.cells[to];
      if (c.z === c0.z && c.w === c0.w) continue;
      if (!this.layerShown(c.z)) continue;
      const a = this.at(from, PIECE_Y), b = this.at(to, 0.1);
      // bow the thread outwards so vertical links don't hide behind the piece
      const mid = a.clone().lerp(b, 0.5); mid.x += (c.w !== c0.w ? 0 : 0.6); mid.y += c.w !== c0.w ? 2.5 : 0;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(16);
      for (let k = 0; k < curve.length - 1; k++) pts.push(curve[k], curve[k + 1]);
      void jump;
    }
    if (!pts.length) return;
    this.linkLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }));
    this.fxGroup.add(this.linkLines);
  }
  clearLinks() {
    if (this.linkLines) { this.fxGroup.remove(this.linkLines); this.linkLines.geometry.dispose(); this.linkLines = null; }
  }

  buildLayerTags() {
    for (const t of this.layerTags || []) t.el.remove();
    this.layerTags = [];
    if (!this.multi) return;
    const B = this.board, greek = ['α', 'β', 'γ', 'δ'];
    for (let w = 0; w < B.W; w++) for (let z = 0; z < B.L; z++) {
      // anchor at the left-most cell of that plane
      const anchor = () => {
        let best = null;
        B.cells.forEach((c, i) => {
          if (c.z !== z || c.w !== w) return;
          const p = this.at(i, 0);
          if (!best || p.x < best.x) best = p;
        });
        best.x -= 1.6;
        return best;
      };
      const el = document.createElement('div');
      el.className = 'layer-tag';
      el.textContent = (B.W > 1 ? `${greek[w]} · ` : '') + `L${z + 1}`;
      document.getElementById('labels').appendChild(el);
      this.layerTags.push({ el, z, w, anchor, pos: anchor() });
    }
  }

  // ---------- board ----------
  build(board, state) {
    this.board = board;
    for (const g of [this.boardGroup, this.pieceGroup, this.fxGroup]) {
      while (g.children.length) g.remove(g.children[0]);
    }
    this.tiles = []; this.rings = []; this.mists = []; this.pieces = []; this.particles = []; this.tweens = [];
    this.holes = []; this.pillars = null; this.linkLines = null;
    this.focus = -1; this.spread = 1; this.fogMask = null;
    this.clearLabels();
    board.cells.forEach((c, i) => {
      const p = this.posOf(i);
      // indicator ring (selection / targets / previews)
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
      ring.position.copy(this.at(i, 0.03)); ring.visible = false; ring.userData = { cell: i, pulse: 0 };
      this.boardGroup.add(ring); this.rings[i] = ring;
      const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloudTex, transparent: true, opacity: 0, depthWrite: false }));
      mist.position.copy(this.at(i, 0.6)); mist.scale.setScalar(2.6); mist.visible = false; mist.material.rotation = Math.random() * 6;
      this.boardGroup.add(mist); this.mists[i] = mist;
      if (state[i] === HOLE) { this.addHole(i); return; }
      this.addTile(i);
    });
    this.sync(state);
    this.buildPillars();
    this.buildLayerTags();
    this.buildIsland();
    this.fitShadow();
    this.applyVisibility();
    this.fitCamera(true);
  }

  /** Ground the board: a floating rock island under a flat board, with faction crystals. */
  buildIsland() {
    if (this.multi) return;
    const R = this.board.R;
    const rad = Math.sqrt(3) * R * 1.02 + 1.35; // the board's own hexagon, plus a rim
    const rock = new THREE.MeshStandardMaterial({ color: new THREE.Color('#150f2a'), roughness: 0.95, metalness: 0, flatShading: true });
    const rim = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#1c1638'), roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, flatShading: true });
    this.rimMat = rim;
    const island = new THREE.Group();
    island.name = 'island';
    // the slab the tiles sit in (pointy-top hexagon, matching the board outline)
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.97, 0.55, 6, 1), rim);
    slab.position.y = -0.58; slab.receiveShadow = true; slab.castShadow = false;
    island.add(slab);
    // a craggy underside: a cone with jittered vertices, darker and rougher further down
    const cone = new THREE.CylinderGeometry(rad * 0.96, 0.6, rad * 1.15, 12, 6);
    const pos = cone.attributes.position, rnd = mulberry(R * 7 + 3);
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      if (y > rad * 0.5) continue; // keep the top rim clean
      const s = 1 + (rnd() - 0.5) * 0.28;
      pos.setX(k, pos.getX(k) * s); pos.setZ(k, pos.getZ(k) * s); pos.setY(k, y + (rnd() - 0.5) * 0.6);
    }
    cone.computeVertexNormals();
    const under = new THREE.Mesh(cone, rock);
    under.position.y = -0.86 - rad * 0.575;
    island.add(under);
    // crystals growing out of the rock: violet on the Galactic side, green on the Dino side
    const cg = new THREE.OctahedronGeometry(0.5, 0);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + rnd() * 0.3;
      const left = Math.cos(a) < 0;
      const c = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({
        color: left ? 0x9a6bff : 0x7fe34b, emissive: left ? 0x5a2bd0 : 0x3a9a10, emissiveIntensity: 1.4, roughness: 0.25, flatShading: true,
      }));
      const d = rad * (0.75 + rnd() * 0.18), y = -1.2 - rnd() * rad * 0.7;
      c.position.set(Math.cos(a) * d * (1 + y / (rad * 2.2)), y, Math.sin(a) * d * (1 + y / (rad * 2.2)));
      c.scale.set(0.6 + rnd() * 0.5, 1.4 + rnd() * 1.6, 0.6 + rnd() * 0.5);
      c.rotation.set((rnd() - 0.5) * 0.9, rnd() * 3, Math.PI + (rnd() - 0.5) * 0.9);
      island.add(c);
    }
    this.boardGroup.add(island);
    this.island = island;
  }

  /** Size the key light's shadow camera to the board so shadows stay crisp. */
  fitShadow() {
    const box = new THREE.Box3();
    this.board.cells.forEach((_, i) => box.expandByPoint(this.posOf(i)));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, size.y) * 0.62 + 2.5;
    const cam = this.key.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 60;
    cam.updateProjectionMatrix();
    this.key.target.position.copy(c);
    this.key.position.copy(c).add(new THREE.Vector3(-7, 16, 9));
  }

  /** A quick camera "punch" (field-of-view kick) for big moments. */
  punch(strength = 1) {
    const f0 = this.baseFov;
    this.tween(380, (t) => {
      this.camera.fov = f0 - Math.sin(t * Math.PI) * 2.2 * strength;
      this.camera.updateProjectionMatrix();
    }, (t) => t, true);
  }

  /** Render each faction's piece to a transparent PNG for the UI: real faces instead of emoji. */
  portraits(theme) {
    const size = 256;
    const rr = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    rr.setSize(size, size); rr.setPixelRatio(1);
    rr.toneMapping = THREE.AgXToneMapping; rr.toneMappingExposure = 1.25;
    const sc = new THREE.Scene();
    sc.environment = this.scene.environment;
    sc.add(new THREE.HemisphereLight(0xbfb0ff, 0x302040, 1.4));
    const k = new THREE.DirectionalLight(0xffffff, 2.6); k.position.set(-2, 3, 4); sc.add(k);
    const rimL = new THREE.DirectionalLight(0xb07aff, 2); rimL.position.set(3, 1, -2); sc.add(rimL);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    const out = [null];
    const protos = theme === 'cats' ? (this.catProto || buildCatModels()) : null;
    for (let p = 1; p <= 3; p++) {
      const o = protos ? protos[p].clone() : new THREE.Mesh(this.pieceGeo[p], this.pieceMat[p]);
      o.rotation.y = protos ? -0.45 : 0.4;
      sc.add(o);
      // head-and-shoulders, three-quarter view: the face is what the UI needs
      if (protos) { cam.position.set(1.05, 1.05, 3.5); cam.lookAt(0.05, 0.3, 0.2); }
      else { cam.position.set(0, 0.5, 1.9); cam.lookAt(0, 0, 0); }
      rr.render(sc, cam);
      out.push(rr.domElement.toDataURL('image/png'));
      sc.remove(o);
    }
    rr.dispose();
    rr.forceContextLoss?.();
    return out;
  }

  addTile(i) {
    const p = this.posOf(i), c = this.board.cells[i];
    // Tiles are carved slate: matte, slightly varied, lit by the key light and catching shadows.
    // colours are given in sRGB (as a designer would pick them); three converts them to linear
    const col = new THREE.Color('#2b2552').offsetHSL(0, 0, 0.022 * ((c.q - c.r + 30) % 3) - 0.02 + Math.sin(i * 12.9898) * 0.008);
    // crystal: a glossy coat over dark gem-stone, an inner glow in the owner's colour (emissive),
    // faint iridescence, and on Ultra real refraction (transmission)
    const mat = new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.05, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12, emissive: 0x000000, envMapIntensity: 0.7 });
    const t = new THREE.Mesh(this.tileGeo, mat);
    t.receiveShadow = true;
    t.position.copy(p); t.userData = { cell: i, base: mat.color.clone(), owner: 0, paintT: 1, glow: 0, flash: 0, wet: 0 };
    this.styleTile(t);
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 6 }, (_, k) => new THREE.Vector3(0.86 * Math.cos((k * Math.PI) / 3), 0.005, 0.86 * Math.sin((k * Math.PI) / 3)))),
      new THREE.LineBasicMaterial({ color: 0xc8b8ff, transparent: true, opacity: 0.16 })
    );
    t.add(edge);
    // Territory paint: an inset hex in the owner's colour that washes outward when a cell changes hands.
    const paint = new THREE.Mesh(this.paintGeo, paintMaterial());
    paint.position.y = 0.012; paint.name = 'paint';
    t.add(paint);
    this.boardGroup.add(t);
    this.tiles[i] = t;
    if (this.holes?.[i]) { this.boardGroup.remove(this.holes[i]); this.holes[i] = null; }
  }

  addHole(i) {
    this.holes = this.holes || [];
    // A hole is a little rift: a dark void with a breathing violet lip.
    const h = new THREE.Mesh(this.holeGeo, new THREE.MeshBasicMaterial({ color: 0x8a5bff, transparent: true, opacity: 0.22, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
    h.position.copy(this.at(i, -0.2));
    h.userData = { hole: true, phase: Math.random() * 6 };
    const voidDisc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.voidTex, transparent: true, depthWrite: false }));
    voidDisc.position.y = -0.03;
    h.add(voidDisc);
    this.boardGroup.add(h);
    this.holes[i] = h;
  }

  fitCamera(animate) {
    if (!this.board) return;
    const box = new THREE.Box3();
    this.board.cells.forEach((_, i) => box.expandByPoint(this.posOf(i)));
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const aspect = this.camera.aspect;
    // Fit using both fields of view: on wide screens the board's depth limits the distance,
    // on tall phone screens its width does (the horizontal FOV is narrow there).
    const vt = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), ht = vt * aspect;
    const rim = this.multi ? 0.6 : 1.3; // the island's edge around a flat board
    const halfW = Math.max(size.x, size.z) / 2 + rim;
    const halfH = size.z * 0.42 + size.y * 0.75 + rim;
    const dist = Math.max(halfW / ht, halfH / vt, 9) * 1.08 + 1.5;
    const target = this.multi
      ? new THREE.Vector3(center.x, center.y + dist * 0.5, dist * 0.87)
      : new THREE.Vector3(0, dist * 0.72, dist * 0.74);
    this.underglow.position.y = box.min.y - 4;
    this.controls.target.set(center.x, center.y, 0.4);
    this.controls.maxDistance = dist * 1.8;
    if (!animate) { this.camera.position.copy(target); return; }
    const from = new THREE.Vector3(target.x + 20, target.y + 22, target.z - 18);
    this.tween(1800, (t) => {
      const a = (1 - t) * 2.2;
      const v = from.clone().lerp(target, t);
      const rx = v.x * Math.cos(a) - v.z * Math.sin(a), rz = v.x * Math.sin(a) + v.z * Math.cos(a);
      this.camera.position.set(rx, v.y, rz);
    }, ease.inOut, true);
  }

  // ---------- pieces ----------
  makePiece(i, owner) {
    const obj = new THREE.Group();
    const cats = this.theme === 'cats';
    let mesh, vis, parts = null;
    if (cats) {
      vis = this.catProto[owner].clone();
      vis.rotation.order = 'YXZ'; // yaw first, so flips happen in the cat's own frame
      parts = catParts(vis);
      castAll(vis);
      mesh = new THREE.Mesh(this.hitGeo, this.hitMat); // invisible, easy-to-click proxy
      obj.add(vis); obj.add(mesh);
    } else {
      mesh = vis = new THREE.Mesh(this.pieceGeo[owner], this.pieceMat[owner]);
      mesh.castShadow = true;
      obj.add(mesh);
    }
    mesh.userData = { cell: i };
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -PIECE_Y + 0.02;
    obj.add(shadow);
    obj.position.copy(this.at(i, PIECE_Y));
    obj.visible = this.layerShown(this.board.cells[i].z) && !(this.fogMask && !this.fogMask[i]);
    this.pieceGroup.add(obj);
    const piece = { obj, mesh, vis, parts, shadow, owner, phase: Math.random() * Math.PI * 2, lift: 0, yaw: cats ? (Math.random() - 0.5) * 0.9 : 0, hop: 0, level: 1, lvlScale: 1, deco: null };
    if (cats) vis.rotation.y = piece.yaw;
    this.pieces[i] = piece;
    return piece;
  }

  setOwner(piece, owner) {
    piece.owner = owner;
    if (this.theme === 'cats') {
      const rot = piece.vis.rotation.clone();
      piece.obj.remove(piece.vis);
      piece.vis = this.catProto[owner].clone();
      piece.vis.rotation.copy(rot);
      castAll(piece.vis);
      piece.parts = catParts(piece.vis);
      piece.obj.add(piece.vis);
    } else {
      piece.mesh.geometry = this.pieceGeo[owner];
      piece.mesh.material = this.pieceMat[owner];
    }
  }

  face(piece, from, to) {
    const dx = to.x - from.x, dz = to.z - from.z;
    if (this.theme !== 'cats' || Math.hypot(dx, dz) < 0.1) return;
    piece.yaw = Math.atan2(dx, dz);
    piece.vis.rotation.y = piece.yaw;
  }

  removePiece(i) {
    const p = this.pieces[i];
    if (p) { this.pieceGroup.remove(p.obj); this.pieces[i] = null; }
  }

  sync(state) {
    for (let i = 0; i < state.length; i++) {
      const v = state[i];
      if (v > 0) {
        if (!this.pieces[i]) this.makePiece(i, own(v));
        else if (this.pieces[i].owner !== own(v)) this.setOwner(this.pieces[i], own(v));
        const p = this.pieces[i];
        if (p.level !== lvl(v)) this.applyLevel(p, lvl(v));
        p.obj.position.copy(this.at(i, PIECE_Y)); p.obj.scale.setScalar(1); p.vis.rotation.set(0, this.theme === 'cats' ? p.yaw : 0, 0);
      } else this.removePiece(i);
      if (v === HOLE && this.tiles[i]) { this.boardGroup.remove(this.tiles[i]); this.tiles[i] = null; this.addHole(i); }
      if (v !== HOLE && !this.tiles[i]) this.addTile(i);
    }
    this.updateGlow(state);
    this.applyVisibility();
  }

  updateGlow(state) {
    const cnt = [0, 0, 0, 0];
    for (const v of state) if (v > 0) cnt[v]++;
    let lead = 0, best = -1, tie = false;
    for (let p = 1; p <= 3; p++) { if (cnt[p] > best) { best = cnt[p]; lead = p; tie = false; } else if (cnt[p] === best) tie = true; }
    this.glowTarget = tie ? new THREE.Color(0x3a2a80) : new THREE.Color(PLAYER_COLORS[lead]).multiplyScalar(0.55);
  }

  // ---------- indicators ----------
  clearMarks() {
    for (const r of this.rings) if (r) { r.visible = false; r.userData.pulse = 0; }
    for (const p of this.pieces) if (p) p.lift = 0;
    this.clearLabels();
    this.clearLinks();
    this.clearAim();
  }
  mark(i, color, opacity = 0.85, pulse = 0) {
    const r = this.rings[i]; if (!r) return;
    r.visible = true; r.material.color.set(color); r.material.opacity = opacity; r.userData.base = opacity; r.userData.pulse = pulse;
  }
  lift(i, on) { if (this.pieces[i]) this.pieces[i].lift = on ? 1 : 0; }

  label(i, text, color = '#fff') {
    const el = document.createElement('div');
    el.className = 'float-label'; el.textContent = text; el.style.color = color;
    document.getElementById('labels').appendChild(el);
    this.labels.push({ el, pos: this.at(i, 1.4) });
  }
  clearLabels() { for (const l of this.labels) l.el.remove(); this.labels = []; }

  setFog(mask, state) {
    this.fogMask = mask;
    this.applyVisibility();
    if (mask) for (let i = 0; i < this.board.cells.length; i++) {
      const m = this.mists[i];
      if (m.visible && state[i] !== HOLE) m.material.opacity = Math.max(m.material.opacity, 0.6);
    }
  }

  // ---------- animation ----------
  /** Animate fn(t) over ms. Runs on virtual time (so the director's slow motion applies)
   *  unless eal is set, as camera moves are. ignoreSpeed skips the animation-speed setting. */
  tween(ms, fn, e = ease.out, ignoreSpeed = false, real = false) {
    return new Promise((resolve) => {
      const dur = ignoreSpeed ? ms : ms / this.speed;
      if (dur <= 1) { fn(1); resolve(); return; }
      this.tweens.push({ t0: real ? performance.now() : this.vnow, dur, fn, e, resolve, real });
    });
  }
  wait(ms) { return this.tween(ms, () => {}); }

  arcTo(obj, from, to, height, ms, spin = 0, axis = 'y') {
    return this.tween(ms, (t) => {
      obj.position.lerpVectors(from, to, t);
      obj.position.y += Math.sin(Math.PI * t) * height;
      if (spin) obj.children[0].rotation[axis] = spin * t;
    }, ease.inOut);
  }

  // ---------- levels (Merge rule) ----------
  static LEVEL_SCALE = [1, 1, 1.28, 1.55];

  /** Size up a piece and give it a crown (cats) or halo rings (gems) for its level. */
  applyLevel(p, level) {
    p.level = level;
    p.lvlScale = Renderer.LEVEL_SCALE[level];
    if (this.theme !== 'cats') p.vis.scale.setScalar(p.lvlScale);
    if (p.deco) { p.obj.remove(p.deco); p.deco = null; }
    if (p.crown) { p.crown.parent?.remove(p.crown); p.crown = null; }
    if (level < 2) return;
    const g = new THREE.Group();
    if (!this.crownGeo) {
      const band = new THREE.CylinderGeometry(0.17, 0.14, 0.1, 10, 1, true);
      const spikes = [];
      for (let k = 0; k < 5; k++) {
        const c = new THREE.ConeGeometry(0.045, 0.13, 4);
        const a = (k / 5) * Math.PI * 2;
        c.translate(Math.cos(a) * 0.155, 0.1, Math.sin(a) * 0.155);
        spikes.push(c);
      }
      this.crownGeo = mergeGeometries([band.toNonIndexed(), ...spikes.map((s) => s.toNonIndexed())]);
      this.crownGeo.computeVertexNormals();
      this.crownMat = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.22, emissive: 0x6a4000, emissiveIntensity: 0.6 });
      this.jewelMat = new THREE.MeshBasicMaterial({ color: 0xff3ad6, toneMapped: false });
      this.auraGeo = new THREE.TorusGeometry(0.62, 0.025, 8, 48);
    }
    if (this.theme === 'cats' && p.parts?.head) {
      // the crown sits on the head itself (head-local model units), so it turns, tilts and
      // bobs with every glance; the head's own scale carries the cat's size and level
      const crown = new THREE.Mesh(this.crownGeo, this.crownMat);
      crown.position.set(0, 0.2, -0.015);
      crown.rotation.x = -0.12;
      crown.scale.setScalar(0.62);
      crown.name = 'crown';
      crown.castShadow = true;
      p.parts.head.add(crown);
      p.crown = crown;
      if (level >= 3) {
        const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), this.jewelMat);
        jewel.position.set(0, 0.06, 0.16); crown.add(jewel);
      }
    }
    // a glowing aura ring per level above 1, in the owner's colour
    for (let k = 0; k < level - 1; k++) {
      const ring = new THREE.Mesh(this.auraGeo, new THREE.MeshBasicMaterial({ color: PLAYER_COLORS[p.owner], toneMapped: false, transparent: true, opacity: 0.85 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -PIECE_Y + 0.08 + k * 0.12;
      ring.scale.setScalar(0.9 + k * 0.18);
      ring.name = 'aura';
      g.add(ring);
    }
    p.deco = g;
    p.obj.add(g);
  }

  /** Two equal pieces fuse: the mover pounces onto its twin, light flares, a bigger piece appears. */
  async mergeAnim(m, player, newLevel, sfx) {
    const a = this.pieces[m.from], b = this.pieces[m.to];
    if (!a || !b) return;
    const from = this.at(m.from, PIECE_Y), to = this.at(m.to, PIECE_Y);
    this.face(a, from, to);
    this.pieces[m.from] = null;
    sfx.merge?.(newLevel);
    b.hop = 1;
    await this.arcTo(a.obj, from, to, 1.3, 420, Math.PI * 2, this.theme === 'cats' ? 'x' : 'y');
    this.pieceGroup.remove(a.obj);
    this.burst(to.clone().add(new THREE.Vector3(0, 0.6, 0)), PLAYER_COLORS[player], 90, 3.5, null, { swirl: -7, life: 1.1, size: 0.12, spread: 0.6, up: 0.4 });
    this.burst(to, 0xffffff, 40, 3);
    this.ripple(to, newLevel >= 3 ? 1.6 : 1);
    b.squash = 1;
    this.burst(to, 0xffc83a, 30, 2.4);
    this.burst(to, PLAYER_COLORS[player], 30, 2);
    this.shock(to, 0xffc83a, 2.2);
    this.strike(to, newLevel >= 3 ? 0xffe27a : 0xd8b8ff, sfx);
    this.shake(300);
    this.pop(m.to, newLevel >= 3 ? 'LEGENDARY!' : 'MERGE!', newLevel >= 3 ? '#ffd23f' : '#e2b6ff');
    this.applyLevel(b, newLevel);
    const s = b.lvlScale;
    await this.tween(520, (t) => b.obj.scale.setScalar(0.6 + 0.4 * t + Math.sin(t * Math.PI) * 0.35 * (1 - t)), ease.back);
    b.obj.scale.setScalar(1);
    void s;
  }

  /** Armour cracks: a crowned piece survives a hit but drops a level. */
  async crack(i, sfx) {
    const p = this.pieces[i]; if (!p) return;
    const at = this.at(i, PIECE_Y);
    sfx.crack?.();
    const crown = p.crown;
    if (crown) {
      // the crown pops off the head and tumbles away
      const c = crown.clone();
      crown.getWorldPosition(c.position);
      c.scale.copy(crown.getWorldScale(new THREE.Vector3()));
      this.fxGroup.add(c);
      const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      const start = c.position.clone(), s0 = c.scale.x;
      this.tween(700, (t) => {
        c.position.copy(start).addScaledVector(dir, t * 1.6);
        c.position.y = start.y + Math.sin(t * Math.PI) * 1.2 - t * 1.5;
        c.rotation.x += 0.2; c.rotation.z += 0.15;
        c.scale.setScalar(s0 * (1 - t * 0.8));
      }).then(() => this.fxGroup.remove(c));
    }
    this.burst(at, 0x9ae8ff, 26, 2.6);
    this.burst(at, 0xffffff, 12, 1.6);
    this.pop(i, '⛨ CRACK', '#9ae8ff');
    await this.tween(360, (t) => { p.obj.position.x = at.x + Math.sin(t * 40) * 0.08 * (1 - t); });
    p.obj.position.x = at.x;
    this.applyLevel(p, Math.max(1, p.level - 1));
  }

  /** A short-lived floating word above a cell. */
  pop(i, text, color) {
    const el = document.createElement('div');
    el.className = 'popword'; el.textContent = text; el.style.color = color;
    document.getElementById('labels').appendChild(el);
    this.bubbles.push({ el, pos: this.at(i, 2.2), until: performance.now() + 1100 });
  }

  async animateMove(m, player, res, sfx, finalState) {
    this.clearMarks();
    const cats = this.theme === 'cats';
    const waves = res.waves || res;
    const from = this.at(m.from, PIECE_Y), to = this.at(m.to, PIECE_Y);
    this.lookTarget = to.clone(); // every cat turns to watch the move
    if (player === 3) this.glitchHit(0.8); // Unit-9 glitches the feed whenever it acts
    // the director takes big moments: a cascade of 5+, or a merge into a Legendary
    const total0 = waves.reduce((a, w) => a + w.length, 0);
    const newLvl = m.merge && finalState ? lvl(finalState[m.to]) : 0;
    if (total0 >= 5 || newLvl >= 3) this.cinematic(to, { ms: 1500 + Math.min(total0, 10) * 120 });
    let piece;
    if (m.merge) {
      await this.mergeAnim(m, player, finalState ? lvl(finalState[m.to]) : (this.pieces[m.to]?.level || 1) + 1, sfx);
      piece = this.pieces[m.to];
    } else if (m.jump) {
      piece = this.pieces[m.from];
      this.pieces[m.from] = null;
      this.face(piece, from, to);
      if (cats) { piece.hop = 1; sfx.meow?.(player, 1); }
      sfx.jump();
      this.trail(piece.obj, PLAYER_COLORS[player], 520 / this.speed);
      // gems spin; cats do a somersault
      await this.arcTo(piece.obj, from, to, 2.4, 560, Math.PI * 2, cats ? 'x' : 'y');
      if (cats) piece.vis.rotation.x = 0;
      this.pieces[m.to] = piece;
      piece.mesh.userData.cell = m.to;
    } else {
      const parent = this.pieces[m.from];
      if (parent) this.face(parent, from, to);
      piece = this.makePiece(m.to, player);
      piece.obj.position.copy(from);
      if (parent) { piece.yaw = parent.yaw; piece.vis.rotation.y = parent.yaw; }
      if (cats) sfx.meow?.(player, 1.35); else sfx.clone();
      this.burst(from, PLAYER_COLORS[player], 14, 1.2);
      const arc = this.arcTo(piece.obj, from, to, 0.9, 360);
      await Promise.all([arc, this.tween(360, (t) => piece.obj.scale.setScalar(0.2 + 0.8 * t), ease.back)]);
    }
    if (!m.merge) {
      sfx.land();
      if (piece) piece.squash = 1;
      this.shock(to, PLAYER_COLORS[player], 1.6);
      this.burst(to, PLAYER_COLORS[player], 22, 2);
      if (m.jump) this.ripple(to, 0.6);
    }
    const cracked = res.cracked || [];
    const total = waves.reduce((a, w) => a + w.length, 0);
    if (cats && total + cracked.length >= 2) this.taunt(m.to, player, total);
    // one conversion style per move keeps a multi-capture readable, and moves stay varied
    const style = this.pickStyle(player);
    for (let w = 0; w < waves.length; w++) {
      const cells = waves[w];
      const cr = w === 0 ? cracked : [];
      if (!cells.length && !cr.length) continue;
      if (w > 0) {
        sfx.cascade(w);
        sfx.crackle?.();
        // a cascade arcs outward: each newly flipped piece is struck from the nearest one of the last wave
        const prev = waves[w - 1].length ? waves[w - 1] : [m.to];
        for (const c of cells) {
          const at = this.at(c, PIECE_Y + 0.15);
          const src = prev.map((p) => this.at(p, PIECE_Y + 0.15)).sort((x, y) => x.distanceTo(at) - y.distanceTo(at))[0];
          this.bolt(src, at, { color: 0xffd060, width: 0.05, branches: 1, life: 300, light: 0.5 });
        }
        await this.wait(160);
      }
      else if (cats && cells.length) await this.captureFx(player, to, cells, sfx);
      else if (cells.length) await this.gemFx(player, to, cells, sfx);
      await Promise.all([
        ...cells.map((c, k) => this.convert(c, player, cats ? k * 30 : k * 70, w, sfx, w ? 'flip' : style, to)),
        ...cr.map((c, k) => this.wait(k * 60).then(() => this.crack(c, sfx))),
      ]);
    }
    // refresh reflections now the board has changed; let the cats' attention drift back
    this.updateReflections(true);
    const watched = this.lookTarget;
    setTimeout(() => { if (this.lookTarget === watched) this.lookTarget = null; }, 1400);
  }

  pickStyle(player) {
    const pool = this.theme === 'cats'
      ? { 1: ['abduct', 'spin', 'flip', 'hearts'], 2: ['yarn', 'flip', 'hearts', 'spin'], 3: ['spin', 'abduct', 'flip', 'yarn'] }[player]
      : ['flip', 'spin', 'abduct', 'hearts'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Convert one enemy piece, in one of several styles. The owner swaps at the climax. */
  async convert(i, player, delay, wave, sfx, style = 'flip', attackerPos = null) {
    const p = this.pieces[i]; if (!p) return;
    await this.wait(delay);
    const base = this.at(i, PIECE_Y);
    const col = PLAYER_COLORS[player];
    let swapped = false;
    const swap = () => {
      if (swapped) return; swapped = true;
      this.setOwner(p, player);
      this.burst(base, col, 26 + wave * 10, 2.4 + wave);
      if (this.theme === 'cats') this.burst(base, 0xffffff, 14, 1.4);
    };
    sfx.capture(Math.min(5, Math.round(delay / 70)), wave);

    if (style === 'spin') {
      // hypno-spin: spiral rings close in and the piece twirls until it changes sides
      const rings = [0, 1, 2].map((k) => {
        const r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
        r.position.copy(base).add(new THREE.Vector3(0, 0.2 + k * 0.35, 0)); this.fxGroup.add(r); return r;
      });
      sfx.spin?.();
      await this.tween(700, (t) => {
        p.vis.rotation.y = (p.yaw || 0) + t * Math.PI * 6;
        p.obj.scale.set(1 - Math.sin(t * Math.PI) * 0.25, 1 + Math.sin(t * Math.PI) * 0.35, 1 - Math.sin(t * Math.PI) * 0.25);
        rings.forEach((r, k) => { r.material.opacity = Math.sin(t * Math.PI) * 0.9; r.scale.setScalar(2.2 - t * 1.6 + k * 0.2); r.rotation.y = t * 8 + k; });
        if (t > 0.55) swap();
      }, ease.inOut);
      rings.forEach((r) => { this.fxGroup.remove(r); r.material.dispose(); });
      p.obj.scale.setScalar(1);
      p.vis.rotation.y = p.yaw || 0;
    } else if (style === 'abduct') {
      // tractor beam: lifted into the sky, recoloured, gently set back down
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.75, 5, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.copy(base).add(new THREE.Vector3(0, 2.3, 0));
      const saucer = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 10), new THREE.MeshStandardMaterial({ color: 0xb8c2e0, metalness: 0.9, roughness: 0.25, emissive: col, emissiveIntensity: 0.4 }));
      saucer.scale.set(1, 0.28, 1);
      saucer.position.copy(base).add(new THREE.Vector3(0, 5.2, 0));
      this.fxGroup.add(beam, saucer);
      sfx.beam?.();
      await this.tween(900, (t) => {
        beam.material.opacity = Math.sin(t * Math.PI) * 0.45;
        saucer.position.y = base.y + 5.2 + Math.sin(t * 9) * 0.08;
        saucer.rotation.y = t * 10;
        const lift = Math.sin(t * Math.PI);
        p.obj.position.y = base.y + lift * 2.4;
        p.vis.rotation.y = (p.yaw || 0) + t * Math.PI * 4;
        if (t > 0.5) swap();
        if (Math.random() < 0.4) this.burst(p.obj.position.clone(), col, 1, 0.3);
      }, ease.inOut);
      this.fxGroup.remove(beam, saucer);
      p.obj.position.y = base.y; p.vis.rotation.y = p.yaw || 0; p.hop = 1;
    } else if (style === 'yarn' && attackerPos) {
      // a ball of yarn is lobbed in; bonk, then a dizzy somersault
      if (!this.yarnGeo) {
        this.yarnGeo = new THREE.SphereGeometry(0.2, 16, 12);
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const g = c.getContext('2d'); g.fillStyle = '#ff5fa2'; g.fillRect(0, 0, 64, 64);
        g.strokeStyle = '#ffd0e6'; g.lineWidth = 3;
        for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(0, k * 8); g.bezierCurveTo(20, k * 8 + 12, 44, k * 8 - 12, 64, k * 8); g.stroke(); }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        this.yarnMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
      }
      const ball = new THREE.Mesh(this.yarnGeo, this.yarnMat);
      const a = attackerPos.clone().add(new THREE.Vector3(0, 0.4, 0));
      this.fxGroup.add(ball);
      sfx.whoosh?.();
      await this.tween(380, (t) => {
        ball.position.lerpVectors(a, base, t); ball.position.y += Math.sin(t * Math.PI) * 1.6;
        ball.rotation.x += 0.4; ball.rotation.z += 0.3;
      }, ease.linear);
      this.fxGroup.remove(ball);
      sfx.bonk?.();
      this.burst(base, 0xff5fa2, 16, 1.8);
      await this.somersault(p, base, swap);
    } else if (style === 'hearts') {
      // love conquers all: hearts bubble up, the piece swoons and wobbles over
      sfx.swoon?.();
      for (let k = 0; k < 3; k++) this.wait(k * 120).then(() => this.burst(base.clone().add(new THREE.Vector3(0, 0.4, 0)), 0xff6fae, 7, 1.2, this.heartTex()));
      await this.tween(650, (t) => {
        const w = Math.sin(t * Math.PI * 6) * (1 - t);
        p.obj.scale.set(1 + w * 0.15, 1 - w * 0.15, 1 + w * 0.15);
        p.vis.rotation.z = Math.sin(t * Math.PI * 4) * 0.35 * (1 - t);
        p.obj.position.y = base.y + Math.sin(t * Math.PI) * 0.5;
        if (t > 0.5) swap();
      }, ease.inOut);
      p.obj.scale.setScalar(1); p.vis.rotation.z = 0; p.obj.position.y = base.y;
    } else {
      await this.somersault(p, base, swap);
    }
    swap();
    if (wave > 0) this.shock(base, 0xffd060, 1.2);
  }

  async somersault(p, base, swap) {
    const ax = this.theme === 'cats' ? 'x' : (Math.random() < 0.5 ? 'x' : 'z');
    await this.tween(520, (t) => {
      p.vis.rotation[ax] = Math.PI * 2 * t;
      p.obj.position.y = base.y + Math.sin(Math.PI * t) * 0.9;
      p.obj.scale.setScalar(1 + Math.sin(Math.PI * t) * 0.25);
      if (t > 0.5) swap();
    }, ease.inOut);
    p.vis.rotation[ax] = 0;
    p.obj.scale.setScalar(1);
  }

  heartTex() {
    if (!this._heart) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(32, 56); g.bezierCurveTo(4, 36, 6, 10, 22, 10); g.bezierCurveTo(28, 10, 32, 16, 32, 20);
      g.bezierCurveTo(32, 16, 36, 10, 42, 10); g.bezierCurveTo(58, 10, 60, 36, 32, 56); g.fill();
      this._heart = new THREE.CanvasTexture(c);
    }
    return this._heart;
  }

  // ---------- lightning and lasers ----------
  /** A jagged path from a to b by midpoint displacement: each pass halves the segments' wander. */
  boltPath(a, b, rough = 0.32, depth = 5) {
    let pts = [a.clone(), b.clone()];
    let disp = a.distanceTo(b) * rough;
    for (let d = 0; d < depth; d++) {
      const next = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const mid = pts[k].clone().lerp(pts[k + 1], 0.5);
        mid.x += (Math.random() - 0.5) * disp; mid.y += (Math.random() - 0.5) * disp; mid.z += (Math.random() - 0.5) * disp;
        next.push(mid, pts[k + 1]);
      }
      pts = next;
      disp *= 0.55;
    }
    return pts;
  }

  /** HDR-bright tube along a polyline: colours above 1.0 are what the bloom pass turns into glow. */
  tubeAlong(pts, radius, color, opacity, additive) {
    const path = new THREE.CurvePath();
    for (let k = 0; k < pts.length - 1; k++) path.add(new THREE.LineCurve3(pts[k], pts[k + 1]));
    const geo = new THREE.TubeGeometry(path, pts.length * 2, radius, additive ? 6 : 4, false);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    return new THREE.Mesh(geo, mat);
  }

  /**
   * A lightning bolt from a to b. It forks, flickers (re-rolling its shape a few times) and
   * briefly lights everything around it.
   */
  bolt(a, b, { color = 0xbfa8ff, width = 0.05, life = 340, branches = 2, flicker = 3, rough = 0.32, light = 1 } = {}) {
    const group = new THREE.Group();
    this.fxGroup.add(group);
    const hot = new THREE.Color(color).multiplyScalar(3.2);
    const core = new THREE.Color(1, 1, 1).multiplyScalar(4);
    const build = () => {
      for (const m of group.children) { m.geometry.dispose(); m.material.dispose(); }
      group.clear();
      const main = this.boltPath(a, b, rough);
      const add = (pts, w) => {
        group.add(this.tubeAlong(pts, w * 0.32, core, 1, false));
        group.add(this.tubeAlong(pts, w, hot, 0.38, true));
      };
      add(main, width);
      for (let k = 0; k < branches; k++) {
        const from = main[Math.floor(main.length * (0.2 + Math.random() * 0.55))];
        const reach = a.distanceTo(b) * (0.18 + Math.random() * 0.25);
        const dir = b.clone().sub(a).normalize().add(new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.8, Math.random() - 0.5).multiplyScalar(1.4)).normalize();
        add(this.boltPath(from, from.clone().addScaledVector(dir, reach), rough * 1.2, 4), width * 0.55);
      }
    };
    build();
    if (light) this.flashAt(a.clone().lerp(b, 0.5), color, light);
    let rolls = 0;
    return this.tween(life, (t) => {
      const want = Math.floor(t * flicker);
      if (want > rolls && t < 0.85) { rolls = want; build(); }
      const o = (1 - t) * (0.6 + Math.random() * 0.4);
      group.children.forEach((m, k) => (m.material.opacity = (k % 2 ? 0.38 : 1) * o));
    }, (t) => t, true).then(() => {
      for (const m of group.children) { m.geometry.dispose(); m.material.dispose(); }
      this.fxGroup.remove(group);
    });
  }

  /** Light the scene from a point for a moment: lightning and lasers illuminate the cats nearby. */
  flashAt(pos, color, strength = 1) {
    if (!this.flash) { this.flash = new THREE.PointLight(0xffffff, 0, 14, 1.4); this.scene.add(this.flash); }
    const f = this.flash;
    f.position.copy(pos); f.color.set(color);
    f.intensity = Math.max(f.intensity, 70 * strength);
  }

  /**
   * A proper laser: a white-hot core inside a coloured glow and a faint halo. It shoots out
   * from the muzzle, hits with sparks and a ring, holds for a moment and pinches out.
   */
  laserBeam(a, b, color, { ms = 460, width = 1 } = {}) {
    const dir = b.clone().sub(a), len = dir.length();
    const g = new THREE.Group();
    g.position.copy(a);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const cyl = (r, col, op, add) => {
      const geo = new THREE.CylinderGeometry(r, r, 1, add ? 12 : 8, 1, true); geo.translate(0, 0.5, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, toneMapped: false, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }));
      g.add(m); return m;
    };
    cyl(0.022 * width, new THREE.Color(4, 4, 4), 1, false);
    cyl(0.07 * width, new THREE.Color(color).multiplyScalar(3), 0.55, true);
    cyl(0.18 * width, new THREE.Color(color).multiplyScalar(1.5), 0.16, true);
    const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkTex, color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    muzzle.position.copy(a); muzzle.scale.setScalar(0.6 * width);
    this.fxGroup.add(g, muzzle);
    let hit = false;
    return this.tween(ms, (t) => {
      const reach = Math.min(1, t / 0.18);
      g.scale.set(1, len * reach, 1);
      if (reach >= 1 && !hit) {
        hit = true;
        this.burst(b, color, 16, 2.4);
        this.burst(b, 0xffffff, 8, 1.4);
        this.shock(b, color, 0.8);
        this.flashAt(b, color, 0.6);
      }
      const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const pinch = 1 + Math.sin(t * 60) * 0.12;
      g.scale.x = g.scale.z = fade * pinch;
      muzzle.material.opacity = fade;
      muzzle.scale.setScalar(0.6 * width * (1 + Math.sin(t * 50) * 0.3));
    }, (t) => t, true).then(() => {
      for (const m of g.children) { m.geometry.dispose(); m.material.dispose(); }
      this.fxGroup.remove(g, muzzle);
      muzzle.material.dispose();
    });
  }

  /** Where a cat's eyes are right now, in world space (for eye-lasers). */
  eyesOf(i) {
    const p = this.pieces[i];
    const base = this.at(i, PIECE_Y + 0.4);
    if (!p?.parts?.eyes) return [base, base];
    p.vis.updateWorldMatrix(true, true);
    const c = p.parts.eyes.getWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(p.vis.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(0.15 * (p.lvlScale || 1));
    return [c.clone().sub(right), c.clone().add(right)];
  }

  /** A sky strike: a fat bolt from high above onto a point, with a flash and a shake. */
  strike(pos, color = 0xd8c8ff, sfx = null) {
    const top = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 16, (Math.random() - 0.5) * 3));
    sfx?.thunder?.(1);
    this.ripple(pos, 1.2);
    this.shake(260, 0.18);
    this.burst(pos, 0xffffff, 20, 2.6);
    this.shock(pos, color, 1.8);
    return this.bolt(top, pos, { color, width: 0.11, branches: 4, life: 420, flicker: 4, rough: 0.22, light: 2 });
  }

  /** The aiming laser sight shown while you hover a move. */
  aim(fromCell, toCell, color) {
    this.clearAim();
    const a = this.at(fromCell, PIECE_Y + 0.25), b = this.at(toCell, 0.12);
    const dir = b.clone().sub(a);
    const geo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6, 1, true); geo.translate(0, 0.5, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    m.scale.set(1, dir.length(), 1);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkTex, color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    dot.position.copy(b); dot.scale.setScalar(0.5);
    this.sight = { m, dot };
    this.fxGroup.add(m, dot);
  }
  clearAim() {
    if (!this.sight) return;
    const { m, dot } = this.sight;
    this.fxGroup.remove(m, dot); m.geometry.dispose(); m.material.dispose(); dot.material.dispose();
    this.sight = null;
  }

  /** Far-off lightning in the Rift's sky: a big bolt, the sky lights up, thunder rolls in later. */
  skyStrike(sfx) {
    const ang = Math.random() * Math.PI * 2, r = 70 + Math.random() * 40;
    const x = Math.cos(ang) * r, z = -Math.abs(Math.sin(ang) * r) - 20;
    const top = new THREE.Vector3(x, 50 + Math.random() * 20, z);
    const bottom = new THREE.Vector3(x + (Math.random() - 0.5) * 30, -15 - Math.random() * 25, z + (Math.random() - 0.5) * 20);
    const col = x < 0 ? 0xc8a8ff : 0xd8ffb0;
    this.bolt(top, bottom, { color: col, width: 0.55, branches: 5, life: 520, flicker: 4, rough: 0.28, light: 0 });
    if (Math.random() < 0.5) this.wait(110).then(() => this.bolt(top, bottom, { color: col, width: 0.4, branches: 3, life: 300, flicker: 2, rough: 0.3, light: 0 }));
    this.skyFlash = 1;
    sfx?.thunder?.(0.35 + Math.random() * 0.25, 0.5 + Math.random() * 1.2);
  }

  // ---------- faction strikes ----------
  /** Galactic Cat: twin eye-lasers, then meteors on a big haul. Dino Cat: a roar of ground
   *  lightning. Robo Cat: a laser, then chain lightning jumping victim to victim. */
  async captureFx(player, toPos, cells, sfx) {
    const toCell = this.board.cells.findIndex((_, i) => this.at(i, PIECE_Y).distanceTo(toPos) < 0.01);
    if (player === 1) {
      const [eL, eR] = this.eyesOf(toCell);
      sfx.laser?.();
      await Promise.all(cells.map((c, k) => this.wait(k * 80).then(() => {
        const tgt = this.at(c, PIECE_Y + 0.1);
        return Promise.all([this.laserBeam(eL, tgt, 0xff5ae0, { ms: 420 }), this.laserBeam(eR, tgt, 0x6ff6ff, { ms: 420 })]);
      })));
      if (cells.length >= 2) await Promise.all(cells.map((c, k) => this.wait(k * 90).then(() => this.meteor(this.at(c, PIECE_Y), sfx))));
    } else if (player === 2) {
      sfx.roar?.();
      sfx.crackle?.();
      const attacker = this.pieces[toCell];
      if (attacker) attacker.hop = 1;
      for (let k = 0; k < 3; k++) this.wait(k * 110).then(() => this.shock(toPos, k === 1 ? 0xffb02e : 0x8dff4a, 2.6 + k * 0.9));
      this.shake(700);
      this.ripple(toPos, 1.5);
      for (const t of this.tiles) if (t && t.position.distanceTo(toPos) < 2.8) t.userData.wet = 1; // the roar leaves the ground slick
      sfx.rain?.();
      this.burst(toPos, 0x7dff4a, 30, 3.4);
      // lightning crawls along the ground from the roaring cat to every victim
      const ground = (v) => v.clone().setY(v.y - PIECE_Y + 0.18);
      cells.forEach((c, k) => this.wait(60 + k * 50).then(() => this.bolt(ground(toPos), this.at(c, 0.3), { color: k % 2 ? 0xffd04a : 0xa8ff5a, width: 0.06, branches: 3, rough: 0.22, life: 380, light: 0.7 })));
      await this.wait(380);
    } else {
      sfx.zap?.();
      sfx.crackle?.();
      this.glitchHit(1);
      const muzzle = toPos.clone().add(new THREE.Vector3(0, 0.45, 0));
      await this.laserBeam(muzzle, this.at(cells[0], PIECE_Y + 0.1), PLAYER_COLORS[3], { ms: 380, width: 1.3 });
      // chain lightning: hop from each victim to the next
      for (let k = 1; k < cells.length; k++) {
        this.bolt(this.at(cells[k - 1], PIECE_Y + 0.15), this.at(cells[k], PIECE_Y + 0.15), { color: 0x7ae8ff, width: 0.05, branches: 1, life: 300, light: 0.6 });
        await this.wait(70);
      }
    }
  }

  /** Captures in the gem skin: lightning arcs from the landing piece to each victim. */
  async gemFx(player, toPos, cells, sfx) {
    sfx.crackle?.();
    cells.forEach((c, k) => this.wait(k * 50).then(() => this.bolt(toPos, this.at(c, PIECE_Y), { color: PLAYER_COLORS[player], width: 0.045, branches: 1, life: 300, light: 0.6 })));
    await this.wait(200);
  }

  meteor(target, sfx) {
    const m = new THREE.Mesh(this.meteorGeo, this.meteorMat);
    const start = target.clone().add(new THREE.Vector3(-5 + Math.random() * 2, 13, -6));
    m.position.copy(start);
    this.fxGroup.add(m);
    return this.tween(430, (t) => {
      m.position.lerpVectors(start, target, t);
      m.rotation.x += 0.35; m.rotation.z += 0.2;
      this.burst(m.position.clone(), Math.random() < 0.5 ? 0xff9a3a : 0xffe08a, 2, 0.35);
    }, (t) => t * t).then(() => {
      this.fxGroup.remove(m);
      sfx?.boom?.();
      this.ripple(target, 0.9);
      this.burst(target, 0xffb050, 34, 3.2);
      this.burst(target, 0xb07aff, 16, 2.2);
      this.shock(target, 0xff7a20, 1.6);
      this.shake(260);
    });
  }

  laser(a, b, color) {
    const dir = b.clone().sub(a), len = dir.length();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.copy(a).addScaledVector(dir, 0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.fxGroup.add(beam);
    this.burst(b, color, 18, 2);
    this.tween(380, (t) => { beam.material.opacity = 1 - t; beam.scale.set(1 + t * 2, 1, 1 + t * 2); })
      .then(() => { this.fxGroup.remove(beam); beam.geometry.dispose(); beam.material.dispose(); });
  }

  taunt(i, player, n) {
    const lines = {
      1: ['Meow-teor shower!', 'One small step for cat…', 'Purrrr-ojectiles away!', 'To in-feline-ity!', 'Space is MY litter box'],
      2: ['RAWR-MEOW!', 'Extinct THIS!', 'Jurassic Purrk!', 'Tyranno-sore loser?', 'Clawsome!'],
      3: ['BEEP. MEOW.', 'Assimilating kitties', 'Purr.exe running', 'Error 404: your cats'],
    }[player];
    const text = (n >= 4 ? '×' + n + '! ' : '') + lines[Math.floor(Math.random() * lines.length)];
    const el = document.createElement('div');
    el.className = 'bubble p' + player;
    el.textContent = text;
    document.getElementById('labels').appendChild(el);
    this.bubbles.push({ el, pos: this.at(i, 2.1), until: performance.now() + 1700 });
  }

  /** Winner's cats bounce in a wave while fireworks go off. */
  celebrate(winner) {
    const cells = this.pieces.map((p, i) => (p && p.owner === winner ? i : -1)).filter((i) => i >= 0);
    for (let rep = 0; rep < 3; rep++) for (const i of cells) {
      const c = this.board.cells[i];
      this.wait(rep * 700 + c.d * 70).then(() => { const p = this.pieces[i]; if (p) p.hop = 1; });
    }
    // the director's hero shot: low and close on one of the winning cats
    if (cells.length) this.cinematic(this.at(cells[Math.floor(cells.length / 2)], PIECE_Y), { ms: 2000, slow: 0.7, low: true, dist: 4.2 });
    // a lightning storm crowns the winner
    for (let k = 0; k < 7; k++) this.wait(200 + k * 330).then(() => {
      const c = cells[Math.floor(Math.random() * cells.length)];
      if (c !== undefined) this.strike(this.at(c, PIECE_Y), [PLAYER_COLORS[winner], 0xffffff, 0xffe27a][k % 3]);
    });
    for (let k = 0; k < 14; k++) {
      this.wait(k * 180).then(() => {
        const at = this.at(cells[Math.floor(Math.random() * cells.length)] ?? 0, 3 + Math.random() * 3);
        const col = [PLAYER_COLORS[winner], 0xffffff, 0xffd23f][k % 3];
        this.burst(at, col, 46, 4.5);
        // tumbling confetti in the winner's colours
        this.burst(at.clone().add(new THREE.Vector3(0, 1.5, 0)), [PLAYER_COLORS[winner], 0xffd23f, 0xff6fae, 0x7ad8ff][k % 4], 70, 3.2, null, { shape: 1, life: 2.8, size: 0.11, spread: 1.2 });
        this.shock(at.clone().setY(at.y - 2.5), col, 2);
      });
    }
  }

  async shiftPieces(moves, sfx) {
    sfx.shift();
    for (const ring of this.board.rings) for (const i of ring.cells) if (this.layerShown(this.board.cells[i].z)) this.mark(i, 0xffb347, 0.7, 1);
    this.shake(900);
    const objs = moves.map((m) => ({ m, p: this.pieces[m.from] }));
    for (const { m } of objs) this.pieces[m.from] = null;
    await Promise.all(objs.map(({ m, p }) => {
      const a = this.at(m.from, PIECE_Y), b = this.at(m.to, PIECE_Y);
      return this.arcTo(p.obj, a, b, 0.5, 900);
    }));
    for (const { m, p } of objs) { this.pieces[m.to] = p; p.mesh.userData.cell = m.to; }
    this.clearMarks();
  }

  async fillAnim(cells, player) {
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const p = this.makePiece(i, player);
      p.obj.scale.setScalar(0.01);
      this.tween(420, (t) => p.obj.scale.setScalar(Math.max(0.01, t)), ease.back);
      this.burst(this.at(i, PIECE_Y), PLAYER_COLORS[player], 8, 1.2);
      await this.wait(28);
    }
    await this.wait(400);
  }

  async eliminate(cells) {
    await Promise.all(cells.map((i, k) => {
      const p = this.pieces[i]; if (!p) return null;
      return this.wait(k * 30).then(() => {
        this.burst(p.obj.position.clone(), 0x888888, 16, 2);
        return this.tween(400, (t) => p.obj.scale.setScalar(1 - t)).then(() => this.removePiece(i));
      });
    }));
  }

  shake(ms, amp = Math.min(0.45, ms / 1500)) {
    this.shakeUntil = performance.now() + ms / this.speed;
    this.shakeAmp = amp;
  }

  // ---------- graphics quality ----------
  /** Apply a tier from gfx.js QUALITY: resolution, shadows, AO, rays, dust, particles, reflections. */
  setQuality(q) {
    const Q = QUALITY[q] || QUALITY.high;
    this.quality = q in QUALITY ? q : 'high';
    this.Q = Q;
    this.maxDpr = Math.min(devicePixelRatio, Q.dpr);
    this.setDpr(this.maxDpr);
    const r = this.renderer;
    if (r.shadowMap.enabled !== Q.shadows) {
      r.shadowMap.enabled = Q.shadows;
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    }
    if (this.key.shadow.mapSize.x !== Q.shadowSize) {
      this.key.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
      this.key.shadow.map?.dispose(); this.key.shadow.map = null;
    }
    this.gtao.enabled = Q.ao;
    this.rays.enabled = Q.rays;
    this.dust.setCount(Q.dust); this.dust.points.visible = Q.dust > 0;
    this.gpu.mult = Q.particles;
    for (const t of this.tiles) if (t) this.styleTile(t);
    this.updateReflections(true);
  }

  /** Crystal tiles: glossy, faintly iridescent, glowing from inside; real refraction on Ultra. */
  styleTile(t) {
    const Q = this.Q || QUALITY.high, m = t.material;
    const want = Q.transmission ? 0.42 : 0;
    if ((m.transmission > 0) !== (want > 0)) m.needsUpdate = true;
    m.transmission = want;
    m.thickness = 0.7;
    m.ior = 1.45;
    m.iridescence = Q.iridescence ? 0.35 : 0;
    m.iridescenceIOR = 1.3;
    m.attenuationColor = t.userData.base;
    m.attenuationDistance = 1.2;
  }

  // ---------- live reflections ----------
  /** Snapshot the scene into a cube map and hand it to glossy surfaces. Two targets ping-pong
   *  so a material is never sampling the texture being rendered into. */
  updateReflections(force = false) {
    const Q = this.Q;
    const targets = this.reflectTargets();
    if (!Q?.reflect) {
      if (this.reflecting) { targets.forEach((m) => { m.envMap = null; m.needsUpdate = true; }); this.reflecting = false; }
      return;
    }
    const now = performance.now();
    if (!force && now < this.reflectAt) return;
    this.reflectAt = now + Q.reflect * 1000;
    this.cubeRTs = this.cubeRTs || [this.cubeRT, new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter })];
    this.cubeFlip = !this.cubeFlip;
    const rt = this.cubeRTs[this.cubeFlip ? 1 : 0];
    this.cubeCam.renderTarget = rt;
    const vis = this.gpu.points.visible;
    this.gpu.points.visible = false;
    this.cubeCam.update(this.renderer, this.scene);
    this.gpu.points.visible = vis;
    for (const m of targets) {
      if (!m.envMap) m.needsUpdate = true;
      m.envMap = rt.texture;
    }
    this.reflecting = true;
  }
  reflectTargets() {
    const out = [];
    for (const t of this.tiles) if (t) out.push(t.material);
    if (this.rimMat) out.push(this.rimMat);
    if (this.catProto) for (let p = 1; p <= 3; p++) this.catProto[p].traverse((o) => { if (o.material?.userData?.reflective && !out.includes(o.material)) out.push(o.material); });
    return out;
  }

  // ---------- skies ----------
  /** Cross-fade the sky to a preset (rift, shore, wilds, veil); also sets the storm's pace. */
  setSky(name = 'rift') {
    const S = SKIES[name] || SKIES.rift;
    this.skyName = name;
    this.stormRange = S.storm;
    this.nextStorm = performance.now() + S.storm[0] * 1000;
    if (!this.sky) return;
    const u = this.sky.material.uniforms;
    const from = { a: u.uA.value.clone(), b: u.uB.value.clone(), c: u.uC.value.clone(), d: u.uD.value.clone(), x: u.uAccent.value.clone(), split: u.uSplit.value, aur: u.uAurora.value, gal: u.uGalaxy.value };
    const to = { a: new THREE.Vector3(...S.a), b: new THREE.Vector3(...S.b), c: new THREE.Vector3(...S.c), d: new THREE.Vector3(...S.d), x: new THREE.Vector3(...S.accent) };
    this.tween(1600, (t) => {
      u.uA.value.lerpVectors(from.a, to.a, t); u.uB.value.lerpVectors(from.b, to.b, t);
      u.uC.value.lerpVectors(from.c, to.c, t); u.uD.value.lerpVectors(from.d, to.d, t);
      u.uAccent.value.lerpVectors(from.x, to.x, t);
      u.uSplit.value = from.split + (S.split - from.split) * t;
      u.uAurora.value = from.aur + (S.aurora - from.aur) * t;
      u.uGalaxy.value = from.gal + (S.galaxy - from.gal) * t;
    }, ease.inOut, true, true);
  }

  // ---------- the director: cinematic moments ----------
  /** Swoop the camera to a moment, slow time, focus-pull the background, then hand back control. */
  async cinematic(focus, { ms = 1900, slow = 0.35, dist = 5.2, height = 1.9, low = false } = {}) {
    if (!this.Q?.director || this.inCine || this.photo) return;
    this.inCine = true;
    const cam = this.camera, ctl = this.controls;
    const p0 = cam.position.clone(), t0 = ctl.target.clone(), was = ctl.enabled;
    const lim = { min: ctl.minDistance, maxP: ctl.maxPolarAngle };
    ctl.enabled = false; ctl.minDistance = 0.5; ctl.maxPolarAngle = Math.PI * 0.49;
    const back = p0.clone().sub(t0).setY(0).normalize();
    const side = new THREE.Vector3(-back.z, 0, back.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    const look = focus.clone().add(new THREE.Vector3(0, low ? 0.7 : 0.25, 0));
    const pos = focus.clone().addScaledVector(back, dist).addScaledVector(side, dist * 0.55).add(new THREE.Vector3(0, low ? 0.55 : height, 0));
    this.timeScale = slow;
    if (this.Q.dof) { this.bokeh.enabled = true; this.bokeh.uniforms.focus.value = pos.distanceTo(look); this.bokeh.uniforms.aperture.value = 0.0035; }
    await this.tween(420, (t) => { cam.position.lerpVectors(p0, pos, t); ctl.target.lerpVectors(t0, look, t); }, ease.inOut, true, true);
    const p2 = pos.clone().lerp(look, 0.2); // a slow push-in while the moment plays
    await this.tween(ms, (t) => { cam.position.lerpVectors(pos, p2, t); if (this.Q.dof) this.bokeh.uniforms.focus.value = cam.position.distanceTo(look); }, ease.inOut, true, true);
    this.timeScale = 1;
    await this.tween(560, (t) => { cam.position.lerpVectors(p2, p0, t); ctl.target.lerpVectors(look, t0, t); }, ease.inOut, true, true);
    this.bokeh.enabled = !!this.photoDof;
    ctl.minDistance = lim.min; ctl.maxPolarAngle = lim.maxP; ctl.enabled = was;
    this.inCine = false;
  }

  // ---------- screen-space impacts ----------
  /** A refraction ring expanding across the screen from a world point. */
  ripple(worldPos, strength = 1) {
    if (this.quality === 'low') return;
    const v = worldPos.clone().project(this.camera);
    if (v.z > 1) return;
    this.grade.uniforms.uRip.value[this.ripIdx++ % 4].set((v.x + 1) / 2, (v.y + 1) / 2, this.vnow / 1000, strength);
  }
  glitchHit(amount = 1) { this.glitch = Math.max(this.glitch, amount); }

  // ---------- photo mode ----------
  setPhoto(on) {
    const c = this.controls;
    if (on && !this.photo) {
      this.photoSaved = { pan: c.enablePan, min: c.minDistance, max: c.maxDistance, maxP: c.maxPolarAngle, minP: c.minPolarAngle };
      this.timeScale = 0;
      c.enablePan = true; c.minDistance = 1.2; c.maxDistance = 150; c.maxPolarAngle = Math.PI * 0.495; c.minPolarAngle = 0.02;
    } else if (!on && this.photo) {
      const s = this.photoSaved;
      this.timeScale = 1;
      c.enablePan = s.pan; c.minDistance = s.min; c.maxDistance = s.max; c.maxPolarAngle = s.maxP; c.minPolarAngle = s.minP;
      this.setPhotoDof(false);
      this.setFilter('natural');
    }
    this.photo = on;
  }
  setPhotoDof(on) { this.photoDof = on; this.bokeh.enabled = on; if (on) this.bokeh.uniforms.aperture.value = 0.006; }
  setFilter(name) {
    const F = FILTERS[name] || FILTERS.natural, u = this.grade.uniforms;
    u.uSat.value = F.sat; u.uContrast.value = F.contrast; u.uTint.value.set(...F.tint); u.uVig.value = F.vig; u.uBloomTint.value = F.bloom;
  }
  /** Render a frame and return it as a PNG data URL (no HUD: the canvas only). */
  capture() {
    this.composer.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  // ---------- themes ----------
  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    const cols = theme === 'cats' ? [null, 0xb07aff, 0x8dff4a, 0x4dd8ff] : [null, 0xff2d55, 0xbfe0ff, 0x1dffa0];
    PLAYER_COLORS.splice(0, 4, ...cols);
    if (theme === 'cats' && !this.catProto) {
      this.catProto = buildCatModels();
      this.hitGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.95, 8);
      this.hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      this.meteorGeo = new THREE.IcosahedronGeometry(0.2, 0);
      this.meteorMat = new THREE.MeshBasicMaterial({ color: 0xffc070, toneMapped: false });
      this.buildDecor();
    }
    this.ownerTint = cols.map((c) => (c ? new THREE.Color(c).multiplyScalar(0.07) : null));
    this.noTint = new THREE.Color(0);
    if (this.decor) { this.decor.visible = theme === 'cats'; this.sky.visible = theme === 'cats'; }
    this.stars.material.opacity = theme === 'cats' ? 0.6 : 1;
    for (const t of this.tiles) if (t) t.material.emissive.set(0);
  }

  /** A split universe: a nebula on the Galactic side, a volcanic sky on the Dino side. */
  buildDecor() {
    // the sky is a shader dome with presets (gfx.js SKIES): split rift, dusk shore, storm, neon veil
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(190, 48, 32), skyMaterial());
    this.scene.add(this.sky);

    this.decor = new THREE.Group();
    // Galactic side: a ringed planet and a moon
    const band = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      for (let y = 0; y < 128; y += 4) { g.fillStyle = `hsl(${270 + Math.sin(y * 0.15) * 40}, 70%, ${35 + Math.sin(y * 0.4) * 15}%)`; g.fillRect(0, y, 256, 4); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(9, 48, 32), new THREE.MeshStandardMaterial({ map: band, emissive: 0x2a0a50, emissiveIntensity: 0.6, roughness: 0.8, fog: false }));
    this.planet.position.set(-62, 22, -80);
    const ring = new THREE.Mesh(new THREE.RingGeometry(12, 18, 64), new THREE.MeshBasicMaterial({ color: 0xd8a8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }));
    ring.rotation.set(1.2, 0.3, 0); this.planet.add(ring);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 16), new THREE.MeshStandardMaterial({ color: 0xbfc8ff, emissive: 0x202a60, fog: false }));
    moon.position.set(-38, 34, -70);
    // Dino side: a smoking volcano on a floating rock
    const rock = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.95, flatShading: true, fog: false });
    const volcano = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 15, 16, 9, 3), rock);
    volcano.position.set(64, -10, -78);
    const base = new THREE.Mesh(new THREE.ConeGeometry(15, 12, 9), rock);
    base.rotation.x = Math.PI; base.position.set(0, -14, 0); volcano.add(base);
    this.crater = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8), new THREE.MeshBasicMaterial({ color: 0xff6a10, toneMapped: false, fog: false }));
    this.crater.scale.y = 0.35; this.crater.position.y = 8; volcano.add(this.crater);
    const lava = new THREE.PointLight(0xff5a10, 300, 120, 1.5); lava.position.set(64, 2, -70);
    // little floating fern islands near the dino side of the board
    for (let k = 0; k < 4; k++) {
      const isle = new THREE.Group();
      const r = new THREE.Mesh(new THREE.ConeGeometry(1.2 + Math.random(), 2.2, 6), rock); r.rotation.x = Math.PI; isle.add(r);
      for (let f = 0; f < 5; f++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.4, 4), new THREE.MeshStandardMaterial({ color: 0x3fbf3a, fog: false }));
        leaf.position.set(Math.cos(f * 1.3) * 0.5, 1.6, Math.sin(f * 1.3) * 0.5); leaf.rotation.z = Math.cos(f * 1.3) * 0.6; leaf.rotation.x = Math.sin(f * 1.3) * 0.6;
        isle.add(leaf);
      }
      isle.position.set(40 + k * 10, -3 + Math.random() * 8, -18 - k * 10);
      this.decor.add(isle);
    }
    this.decor.add(this.planet, moon, volcano, lava);
    this.scene.add(this.decor);
  }

  burst(pos, color, count, speed, tex = null, opts = {}) {
    if (!tex) { this.gpu.emit(pos, color, count, speed, this.time, opts); return; }
    const N = count, geo = new THREE.BufferGeometry();
    const p = new Float32Array(N * 3), v = [];
    for (let k = 0; k < N; k++) {
      p.set([pos.x, pos.y, pos.z], k * 3);
      const d = new THREE.Vector3().randomDirection(); d.y = Math.abs(d.y) * 1.4 + 0.3;
      v.push(d.multiplyScalar(speed * (0.4 + Math.random())));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({ color, size: tex ? 0.45 : 0.22, map: tex || this.sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pts = new THREE.Points(geo, mat);
    this.fxGroup.add(pts);
    this.particles.push({ pts, v, life: 0, max: 0.9 });
  }

  trail(obj, color, ms) {
    const end = performance.now() + ms;
    const tick = () => {
      if (performance.now() > end) return;
      this.burst(obj.position.clone(), color, 3, 0.25);
      requestAnimationFrame(tick);
    };
    tick();
  }

  shock(pos, color, size) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false, depthWrite: false }));
    m.position.copy(pos); m.position.y += 0.05 - PIECE_Y;
    this.fxGroup.add(m);
    this.tween(650, (t) => { m.scale.setScalar(0.6 + size * 1.8 * t); m.material.opacity = 1 - t; }, ease.out)
      .then(() => this.fxGroup.remove(m));
  }

  // ---------- loop ----------
  frame() {
    const rdt = Math.min(this.clock.getDelta(), 0.05);
    const dt = rdt * this.timeScale;     // virtual time: slows in cinematic moments, stops in photo mode
    this.time += dt;
    this.vnow += rdt * 1000 * this.timeScale;
    const now = performance.now();
    for (let k = this.tweens.length - 1; k >= 0; k--) {
      const tw = this.tweens[k];
      const t = Math.min(1, ((tw.real ? now : this.vnow) - tw.t0) / tw.dur);
      tw.fn(tw.e(t));
      if (t >= 1) { this.tweens.splice(k, 1); tw.resolve(); }
    }
    for (let k = this.particles.length - 1; k >= 0; k--) {
      const pr = this.particles[k];
      pr.life += dt;
      const a = pr.pts.geometry.attributes.position;
      for (let j = 0; j < pr.v.length; j++) {
        pr.v[j].y -= 3.2 * dt; pr.v[j].multiplyScalar(0.985);
        a.array[j * 3] += pr.v[j].x * dt; a.array[j * 3 + 1] += pr.v[j].y * dt; a.array[j * 3 + 2] += pr.v[j].z * dt;
      }
      a.needsUpdate = true;
      pr.pts.material.opacity = 1 - pr.life / pr.max;
      if (pr.life >= pr.max) { this.fxGroup.remove(pr.pts); pr.pts.geometry.dispose(); pr.pts.material.dispose(); this.particles.splice(k, 1); }
    }
    const T = this.time;
    const cats = this.theme === 'cats';
    const { cursor, attention } = cats ? this.cursorPoint() : {};
    for (const p of this.pieces) {
      if (!p) continue;
      const v = p.vis;
      p.cur = (p.cur || 0) + (p.lift - (p.cur || 0)) * Math.min(1, dt * 10);
      // landing squash: set p.squash = 1 when a piece lands; it flattens and springs back
      p.squash = Math.max(0, (p.squash || 0) - dt * 3.2);
      const sq = Math.sin(p.squash * Math.PI) * p.squash;
      if (cats) {
        this.gaze(p, cursor, attention, rdt, T);
        animateCat(p, T, p.cur);
        // hop: a quick squash-and-stretch bounce, triggered by setting p.hop = 1
        p.hop = Math.max(0, (p.hop || 0) - dt * 2.4);
        const h = Math.sin((1 - p.hop) * Math.PI) * (p.hop > 0 ? 1 : 0);
        // The model's own scale (set when it was built) times the merge level. Paws sit at
        // -0.32 model units, so lift the cat until they rest on the tile surface (y = 0).
        const B = p.baseScale || (p.baseScale = v.scale.x || 1);
        const L = (p.lvlScale || 1) * B;
        p.footLift = 0.32 * L - PIECE_Y;
        const sy = 1 - h * 0.1 + (p.hop > 0.85 ? -0.12 : 0) - sq * 0.28, sxz = 1 + h * 0.08 + sq * 0.18;
        v.position.y = 0.32 * L * sy - PIECE_Y + p.cur * 0.35 + h * 0.55; // paws stay planted while squashed
        v.scale.set(L * sxz, L * sy, L * sxz);
      } else {
        if (p.owner === 1 || p.owner === 3) v.rotation.y += dt * 0.5;
        v.position.y = Math.sin(T * 1.6 + p.phase) * 0.04 + p.cur * 0.35 - sq * 0.08;
        const s0 = p.lvlScale || 1;
        v.scale.set(s0 * (1 + sq * 0.2), s0 * (1 - sq * 0.3), s0 * (1 + sq * 0.2));
      }
      p.shadow.material.opacity = 0.5 - p.cur * 0.3; // soft contact shadow under the real one
      if (p.deco) {
        // crowns ride along with hops; aura rings slowly orbit and pulse
        p.deco.position.y = cats ? v.position.y - (p.footLift || 0) : v.position.y;
        for (const ch of p.deco.children) if (ch.name === 'aura') {
          ch.rotation.z += dt * (ch.scale.x > 1 ? -1.2 : 0.9);
          ch.material.opacity = 0.55 + 0.35 * Math.sin(T * 3 + p.phase);
        }
      }
    }
    // speech bubbles
    for (let k = this.bubbles.length - 1; k >= 0; k--) {
      const b = this.bubbles[k];
      if (now > b.until) { b.el.remove(); this.bubbles.splice(k, 1); continue; }
      b.pos.y += dt * 0.25;
    }
    if (cats && this.decor) {
      this.sky.material.uniforms.uTime.value = T;
      this.planet.rotation.y += dt * 0.05;
      this.decor.rotation.y = Math.sin(T * 0.02) * 0.05;
      if (Math.random() < dt * 2.2) this.burst(this.crater.getWorldPosition(new THREE.Vector3()), Math.random() < 0.5 ? 0xff5a00 : 0xffb030, 12, 7);
    }
    // Territory: each owned tile glows from inside in its owner's colour, and its top carries
    // a paint wash. When a cell changes hands the new colour burns through the old one with a
    // fiery dissolve edge, and the crystal flares. Dino roars leave tiles wet and glossy.
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i]; if (!t) continue;
      const u = t.userData, pu = t.children[1].material.uniforms, m = t.material;
      const owner = this.pieces[i]?.owner || 0;
      if (owner !== u.owner) {
        pu.uOld.value.copy(pu.uNew.value); pu.uOldA.value = u.owner ? 1 : 0;
        if (owner) pu.uNew.value.set(PLAYER_COLORS[owner]);
        pu.uNewA.value = owner ? 1 : 0;
        pu.uT.value = 0;
        u.owner = owner; u.flash = owner ? 1 : 0;
        u.glowCol = owner ? new THREE.Color(PLAYER_COLORS[owner]) : null;
      }
      if (pu.uT.value < 1) pu.uT.value = Math.min(1, pu.uT.value + dt * 1.6);
      pu.uAlpha.value = 0.26 + 0.05 * Math.sin(T * 2 + i * 0.7);
      u.flash = Math.max(0, u.flash - dt * 1.8);
      u.glow += ((owner ? 1 : 0) - u.glow) * Math.min(1, dt * 3);
      if (u.glowCol) m.emissive.copy(u.glowCol).multiplyScalar(0.07 * u.glow + 0.5 * u.flash); else m.emissive.multiplyScalar(0.9);
      if (u.wet > 0) {
        u.wet = Math.max(0, u.wet - dt * 0.22);
        m.roughness = 0.32 - 0.3 * u.wet; m.clearcoatRoughness = 0.12 - 0.11 * u.wet;
      }
    }
    // lightning light decays fast; the sky and fill light flare with distant strikes
    if (this.flash) this.flash.intensity *= Math.pow(0.0008, rdt);
    this.skyFlash *= Math.pow(0.004, rdt);
    this.hemi.intensity = 0.55 + this.skyFlash * 0.35;
    if (this.sky) { this.sky.material.uniforms.uFlash.value = this.skyFlash; this.sky.material.uniforms.uTime.value = T; }
    if (this.storm && !this.photo && now > this.nextStorm) {
      const [lo, hi] = this.stormRange || [5, 14];
      this.nextStorm = now + (lo + Math.random() * (hi - lo)) * 1000;
      this.skyStrike(this.sfx);
    }
    // the laser sight shimmers
    if (this.sight) { this.sight.m.material.opacity = 0.55 + 0.35 * Math.sin(T * 14); this.sight.dot.scale.setScalar(0.45 + 0.15 * Math.sin(T * 9)); }
    // dust, particles, lightning-lit grade, god-ray anchor, reflections
    this.gpu.uniforms.uTime.value = this.time;
    this.dust.uniforms.uTime.value = this.time;
    const gu = this.grade.uniforms;
    gu.uNow.value = this.vnow / 1000;
    gu.uAspect.value = this.camera.aspect;
    this.glitch = Math.max(0, this.glitch - rdt * 2.6);
    gu.uGlitch.value = this.glitch;
    if (this.rays.enabled) {
      const lp = this.key.position.clone().sub(this.key.target.position).normalize().multiplyScalar(60).add(this.controls.target).project(this.camera);
      this.rays.uniforms.uLight.value.set((lp.x + 1) / 2, (lp.y + 1) / 2);
      this.rays.uniforms.uStrength.value = lp.z < 1 ? 0.55 + this.skyFlash * 0.6 : 0;
    }
    if (this.Q?.reflect && !this.photo) this.updateReflections();
    if (this.photo && this.photoDof) this.bokeh.uniforms.focus.value = this.camera.position.distanceTo(this.controls.target);    // film grain moves; adaptive resolution keeps the frame rate up on slower machines
    this.grade.uniforms.uTime.value = T % 100;
    const fp = this.fps;
    // A long gap between frames means the tab was hidden or throttled, not that rendering is
    // slow: restart the measurement window instead of lowering the resolution.
    if (fp.last && now - fp.last > 150) { fp.frames = 0; fp.t0 = now; fp.slow = 0; }
    fp.last = now;
    fp.frames++;
    if (now - fp.t0 > 1000) {
      fp.value = (fp.frames * 1000) / (now - fp.t0); fp.frames = 0; fp.t0 = now;
      if (fp.value < 48 && this.dpr > 0.75) { fp.slow++; if (fp.slow >= 2) { this.setDpr(this.dpr - 0.25); fp.slow = 0; } }
      else if (fp.value > 58 && this.dpr < this.maxDpr) { fp.fast = (fp.fast || 0) + 1; if (fp.fast >= 6) { this.setDpr(this.dpr + 0.25); fp.fast = 0; } }
      else fp.slow = 0;
    }
    for (const r of this.rings) {
      if (r && r.visible && r.userData.pulse) r.material.opacity = r.userData.base * (0.55 + 0.45 * Math.sin(T * 6 + r.userData.cell * 0.4));
    }
    if (this.holes) for (const h of this.holes) if (h) h.material.opacity = 0.16 + 0.1 * Math.sin(T * 1.3 + h.userData.phase);
    for (const m of this.mists) if (m && m.visible) {
      m.material.rotation += dt * 0.08;
      m.material.opacity += ((m.userData.target ?? 0) - m.material.opacity) * dt * 3;
    }
    this.rimA.position.set(Math.cos(T * 0.3) * 14, 6, Math.sin(T * 0.3) * 14);
    this.rimB.position.set(Math.cos(T * 0.3 + Math.PI) * 14, 6, Math.sin(T * 0.3 + Math.PI) * 14);
    this.underglow.material.color.lerp(this.glowTarget, dt * 1.5);
    this.stars.rotation.y += dt * 0.004;

    this.controls.update();
    let shake = null;
    // the director's idle drift: the camera breathes very slightly, so the board never feels frozen
    if (this.Q?.director && !this.inCine && !this.photo) {
      shake = this.camera.position.clone();
      const tr = now / 1000, amp = this.camera.position.distanceTo(this.controls.target) * 0.006;
      this.camera.position.x += Math.sin(tr * 0.21) * amp * 1.6;
      this.camera.position.y += Math.sin(tr * 0.17 + 1.3) * amp;
      this.camera.position.z += Math.sin(tr * 0.13 + 2.1) * amp;
    }
    if (this.shakeUntil && now < this.shakeUntil) {
      shake = shake || this.camera.position.clone(); // keep the true position from before the drift
      const k = (this.shakeAmp || 0.12) * Math.min(1, (this.shakeUntil - now) / 400);
      this.camera.position.x += (Math.random() - 0.5) * k; this.camera.position.y += (Math.random() - 0.5) * k;
    }
    // float labels
    const w = this.host.clientWidth, h = this.host.clientHeight;
    for (const l of [...this.labels, ...this.layerTags, ...this.bubbles]) {
      const v = l.pos.clone().project(this.camera);
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
    this.composer.render();
    if (shake) this.camera.position.copy(shake);
  }
}
