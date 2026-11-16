// Colossal decor: Leviathan (Ch.I sky) and Watcher (Ch.III eye cluster). Non-hostile, no AI sync.
import * as THREE from 'three';
import { CreatureBase, acquireShared, mesh, group, damp, clamp, rand, validTarget, localPlayer } from './common.js';

// ---------------- Leviathan ----------------
function spotsTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 260; i++) {
    const v = 0.3 + Math.random() * 0.4, y = v * 128, x = Math.random() * 256;
    const r = Math.random() < 0.15 ? 2.6 : 1.2;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.5);
    gr.addColorStop(0, 'rgba(160,255,240,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildLeviathanShared(ctx) {
  const tex = spotsTexture();
  const fogC = ctx?.scene?.fog?.color;
  const col = fogC ? fogC.clone().multiplyScalar(0.18) : new THREE.Color(0x0b0e0c);
  const body = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.05, emissive: 0x63ffe6, emissiveMap: tex, emissiveIntensity: 0.8, fog: false });
  const fin = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, fog: false, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
  const tent = limbDown(1.6, 0.15, 60, 7, 10);
  return { tex, body, fin, seg: new THREE.SphereGeometry(1, 20, 14), tent };
}
function limbDown(rt, rb, len, rad, hs) { const g = new THREE.CylinderGeometry(rt, rb, len, rad, hs); g.translate(0, -len / 2, 0); return g; }

const NSEG = 11, SPACING = 18;
const PROFILE = [9, 13, 15.5, 16, 15, 13, 11, 8.5, 6.5, 4.5, 3];

export class Leviathan extends CreatureBase {
  constructor(ctx, opts) {
    super('leviathan', ctx, opts);
    this.R = opts.radius ?? 320; this.speed = opts.speed ?? 9;
    const c = opts.center || opts.position;
    this.center = c && c.isVector3 ? c.clone() : new THREE.Vector3();
    // opts.center (+height, default 120) = circle centre; a bare opts.position = centre incl. altitude
    if (opts.height != null) this.H = opts.height;
    else if (!opts.center && opts.position && Math.abs(opts.position.y) > 1) this.H = 0;
    else this.H = 120;
    this.phase0 = opts.phase ?? 0;
    const S = this.S = acquireShared('leviathan', () => buildLeviathanShared(ctx));
    this.object.scale.setScalar(opts.scale ?? 1);
    this.segs = [];
    for (let i = 0; i < NSEG; i++) {
      const g = group(this.object, 0, 0, -100 + i * SPACING);
      const r = PROFILE[i];
      const m = mesh(S.seg, S.body, g); m.scale.set(r, r * 0.85, SPACING * 0.85);
      m.frustumCulled = false;
      this.segs.push(g);
    }
    const finL = mesh(S.seg, S.fin, this.segs[2], -20, -3, 2); finL.scale.set(22, 0.9, 7); finL.rotation.z = 0.35;
    const finR = mesh(S.seg, S.fin, this.segs[2], 20, -3, 2); finR.scale.set(22, 0.9, 7); finR.rotation.z = -0.35;
    const dorsal = mesh(S.seg, S.fin, this.segs[4], 0, 15, 4); dorsal.scale.set(0.9, 9, 12);
    this.fluke = mesh(S.seg, S.fin, this.segs[NSEG - 1], 0, 0, 12); this.fluke.scale.set(26, 0.9, 7);
    this.fins = [finL, finR];
    this.tents = [];
    for (let i = 0; i < 6; i++) {
      const g = group(this.segs[1 + (i >> 1)], (i % 2 ? 1 : -1) * rand(3, 7), -8, rand(-4, 4));
      const m = mesh(S.tent, S.body, g); m.frustumCulled = false;
      m.scale.setScalar(rand(0.7, 1.2));
      this.tents.push(g);
    }
    this.growlT = rand(12, 30);
    this.state = 'patrol';
  }
  getNetState() { return []; }
  setNetState() {}
  hearNoise() {}
  update(dt) {
    if (this.disposed) return;
    dt = Math.min(dt || 0, 0.1);
    this.t += dt;
    const T = Number.isFinite(this.ctx.time) ? this.ctx.time : this.t;
    const a = this.phase0 + T * this.speed / this.R;
    this.position.set(this.center.x + Math.cos(a) * this.R, this.center.y + this.H + Math.sin(T * 0.05) * 14, this.center.z + Math.sin(a) * this.R);
    this.yaw = Math.PI - a;
    this.object.rotation.set(Math.sin(T * 0.04) * 0.06, this.yaw, 0.12, 'YXZ');
    for (let i = 0; i < NSEG; i++) {
      const g = this.segs[i];
      const w = i / (NSEG - 1);
      g.position.x = Math.sin(i * 0.55 - T * 0.5) * (1 + w * 9);
      g.position.y = Math.sin(i * 0.38 - T * 0.33) * (0.5 + w * 4);
      const nx = Math.sin((i + 1) * 0.55 - T * 0.5) * (1 + (i + 1) / (NSEG - 1) * 9);
      g.rotation.y = Math.atan2(nx - g.position.x, SPACING);
    }
    this.fins[0].rotation.z = 0.35 + Math.sin(T * 0.6) * 0.25;
    this.fins[1].rotation.z = -0.35 - Math.sin(T * 0.6) * 0.25;
    this.fluke.rotation.x = Math.sin(T * 0.5) * 0.3;
    for (let i = 0; i < this.tents.length; i++) {
      const g = this.tents[i];
      g.rotation.x = -0.9 + Math.sin(T * 0.4 + i * 1.3) * 0.25;
      g.rotation.z = Math.sin(T * 0.31 + i) * 0.2;
    }
    this.S.body.emissiveIntensity = 0.6 + 0.35 * Math.sin(T * 0.7);
    this.growlT -= dt;
    if (this.growlT <= 0) {
      this.growlT = rand(28, 60);
      const lp = localPlayer(this.ctx);
      if (lp?.position) {
        const d = lp.position.distanceTo(this.position);
        const vol = clamp(1.1 * (1 - d / 900), 0.08, 0.7);
        const proxy = this.position.clone().sub(lp.position).setLength(Math.min(45, d)).add(lp.position);
        this.play('growl', vol, rand(0.45, 0.6), proxy);
      }
    }
  }
}

// ---------------- Watcher ----------------
function eyeTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d2b8'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = 'rgba(140,20,20,0.55)'; g.lineWidth = 1.2;
  for (let i = 0; i < 70; i++) {
    let x = Math.random() * 512, y = Math.random() < 0.5 ? rand(0, 60) : rand(196, 256);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += rand(-14, 14) + (384 - x) * 0.05; y += (128 - y) * 0.12 + rand(-6, 6); g.lineTo(x, y); }
    g.stroke();
  }
  const cx = 384, cy = 128;
  const ir = g.createRadialGradient(cx, cy, 4, cx, cy, 46);
  ir.addColorStop(0, '#2c0500'); ir.addColorStop(0.35, '#a8641a'); ir.addColorStop(0.8, '#5b2a06'); ir.addColorStop(1, '#120400');
  g.fillStyle = ir; g.beginPath(); g.arc(cx, cy, 46, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,200,120,0.25)';
  for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16); g.lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44); g.stroke(); }
  g.fillStyle = '#000'; g.beginPath(); g.ellipse(cx, cy, 9, 26, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildWatcherShared() {
  const tex = eyeTexture();
  const eye = new THREE.MeshBasicMaterial({ map: tex, fog: false });
  const flesh = new THREE.MeshStandardMaterial({ color: 0x0b0710, roughness: 0.45, metalness: 0.1, emissive: 0x1d0a33, emissiveIntensity: 0.6, fog: false });
  const core = new THREE.SphereGeometry(1, 32, 24);
  const pos = core.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const k = 1 + Math.sin(v.x * 5.1) * 0.08 + Math.sin(v.y * 6.3 + v.z * 3.1) * 0.07; v.multiplyScalar(k); pos.setXYZ(i, v.x, v.y, v.z); }
  core.computeVertexNormals();
  const tseg = new THREE.CylinderGeometry(0.6, 1, 1, 7, 3); tseg.translate(0, 0.5, 0);
  return { tex, eye, flesh, core, tseg, eyeG: new THREE.SphereGeometry(1, 24, 16) };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class Watcher extends CreatureBase {
  constructor(ctx, opts) {
    super('watcher', ctx, opts);
    const S = this.S = acquireShared('watcher', buildWatcherShared);
    const sc = (opts.scale ?? 1);
    this.object.scale.setScalar(sc);
    const look = opts.lookAt || new THREE.Vector3(0, 0, 0);
    this.object.rotation.y = this.yaw = Math.atan2(-(look.x - this.position.x), -(look.z - this.position.z));
    this.mass = group(this.object, 0, 32, 0);
    const core = mesh(S.core, S.flesh, this.mass); core.scale.set(13, 15, 12); core.frustumCulled = false;
    this.tendrils = [];
    for (let i = 0; i < 9; i++) {
      const up = i >= 6;
      const a = (i / (up ? 3 : 6)) * Math.PI * 2 + rand(-0.3, 0.3);
      const root = group(this.mass, Math.cos(a) * 9, up ? 8 : -6, Math.sin(a) * 8);
      root.rotation.set(up ? rand(-0.4, 0.4) : Math.PI - rand(0.4, 0.8), a, 0, 'YXZ');
      const segs = []; let parent = root, r = up ? 2.2 : 3;
      for (let k = 0; k < 3; k++) {
        const len = up ? 9 : 11;
        const sg = group(parent, 0, k === 0 ? 0 : len, 0);
        const m = mesh(S.tseg, S.flesh, sg); m.scale.set(r, len, r); m.frustumCulled = false;
        segs.push(sg); parent = sg; r *= 0.62;
      }
      this.tendrils.push({ root, segs, seed: rand(0, 10), up });
    }
    const N = opts.eyes ?? 16;
    this.eyeMesh = new THREE.InstancedMesh(S.eyeG, S.eye, N);
    this.eyeMesh.frustumCulled = false;
    this.object.add(this.eyeMesh);
    this.eyes = [];
    for (let i = 0; i < N; i++) {
      const big = i === 0;
      const th = big ? 0 : rand(0.25, 1.25), ph = rand(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph) * 1.1, -Math.cos(th)).normalize();
      const size = big ? 5.5 : rand(1.2, 3.6);
      const p = dir.clone().multiply(new THREE.Vector3(13, 15, 12)).multiplyScalar(0.93).add(new THREE.Vector3(0, 32, 0));
      this.eyes.push({ p, size, q: new THREE.Quaternion(), rate: rand(0.6, 2.6), sacc: new THREE.Vector3(), saccT: rand(0, 3), blinkT: rand(1, 9), blink: 1, jit: rand(0, 10) });
      this.eyeMesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    this.enraged = false; this.rage = 0;
    this.state = 'idle';
    this.object.updateMatrixWorld(true);
  }
  enrage(on = true) { this.enraged = !!on; }
  disposeOwn() { try { this.eyeMesh.dispose(); } catch (e) { /* ignore */ } }
  getNetState() { return [this.enraged ? 1 : 0]; }
  setNetState(a) { if (Array.isArray(a) && a.length) this.enraged = a[0] === 1; }
  hearNoise() {}
  update(dt) {
    if (this.disposed) return;
    dt = Math.min(dt || 0, 0.1);
    this.t += dt;
    const t = this.t, R = this.enraged;
    this.rage = damp(this.rage, R ? 1 : 0, 1.5, dt);
    // target: nearest valid player (world -> local)
    let tgt = null, best = Infinity;
    if (this.ctx.players) for (const p of this.ctx.players.values()) { if (!validTarget(p)) continue; const d = p.position.distanceToSquared(this.position); if (d < best) { best = d; tgt = p; } }
    if (tgt) { _t.set(tgt.position.x, tgt.position.y + 1.6, tgt.position.z); this.object.worldToLocal(_t); }
    else _t.set(0, 20, -200);
    // body sway
    this.mass.rotation.z = Math.sin(t * 0.12) * 0.04 + (R ? Math.sin(t * 9) * 0.01 : 0);
    this.mass.rotation.x = Math.sin(t * 0.09) * 0.03;
    for (const T of this.tendrils) {
      for (let k = 0; k < 3; k++) {
        const sg = T.segs[k], amp = (0.12 + k * 0.08) * (1 + this.rage * 1.5), sp = 0.25 + this.rage * 0.9;
        sg.rotation.x = (k ? 0.25 : 0) + Math.sin(t * sp + T.seed + k * 0.9) * amp;
        sg.rotation.z = Math.sin(t * sp * 0.8 + T.seed * 1.7 + k) * amp;
      }
    }
    this.S.flesh.emissiveIntensity = 0.45 + 0.25 * Math.sin(t * 0.8) + this.rage * 0.8;
    // eyes
    for (let i = 0; i < this.eyes.length; i++) {
      const E = this.eyes[i];
      E.saccT -= dt;
      if (E.saccT <= 0) { E.saccT = R ? rand(0.1, 0.5) : rand(0.8, 4); E.sacc.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(R ? 6 : 3); }
      _s.copy(_t).add(E.sacc);
      _m.lookAt(E.p, _s, UP);
      _q.setFromRotationMatrix(_m);
      E.q.slerp(_q, 1 - Math.exp(-(E.rate * (R ? 3 : 1)) * dt));
      E.blinkT -= dt;
      if (E.blinkT <= 0) { E.blinkT = rand(2, 10) * (R ? 0.4 : 1); E.blink = 0; }
      if (E.blink < 1) E.blink = Math.min(1, E.blink + dt / 0.22);
      const close = E.blink < 1 ? Math.sin(E.blink * Math.PI) : 0;
      _q.copy(E.q);
      if (R) { _e.set(rand(-0.07, 0.07), rand(-0.07, 0.07), 0); _q2.setFromEuler(_e); _q.multiply(_q2); }
      _s.set(E.size, E.size * (1 - close * 0.92), E.size);
      _m.compose(E.p, _q, _s);
      this.eyeMesh.setMatrixAt(i, _m);
      const pulse = 0.85 + 0.25 * Math.sin(t * 1.3 + E.jit);
      _c.setRGB(1 + this.rage * 0.9, 1 - this.rage * 0.75, 1 - this.rage * 0.8).multiplyScalar(pulse);
      this.eyeMesh.setColorAt(i, _c);
    }
    this.eyeMesh.instanceMatrix.needsUpdate = true;
    if (this.eyeMesh.instanceColor) this.eyeMesh.instanceColor.needsUpdate = true;
  }
}
