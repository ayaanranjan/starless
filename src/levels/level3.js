// STARLESS — CHAPTER III: THE DARK BETWEEN (L3 owner)
// Dark-matter realm: floating islands + wreckage in a violet void. 3 singularity shards -> Gate -> collapse -> wormhole.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), xf), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), xf), yf),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), xf), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), xf), yf), zf);
}

// ---------- layout (fixed numbers = identical on all peers) ----------
const L = {
  start: { x: 0, y: 0, z: 46, r: 9 },
  plaza: { x: 0, y: 0, z: 0, r: 15 },
  ringIsle: { x: 0, y: 0, z: -64, r: 12 },
  isleA: { x: -74, y: 6, z: -6, r: 9 },
  isleB: { x: 66, y: 0, z: 6, r: 12 },
  isleC: { x: 31, y: 26, z: -62, r: 9 },
  p1: { x: 31, y: 0, z: -8, r: 6 },
  p2: { x: 31, y: 12, z: -34, r: 5.5 },
  ringZ: -66, ringY: 10.4, Ri: 10, Ro: 12.5,
};
const QI = new THREE.Quaternion();
// audio.js hands out a shared no-op loop (`setPosition() {}`) before init; same heuristic as creatures/common.js
const inertLoop = (h) => !h || (typeof h.setPosition === 'function' && String(h.setPosition).replace(/\s/g, '').length <= 16);
const WORM_OPEN_AT = 6.5; // seconds after gate activation the wormhole accepts players

// ---------- shaders ----------
const UV_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `
uniform float uTime; uniform float uCollapse; varying vec3 vDir;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1.0,0.0,0.0)), f.x), mix(h3(i + vec3(0.0,1.0,0.0)), h3(i + vec3(1.0,1.0,0.0)), f.x), f.y),
             mix(mix(h3(i + vec3(0.0,0.0,1.0)), h3(i + vec3(1.0,0.0,1.0)), f.x), mix(h3(i + vec3(0.0,1.0,1.0)), h3(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < OCT; i++){ s += a * vn(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float t = uTime * (0.01 + uCollapse * 0.06);
  vec3 q = d * 2.0 + vec3(t, t * 0.5, -t * 0.7);
  float w = fbm(q * 1.6 + vec3(0.0, t, 0.0));
  float n1 = fbm(q + w * 1.3);
  float n2 = fbm(d * 4.2 - vec3(t * 0.8, 0.0, t) + w * 0.6);
  float n3 = fbm(d * 2.7 + vec3(5.2, 1.3, -2.0) + t * 0.4);
  vec3 col = vec3(0.010, 0.004, 0.022);
  float neb = smoothstep(0.38, 0.82, n1);
  col += vec3(0.20, 0.05, 0.34) * neb * 0.6;
  col += vec3(0.36, 0.04, 0.24) * smoothstep(0.5, 0.88, n2) * neb * 0.55;
  col += vec3(0.02, 0.22, 0.26) * smoothstep(0.55, 0.9, n3) * 0.4;
  col *= 0.5 + 0.5 * smoothstep(0.2, 0.62, n2);
  float bq = d.y * 3.2 + 0.35 * sin(d.x * 2.3 + d.z); float band = exp(-bq * bq); // no pow(neg, 2.0): undefined in GLSL (NaN on Metal)
  col += vec3(0.07, 0.035, 0.12) * band * (0.35 + 0.65 * n1);
  vec3 sp = floor(d * 260.0);
  col += vec3(0.75, 0.65, 1.0) * step(0.9985, h3(sp)) * (0.3 + 0.7 * h3(sp + 7.0)) * 0.6;
  col = mix(col, col * vec3(1.7, 0.55, 1.15) + vec3(0.05, 0.0, 0.025) * n1, uCollapse * 0.65);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const STREAM_VS = `varying vec2 vUv; varying float vF;
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 v = normalize(cameraPosition - wp.xyz); vF = abs(dot(n, v)); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const STREAM_FS = `uniform float uTime; uniform vec3 uColA; uniform vec3 uColB; uniform float uBoost; varying vec2 vUv; varying float vF;
void main(){
  float b = pow(0.5 + 0.5 * sin(vUv.x * 46.0 - uTime * 1.3), 3.0);
  float fil = 0.5 + 0.5 * sin(vUv.x * 160.0 - uTime * 4.0 + vUv.y * 12.566);
  float core = pow(vF, 2.2);
  float ends = smoothstep(0.0, 0.07, vUv.x) * (1.0 - smoothstep(0.93, 1.0, vUv.x));
  vec3 col = mix(uColA, uColB, b);
  gl_FragColor = vec4(col * core * (0.22 + 0.78 * b) * (0.55 + 0.45 * fil) * ends * uBoost, 1.0);
}`;
const PTS_VS = `attribute float aSize; attribute vec3 aColor; uniform float uScale; varying vec3 vC; varying float vFade;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float dist = max(0.1, -mv.z);
  gl_PointSize = clamp(aSize * uScale / dist, 1.0, 48.0); vC = aColor; vFade = 1.0 - smoothstep(180.0, 420.0, dist);
  gl_Position = projectionMatrix * mv; }`;
const PTS_FS = `varying vec3 vC; varying float vFade;
void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(vC * a * a * vFade, 1.0); }`;
const WH_FS = `uniform float uTime; uniform float uOpen; varying vec2 vUv;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float sw = ang + 2.2 / (r + 0.18) - uTime * 0.9;
  float arms = 0.5 + 0.5 * sin(sw * 3.0 + n2(vec2(sw * 1.5, r * 7.0 - uTime * 0.6)) * 4.0); arms = arms * arms;
  vec2 lp = vec2(cos(sw), sin(sw)) * (0.35 / (r + 0.06));
  float stars = step(0.975, h2(floor(lp * 24.0))) * (1.0 - smoothstep(0.4, 0.95, r));
  float rim = smoothstep(0.78, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float core = 1.0 - smoothstep(0.0, 0.32, r);
  vec3 col = mix(vec3(0.32, 0.08, 0.62), vec3(0.25, 0.85, 1.0), arms) * arms * (1.0 - smoothstep(0.2, 1.0, r)) * 1.1;
  col += vec3(0.85, 0.8, 1.0) * rim * 1.8 + vec3(1.0, 0.8, 0.5) * core * core * 2.2 + vec3(0.85, 0.9, 1.0) * stars;
  gl_FragColor = vec4(col * (0.4 + 0.6 * uOpen), (1.0 - smoothstep(0.93, 1.0, r)) * uOpen);
}`;
const HALO_FS = `uniform float uTime; uniform float uOpen; varying vec2 vUv;
void main(){ vec2 p = (vUv - 0.5) * 44.0; float r = length(p); float a = atan(p.y, p.x);
  float rq = (r - 13.5) / 3.5; float ring = exp(-rq * rq); float streak = 0.5 + 0.5 * sin(a * 14.0 + uTime * 2.0 + r * 0.4);
  float glow = exp(-max(r - 10.0, 0.0) * 0.18) * step(10.0, r);
  vec3 col = vec3(0.55, 0.3, 1.0) * ring * (0.4 + 0.6 * streak) + vec3(0.4, 0.7, 1.0) * glow * 0.35;
  gl_FragColor = vec4(col * uOpen, 1.0); }`;
const WP_VS = `attribute vec3 aSeed; uniform float uTime; uniform float uOpen; uniform float uScale; varying float vA; varying float vPh;
void main(){ float ph = fract(aSeed.y + uTime * (0.08 + aSeed.z * 0.1)); float r = mix(17.0, 0.6, ph);
  float an = aSeed.x + ph * 8.0 + uTime * 0.25; vec3 p = vec3(cos(an) * r, sin(an) * r, (1.0 - ph) * 2.5 * sin(aSeed.x * 7.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = clamp((0.25 + 0.45 * ph) * uScale / max(0.1, -mv.z), 1.0, 40.0);
  vA = uOpen * smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.85, 1.0, ph)); vPh = ph; gl_Position = projectionMatrix * mv; }`;
const WP_FS = `varying float vA; varying float vPh;
void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(mix(vec3(0.6, 0.35, 1.0), vec3(0.8, 0.95, 1.0), vPh) * a * vA, 1.0); }`;
const RUNE_VS = `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RUNE_FS = `uniform sampler2D uTex; uniform float uTime; uniform float uInt; uniform vec3 uCol; uniform float uRi; uniform float uRo; varying vec2 vP;
void main(){ float r = length(vP); float a = atan(vP.y, vP.x) / 6.2831853 + 0.5; float v = clamp((r - uRi) / (uRo - uRi), 0.0, 1.0);
  float g = texture2D(uTex, vec2(a * 4.0, v)).r; float pulse = 0.55 + 0.45 * sin(uTime * 1.4 - a * 31.4159);
  float edge = smoothstep(0.0, 0.08, v) * (1.0 - smoothstep(0.92, 1.0, v));
  gl_FragColor = vec4(uCol * g * uInt * pulse * edge, 1.0); }`;
const RIFT_FS = `uniform float uTime; uniform float uI; varying vec2 vUv;
void main(){ vec2 p = vUv - 0.5; float wob = 0.06 * sin(p.y * 9.0 + uTime * 1.3) + 0.025 * sin(p.y * 31.0 - uTime * 2.7);
  float w = 0.018 + 0.02 * (0.5 + 0.5 * sin(p.y * 17.0 + uTime * 4.0)); float d = abs(p.x - wob);
  float core = exp(-pow(d / w, 2.0)); float glow = exp(-d * 9.0) * 0.45; float fade = 1.0 - smoothstep(0.32, 0.5, abs(p.y));
  gl_FragColor = vec4((vec3(0.6, 0.3, 1.0) * glow + vec3(1.0, 0.92, 1.0) * core) * fade * uI, 1.0); }`;
const PAD_FS = `uniform float uTime; uniform vec3 uCol; varying vec2 vUv;
void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
  float rings = 0.5 + 0.5 * sin(r * 18.0 - uTime * 6.0); float edge = smoothstep(0.8, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
  gl_FragColor = vec4(uCol * (pow(rings, 4.0) * (1.0 - r) * 0.8 + edge * 1.5), 1.0); }`;
const BEAM_FS = `uniform float uTime; uniform vec3 uCol; varying vec2 vUv;
void main(){ float f = 1.0 - vUv.y; float s = 0.6 + 0.4 * sin(vUv.y * 20.0 - uTime * 8.0); gl_FragColor = vec4(uCol * f * f * s * 0.55, 1.0); }`;

// ---------- canvas textures ----------
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function glowTexture() {
  return canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,0.5)'); r.addColorStop(0.5, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
}
function galaxyTexture(hue, rnd) {
  return canvasTex(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(255,240,255,0.95)'); r.addColorStop(0.07, `hsla(${hue},70%,80%,0.5)`); r.addColorStop(0.35, `hsla(${hue},60%,45%,0.1)`); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 256, 256); g.globalCompositeOperation = 'lighter';
    for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 1100; i++) {
      const t = rnd(); const a = arm * Math.PI + t * 4.6 + (rnd() - 0.5) * 0.55; const rr = 5 + t * 112 + (rnd() - 0.5) * 9;
      g.fillStyle = `hsla(${hue + rnd() * 50 - 10},80%,${60 + rnd() * 30}%,${0.28 * (1 - t) + 0.05})`;
      const s = rnd() * 1.8 + 0.4; g.fillRect(128 + Math.cos(a) * rr, 128 + Math.sin(a) * rr, s, s);
    }
  });
}
function runeTexture(rnd) {
  const t = canvasTex(1024, 128, (g) => {
    g.clearRect(0, 0, 1024, 128); g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round'; g.shadowColor = '#fff'; g.shadowBlur = 8;
    for (let i = 0; i < 22; i++) {
      const x0 = i * 46.5 + 8, y0 = 28, w = 30, h = 72; g.beginPath();
      let x = x0 + rnd() * w, y = y0 + rnd() * h; g.moveTo(x, y);
      const segs = 3 + (rnd() * 4 | 0); for (let s = 0; s < segs; s++) { x = x0 + rnd() * w; y = y0 + rnd() * h; g.lineTo(x, y); }
      g.stroke(); if (rnd() < 0.55) { g.beginPath(); g.arc(x0 + 15, y0 + 36, 5 + rnd() * 9, 0, Math.PI * (1 + rnd())); g.stroke(); }
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; return t;
}
function panelTexture(rnd) {
  const t = canvasTex(512, 256, (g) => {
    g.fillStyle = '#8d929c'; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '40,40,48' : '200,205,215'},${0.05 + rnd() * 0.1})`; g.fillRect(rnd() * 512, rnd() * 256, 20 + rnd() * 120, 10 + rnd() * 60); }
    g.strokeStyle = 'rgba(30,30,36,0.7)'; g.lineWidth = 2;
    for (let x = 0; x <= 512; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    for (let y = 0; y <= 256; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    for (let i = 0; i < 9; i++) { const x = rnd() * 512, y = rnd() * 256, r = 20 + rnd() * 60; const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(10,8,12,0.85)'); gr.addColorStop(1, 'rgba(10,8,12,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function nameTexture() {
  return canvasTex(1024, 160, (g) => {
    g.clearRect(0, 0, 1024, 160); g.fillStyle = 'rgba(225,228,235,0.92)'; g.font = 'bold 92px "Arial Black", Arial, sans-serif'; g.textBaseline = 'middle';
    g.fillText('ICV PERIHELION', 24, 70); g.font = 'bold 30px monospace'; g.fillText('UNEC DEEP SURVEY  ·  HULL 07  ·  2091', 28, 135);
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 420; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.8})`; g.fillRect(Math.random() * 1024, Math.random() * 160, 2 + Math.random() * 14, 2 + Math.random() * 5); }
  });
}

export default class Level3 {
  static id = 'l3';
  static title = 'CHAPTER III';
  static subtitle = 'THE DARK BETWEEN';

  constructor(ctx) {
    this.ctx = ctx;
    this.t = 0;
    this.objs = []; this.textures = []; this.interactIds = []; this.loops = [];
    this.creatures = []; this.watcher = null; this.createCreature = null;
    this.shards = [false, false, false]; this.shardShown = [true, true, true]; this.shardObjs = [];
    this.gate = false; this.gateActive = false; this.collapseStart = -1;
    this.logPlayed = false; this.logShown = false;
    this.objective = ''; this.subQueue = []; this.subT = 0;
    this.crumbles = []; this.slabs = []; this.pads = []; this.flight = null; this.padCool = 0;
    this.completed = false; this.sentEnter = false; this.spawnAtGate = false;
    this.noiseT = 0; this.tensionT = 0; this.shakeT = 0; this.groanT = 8; this.saidWatcher = false; this.saidWraith = false;
    this.flickers = []; this.islets = [];
    this.uTime = { value: 0 };
    this._warned = {};
  }

  // ======================= BUILD =======================
  async build(save) {
    const ctx = this.ctx;
    this.R = mulberry32(0x5eed3);
    this.low = ctx.quality === 'low';
    this.spawnAtGate = !!save?.gate;
    try { ctx.rng?.(); } catch (e) { /* keep rng stream touched consistently */ }
    ctx.scene.background = new THREE.Color(0x05020a);
    ctx.scene.fog = new THREE.FogExp2(0x0c0617, 0.0042);
    ctx.setGravity?.(-7);
    ctx.setOxygenDrain?.(0.35);
    if (ctx.world) { ctx.world.killY = -60; ctx.world.bounds = null; }
    const cam = ctx.camera;
    if (cam && cam.far < 1400) { this._oldFar = cam.far; cam.far = 1400; cam.updateProjectionMatrix(); }
    ctx.audio?.ambience?.('l3');
    try { const m = await import('../creatures/creatures.js'); this.createCreature = m.createCreature || m.default?.createCreature || null; }
    catch (e) { console.warn('[L3] creatures unavailable', e); }

    this.glowTex = glowTexture(); this.textures.push(this.glowTex);
    this.panelTex = panelTexture(this.R); this.textures.push(this.panelTex);
    const steps = ['buildLights', 'buildSky', 'buildStreams', 'buildDebris', 'buildIslands', 'buildGate', 'buildPerihelion', 'buildShards', 'buildPads', 'buildShrines', 'buildRift', 'buildCreatures'];
    // fresh fixed-seed stream per step: quality-dependent counts (low/high) in one step must not shift
    // the layout (crate colliders etc.) of later steps between peers with different quality settings
    steps.forEach((s, k) => { this.R = mulberry32(0x5eed3 + (k + 1) * 0x9e37); try { this[s](); } catch (e) { console.error('[L3] ' + s + ' failed', e); } });

    if (save) {
      (save.shards || []).forEach((b, i) => { if (b) this.collectShard(i, true); });
      if (save.gate) this.activateGate(true);
    }
    this.updateInteractables();
    this.updateObjective(true);
    if (!save) this.queueIntro();
    else this.say('HALE', 'Signal reacquired. Resuming from my last stable memory.', 3.5);
  }

  add(o) { this.ctx.scene.add(o); this.objs.push(o); return o; }
  box(x0, y0, z0, x1, y1, z1) { try { return this.ctx.world?.addBox?.(V(x0, y0, z0), V(x1, y1, z1)); } catch (e) { return undefined; } }
  islandBoxes(cx, cy, cz, r, h = 4) {
    const s = r * 0.66, l = r * 0.9, w = r * 0.42;
    return [this.box(cx - s, cy - h, cz - s, cx + s, cy, cz + s), this.box(cx - l, cy - h, cz - w, cx + l, cy, cz + w), this.box(cx - w, cy - h, cz - l, cx + w, cy, cz + l)];
  }

  rockGeo(r, depth, seed) {
    const geo = new THREE.IcosahedronGeometry(1, r > 4 ? 3 : 2);
    const pos = geo.attributes.position; const cols = new Float32Array(pos.count * 3);
    const cT = new THREE.Color(0x3a3049), cT2 = new THREE.Color(0x56446f), cB = new THREE.Color(0x15111c), cB2 = new THREE.Color(0x2c2238), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = noise3(x * 2.3 + seed, y * 2.3, z * 2.3 - seed), n2 = noise3(x * 6 + seed, y * 6, z * 6);
      if (y > -0.12) { const k = 1 + (n - 0.5) * 0.12; x *= r * k; z *= r * k; y = -0.05 + (n2 - 0.5) * 0.06; tmp.copy(cT).lerp(cT2, n2); }
      else { const t = Math.min(1, (-y - 0.12) / 0.88); const tp = (1 - t * 0.7) * (0.85 + n * 0.3); x *= r * tp; z *= r * tp; y = -0.3 - t * depth * (0.75 + n * 0.5); tmp.copy(cB).lerp(cB2, n2 * (1 - t)); }
      pos.setXYZ(i, x, y, z); cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geo.computeVertexNormals(); return geo;
  }
  island(c, depth, collide = true) {
    const m = new THREE.Mesh(this.rockGeo(c.r, depth, this.R() * 500), this.rockMat); m.position.set(c.x, c.y, c.z); this.add(m);
    return { mesh: m, boxes: collide ? this.islandBoxes(c.x, c.y, c.z, c.r) : [] };
  }

  buildLights() {
    this.add(new THREE.HemisphereLight(0x6b5aa8, 0x0d0716, 0.9));
    this.add(new THREE.AmbientLight(0x2a1f45, 0.6));
    const d = new THREE.DirectionalLight(0xc8b8ff, 0.9); d.position.set(-120, 200, 80); this.add(d);
    const r = new THREE.DirectionalLight(0x3fd6d0, 0.35); r.position.set(150, -60, -120); this.add(r);
  }

  buildSky() {
    const g = new THREE.Group();
    this.skyMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uCollapse: { value: 0 } }, vertexShader: SKY_VS, fragmentShader: SKY_FS,
      side: THREE.BackSide, depthWrite: false, depthTest: false, defines: { OCT: this.low ? 3 : 5 } });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), this.skyMat); sky.renderOrder = -1000; sky.frustumCulled = false; g.add(sky);
    const rnd = mulberry32(77);
    const gals = [[-0.5, 0.35, -0.8, 150, 280, 0.9], [0.8, 0.5, -0.3, 90, 200, 0.5], [0.2, -0.3, 0.9, 120, 320, 1.2], [-0.9, 0.1, 0.4, 70, 180, 0.2], [0.4, 0.75, 0.5, 60, 260, 1.4]];
    this.galaxies = [];
    for (const [x, y, z, size, hue, tilt] of gals) {
      const tex = galaxyTexture(hue, rnd); this.textures.push(tex);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, opacity: 0.85 }));
      m.position.set(x, y, z).normalize().multiplyScalar(520); m.lookAt(0, 0, 0); m.rotateX(tilt); m.renderOrder = -900; g.add(m); this.galaxies.push(m);
    }
    this.skyGroup = this.add(g);
    // a colossal derelict ring, far away (abducted megastructure)
    const far = new THREE.Mesh(new THREE.TorusGeometry(70, 4.5, 10, 64, Math.PI * 1.35), new THREE.MeshBasicMaterial({ color: 0x07050b, fog: false }));
    far.position.set(260, 70, -330); far.rotation.set(0.9, 0.4, 0.3); far.renderOrder = -800; this.add(far);
  }

  buildStreams() {
    const defs = [
      { p: [[-260, -20, -120], [-120, 8, -40], [-48, 22, 8], [20, 30, 34], [90, 8, 52], [260, -12, 80]], r: 1.6, a: 0x7a3cff, b: 0x40e0ff },
      { p: [[-200, -60, 180], [-80, -22, 70], [0, -16, 22], [48, -26, -48], [150, -40, -160]], r: 2.4, a: 0xb03cff, b: 0xff4fd8 },
      { p: [[160, 70, -260], [70, 44, -120], [-10, 42, -40], [-70, 36, 20], [-200, 60, 120]], r: 1.4, a: 0x46d9ff, b: 0x9a5cff },
      { p: [[-260, -40, -10], [-100, -24, -14], [0, -30, -8], [100, -20, -2], [260, -44, 4]], r: 3.0, a: 0x5a1fb0, b: 0x30c8d0 },
      { p: [[80, -90, -200], [50, 0, -140], [60, 60, -90], [20, 130, -30]], r: 1.8, a: 0xff5ad0, b: 0x7a3cff },
    ];
    const per = this.low ? 50 : 120, R = this.R;
    const total = per * defs.length;
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3), size = new Float32Array(total);
    this.streamData = []; this.streamMats = [];
    defs.forEach((d, si) => {
      const curve = new THREE.CatmullRomCurve3(d.p.map(a => V(a[0], a[1], a[2])));
      const mat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uColA: { value: new THREE.Color(d.a) }, uColB: { value: new THREE.Color(d.b) }, uBoost: { value: 1.0 } },
        vertexShader: STREAM_VS, fragmentShader: STREAM_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.streamMats.push(mat);
      this.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 220, d.r, 8, false), mat));
      const pts = curve.getSpacedPoints(255); const tab = new Float32Array(256 * 3); pts.forEach((p, i) => { tab[i * 3] = p.x; tab[i * 3 + 1] = p.y; tab[i * 3 + 2] = p.z; });
      const ca = new THREE.Color(d.a), cb = new THREE.Color(d.b);
      const u0 = new Float32Array(per), sp = new Float32Array(per), jit = new Float32Array(per * 3);
      for (let i = 0; i < per; i++) {
        u0[i] = R(); sp[i] = 0.004 + R() * 0.01; const k = si * per + i;
        jit[i * 3] = (R() - 0.5) * d.r * 5; jit[i * 3 + 1] = (R() - 0.5) * d.r * 5; jit[i * 3 + 2] = (R() - 0.5) * d.r * 5;
        const c = ca.clone().lerp(cb, R()); col[k * 3] = c.r * 1.4; col[k * 3 + 1] = c.g * 1.4; col[k * 3 + 2] = c.b * 1.4; size[k] = 0.6 + R() * 1.4;
      }
      this.streamData.push({ tab, u0, sp, jit, off: si * per, n: per });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.ptsMat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 300 } }, vertexShader: PTS_VS, fragmentShader: PTS_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.streamPts = new THREE.Points(geo, this.ptsMat); this.streamPts.frustumCulled = false; this.add(this.streamPts);
    this.updateStreamPts();
  }
  updateStreamPts() {
    const arr = this.streamPts.geometry.attributes.position.array, t = this.t;
    for (const s of this.streamData) {
      for (let i = 0; i < s.n; i++) {
        let u = (s.u0[i] + t * s.sp[i]) % 1; const f = u * 255, i0 = f | 0, i1 = Math.min(255, i0 + 1), fr = f - i0, k = (s.off + i) * 3;
        arr[k] = s.tab[i0 * 3] + (s.tab[i1 * 3] - s.tab[i0 * 3]) * fr + s.jit[i * 3];
        arr[k + 1] = s.tab[i0 * 3 + 1] + (s.tab[i1 * 3 + 1] - s.tab[i0 * 3 + 1]) * fr + s.jit[i * 3 + 1];
        arr[k + 2] = s.tab[i0 * 3 + 2] + (s.tab[i1 * 3 + 2] - s.tab[i0 * 3 + 2]) * fr + s.jit[i * 3 + 2];
      }
    }
    this.streamPts.geometry.attributes.position.needsUpdate = true;
  }

  buildDebris() {
    const R = this.R, n1 = this.low ? 120 : 260, n2 = this.low ? 80 : 170;
    this.metalMat = new THREE.MeshStandardMaterial({ color: 0x5d5a66, metalness: 0.6, roughness: 0.55, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2233, roughness: 0.95, flatShading: true });
    const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.metalMat, n1);
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMat, n2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const pick = () => { for (let k = 0; k < 40; k++) { const a = R() * Math.PI * 2, d = 60 + R() * 270, y = -120 + R() * 240; p.set(Math.cos(a) * d, y, Math.sin(a) * d - 15); if (d > 125 || y < -30 || y > 64) return; } };
    for (let i = 0; i < n1; i++) {
      pick(); e.set(R() * 6.28, R() * 6.28, R() * 6.28); q.setFromEuler(e); const k = R();
      if (k < 0.5) sc.set(2 + R() * 6, 0.15 + R() * 0.3, 1 + R() * 4); else if (k < 0.8) sc.set(0.3 + R() * 0.4, 0.3 + R() * 0.4, 4 + R() * 12); else sc.set(1.5 + R() * 3, 1.5 + R() * 3, 1.5 + R() * 3);
      m4.compose(p, q, sc); plates.setMatrixAt(i, m4);
    }
    for (let i = 0; i < n2; i++) { pick(); e.set(R() * 6.28, R() * 6.28, R() * 6.28); q.setFromEuler(e); const s = 0.8 + R() * R() * 9; sc.set(s, s * (0.6 + R() * 0.6), s); m4.compose(p, q, sc); rocks.setMatrixAt(i, m4); }
    this.debrisA = new THREE.Group(); this.debrisA.add(plates); this.debrisA.rotation.x = 0.06; this.add(this.debrisA);
    this.debrisB = new THREE.Group(); this.debrisB.add(rocks); this.debrisB.rotation.z = -0.05; this.add(this.debrisB);
    // big ship fragments (abducted vessels) drifting near the islands
    const frag = (x, y, z, ry, rz, len, rad) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(0.2, ry, rz);
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.8, len, 12, 1, true, 0, Math.PI * 1.6), this.metalMat); hull.rotation.z = Math.PI / 2; g.add(hull);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.4, 0.3, rad * 3), this.metalMat); fin.position.set(-len * 0.2, rad * 0.6, 0); g.add(fin);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5544 })); lamp.position.set(len * 0.45, rad, 0); g.add(lamp);
      this.flickers.push({ mesh: lamp, kind: 'blink', ph: R() * 6 });
      this.add(g); this.islets.push({ obj: g, y0: y, ph: R() * 6, amp: 0.6, spin: (R() - 0.5) * 0.02 });
    };
    frag(-40, 34, -70, 0.6, 0.3, 26, 3); frag(105, 18, -40, -0.8, -0.2, 34, 4); frag(-110, -14, 40, 1.2, 0.5, 22, 2.6); frag(40, -30, 70, 0.1, -0.4, 30, 3.5);
  }

  buildIslands() {
    const R = this.R;
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.04, flatShading: true, emissive: 0x0a0612 });
    for (const [c, d] of [[L.start, 14], [L.plaza, 24], [L.ringIsle, 20], [L.isleA, 16], [L.isleB, 16], [L.isleC, 22]]) this.island(c, d);
    const p1 = this.island(L.p1, 9), p2 = this.island(L.p2, 8);
    this.p1Isle = p1; this.p2Isle = p2;
    // under-island glowing crystals (one draw call)
    const cg = new THREE.OctahedronGeometry(1, 0); const cm = new THREE.MeshStandardMaterial({ color: 0x2a0d4a, emissive: 0x8a4dff, emissiveIntensity: 1.6, roughness: 0.3 });
    const N = 70; const cr = new THREE.InstancedMesh(cg, cm, N); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const isl = [L.start, L.plaza, L.ringIsle, L.isleA, L.isleB, L.isleC];
    for (let i = 0; i < N; i++) {
      const c = isl[i % isl.length], a = R() * 6.28, rr = c.r * (0.3 + R() * 0.55);
      e.set((R() - 0.5) * 0.8, R() * 6, (R() - 0.5) * 0.8); q.setFromEuler(e); const s = 0.4 + R() * 1.2;
      m4.compose(V(c.x + Math.cos(a) * rr, c.y - 1.5 - R() * c.r * 0.7, c.z + Math.sin(a) * rr), q, V(s * 0.5, s * 1.8, s * 0.5)); cr.setMatrixAt(i, m4);
    }
    this.add(cr); this.underCrystalMat = cm;
    // bridge plating material
    const plate = new THREE.MeshStandardMaterial({ color: 0x6d6b78, map: this.panelTex, metalness: 0.55, roughness: 0.6 });
    this.plateMat = plate;
    const slab = (x0, x1, z0, z1, y = 0, tilt = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.6, z1 - z0), plate); m.position.set((x0 + x1) / 2, y - 0.3, (z0 + z1) / 2); m.rotation.z = tilt; m.rotation.x = tilt * 0.5; this.add(m); return m;
    };
    // causeway start -> plaza (permanent)
    for (let i = 0; i < 5; i++) slab(-2.1, 2.1, 13 + i * 5.1, 13 + i * 5.1 + 4.9, 0, (R() - 0.5) * 0.03);
    this.box(-2.1, -1, 12.8, 2.1, 0, 38.8);
    // bridge plaza -> Perihelion island (east, with a gap) — crumbles on collapse
    [[13, 23], [23, 32], [35.5, 45], [45, 55.6]].forEach(([a, b], k) => {
      const m = slab(a, b, 2.4, 5.6, 0, (R() - 0.5) * 0.03); const id = this.box(a, -1, 2.4, b, 0, 5.6);
      this.crumbles.push({ objs: [m], boxes: [id], tc: 20 + k * 2 });
    });
    // walkway plaza -> P1 (jump pads)
    { const m = slab(9.5, 25.8, -9.5, -6.5, 0); const id = this.box(9.5, -1, -9.5, 25.8, 0, -6.5); this.crumbles.push({ objs: [m], boxes: [id], tc: 12 }); }
    this.crumbles.push({ objs: [p1.mesh], boxes: p1.boxes, tc: 14, padIdx: 0 }, { objs: [p2.mesh], boxes: p2.boxes, tc: 18, padIdx: 1 });
    // stepping stones plaza -> isle A (west)
    const NS = 10;
    for (let k = 0; k < NS; k++) {
      const t = k / (NS - 1), x = -17 + (-63 + 17) * t, z = Math.sin(t * Math.PI * 2) * 3.5 - t * 6, y = t * 5.4 + (k % 3 === 1 ? 0.6 : 0), r = k % 3 === 2 ? 1.45 : 1.75;
      const m = new THREE.Mesh(this.rockGeo(r, 2.5 + R() * 2, R() * 100), this.rockMat); m.position.set(x, y, z); this.add(m);
      const h = r * 0.72; const id = this.box(x - h, y - 2, z - h, x + h, y, z + h);
      this.crumbles.push({ objs: [m], boxes: [id], tc: 16 + (NS - 1 - k) * 1.0 });
    }
    // decorative islets (no colliders) — some fall during the collapse
    for (let i = 0; i < 14; i++) {
      const a = R() * 6.28, d = 30 + R() * 70, y = -18 + R() * 50; const x = Math.cos(a) * d, z = Math.sin(a) * d - 12;
      if (Math.abs(x) < 20 && z > -80 && z < 50) continue;
      const r = 1.5 + R() * 4; const m = new THREE.Mesh(this.rockGeo(r, r * 1.6, R() * 100), this.rockMat); m.position.set(x, y, z); m.rotation.y = R() * 6; this.add(m);
      this.islets.push({ obj: m, y0: y, ph: R() * 6, amp: 0.3 + R() * 0.8, spin: 0 });
      if (i % 2 === 0) this.crumbles.push({ objs: [m], boxes: [], tc: 6 + i * 2.2, islet: true });
    }
    // plaza monoliths
    const monoMat = new THREE.MeshStandardMaterial({ color: 0x100d16, roughness: 0.85, emissive: 0x1b0830 });
    for (const [x, z, h] of [[-11.2, 8.2, 7], [-10.6, -8.4, 9], [11.4, 9.6, 6], [7.8, -12.6, 8], [-6.2, -13.2, 6.5]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.0), monoMat); m.position.set(x, h / 2 - 0.3, z); m.rotation.set((R() - 0.5) * 0.08, R() * 3, (R() - 0.5) * 0.08); this.add(m);
      this.box(x - 0.6, -0.5, z - 0.6, x + 0.6, h - 0.5, z + 0.6);
    }
  }

  buildGate() {
    const { Ri, Ro, ringZ, ringY } = L, depth = 2.6, R = this.R;
    const shape = new THREE.Shape(); shape.absarc(0, 0, Ro, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, Ri, 0, Math.PI * 2, true); shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.3, bevelSegments: 1, curveSegments: 96 }); geo.translate(0, 0, -depth / 2);
    const stone = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.8, metalness: 0.15, emissive: 0x12051f, emissiveIntensity: 0.6 });
    const gate = new THREE.Group(); gate.position.set(0, ringY, ringZ); gate.add(new THREE.Mesh(geo, stone)); this.gateGroup = gate;
    // chevrons
    const chev = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.6, 3.4), stone, 9); const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.5, 3.5), new THREE.MeshBasicMaterial({ color: 0x9a5cff }), 9);
    this.chevGlowMat = glow.material;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 9; i++) { const a = Math.PI / 2 + i * (Math.PI * 2 / 9); q.setFromAxisAngle(V(0, 0, 1), a - Math.PI / 2);
      m4.compose(V(Math.cos(a) * (Ro + 0.5), Math.sin(a) * (Ro + 0.5), 0), q, V(1, 1, 1)); chev.setMatrixAt(i, m4);
      m4.compose(V(Math.cos(a) * (Ro + 0.9), Math.sin(a) * (Ro + 0.9), 0), q, V(1, 1, 1)); glow.setMatrixAt(i, m4); }
    gate.add(chev, glow);
    // runes front/back
    const rt = runeTexture(R); this.textures.push(rt);
    this.runeMat = new THREE.ShaderMaterial({ uniforms: { uTex: { value: rt }, uTime: this.uTime, uInt: { value: 0.3 }, uCol: { value: new THREE.Color(0xa060ff) }, uRi: { value: Ri + 0.2 }, uRo: { value: Ro - 0.1 } },
      vertexShader: RUNE_VS, fragmentShader: RUNE_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rg = new THREE.RingGeometry(Ri + 0.2, Ro - 0.1, 160, 1);
    const f = new THREE.Mesh(rg, this.runeMat); f.position.z = depth / 2 + 0.37; gate.add(f);
    const b = new THREE.Mesh(rg, this.runeMat); b.position.z = -depth / 2 - 0.37; b.rotation.y = Math.PI; gate.add(b);
    // wormhole disc + halo + particles
    this.whMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uOpen: { value: 0 } }, vertexShader: UV_VS, fragmentShader: WH_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.whDisc = new THREE.Mesh(new THREE.CircleGeometry(Ri, 96), this.whMat); this.whDisc.visible = false; gate.add(this.whDisc);
    this.haloMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uOpen: { value: 0 } }, vertexShader: UV_VS, fragmentShader: HALO_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), this.haloMat); this.halo.position.z = -0.6; this.halo.visible = false; gate.add(this.halo);
    const NP = this.low ? 250 : 600; const pg = new THREE.BufferGeometry(); const seeds = new Float32Array(NP * 3);
    for (let i = 0; i < NP; i++) { seeds[i * 3] = R() * 6.283; seeds[i * 3 + 1] = R(); seeds[i * 3 + 2] = R(); }
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3)); pg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.wpMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uOpen: { value: 0 }, uScale: { value: 300 } }, vertexShader: WP_VS, fragmentShader: WP_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.whPts = new THREE.Points(pg, this.wpMat); this.whPts.frustumCulled = false; this.whPts.visible = false; gate.add(this.whPts);
    this.gateLight = new THREE.PointLight(0x9a5cff, 10, 70, 1.2); this.gateLight.position.set(0, 0, 4); gate.add(this.gateLight);
    this.add(gate);
    // ring stone colliders near the ground (hole stays open in the middle)
    for (const [y0, y1, xi, xo] of [[0, 1.2, 2.6, 7.5], [1.2, 2.6, 4.6, 9.0], [2.6, 4.2, 6.3, 10.5]]) {
      this.box(-xo, y0, ringZ - 1.65, -xi, y1, ringZ + 1.65); this.box(xi, y0, ringZ - 1.65, xo, y1, ringZ + 1.65);
    }
    // altar with 3 sockets on the plaza
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x15111c, roughness: 0.8, emissive: 0x10051c });
    this.socketCrystals = []; this.beams = [];
    const crystGeo = new THREE.OctahedronGeometry(0.38, 0); const crystMat = new THREE.MeshStandardMaterial({ color: 0x1a0830, emissive: 0xb07cff, emissiveIntensity: 2.6, roughness: 0.2 });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const ringC = V(0, ringY, ringZ);
    for (const [x, z] of [[-4.5, -10.5], [0, -11.2], [4.5, -10.5]]) {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.85, 1.1, 8), pedMat); ped.position.set(x, 0.55, z); this.add(ped);
      const sock = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 6, 18), new THREE.MeshBasicMaterial({ color: 0x5a2c9a })); sock.rotation.x = Math.PI / 2; sock.position.set(x, 1.13, z); this.add(sock);
      this.box(x - 0.6, -0.5, z - 0.6, x + 0.6, 1.1, z + 0.6);
      const c = new THREE.Mesh(crystGeo, crystMat); c.scale.set(1, 2, 1); c.position.set(x, 1.75, z); c.visible = false; this.add(c); this.socketCrystals.push(c);
      const from = V(x, 1.75, z), dir = ringC.clone().sub(from), len = dir.length();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true), beamMat); beam.position.copy(from).addScaledVector(dir, 0.5);
      beam.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize()); beam.scale.y = len; beam.visible = false; this.add(beam); this.beams.push(beam);
    }
    this.gateAnchor = new THREE.Object3D(); this.gateAnchor.position.set(0, 1.1, -9.6); this.add(this.gateAnchor);
    this.addInteract({ id: 'l3_gate', object: this.gateAnchor, radius: 3.2, prompt: 'Place the shards in the Gate', holdTime: 3, enabled: false, onInteract: () => this.hostGate() });
    // run bridge slabs: rest in the abyss, rise into place when the Gate wakes
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x1b1624, roughness: 0.75, metalness: 0.2, emissive: 0x3a1468, emissiveIntensity: 0.35, map: this.panelTex });
    for (let i = 0; i < 10; i++) {
      const zc = -15 - i * 4; const m = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 4.1), slabMat);
      const from = V((R() < 0.5 ? -1 : 1) * (8 + R() * 22), -26 - R() * 34, zc + (R() - 0.5) * 16), to = V(0, -0.4, zc);
      const qf = new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3));
      m.position.copy(from); m.quaternion.copy(qf); this.add(m);
      this.slabs.push({ mesh: m, from, to, qf, tStart: 1.6 + i * 0.5, dur: 2.4, placed: false, zc, ph: R() * 6 });
    }
  }

  buildPerihelion() {
    const cx = 70, cz = 6, len = 30, rad = 4.2, cy = 2.6, R = this.R;
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x9aa0ab, map: this.panelTex, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide });
    const g = new THREE.CylinderGeometry(rad, rad, len, 28, 6, true, Math.PI / 2 + 0.45, Math.PI * 2 - 0.9); g.rotateZ(Math.PI / 2);
    const hull = new THREE.Mesh(g, hullMat); hull.position.set(cx, cy, cz); this.add(hull);
    const bulk = new THREE.Mesh(new THREE.CircleGeometry(rad, 28), hullMat); bulk.position.set(cx + len / 2, cy, cz); bulk.rotation.y = -Math.PI / 2; this.add(bulk);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 6.4), this.plateMat); deck.position.set(80.5, -0.15, cz); this.add(deck);
    this.box(76, -1, cz - 3.2, 85, 0, cz + 3.2);
    this.box(55, 0, cz + 3.0, 85, 6, cz + 3.6); this.box(55, 0, cz - 3.6, 85, 6, cz - 3.0); this.box(84.6, 0, cz - 3.6, 85.4, 7, cz + 3.6);
    // engines over the void
    for (const [y, z] of [[1.4, cz - 1.8], [1.4, cz + 1.8], [4.2, cz]]) { const n = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 3, 12, 1, true), this.metalMat); n.rotation.z = -Math.PI / 2; n.position.set(cx + len / 2 + 1.5, y, z); this.add(n); }
    // broken habitat ring drifting beside the wreck
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.9, 8, 48, Math.PI * 1.3), hullMat); ring.position.set(90, 9, 18); ring.rotation.set(1.1, 0.4, 0.6); this.add(ring);
    this.islets.push({ obj: ring, y0: 9, ph: 0, amp: 0.8, spin: 0.01 });
    // truss spine stub
    const truss = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 14, 8), this.metalMat); truss.rotation.z = Math.PI / 2 - 0.25; truss.position.set(cx - len / 2 - 4, 4, cz - 7); this.add(truss);
    // name
    const nt = nameTexture(); this.textures.push(nt);
    const name = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.56), new THREE.MeshStandardMaterial({ map: nt, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    name.position.set(66, cy, cz + rad + 0.08); this.add(name);
    // emergency strips + flickering lights
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xffb070 }); this.stripMat = stripMat;
    for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.12), stripMat); s.position.set(58 + i * 3.8, 5.6, cz + (i % 2 ? 2.4 : -2.4)); this.add(s); }
    for (const x of [63, 77]) { const l = new THREE.PointLight(0xffb27a, 10, 16, 1.6); l.position.set(x, 5.0, cz); this.add(l); this.flickers.push({ light: l, base: 10, off: 0, ph: R() * 6 }); }
    // HALE log terminal
    const term = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.4), this.metalMat); term.position.set(58.6, 0.65, cz - 2.6); this.add(term);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ color: 0xffa040 })); scr.position.set(58.6, 1.0, cz - 2.39); this.add(scr); this.termScreen = scr;
    this.box(58.1, 0, cz - 2.85, 59.1, 1.3, cz - 2.4);
    const anchor = new THREE.Object3D(); anchor.position.set(58.6, 1.1, cz - 1.9); this.add(anchor);
    this.addInteract({ id: 'l3_log', object: anchor, radius: 2.4, prompt: "Play HALE's last log", holdTime: 0.6, enabled: true, onInteract: () => this.hostLog() });
    // a few crates
    for (const [x, z] of [[66, cz + 1.6], [71, cz - 1.8], [75.5, cz + 1.2]]) { const s = 0.9 + R() * 0.4; const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), this.metalMat); c.position.set(x, s / 2, z); c.rotation.y = R(); this.add(c); this.box(x - s / 2, 0, z - s / 2, x + s / 2, s, z + s / 2); }
  }

  buildShards() {
    const defs = [V(-75.5, 7.6, -7.5), V(81.5, 1.7, 6), V(31, 27.6, -64.5)];
    const cg = new THREE.OctahedronGeometry(0.42, 0), fg = new THREE.TetrahedronGeometry(0.3, 0);
    const cm = new THREE.MeshStandardMaterial({ color: 0x1a0830, emissive: 0xa45cff, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.15 });
    defs.forEach((pos, i) => {
      const g = new THREE.Group(); g.position.copy(pos);
      const c = new THREE.Mesh(cg, cm); c.scale.set(1, 2.1, 1); g.add(c);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xb070ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); spr.scale.set(3.4, 3.4, 1); g.add(spr);
      const frag = new THREE.Group(); for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(fg, cm); f.position.set(Math.cos(k * 1.57) * 0.9, k % 2 ? 0.3 : -0.3, Math.sin(k * 1.57) * 0.9); frag.add(f); } g.add(frag);
      // light lives outside g: hiding g on pickup would drop it from the light count -> all lit materials recompile (hitch)
      const light = new THREE.PointLight(0xa86bff, 22, 24, 1.6); light.position.copy(pos); this.add(light);
      this.add(g);
      const anchor = new THREE.Object3D(); anchor.position.set(pos.x, pos.y - 0.4, pos.z); this.add(anchor);
      this.addInteract({ id: 'l3_shard' + i, object: anchor, radius: 2.6, prompt: 'Take the singularity shard', holdTime: 1.5, enabled: true, onInteract: () => this.hostShard(i) });
      let loop = null; try { loop = this.ctx.audio?.loop?.('beacon', { position: pos.clone(), volume: 0.3 }) || null; } catch (e) { /* audio optional */ }
      if (loop) this.loops.push(loop);
      this.shardObjs.push({ group: g, crystal: c, frag, light, pos: pos.clone(), loop, baseY: pos.y });
    });
  }

  buildPads() {
    const padMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uCol: { value: new THREE.Color(0x4ff0ff) } }, vertexShader: UV_VS, fragmentShader: PAD_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const beamMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uCol: { value: new THREE.Color(0x4ff0ff) } }, vertexShader: UV_VS, fragmentShader: BEAM_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beamMatTeal = beamMat;
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x23202b, metalness: 0.6, roughness: 0.4, emissive: 0x0a3040 });
    const defs = [
      { at: V(31, 0, -11.5), to: V(31, 12, -32.5), T: 2.8, isle: this.p1Isle },
      { at: V(31, 12, -36.5), to: V(31, 26, -58.5), T: 3.0, isle: this.p2Isle },
      { at: V(26, 26, -57), to: V(4, 0, -2), T: 4.2, isle: null },
    ];
    for (const d of defs) {
      const g = new THREE.Group(); g.position.copy(d.at);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.2, 24), baseMat); base.position.y = 0.02; g.add(base);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), padMat); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.14; g.add(disc);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 6, 20, 1, true), beamMat); beam.position.y = 3.1; g.add(beam);
      this.add(g);
      const pad = { ...d, group: g, dead: false };
      this.pads.push(pad);
      if (d.isle) { const cr = this.crumbles.find(c => c.objs[0] === d.isle.mesh); if (cr) { cr.objs.push(g); cr.pad = pad; } }
    }
  }

  buildShrines() {
    // Perihelion shrine sits inside the hull corridor (z 3..9): the old (60,0,13.5) was walled off by the hull colliders
    const pts = [V(-9, 0, 5), V(-70, 6, -2.5), V(63, 0, 7.7), V(35, 26, -58.5)];
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1a1722, roughness: 0.8 });
    const crystMat = new THREE.MeshStandardMaterial({ color: 0x062a2a, emissive: 0x4ff0d0, emissiveIntensity: 1.8, roughness: 0.2 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2ad8c0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beamMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uCol: { value: new THREE.Color(0x3fe8c8) } }, vertexShader: UV_VS, fragmentShader: BEAM_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.shrineCrystals = [];
    for (const p of pts) {
      const g = new THREE.Group(); g.position.copy(p);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 0.9, 6), baseMat); b.position.y = 0.45; g.add(b);
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), crystMat); c.position.y = 1.7; c.scale.y = 1.6; g.add(c); this.shrineCrystals.push(c);
      const r = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 40), ringMat); r.rotation.x = -Math.PI / 2; r.position.y = 0.05; g.add(r);
      const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 5, 14, 1, true), beamMat); bm.position.y = 2.6; g.add(bm);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x3fe8c8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 })); spr.scale.set(3, 3, 1); spr.position.y = 1.7; g.add(spr);
      this.add(g);
      this.box(p.x - 0.55, p.y - 0.5, p.z - 0.55, p.x + 0.55, p.y + 0.9, p.z + 0.55);
      try { this.ctx.addOxygenZone?.(V(p.x, p.y + 1, p.z), 3.6); } catch (e) { /* optional */ }
    }
  }

  buildRift() {
    this.riftMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime, uI: { value: 1.0 } }, vertexShader: UV_VS, fragmentShader: RIFT_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 12), this.riftMat); m.position.set(0, 5, 53.5); this.add(m);
    const l = new THREE.PointLight(0xb48cff, 6, 18, 1.5); l.position.set(0, 3, 52); this.add(l);
  }

  buildCreatures() {
    const cc = this.createCreature; if (!cc) return;
    this.spawnWraith(V(-36, 3.5, -1), [V(-22, 2.5, 2), V(-38, 3.5, -2), V(-56, 5.5, -5), V(-38, 3.5, -2)]);
    this.spawnWraith(V(74, 1.2, 6), [V(58, 1.2, 6), V(80, 1.2, 6), V(72, 1.5, 14), V(60, 1.2, 0)]);
    this.spawnWraith(V(20, 3, -22), [V(14, 2, -8), V(31, 2, -14), V(31, 8, -28), V(14, 6, -30)]);
    try { this.watcher = cc('watcher', this.ctx, { position: V(-34, 40, -175), scale: 1.4 }) || null; } catch (e) { console.warn('[L3] watcher', e); }
  }
  spawnWraith(pos, patrol) {
    let c = null;
    try { c = this.createCreature?.('wraith', this.ctx, { position: pos, patrol }) || null; } catch (e) { console.warn('[L3] wraith', e); }
    this.creatures.push(c); // keep index alignment across peers even on failure
  }
  addInteract(o) { try { this.ctx.interact?.add?.(o); this.interactIds.push(o.id); } catch (e) { console.warn('[L3] interact', e); } }

  // ======================= STORY =======================
  say(sp, text, dur = 4) { this.subQueue.push([sp, text, dur]); }
  queueIntro() {
    this.subQueue.push([null, '', 2.5]);
    this.say('HALE', 'Crew... this is HALE. A partial instance, running on your suit processors. I lost you at the Lantern.', 6);
    this.say('HALE', 'No stars here. No time I can measure. Gravity is weak — mind the edges.', 5);
    this.say('HALE', 'Three singularity shards are holding this place together. That ring of black stone wants them. I believe it is a door.', 6.5);
    this._introFx = true; // played on the first update (build runs under the loading screen)
  }
  updateSubs(dt) {
    if (this.subT > 0) { this.subT -= dt; return; }
    const it = this.subQueue.shift(); if (!it) return;
    const [sp, tx, d] = it; this.subT = d + 0.35;
    if (sp == null) return;
    try { this.ctx.ui?.subtitle?.(sp, tx, d); this.ctx.audio?.speak?.(Math.max(1, d - 1)); } catch (e) { /* optional */ }
  }

  // ======================= HOST ACTIONS =======================
  emit(type, data) { const ctx = this.ctx; if (typeof ctx.levelEvent === 'function') ctx.levelEvent(type, data); else this.onEvent(type, data, ctx.localId); }
  hostShard(i) { if (!this.shards[i] && !this.gate) this.emit('shard', { i }); }
  hostGate() { if (this.shards.every(Boolean) && !this.gate) { this.gate = true; this.emit('gate', {}); } }
  hostLog() { if (!this.logPlayed) { this.logPlayed = true; this.emit('log', {}); } }
  complete() { if (this.completed || !this.ctx.isHost) return; this.completed = true; try { this.ctx.completeLevel?.(); } catch (e) { console.error(e); } }

  onEvent(type, data, fromId) {
    const ctx = this.ctx;
    try {
      if (type === 'shard') { this.collectShard((data?.i | 0), false); if (ctx.isHost) ctx.checkpoint?.(); }
      else if (type === 'gate') { this.gate = true; this.activateGate(false); if (ctx.isHost) ctx.checkpoint?.(); }
      else if (type === 'log') { this.logPlayed = true; this.playLog(); }
      else if (type === 'wormhole') { if (ctx.isHost && this.gateActive) this.complete(); }
      else if (type === 'noise' && ctx.isHost && data) { const p = data.pos || data.position; if (p) this.forwardNoise(V(p.x, p.y, p.z), data.loudness ?? data.l ?? 0.5); }
    } catch (e) { console.error('[L3] onEvent', type, e); }
  }

  collectShard(i, silent) {
    if (!(i >= 0 && i < 3)) return;
    this.shards[i] = true;
    if (!this.shardShown[i]) return;
    this.shardShown[i] = false;
    const s = this.shardObjs[i];
    if (s) { s.group.visible = false; s.light.intensity = 0; try { s.loop?.stop?.(0.5); } catch (e) { /* */ } }
    try { this.ctx.interact?.setEnabled?.('l3_shard' + i, false); } catch (e) { /* */ }
    this.updateInteractables();
    if (silent) return;
    const ctx = this.ctx, n = this.shards.filter(Boolean).length;
    try {
      ctx.audio?.play?.('shard', { position: s?.pos, volume: 1 });
      ctx.fx?.flash?.(0xb48cff, 0.35, 0.6);
      if (s) ctx.fx?.burst?.(s.pos, { count: 60, color: 0xc89cff, speed: 4, life: 1.2, size: 0.15 });
      ctx.ui?.notify?.(`Singularity shard recovered (${n}/3)`, 3);
    } catch (e) { /* */ }
    if (n === 1) this.say('HALE', 'Shard secured. It weighs more than its mass should allow. Carry it carefully.', 4.5);
    else if (n === 2) this.say('HALE', 'Two. The Gate is reacting — I can hear it humming through your suits.', 4.5);
    else if (n === 3) this.say('HALE', 'All three shards. Bring them to the Gate.', 3.5);
  }

  playLog() {
    if (this.logShown) return; this.logShown = true;
    try { this.ctx.interact?.setEnabled?.('l3_log', false); this.ctx.audio?.play?.('radio', { position: V(58.6, 1, 4), volume: 0.8 }); this.ctx.audio?.play?.('static', { volume: 0.4 }); } catch (e) { /* */ }
    this.say('HALE', '[LOG] Internal record. Drift day... I stopped counting. There is no sun here to count by.', 5.5);
    this.say('HALE', '[LOG] They took the crew in the light. I kept the corridor lamps burning, in case you found your way back.', 6);
    this.say('HALE', '[LOG] The stars are not going dark. Something is eating them. It is very patient.', 5);
    this.say('HALE', '[LOG] If you are hearing this... you came home to me. I am sorry there is so little left of home.', 6);
    this.say('HALE', 'That was me. Before. I do not remember being so afraid.', 4);
  }

  activateGate(fromSave) {
    if (this.gateActive) return;
    this.gateActive = true; this.gate = true;
    for (let i = 0; i < 3; i++) this.collectShard(i, true);
    this.collapseStart = this.t;
    const ctx = this.ctx, ringC = V(0, L.ringY, L.ringZ);
    for (const c of this.socketCrystals || []) c.visible = true;
    for (const b of this.beams || []) b.visible = true;
    if (this.whDisc) { this.whDisc.visible = true; this.halo.visible = true; this.whPts.visible = true; }
    try {
      ctx.audio?.play?.('gate', { position: ringC, volume: 1 });
      ctx.audio?.stinger?.();
      const lp = ctx.audio?.loop?.('warp_core', { position: ringC, volume: 0.9 }); if (lp) this.loops.push(lp);
      ctx.fx?.flash?.(0xd8b8ff, 0.8, 1.6); ctx.fx?.shake?.(0.6, 2.0); ctx.fx?.pulseGlitch?.(0.6, 0.6);
      ctx.interact?.setEnabled?.('l3_gate', false);
    } catch (e) { /* */ }
    try { this.watcher?.enrage?.(); } catch (e) { /* */ }
    // extra wraiths: spawned on every peer in the same order -> indices 3,4 match
    this.spawnWraith(V(-12, 3, -34), [V(-6, 2, -24), V(6, 2, -44), V(-6, 2, -50)]);
    this.spawnWraith(V(12, 3, -48), [V(6, 2, -50), V(-6, 2, -30), V(4, 2, -18)]);
    this.subQueue.length = 0; this.subT = 0.5;
    this.say('HALE', 'Gate is live. The lattice is failing — this whole realm is folding in on itself!', 4.5);
    this.say('HALE', 'A bridge is rising. The wormhole is forming inside the ring. Cross. Do not stop.', 4.5);
    this.say('CONTROL', '...rihelion... this is CONTROL... we are reading a signal... please respond...', 4.5);
    this.say('HALE', 'That is Earth. The aperture leads home. RUN.', 3.5);
    this.say('HALE', 'It knows we are leaving.', 3);
    this.updateInteractables(); this.updateObjective();
  }

  // ======================= NET / SAVE =======================
  getState() {
    return {
      s: this.shards.map(b => (b ? 1 : 0)), g: this.gate ? 1 : 0, l: this.logPlayed ? 1 : 0,
      ce: this.gateActive ? Math.round((this.t - this.collapseStart) * 10) / 10 : 0,
      c: this.creatures.map(c => { try { return c?.getNetState?.() ?? null; } catch (e) { return null; } }),
    };
  }
  applyState(s) {
    if (!s) return;
    try {
      if (Array.isArray(s.s)) s.s.forEach((b, i) => { if (b && this.shardShown[i]) this.collectShard(i, false); });
      if (s.g && !this.gateActive) this.activateGate(false);
      if (this.gateActive && typeof s.ce === 'number') { const local = this.t - this.collapseStart; if (Math.abs(local - s.ce) > 1.0) this.collapseStart = this.t - s.ce; }
      if (s.l && !this.logPlayed) { this.logPlayed = true; this.ctx.interact?.setEnabled?.('l3_log', false); }
      if (Array.isArray(s.c)) s.c.forEach((cs, i) => { if (cs != null) { try { this.creatures[i]?.setNetState?.(cs); } catch (e) { /* */ } } });
      this.updateObjective();
    } catch (e) { this._warn('apply', e); }
  }
  getSaveData() { return { shards: this.shards.slice(), gate: !!this.gate }; }
  spawnPoints() {
    if (this.spawnAtGate) return [{ x: -1.5, y: 0.05, z: -2, yaw: 0 }, { x: 1.5, y: 0.05, z: -2, yaw: 0 }, { x: -1.5, y: 0.05, z: 1, yaw: 0 }, { x: 1.5, y: 0.05, z: 1, yaw: 0 }];
    return [{ x: -1.5, y: 0.05, z: 44, yaw: 0 }, { x: 1.5, y: 0.05, z: 44, yaw: 0 }, { x: -1.5, y: 0.05, z: 47, yaw: 0 }, { x: 1.5, y: 0.05, z: 47, yaw: 0 }];
  }

  updateInteractables() {
    const ia = this.ctx.interact; if (!ia) return;
    try {
      for (let i = 0; i < 3; i++) ia.setEnabled?.('l3_shard' + i, !this.shards[i]);
      ia.setEnabled?.('l3_gate', this.shards.every(Boolean) && !this.gate);
      ia.setEnabled?.('l3_log', !this.logPlayed);
    } catch (e) { /* */ }
  }
  shardCount() { let n = 0; for (let i = 0; i < 3; i++) if (this.shards[i]) n++; return n; }
  updateObjective(force) {
    const n = this.shardCount(), key = this.gateActive || this.gate ? 9 : n; // called every frame: no string building unless changed
    if (key === this._objKey && !force) return;
    this._objKey = key;
    const txt = key === 9 ? 'REACH THE WORMHOLE' : n < 3 ? `Recover the singularity shards (${n}/3)` : 'Place the shards in the Gate';
    if (txt !== this.objective || force) { this.objective = txt; try { this.ctx.ui?.setObjective?.(txt); } catch (e) { /* */ } this.updateInteractables(); }
  }
  // audio.loop() returns an inert stub until the AudioContext exists (e.g. ?level=3 before the first click): retry beacons
  retryBeacons(dt) {
    if (this._beaconsOk) return;
    this._beaconT = (this._beaconT || 0) - dt; if (this._beaconT > 0) return; this._beaconT = 2;
    let ok = true;
    for (let i = 0; i < this.shardObjs.length; i++) {
      const s = this.shardObjs[i]; if (!this.shardShown[i] || (s.loop && !inertLoop(s.loop))) continue;
      let h = null; try { h = this.ctx.audio?.loop?.('beacon', { position: s.pos, volume: 0.3 }) || null; } catch (e) { h = null; }
      if (h && !inertLoop(h)) { s.loop = h; this.loops.push(h); } else ok = false;
    }
    if (ok) this._beaconsOk = true;
  }

  // ======================= UPDATE =======================
  _warn(k, e) { if (!this._warned[k]) { this._warned[k] = 1; console.warn('[L3] ' + k, e); } }
  localPos() { return this.ctx.getLocalPlayer?.()?.position || this.ctx.localPlayer?.position || null; }

  update(dt) {
    if (!(dt > 0)) dt = 0.016; dt = Math.min(dt, 0.1);
    this.t += dt; this.uTime.value = this.t;
    if (this._introFx) { this._introFx = false; try { this.ctx.fx?.flash?.(0xb48cff, 0.6, 1.4); this.ctx.audio?.play?.('warp', { volume: 0.7 }); } catch (e) { /* optional */ } }
    try { this.updateVisuals(dt); } catch (e) { this._warn('vis', e); }
    try { this.updateCollapse(dt); } catch (e) { this._warn('collapse', e); }
    try { this.updateLocal(dt); } catch (e) { this._warn('local', e); }
    try { if (this.ctx.isHost) this.updateHost(dt); } catch (e) { this._warn('host', e); }
    for (const c of this.creatures) { try { c?.update?.(dt); } catch (e) { this._warn('creature', e); } }
    try { this.watcher?.update?.(dt); } catch (e) { this._warn('watcher', e); }
    try { this.updateSubs(dt); this.updateObjective(); this.retryBeacons(dt); } catch (e) { this._warn('subs', e); }
  }

  updateVisuals(dt) {
    const t = this.t, cam = this.ctx.camera;
    if (this.skyGroup && cam) this.skyGroup.position.copy(cam.position);
    for (let i = 0; i < (this.galaxies || []).length; i++) this.galaxies[i].rotateZ(dt * 0.004 * (i % 2 ? 1 : -1));
    const ck = this.gateActive ? Math.min(1, (t - this.collapseStart) / 6) : 0;
    if (this.debrisA) { this.debrisA.rotation.y += dt * (0.006 + ck * 0.03); this.debrisB.rotation.y -= dt * (0.004 + ck * 0.02); }
    if (this.streamPts) { this.updateStreamPts(); const h = this.ctx.renderer?.domElement?.height || 900; this.ptsMat.uniforms.uScale.value = h * 0.6; if (this.wpMat) this.wpMat.uniforms.uScale.value = h * 0.6; }
    for (const m of this.streamMats || []) m.uniforms.uBoost.value = 1 + ck * 1.2;
    if (this.skyMat) this.skyMat.uniforms.uCollapse.value = ck;
    for (const it of this.islets) { if (it.falling) continue; it.obj.position.y = it.y0 + Math.sin(t * 0.3 + it.ph) * it.amp; if (it.spin) it.obj.rotation.y += it.spin * dt; }
    // shards
    for (let i = 0; i < this.shardObjs.length; i++) { const s = this.shardObjs[i]; if (!this.shardShown[i]) continue;
      s.group.position.y = s.baseY + Math.sin(t * 1.6 + i) * 0.18; s.crystal.rotation.y += dt * 0.9; s.frag.rotation.y -= dt * 1.6; s.light.intensity = 18 + Math.sin(t * 3 + i) * 5; }
    for (let i = 0; i < (this.shrineCrystals || []).length; i++) { const c = this.shrineCrystals[i]; c.rotation.y += dt; c.position.y = 1.7 + Math.sin(t * 1.2 + i) * 0.1; }
    // gate runes respond to shard count
    const n = this.shardCount();
    if (this.runeMat) this.runeMat.uniforms.uInt.value = this.gateActive ? 2.4 + Math.sin(t * 5) * 0.6 : 0.3 + n * 0.3;
    if (this.chevGlowMat) this.chevGlowMat.color.setHex(this.gateActive ? 0xe0c8ff : n > 0 ? 0x9a5cff : 0x3a1f66);
    if (this.gateLight) this.gateLight.intensity = this.gateActive ? 40 + 25 * ck + Math.sin(t * 7) * 8 : 6 + n * 4;
    if (this.gateActive) {
      const ce = t - this.collapseStart, open = Math.min(1, Math.max(0, (ce - 1.0) / (WORM_OPEN_AT - 1.0)));
      this.whMat.uniforms.uOpen.value = open; this.haloMat.uniforms.uOpen.value = open; this.wpMat.uniforms.uOpen.value = open;
      const s = 0.05 + 0.95 * (1 - Math.pow(1 - open, 3)); this.whDisc.scale.set(s, s, 1);
      if (this.gateLight) this.gateLight.color.setHex(open > 0.5 ? 0xbfe6ff : 0x9a5cff);
      for (const b of this.beams) b.material.opacity = 0.45 + Math.random() * 0.4;
    }
    // Perihelion flicker
    let dark = false;
    for (const f of this.flickers) {
      if (f.light) { if (f.off > 0) { f.off -= dt; f.light.intensity = f.base * 0.04; } else { f.light.intensity = f.base * (0.8 + 0.2 * Math.sin(t * 23 + f.ph)); if (Math.random() < dt * 0.7) f.off = 0.06 + Math.random() * 0.35; } if (f.off > 0) dark = true; }
      else if (f.mesh) f.mesh.visible = Math.sin(t * 2 + f.ph) > 0.6;
    }
    if (this.stripMat) this.stripMat.color.setHex(dark ? 0x2a1a10 : 0xffb070);
    if (this.termScreen) this.termScreen.visible = this.logPlayed || Math.sin(t * 4) > -0.3;
    if (this.riftMat) this.riftMat.uniforms.uI.value = 0.85 + 0.15 * Math.sin(t * 2.3);
    // run-bridge slabs: drift in the abyss, then rise into place
    for (const s of this.slabs) {
      if (!this.gateActive) { s.mesh.position.set(s.from.x, s.from.y + Math.sin(t * 0.4 + s.ph) * 0.8, s.from.z); s.mesh.rotation.y += dt * 0.05; continue; }
    }
  }

  updateCollapse(dt) {
    if (!this.gateActive) return;
    const ctx = this.ctx, ce = this.t - this.collapseStart, k = Math.min(1, ce / 6);
    // bridge assembly (deterministic from collapse time)
    for (const s of this.slabs) {
      const u = Math.min(1, Math.max(0, (ce - s.tStart) / s.dur)), e = 1 - Math.pow(1 - u, 3);
      s.mesh.position.lerpVectors(s.from, s.to, e); s.mesh.quaternion.copy(s.qf).slerp(QI, e);
      if (u >= 1 && !s.placed) { s.placed = true; this.box(-2.2, -1, s.zc - 2.1, 2.2, 0, s.zc + 2.1); try { ctx.audio?.play?.('metal_groan', { position: s.to, volume: 0.35 }); } catch (e) { /* */ } }
    }
    // crumbling outer platforms
    for (const c of this.crumbles) {
      if (!c.fallen) {
        if (ce >= c.tc) {
          c.fallen = true; c.fallT = 0;
          for (const id of c.boxes) { try { if (id !== undefined) ctx.world?.removeBox?.(id); } catch (e) { /* */ } }
          if (c.pad) c.pad.dead = true;
          for (const o of c.objs) { const it = this.islets.find(i => i.obj === o); if (it) it.falling = true; }
          c.base = c.objs.map(o => o.position.clone()); c.spin = (Math.random() - 0.5) * 0.6;
          if (!c.islet) { try { ctx.audio?.play?.('explosion', { position: c.base[0], volume: 0.5 }); } catch (e) { /* */ } }
        } else if (ce > c.tc - 1.6 && !c.islet) {
          for (const o of c.objs) { if (!o.userData.p0) o.userData.p0 = o.position.clone(); o.position.x = o.userData.p0.x + (Math.random() - 0.5) * 0.12; o.position.z = o.userData.p0.z + (Math.random() - 0.5) * 0.12; }
        }
      } else if (c.fallT < 10) {
        c.fallT += dt; const dy = -(3 * c.fallT * c.fallT + c.fallT);
        c.objs.forEach((o, i) => { o.position.y = c.base[i].y + dy; o.rotation.x += c.spin * dt; o.rotation.z += c.spin * 0.6 * dt; if (c.fallT >= 10) o.visible = false; });
      }
    }
    // screen: shaking + glitch
    try {
      const fx = ctx.fx; const pulse = Math.pow(Math.max(0, Math.sin(this.t * 1.7)), 8);
      fx?.setGlitch?.(0.06 + 0.1 * k + 0.15 * pulse);
      this.shakeT -= dt;
      if (this.shakeT <= 0) {
        this.shakeT = 0.7 + Math.random() * 1.2; fx?.shake?.(0.12 + 0.22 * k, 0.6);
        if (Math.random() < 0.35) { fx?.pulseGlitch?.(0.5, 0.25); ctx.audio?.play?.(Math.random() < 0.5 ? 'thunder' : 'metal_groan', { volume: 0.5 }); }
      }
    } catch (e) { /* */ }
  }

  inWormhole(p) {
    if (!p) return false;
    const dz = p.z - L.ringZ; if (Math.abs(dz) > 4) return false;
    const dy = p.y + 0.9 - L.ringY; return p.x * p.x + dy * dy < (L.Ri + 1) * (L.Ri + 1);
  }

  updateLocal(dt) {
    const ctx = this.ctx, p = this.localPos(); if (!p) return;
    const me = ctx.getLocalPlayer?.();
    // jump pads (local physics, every peer launches its own player)
    this.padCool -= dt;
    const v = ctx.localPlayer?.velocity;
    if (this.flight) {
      const f = this.flight; f.t += dt;
      if (v) {
        if (f.t < f.T * 0.97) { v.x = f.vx; v.z = f.vz; }
        // re-assert the analytic vertical speed early on (matches moveCapsule's per-frame integration exactly)
        if (f.t < 0.25) v.y = f.vy - f.g * f.t;
      }
      if (f.t > f.T + 0.3) this.flight = null;
    } else if (this.padCool <= 0 && !me?.downed) {
      for (const pad of this.pads) {
        if (pad.dead) continue;
        const dx = p.x - pad.at.x, dz = p.z - pad.at.z;
        if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(p.y - pad.at.y) < 0.8) { this.launch(pad, p, v); break; }
      }
    }
    // wormhole entry (local detection, host confirms)
    if (this.gateActive && !this.sentEnter && this.t - this.collapseStart > WORM_OPEN_AT && this.inWormhole(p)) {
      this.sentEnter = true;
      try { ctx.fx?.flash?.(0xffffff, 1, 1.5); ctx.audio?.play?.('warp', { volume: 1 }); } catch (e) { /* */ }
      if (ctx.isHost) this.complete(); else this.emit('wormhole', {});
    }
    // tension + story pings (local)
    this.tensionT -= dt;
    if (this.tensionT <= 0) {
      this.tensionT = 0.2;
      let best = 1e9, chasing = false;
      for (const c of this.creatures) { const cp = c?.position || c?.object?.position; if (!cp) continue; const d = cp.distanceTo(p); if (d < best) { best = d; chasing = c.state === 'chase' || c.state === 'attack'; } }
      let ten = Math.max(0, Math.min(1, 1 - (best - 6) / 30)) * (chasing ? 1 : 0.6);
      if (this.gateActive) ten = Math.max(ten, 0.75);
      try { ctx.audio?.setTension?.(ten); } catch (e) { /* */ }
      if (!this.saidWraith && best < 20) { this.saidWraith = true; this.say('HALE', 'Wraith signature. They pass through matter — but not through light. Use your lamps.', 5); }
      if (!this.saidWatcher && this.t > 70 && !this.gateActive) { this.saidWatcher = true; this.say('HALE', 'Something vast at the edge of my sensors. Do not stare at it. It stares back.', 5); }
      this.groanT -= 0.2;
      if (this.groanT <= 0) { this.groanT = 9 + Math.random() * 10; if (Math.hypot(p.x - 70, p.z - 6) < 35) { try { ctx.audio?.play?.('metal_groan', { position: V(70, 3, 6), volume: 0.5 }); } catch (e) { /* */ } } }
    }
  }

  launch(pad, p, v) {
    const lp = this.ctx.localPlayer;
    const g = (typeof lp?.gravity === 'number' && lp.gravity < 0) ? -lp.gravity : 7;
    const T = pad.T, vx = (pad.to.x - p.x) / T, vz = (pad.to.z - p.z) / T, vy = (pad.to.y - p.y) / T + 0.5 * g * T;
    if (v && v.set) v.set(vx, vy, vz);
    p.y += 0.1;
    if (lp) { // airborne from now on: no ground friction / coyote-jump overwrite on the controller's next frame
      lp.onGround = false;
      if (typeof lp._coyote === 'number') lp._coyote = 0;
      if (typeof lp._jumpBuf === 'number') lp._jumpBuf = 0;
    }
    this.flight = { vx, vy, vz, g, T, t: 0 }; this.padCool = 1.0;
    try { this.ctx.audio?.play?.('jump', { position: p.clone(), volume: 1 }); this.ctx.fx?.shake?.(0.15, 0.3); } catch (e) { /* */ }
  }

  onNoise(pos, loudness) { if (pos) this.forwardNoise(pos.isVector3 ? pos : V(pos.x, pos.y, pos.z), loudness ?? 0.5); }
  forwardNoise(pos, loud) {
    for (const c of this.creatures) { const cp = c?.position || c?.object?.position; if (cp && cp.distanceTo(pos) < 10 + 45 * loud) { try { c.hearNoise?.(pos, loud); } catch (e) { /* */ } } }
  }
  updateHost(dt) {
    const ctx = this.ctx;
    this.noiseT -= dt;
    if (this.noiseT <= 0 && ctx.players) {
      this.noiseT = 0.25;
      for (const pl of ctx.players.values()) { const n = pl?.noise || 0; if (n > 0.12 && pl.position) this.forwardNoise(pl.position, n); }
    }
    if (this.gateActive && !this.completed && this.t - this.collapseStart > WORM_OPEN_AT && ctx.players) {
      for (const pl of ctx.players.values()) { if (pl?.position && this.inWormhole(pl.position)) { this.complete(); break; } }
    }
  }

  dispose() {
    const ctx = this.ctx;
    for (const c of this.creatures) { try { c?.dispose?.(); } catch (e) { /* */ } }
    try { this.watcher?.dispose?.(); } catch (e) { /* */ }
    for (const l of this.loops) { try { l?.stop?.(0.4); } catch (e) { /* */ } }
    try { ctx.fx?.setGlitch?.(0); ctx.audio?.setTension?.(0); } catch (e) { /* */ }
    try { ctx.setGravity?.(-18); ctx.setOxygenDrain?.(0); } catch (e) { /* */ }
    if (this._oldFar && ctx.camera) { ctx.camera.far = this._oldFar; ctx.camera.updateProjectionMatrix(); }
    for (const id of this.interactIds) { try { ctx.interact?.remove?.(id); } catch (e) { /* */ } }
    for (const o of this.objs) {
      try {
        ctx.scene.remove(o);
        o.traverse?.((n) => { n.geometry?.dispose?.(); const m = n.material; if (Array.isArray(m)) m.forEach(x => x.dispose?.()); else m?.dispose?.(); if (n.isInstancedMesh) n.dispose?.(); });
      } catch (e) { /* */ }
    }
    for (const t of this.textures) { try { t.dispose(); } catch (e) { /* */ } }
    this.objs = []; this.creatures = []; this.subQueue = [];
  }
}
