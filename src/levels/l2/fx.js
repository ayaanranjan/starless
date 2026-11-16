// CHAPTER II — cinematic FX layer (owner: L2). Pure visuals: no colliders, no gameplay state.
// Light shafts, drifting floor mist, travelling vein pulses + failing lights + red emergency strobes (shader patch on the
// shell materials), wet floor sheen, warp-core heat shimmer + glow, specimen-pod backlight + bubbles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const NOISE = `
float l2h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float l2n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(l2h(i), l2h(i + vec2(1.0, 0.0)), f.x), mix(l2h(i + vec2(0.0, 1.0)), l2h(i + vec2(1.0, 1.0)), f.x), f.y); }
float l2f(vec2 p){ return l2n(p) * 0.6 + l2n(p * 2.31 + vec2(7.1, 3.7)) * 0.4; }
`;
// slow red emergency strobe: same phase formula in the wall shader and on the lamp glows so they flash together
const EMG = 'pow(max(0.0, sin(uT * 1.25 + dot(P, vec2(0.045, 0.07)))), 14.0)';

const SHAFT_VS = `varying vec3 vW; varying vec3 vN; varying float vY;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vY = uv.y;
  gl_Position = projectionMatrix * viewMatrix * w; }`;
const SHAFT_FS = NOISE + `uniform float uT; uniform vec3 uCol; uniform float uI;
varying vec3 vW; varying vec3 vN; varying float vY;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float e = abs(dot(normalize(vN), V)); e *= e;
  float n = l2f(vec2(vW.x * 0.9 + vW.z * 0.7, vW.y * 0.22 - uT * 0.35));
  float s = l2n(vec2((vW.x - vW.z) * 3.1 + vW.y * 0.04, uT * 0.22)); s = s * s;
  float a = e * e * smoothstep(0.0, 0.5, vY) * (0.15 + 0.85 * vY * vY) * (0.25 + n * n * 1.4) * (0.2 + 1.5 * s);
  a *= smoothstep(0.6, 3.5, length(cameraPosition - vW));
  gl_FragColor = vec4(uCol * (a * uI), 1.0);
}`;
const SHIM_FS = NOISE + `uniform float uT; uniform vec3 uCol; uniform float uI;
varying vec3 vW; varying vec3 vN; varying float vY;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float e = abs(dot(normalize(vN), V));
  float n = l2f(vec2(vW.x * 1.7 + vW.z * 1.3, vW.y * 1.4 - uT * 1.8));
  float band = pow(0.5 + 0.5 * sin(vW.y * 4.0 - uT * 4.5 + n * 5.0), 5.0);
  float a = (band * 0.75 + n * n * 0.5) * smoothstep(0.0, 0.2, vY) * smoothstep(1.0, 0.75, vY) * (0.25 + 0.75 * pow(1.0 - e, 1.5));
  gl_FragColor = vec4(uCol * (a * uI), 1.0);
}`;
const MIST_VS = `varying vec3 vW;
void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const MIST_FS = NOISE + `uniform float uT; uniform vec3 uCol; uniform float uA;
varying vec3 vW;
void main(){
  vec2 p = vW.xz * 0.21 + vec2(vW.y * 3.1);
  float n = l2f(p + vec2(uT * 0.06, uT * 0.035));
  float m = l2f(p * 1.7 - vec2(uT * 0.045, -uT * 0.07) + n * 1.3);
  float a = smoothstep(0.42, 1.0, n * 0.62 + m * 0.62) * uA;
  float d = length(cameraPosition.xz - vW.xz);
  a *= smoothstep(0.6, 2.8, d) * exp(-d * 0.035);
  gl_FragColor = vec4(uCol, a);
}`;
// instanced billboards: aG = (w, h, phase, kind)  kind 0 core glow, 1 red emergency lamp, 2 pod backlight
const GLOW_VS = `attribute vec4 aG; attribute float aI; uniform float uT; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
varying vec2 vUv; varying vec3 vC;
void main(){
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c + r * position.x * aG.x + u * position.y * aG.y;
  vec2 P = c.xz;
  float k = aG.w, b;
  if (k < 0.5) { b = (0.8 + 0.2 * sin(uT * 3.0 + aG.z)) * aI; vC = uC0; }
  else if (k < 1.5) { b = 0.04 + 1.6 * ${EMG}; vC = uC1; }
  else { b = (0.55 + 0.35 * sin(uT * 0.7 + aG.z)) * (0.8 + 0.2 * step(0.2, fract(sin(floor(uT * 11.0) + aG.z) * 431.7))); vC = uC2; }
  vC *= b; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const GLOW_FS = `varying vec2 vUv; varying vec3 vC;
void main(){ float d = length(vUv * 2.0 - 1.0); float a = pow(max(0.0, 1.0 - d), 2.4) + 0.6 * pow(max(0.0, 1.0 - d * 3.5), 3.0);
  gl_FragColor = vec4(vC * a, 1.0); }`;
const BUB_VS = `attribute vec3 aB; uniform float uT; uniform float uPx; varying float vA;
void main(){
  float h = mod(aB.x + uT * aB.y, 2.75);
  vec3 p = position; p.y = 0.55 + h; p.x += sin(uT * 2.3 + aB.x * 9.0) * 0.035; p.z += cos(uT * 1.9 + aB.x * 7.0) * 0.035;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * aB.z / max(0.1, -mv.z), 1.0, 48.0);
  vA = smoothstep(0.0, 0.25, h) * smoothstep(2.75, 2.35, h);
}`;
const BUB_FS = `uniform vec3 uCol; varying float vA;
void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float d = length(q); if (d > 1.0) discard;
  float ring = smoothstep(0.5, 0.88, d) * smoothstep(1.0, 0.88, d) + pow(max(0.0, 1.0 - length(q - vec2(-0.35, 0.35)) * 3.2), 2.0);
  gl_FragColor = vec4(uCol * (ring * vA), 1.0); }`;

export class L2Fx {
  constructor(lv) { this.lv = lv; this.U = { uL2T: { value: 0 }, uL2Emg: { value: 1 }, uL2EmgCol: { value: new THREE.Color(1, 0.05, 0.02) }, uL2Wet: { value: 1 } }; }
  _keep(o) { this.lv.disp.push(o); return o; }
  _sm(o) {
    return this._keep(new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...o }));
  }

  build() {
    const lv = this.lv, low = lv.low;
    this.T = { value: 0 };
    this._patchShell();
    // ---- light shafts: hub ceiling vents, core chambers, a few room vents
    this.shaftMat = this._sm({ vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS, side: THREE.DoubleSide,
      uniforms: { uT: this.T, uCol: { value: new THREE.Color() }, uI: { value: 0.4 } } });
    const shafts = [];
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.55; shafts.push([Math.cos(a) * 8.2, Math.sin(a) * 8.2, 15.9, 0.7, 2.5, 0.06 * Math.cos(a * 3)]); }
    for (const o of lv.coreObjs || []) shafts.push([o.pos.x, o.pos.z, 4.95, 0.9, 2.7, 0]);
    const room = this._roomCells(); for (const [x, z] of room) shafts.push([x, z, 4.95, 0.45, 1.6, 0.05]);
    const sgeos = shafts.map(([x, z, h, rt, rb, tilt]) => { const geo = new THREE.CylinderGeometry(rt, rb, h, 18, 1, true); geo.translate(0, h / 2, 0); geo.rotateZ(tilt); geo.translate(x, 0, z); return geo; });
    const sm = mergeGeometries(sgeos); sgeos.forEach((x) => x.dispose());
    if (sm) { this._keep(sm); const m = new THREE.Mesh(sm, this.shaftMat); m.renderOrder = 6; m.frustumCulled = false; lv.root.add(m); }
    // ---- floor mist (two drifting layers, one instanced draw)
    this.mistMat = this._sm({ vertexShader: MIST_VS, fragmentShader: MIST_FS, blending: THREE.NormalBlending,
      uniforms: { uT: this.T, uCol: { value: new THREE.Color() }, uA: { value: 0.42 } } });
    const cells = lv.floorCells || [], layers = low ? [0.3] : [0.22, 0.7];
    const mg = this._keep(new THREE.PlaneGeometry(4, 4)); mg.rotateX(-Math.PI / 2);
    const mist = new THREE.InstancedMesh(mg, this.mistMat, Math.max(1, cells.length * layers.length)); let k = 0;
    const m4 = new THREE.Matrix4();
    for (const y of layers) for (const [c, r] of cells) { m4.makeTranslation((c - 17) * 4, y, (r - 20) * 4); mist.setMatrixAt(k++, m4); }
    mist.count = k; mist.instanceMatrix.needsUpdate = true; mist.frustumCulled = false; mist.renderOrder = 4; lv.root.add(mist);
    // ---- heat shimmer shells around the warp cores and the drive column
    this.shimMat = this._sm({ vertexShader: SHAFT_VS, fragmentShader: SHIM_FS, side: THREE.DoubleSide,
      uniforms: { uT: this.T, uCol: { value: new THREE.Color() }, uI: { value: 0.5 } } });
    this.coreShim = [];
    const sg = this._keep(new THREE.CylinderGeometry(1.25, 1.35, 4.2, 20, 1, true)); sg.translate(0, 2.35, 0);
    for (const o of lv.coreObjs || []) {
      const mat = this.shimMat.clone(); this._keep(mat); mat.uniforms.uT = this.T;
      const m = new THREE.Mesh(sg, mat); m.position.set(o.pos.x, 0, o.pos.z); m.renderOrder = 5; lv.root.add(m); this.coreShim.push({ m, mat, o });
    }
    const dg = this._keep(new THREE.CylinderGeometry(2.3, 2.6, 14.4, 24, 1, true)); dg.translate(0, 1.2 + 7.2, 0);
    this.driveShim = new THREE.Mesh(dg, this.shimMat); this.driveShim.renderOrder = 5; lv.root.add(this.driveShim);
    // ---- glow billboards: cores, red emergency lamps, pod backlights
    const glows = [];
    for (const o of lv.coreObjs || []) glows.push([o.pos.x, 2.4, o.pos.z, 3.6, 4.6, glows.length, 0]);
    glows.push([0, 1.6, 0, 6.5, 4.0, 2.2, 0]); // pedestal bloom of the drive column
    for (const [x, y, z] of this._lampSpots()) glows.push([x, y, z, 1.5, 1.5, 0, 1]);
    this.pods = [];
    for (const s of lv.silData || []) this.pods.push([s[0], s[1]]);
    if (lv.kestrel) this.pods.push([lv.kestrel.position.x, lv.kestrel.position.z]);
    for (const [x, z] of this.pods) glows.push([x, 1.9, z, 1.7, 3.6, x * 0.37 + z, 2]);
    const bg = this._keep(new THREE.PlaneGeometry(1, 1));
    this.glowMat = this._sm({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
      uniforms: { uT: this.T, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color(1, 0.06, 0.03) }, uC2: { value: new THREE.Color() } } });
    const gm = new THREE.InstancedMesh(bg, this.glowMat, glows.length);
    const aG = new Float32Array(glows.length * 4), aI = new Float32Array(glows.length);
    glows.forEach(([x, y, z, w, h, ph, kind], i) => { m4.makeTranslation(x, y, z); gm.setMatrixAt(i, m4); aG.set([w, h, ph, kind], i * 4); aI[i] = 0.4; });
    bg.setAttribute('aG', new THREE.InstancedBufferAttribute(aG, 4));
    this.aI = new THREE.InstancedBufferAttribute(aI, 1); this.aI.setUsage(THREE.DynamicDrawUsage); bg.setAttribute('aI', this.aI);
    gm.instanceMatrix.needsUpdate = true; gm.frustumCulled = false; gm.renderOrder = 7; lv.root.add(gm); this.glows = gm;
    // ---- pod bubbles
    const R = lv.R || Math.random, NB = low ? 10 : 22, bp = [], bb = [];
    for (const [x, z] of this.pods) for (let i = 0; i < NB; i++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.7;
      bp.push(x + Math.cos(a) * rr, 0, z + Math.sin(a) * rr); bb.push(R() * 3, 0.25 + R() * 0.55, 0.025 + R() * 0.05);
    }
    if (bp.length) {
      const pg = this._keep(new THREE.BufferGeometry());
      pg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); pg.setAttribute('aB', new THREE.Float32BufferAttribute(bb, 3));
      this.bubMat = this._sm({ vertexShader: BUB_VS, fragmentShader: BUB_FS, uniforms: { uT: this.T, uPx: { value: 520 }, uCol: { value: new THREE.Color() } } });
      const pts = new THREE.Points(pg, this.bubMat); pts.frustumCulled = false; pts.renderOrder = 4; lv.root.add(pts);
    }
  }

  _cellSet() { if (!this._cs) { this._cs = new Set(); for (const [c, r] of this.lv.floorCells || []) this._cs.add(c + ',' + r); } return this._cs; }
  _roomCells() {
    const S = this._cellSet(), out = [];
    for (const [c, r] of this.lv.floorCells || []) {
      const x = (c - 17) * 4, z = (r - 20) * 4; if (Math.max(Math.abs(x), Math.abs(z)) < 15) continue;
      let n = 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (S.has((c + a) + ',' + (r + b))) n++;
      if (n >= 3 && (c * 7 + r * 3) % 4 === 0) out.push([x, z]);
    }
    return out.slice(0, 7);
  }
  _lampSpots() {
    const S = this._cellSet(), out = [];
    for (const [c, r] of this.lv.floorCells || []) {
      const x = (c - 17) * 4, z = (r - 20) * 4; if (Math.max(Math.abs(x), Math.abs(z)) < 15) continue;
      if ((c + r * 2) % 3 !== 0) continue;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!S.has((c + a) + ',' + (r + b))) { out.push([x + a * 1.55, 4.25, z + b * 1.55]); break; }
    }
    return out.slice(0, 24);
  }

  // travelling pulses along the veins + failing-light flicker + red emergency strobe + wet floor sheen
  _patchShell() {
    const lv = this.lv, U = this.U;
    lv.floorMat.roughness = 0.34; lv.floorMat.metalness = 0.38; lv.floorMat.needsUpdate = true;
    const list = [[lv.wallMat, 0], [lv.floorMat, 1], [lv.ceilMat, 2]];
    for (const [m, kind] of list) {
      if (!m) continue;
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vL2W;')
          .replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 l2p = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    l2p = instanceMatrix * l2p;
  #endif
    vL2W = (modelMatrix * l2p).xyz; }`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
#define L2KIND ${kind}
varying vec3 vL2W; uniform float uL2T; uniform float uL2Emg; uniform vec3 uL2EmgCol; uniform float uL2Wet;
${NOISE}`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float uT = uL2T; vec2 P = vL2W.xz;
    float l2d = length(P);
    float l2w = pow(0.5 + 0.5 * sin(l2d * 0.42 - uT * 2.2 + vL2W.y * 0.2), 6.0);
    float l2w2 = pow(0.5 + 0.5 * sin(l2d * 0.12 - uT * 0.8), 3.0);
    totalEmissiveRadiance *= 0.35 + 1.75 * l2w + 0.55 * l2w2;
    vec2 l2c = floor(P * 0.125);
    float l2fl = step(0.8, l2h(l2c + 3.1)) * step(0.42, l2n(vec2(uT * 7.0, l2h(l2c) * 50.0)));
    totalEmissiveRadiance *= 1.0 - 0.85 * l2fl;
    float l2cor = smoothstep(14.5, 16.0, max(abs(P.x), abs(P.y)));
    float l2e = ${EMG};
    totalEmissiveRadiance += uL2EmgCol * (uL2Emg * l2cor * l2e) * (0.1 + diffuseColor.rgb * 2.5) * (0.35 + 0.65 * smoothstep(0.0, 4.6, vL2W.y));
  #if L2KIND == 1
    float l2fr = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
    float l2wet = smoothstep(0.35, 0.7, l2f(P * 0.35));
    totalEmissiveRadiance += emissive * ((0.1 + 0.6 * l2w) * l2fr * (0.3 + 0.7 * l2wet) * uL2Wet);
  #endif
  }`);
      };
      m.customProgramCacheKey = () => 'l2shell' + kind;
      m.needsUpdate = true;
    }
  }

  applyPal(c, u) {
    if (!this.shaftMat) return;
    const inv = u === 3;
    this.shaftMat.uniforms.uCol.value.copy(c.light); this.shaftMat.uniforms.uI.value = inv ? 0.05 : 0.4;
    this.shimMat.uniforms.uCol.value.copy(c.drive); this.shimMat.uniforms.uI.value = inv ? 0.0 : 0.45;
    for (const s of this.coreShim) { s.mat.uniforms.uCol.value.copy(s.o.active ? c.light : c.vein); s.mat.uniforms.uI.value = inv ? 0 : (s.o.active ? 0.55 : 0.18); }
    const mc = this.mistMat.uniforms.uCol.value;
    if (inv) mc.copy(c.fog).multiplyScalar(1.08); else mc.copy(c.fog).multiplyScalar(5.5).add(this._t.copy(c.vein).multiplyScalar(0.11));
    this.mistMat.uniforms.uA.value = inv ? 0.5 : 0.46;
    this.glowMat.uniforms.uC0.value.copy(c.light).multiplyScalar(inv ? 0 : 1);
    this.glowMat.uniforms.uC2.value.copy(c.vein).multiplyScalar(inv ? 0 : 0.55);
    this.glowMat.uniforms.uC1.value.setRGB(1, 0.06, 0.03).multiplyScalar(inv ? 0 : (u === 1 ? 0.7 : 1));
    if (this.bubMat) this.bubMat.uniforms.uCol.value.copy(c.spore).multiplyScalar(inv ? 0 : 0.6);
    this.U.uL2Emg.value = inv ? 0 : (u === 1 ? 0.7 : 1.2);
    this.U.uL2Wet.value = inv ? 0.2 : 1;
  }

  update(dt, t, hb) {
    if (!this.shaftMat) return;
    this.T.value = t; this.U.uL2T.value = t;
    const lv = this.lv, os = lv.coreObjs || [];
    for (let i = 0; i < os.length && i < 3; i++) this.aI.array[i] = os[i].active ? 1.1 + 0.25 * Math.sin(t * 9) + lv.boost * 0.4 : 0.22 + hb * 0.5;
    this.aI.array[os.length] = 0.35 + (lv.nCores || 0) * 0.2 + hb * 0.3 + (lv.driveDone ? 1.2 : 0) + lv.boost * 0.3;
    this.aI.needsUpdate = true;
    if (this.driveShim) { const s = 1 + 0.05 * Math.sin(t * 5) + hb * 0.08; this.driveShim.scale.set(s, 1, s); this.driveShim.rotation.y = t * 0.3; }
  }
}
L2Fx.prototype._t = new THREE.Color();

// Richer outside-universe vistas (painted once; zero per-frame cost). kind: 0 derelict, 1 crimson nebula, 2 crystal, 3 inverted void
export function paintBackdrop(kind, R) {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2; const g = c.getContext('2d'); g.scale(2, 2);
  const blob = (x, y, r, rgb, a) => { const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, `rgba(${rgb},${a})`); grd.addColorStop(0.45, `rgba(${rgb},${a * 0.45})`); grd.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2); };
  const band = (y0, amp) => (x) => y0 + Math.sin(x * 0.006 + 1.3) * amp + Math.sin(x * 0.017) * amp * 0.35;
  const neb = (cols, n, a, rmin, rmax, by, spread) => { g.globalCompositeOperation = 'lighter'; for (let i = 0; i < n; i++) { const x = R() * W, y = by(x) + (R() - 0.5) * spread; blob(x, y, rmin + R() * (rmax - rmin), cols[i % cols.length], a * (0.35 + R() * 0.65)); blob(x + W * (x < 200 ? 1 : x > W - 200 ? -1 : 0), y, rmin, cols[i % cols.length], 0); } g.globalCompositeOperation = 'source-over'; };
  const dust = (n, by, rgb, a) => { for (let i = 0; i < n; i++) { const x = R() * W, y = by(x) + (R() - 0.5) * 40; blob(x, y, 20 + R() * 70, rgb, a * (0.4 + R() * 0.6)); } };
  const stars = (n, rgb, glowRgb, big) => {
    for (let i = 0; i < n; i++) { const s = 0.5 + R() * 1.1; g.fillStyle = `rgba(${rgb},${0.3 + R() * 0.7})`; g.fillRect(R() * W, R() * H, s, s); }
    for (let i = 0; i < big; i++) {
      const x = R() * W, y = R() * H, r = 4 + R() * 10; blob(x, y, r * 2.2, glowRgb, 0.5);
      g.strokeStyle = `rgba(${glowRgb},.5)`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x - r * 2.5, y); g.lineTo(x + r * 2.5, y); g.moveTo(x, y - r * 2.5); g.lineTo(x, y + r * 2.5); g.stroke();
      g.fillStyle = `rgba(${rgb},1)`; g.fillRect(x - 1, y - 1, 2, 2);
    }
  };
  if (kind === 0) {
    g.fillStyle = '#010306'; g.fillRect(0, 0, W, H); const b = band(250, 50);
    neb(['20,70,80', '10,30,60', '40,90,90'], 40, 0.2, 30, 160, b, 160); dust(40, b, '1,3,6', 0.7); stars(1300, '220,240,255', '150,220,230', 14);
  } else if (kind === 1) {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#060003'); gr.addColorStop(0.5, '#1c0208'); gr.addColorStop(1, '#050002'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const b = band(256, 70);
    neb(['200,10,30', '255,70,30', '130,0,60', '255,30,50'], 58, 0.3, 25, 200, b, 210);
    neb(['255,170,110', '255,230,190'], 14, 0.3, 10, 60, b, 60);
    dust(110, b, '6,0,2', 0.8);
    blob(640, 230, 120, '255,60,30', 0.5); blob(640, 230, 40, '255,220,180', 0.9); // the crimson "eye"
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(640, 230, 7, 26, 0, 0, Math.PI * 2); g.fill();
    stars(900, '255,220,210', '255,120,90', 18);
  } else if (kind === 2) {
    g.fillStyle = '#010a12'; g.fillRect(0, 0, W, H); const b = band(240, 60);
    neb(['20,160,200', '80,240,255', '10,60,120', '150,255,255'], 50, 0.26, 30, 200, b, 200);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 110; i++) { // crystal shards / lattice filaments
      const x = R() * W, y = b(x) + (R() - 0.5) * 300, a = R() * Math.PI, L = 40 + R() * 260; g.strokeStyle = `rgba(140,240,255,${0.05 + R() * 0.16})`; g.lineWidth = R() < 0.2 ? 2 : 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L * 0.55); g.lineTo(x + Math.cos(a + 0.5) * L * 0.5, y + Math.sin(a + 0.5) * L * 0.3); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    const pg = g.createRadialGradient(680, 190, 10, 700, 200, 92); pg.addColorStop(0, '#f2ffff'); pg.addColorStop(0.6, '#3ab8d8'); pg.addColorStop(1, 'rgba(10,60,90,0)');
    g.fillStyle = pg; g.beginPath(); g.arc(700, 200, 92, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(190,250,255,.55)'; g.lineWidth = 3; g.beginPath(); g.ellipse(700, 200, 170, 26, -0.25, 0, Math.PI * 2); g.stroke();
    stars(1100, '190,250,255', '120,230,255', 22);
  } else {
    g.fillStyle = '#f1f1ee'; g.fillRect(0, 0, W, H); const b = band(260, 60);
    for (let i = 0; i < 60; i++) { const x = R() * W, y = b(x) + (R() - 0.5) * 200; blob(x, y, 30 + R() * 150, '30,30,34', 0.12 * (0.4 + R() * 0.6)); }
    for (let i = 0; i < 900; i++) { const s = 0.6 + R() * 1.4; g.fillStyle = `rgba(0,0,0,${0.3 + R() * 0.7})`; g.fillRect(R() * W, R() * H, s, s); }
    blob(380, 230, 130, '0,0,0', 0.35);
    g.fillStyle = '#000'; g.beginPath(); g.arc(380, 230, 46, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 3; g.beginPath(); g.ellipse(380, 230, 92, 16, 0.2, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 2; g.beginPath(); g.arc(380, 230, 64, 0, Math.PI * 2); g.stroke();
  }
  return c;
}
