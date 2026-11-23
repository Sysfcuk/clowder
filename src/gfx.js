// Graphics building blocks for Clowder's renderer: quality tiers, a GPU particle engine,
// sky presets, and the custom shader passes (god rays, final grade with ripples / glitch /
// photo filters) and materials (territory dissolve, fur rim light).
import * as THREE from 'three';

// ---------- quality tiers ----------
export const QUALITY = {
  low:    { label: 'Low',    dpr: 1,   shadows: false, shadowSize: 1024, ao: false, rays: false, dust: 0,   particles: 0.5, reflect: 0,   transmission: false, iridescence: false, dof: false, director: false },
  medium: { label: 'Medium', dpr: 1.5, shadows: true,  shadowSize: 1024, ao: false, rays: false, dust: 260, particles: 1,   reflect: 0,   transmission: false, iridescence: true,  dof: false, director: true },
  high:   { label: 'High',   dpr: 2,   shadows: true,  shadowSize: 2048, ao: true,  rays: true,  dust: 520, particles: 1.6, reflect: 2.5, transmission: false, iridescence: true,  dof: true,  director: true },
  ultra:  { label: 'Ultra',  dpr: 2,   shadows: true,  shadowSize: 4096, ao: true,  rays: true,  dust: 900, particles: 2.5, reflect: 1,   transmission: true,  iridescence: true,  dof: true,  director: true },
};
export const autoQuality = (mobile) => (mobile ? 'medium' : 'high');

// ---------- GPU particles ----------
/**
 * One big point cloud with a ring buffer of particles. Each particle stores where and when it
 * was born, its velocity, colour, size, swirl and shape; the vertex shader computes its whole
 * flight (drag, gravity, swirl) from those, so the CPU only writes particles when they spawn.
 * Shapes: 0 = glowing spark, 1 = tumbling confetti.
 */
export class GpuParticles {
  constructor(max, sparkTex) {
    this.max = max; this.head = 0; this.mult = 1;
    const g = new THREE.BufferGeometry();
    const attr = (n) => new THREE.BufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { position: attr(3), aVel: attr(3), aColor: attr(3), aTime: attr(2), aMisc: attr(3) };
    for (let i = 0; i < max; i++) this.attrs.aTime.array[i * 2] = -1e4; // all dead
    for (const [k, a] of Object.entries(this.attrs)) g.setAttribute(k, a);
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uTex: { value: sparkTex } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aVel, aColor, aMisc; attribute vec2 aTime;
        uniform float uTime, uScale;
        varying vec3 vColor; varying float vAlpha, vShape, vSpin;
        void main() {
          float age = uTime - aTime.x, life = aTime.y;
          if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          bool conf = aMisc.z > 0.5;
          float k = conf ? 2.4 : 1.5, grav = conf ? 1.1 : 3.0;
          vec3 rel = aVel * (1.0 - exp(-k * age)) / k;
          rel.y -= 0.5 * grav * age * age;
          float sw = aMisc.y * age, c = cos(sw), s = sin(sw);
          rel.xz = mat2(c, -s, s, c) * rel.xz;
          if (aMisc.y < 0.0) rel *= max(0.0, 1.0 - age / life); // vortex: spiral inwards
          vec4 mv = modelViewMatrix * vec4(position + rel, 1.0);
          gl_Position = projectionMatrix * mv;
          float t = age / life;
          vAlpha = (1.0 - t) * smoothstep(0.0, 0.06, age);
          vColor = aColor; vShape = aMisc.z; vSpin = age * 9.0 + aMisc.x * 37.0;
          gl_PointSize = aMisc.x * uScale / max(0.1, -mv.z) * (1.0 - 0.45 * t);
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vColor; varying float vAlpha, vShape, vSpin;
        void main() {
          float a;
          if (vShape > 0.5) {
            vec2 p = gl_PointCoord - 0.5; float c = cos(vSpin), s = sin(vSpin); p = mat2(c, -s, s, c) * p;
            a = step(abs(p.x), 0.34) * step(abs(p.y), 0.1 + 0.14 * abs(sin(vSpin * 0.7)));
            gl_FragColor = vec4(vColor * 1.2, a * vAlpha);
          } else {
            a = texture2D(uTex, gl_PointCoord).a;
            gl_FragColor = vec4(vColor * 2.4, a * vAlpha);
          }
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Spawn particles. opts: { life, size, swirl, shape, up, spread } */
  emit(pos, color, count, speed, time, { life = 0.9, size = 0.16, swirl = 0, shape = 0, up = 1, spread = 0 } = {}) {
    const n = Math.min(this.max, Math.max(1, Math.round(count * this.mult)));
    const c = new THREE.Color(color), A = this.attrs, d = new THREE.Vector3();
    const start = this.head;
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.max;
      d.randomDirection(); d.y = Math.abs(d.y) * 1.4 * up + 0.3 * up;
      const sp = speed * (0.4 + Math.random());
      A.position.setXYZ(i, pos.x + (Math.random() - 0.5) * spread, pos.y + (Math.random() - 0.5) * spread, pos.z + (Math.random() - 0.5) * spread);
      A.aVel.setXYZ(i, d.x * sp, d.y * sp, d.z * sp);
      const v = 0.85 + Math.random() * 0.3;
      A.aColor.setXYZ(i, c.r * v, c.g * v, c.b * v);
      A.aTime.setXY(i, time, life * (0.6 + Math.random() * 0.7));
      A.aMisc.setXYZ(i, size * (0.6 + Math.random() * 0.8), swirl * (0.7 + Math.random() * 0.6), shape);
    }
    // upload only what changed (two ranges when the ring wraps)
    for (const a of Object.values(A)) {
      const s = a.itemSize;
      if (start + n <= this.max) a.addUpdateRange(start * s, n * s);
      else { a.addUpdateRange(start * s, (this.max - start) * s); a.addUpdateRange(0, (start + n - this.max) * s); }
      a.needsUpdate = true;
    }
  }
}

// ---------- dust motes: a slow, glittering haze over the board ----------
export function makeDust(max, sparkTex) {
  const pos = new Float32Array(max * 3), seed = new Float32Array(max);
  for (let i = 0; i < max; i++) { pos.set([(Math.random() - 0.5) * 22, Math.random() * 7 - 0.5, (Math.random() - 0.5) * 22], i * 3); seed[i] = Math.random() * 100; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uTex: { value: sparkTex } };
  const m = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSeed; uniform float uTime, uScale; varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.13 + aSeed) * 0.8; p.z += cos(uTime * 0.11 + aSeed * 1.3) * 0.8;
        p.y = mod(position.y + 0.5 + uTime * 0.12 + aSeed, 7.0) - 0.5; // motes rise slowly and wrap
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.0 + aSeed * 7.0), 4.0)) * smoothstep(-0.5, 0.5, p.y) * (1.0 - smoothstep(5.0, 6.5, p.y));
        gl_PointSize = (0.035 + fract(aSeed) * 0.05) * uScale / max(0.1, -mv.z);
      }`,
    fragmentShader: `uniform sampler2D uTex; varying float vA;
      void main() { gl_FragColor = vec4(vec3(1.0, 0.92, 0.8) * 1.6, texture2D(uTex, gl_PointCoord).a * vA * 0.55); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return { points: pts, uniforms, setCount: (n) => g.setDrawRange(0, Math.min(max, n)) };
}

// ---------- god rays: radial light scattering toward the key light's screen position ----------
export function godRaysShader() {
  return {
    uniforms: { tDiffuse: { value: null }, uLight: { value: new THREE.Vector2(0.2, 1.1) }, uStrength: { value: 0.55 }, uDecay: { value: 0.955 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 uLight; uniform float uStrength, uDecay; varying vec2 vUv;
      #define N 30
      void main() {
        vec3 base = texture2D(tDiffuse, vUv).rgb;
        vec2 delta = (vUv - uLight) / float(N) * 0.85;
        vec2 uv = vUv; float illum = 1.0; vec3 acc = vec3(0.0);
        for (int i = 0; i < N; i++) {
          uv -= delta;
          vec3 s = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
          acc += max(s - 0.55, 0.0) * illum;
          illum *= uDecay;
        }
        gl_FragColor = vec4(base + acc * uStrength / float(N) * vec3(1.0, 0.9, 1.05), 1.0);
      }`,
  };
}

// ---------- final grade: vignette, grain, fringing, shockwave ripples, glitch, photo filters ----------
export function gradeShader() {
  return {
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uNow: { value: 0 }, uAspect: { value: 1 },
      uVig: { value: 0.32 }, uGrain: { value: 0.035 }, uGlitch: { value: 0 },
      uRip: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uSat: { value: 1 }, uContrast: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uBloomTint: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime, uNow, uAspect, uVig, uGrain, uGlitch, uSat, uContrast, uBloomTint;
      uniform vec4 uRip[4]; uniform vec3 uTint; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.0) * 43758.5453); }
      void main(){
        vec2 uv = vUv;
        // shockwave ripples: a ring of refraction expanding from each impact
        for (int i = 0; i < 4; i++) {
          vec4 r = uRip[i];
          float age = uNow - r.z;
          if (r.w > 0.0 && age > 0.0 && age < 1.1) {
            vec2 d = uv - r.xy; d.x *= uAspect;
            float dist = length(d), radius = age * 0.75;
            float band = exp(-pow((dist - radius) * 16.0, 2.0)) * (1.0 - age / 1.1);
            vec2 dir = d / max(dist, 1e-4); dir.x /= uAspect;
            uv -= dir * band * r.w * 0.03;
          }
        }
        // glitch: displaced scanline blocks
        if (uGlitch > 0.001) {
          float row = floor(uv.y * 26.0 + floor(uTime * 24.0));
          float h = fract(sin(row * 91.7) * 4375.5);
          if (h < uGlitch * 0.55) uv.x += (h - 0.25) * 0.09 * uGlitch;
        }
        vec2 d = uv - 0.5; float r2 = dot(d, d);
        vec2 off = d * r2 * 0.012 + vec2(uGlitch * 0.014, 0.0);
        vec3 c = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
        c *= 1.0 - uVig * smoothstep(0.12, 0.62, r2 * 1.6);
        // photo filters
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(lum), c, uSat);
        c = (c - 0.5) * uContrast + 0.5;
        c *= uTint;
        c += vec3(1.0, 0.6, 0.9) * uBloomTint * smoothstep(0.55, 1.0, lum) * 0.25;
        c += (hash(vUv * 1000.0) - 0.5) * uGrain;
        gl_FragColor = vec4(c, 1.0);
      }`,
  };
}

export const FILTERS = {
  natural: { sat: 1, contrast: 1, tint: [1, 1, 1], vig: 0.32, bloom: 0 },
  vivid: { sat: 1.45, contrast: 1.12, tint: [1.02, 1, 1.04], vig: 0.38, bloom: 0 },
  noir: { sat: 0, contrast: 1.3, tint: [1.05, 1.02, 0.98], vig: 0.6, bloom: 0 },
  dream: { sat: 1.15, contrast: 0.9, tint: [1.06, 0.96, 1.1], vig: 0.25, bloom: 1 },
  retro: { sat: 0.75, contrast: 1.05, tint: [1.1, 1.0, 0.82], vig: 0.5, bloom: 0 },
};

// ---------- skies ----------
// Each preset: two palettes (left/right of the rift seam), how split the sky is, accent
// glows, aurora curtains, a spiral galaxy, and how often distant lightning strikes.
export const SKIES = {
  rift:  { a: [0.012, 0.004, 0.04], b: [0.32, 0.05, 0.48], c: [0.03, 0.008, 0.0], d: [0.6, 0.14, 0.02], accent: [0.05, 0.35, 0.6], split: 1, aurora: 0.15, galaxy: 0.45, storm: [5, 14] },
  shore: { a: [0.03, 0.006, 0.05], b: [0.62, 0.2, 0.32], c: [0.03, 0.006, 0.05], d: [0.75, 0.32, 0.12], accent: [0.9, 0.45, 0.2], split: 0.35, aurora: 0, galaxy: 0.7, storm: [12, 25] },
  wilds: { a: [0.006, 0.014, 0.01], b: [0.1, 0.2, 0.11], c: [0.01, 0.012, 0.01], d: [0.2, 0.16, 0.06], accent: [0.25, 0.45, 0.3], split: 0.3, aurora: 0, galaxy: 0, storm: [1.5, 4.5] },
  veil:  { a: [0.008, 0.0, 0.03], b: [0.04, 0.22, 0.4], c: [0.02, 0.0, 0.035], d: [0.42, 0.05, 0.4], accent: [0.9, 0.2, 0.8], split: 0.5, aurora: 1, galaxy: 0.9, storm: [6, 16] },
};

export function skyMaterial() {
  const v3 = (a) => new THREE.Vector3(...a);
  const s = SKIES.rift;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 }, uFlash: { value: 0 },
      uA: { value: v3(s.a) }, uB: { value: v3(s.b) }, uC: { value: v3(s.c) }, uD: { value: v3(s.d) }, uAccent: { value: v3(s.accent) },
      uSplit: { value: s.split }, uAurora: { value: s.aurora }, uGalaxy: { value: s.galaxy },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime, uFlash, uSplit, uAurora, uGalaxy; uniform vec3 uA, uB, uC, uD, uAccent; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float a = .5, s = 0.; for (int k = 0; k < 5; k++) { s += a * noise(p); p *= 2.03; a *= .5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float t = uTime * 0.025;
        float n = fbm(d * 2.6 + vec3(t, t * .5, 0.));
        float n2 = fbm(d * 5.5 - vec3(0., t, t * .7) + n * 1.5);
        float side = smoothstep(-0.3, 0.3, d.x) * uSplit;
        vec3 left = mix(uA, uB, smoothstep(.38, .9, n)) + uAccent * pow(n2, 3.) * 1.1;
        vec3 right = mix(uC, uD, smoothstep(.42, .95, n)) + uD * 0.5 * pow(n2, 3.);
        vec3 col = mix(left, right, side);
        col += vec3(1., .75, 1.) * exp(-abs(d.x) * 22.) * .22 * uSplit * (.5 + .5 * n2);
        // aurora curtains: wavering ribbons of green-to-magenta light above the horizon
        if (uAurora > 0.0) {
          float wave = 0.28 + 0.08 * sin(d.x * 3.0 + uTime * 0.12) + 0.05 * sin(d.z * 5.0 - uTime * 0.07);
          float band = exp(-pow((d.y - wave) * 6.0, 2.0));
          float curtain = pow(fbm(vec3(d.x * 7.0 + uTime * 0.06, d.y * 1.5, d.z * 7.0)), 2.0) * 2.2;
          vec3 ac = mix(vec3(.15, 1., .55), vec3(.9, .25, 1.), .5 + .5 * sin(d.x * 4. + uTime * .2));
          col += uAurora * band * curtain * ac * 0.6;
        }
        // a slowly turning spiral galaxy
        if (uGalaxy > 0.0) {
          vec3 g = normalize(vec3(-0.55, 0.42, -0.72));
          vec3 u = normalize(cross(g, vec3(0., 1., 0.))), v = cross(u, g);
          vec2 p = vec2(dot(d, u), dot(d, v)) / 0.32;
          float r = length(p);
          if (dot(d, g) > 0.7 && r < 2.0) {
            float th = atan(p.y, p.x);
            float arms = pow(0.5 + 0.5 * cos(2.0 * th - 5.5 * log(r + 0.05) + uTime * 0.04), 3.0);
            col += uGalaxy * (arms * exp(-r * 2.2) * 0.4 * vec3(.75, .6, 1.) + exp(-r * 6.0) * vec3(1., .88, .75) * 0.9) * smoothstep(2.0, 1.2, r);
          }
        }
        col += vec3(.32, .28, .55) * uFlash * (.25 + .75 * n2) * smoothstep(-.2, .6, d.y);
        col *= .45 + .55 * smoothstep(-.7, .5, d.y);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}

// ---------- territory paint with a burning dissolve edge ----------
export function paintMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uOld: { value: new THREE.Color(0) }, uNew: { value: new THREE.Color(0) }, uOldA: { value: 0 }, uNewA: { value: 0 }, uT: { value: 1 }, uAlpha: { value: 0.34 }, uSeed: { value: Math.random() * 10 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uOld, uNew; uniform float uOldA, uNewA, uT, uAlpha, uSeed; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float field = 0.55 * length(vUv - 0.5) * 2.0 + 0.45 * (vn(vUv * 7.0) * 0.6 + vn(vUv * 15.0) * 0.4);
        float edge = uT * 1.25 - field;
        float isNew = step(0.0, edge);
        float burn = smoothstep(0.09, 0.0, abs(edge)) * step(uT, 0.999);
        vec3 col = mix(uOld, uNew, isNew) + burn * mix(vec3(1., .55, .15), vec3(1., .95, .8), burn) * 2.5;
        float a = mix(uOldA, uNewA, isNew) * uAlpha + burn * 0.9;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

// ---------- fur rim light: a soft halo of light on silhouette edges (reads as fluff) ----------
export function addRim(material, color, strength = 0.6, power = 2.6) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev?.(shader, r);
    shader.uniforms.uRimColor = { value: new THREE.Color(color) };
    shader.uniforms.uRimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), ${power.toFixed(2)});
        totalEmissiveRadiance += uRimColor * rimF * uRimStrength;`);
  };
  material.customProgramCacheKey = () => 'rim' + color + strength;
  material.needsUpdate = true;
  return material;
}
