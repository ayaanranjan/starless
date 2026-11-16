// Wraith (Ch.III): floating translucent shroud with trailing tendrils and two dim eyes. Phases through matter.
// NOTE: wraith.position is the body centre (~1.6m above ground), not the feet.
import * as THREE from 'three';
import { CreatureBase, acquireShared, mesh, group, damp, dampAngle, clamp, rand, fogShaderMaterial, GLSL_NOISE, validTarget, yawTo } from './common.js';

function buildShared() {
  const ribbon = new THREE.PlaneGeometry(1, 1, 3, 12); ribbon.translate(0, -0.5, 0);
  return { ribbon, core: new THREE.SphereGeometry(0.3, 14, 10), eye: new THREE.SphereGeometry(0.032, 8, 6) };
}
const VERT = `
uniform float uTime; uniform float uSeed; uniform float uAmp;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec3 p = position;
  float hang = 1.0 - uv.y;
  float w = uTime * 1.6 + uSeed * 6.2831;
  p.z += sin(w + hang * 5.0 + p.x * 3.0) * 0.22 * hang * uAmp + hang * hang * 0.35 * uAmp;
  p.x += sin(w * 0.73 + hang * 4.0 + uSeed * 3.0) * 0.14 * hang * uAmp;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `
uniform float uTime; uniform float uSeed; uniform float uFade; uniform vec3 uCore; uniform vec3 uEdge;
varying vec2 vUv;
${GLSL_NOISE}
void main(){
  float n = n3(vec3(vUv * vec2(3.0, 5.0) + vec2(uSeed * 7.0, -uTime * 0.7), uTime * 0.2));
  float ex = abs(vUv.x - 0.5) * 2.0;
  float a = (0.45 + 0.55 * n) * (1.0 - smoothstep(0.45, 1.0, ex + n * 0.35)) * smoothstep(0.0, 0.55, vUv.y + n * 0.2);
  vec3 col = mix(uCore, uEdge, smoothstep(0.25, 0.95, ex + (1.0 - vUv.y) * 0.45 * n));
  a *= uFade;
  if (a < 0.015) discard;
  gl_FragColor = vec4(col, a * 0.85);
  #include <fog_fragment>
}`;

const _p = new THREE.Vector3();

export class Wraith extends CreatureBase {
  constructor(ctx, opts) {
    super('wraith', ctx, opts);
    if (opts.position && opts.hoverFromFeet !== false) this.position.y += 1.6;
    this.home.copy(this.position);
    this.chase = opts.speed ?? 2.8; this.dmg = opts.damage ?? 20; this.range = 30 * this.aggr;
    const S = this.S = acquireShared('wraith', buildShared);
    const mk = (core, edge, amp) => fogShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSeed: { value: 0 }, uFade: { value: 1 }, uAmp: { value: amp }, uCore: { value: new THREE.Color(core) }, uEdge: { value: new THREE.Color(edge) } },
      vertex: VERT, fragment: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.shroudMat = mk(0x050308, 0x7a3cff, 1);
    this.tendrilMat = mk(0x07040c, 0xa070ff, 1.8);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x020104, transparent: true, opacity: 0.92, depthWrite: false });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.8, 1.25), transparent: true });
    this.mats = [this.shroudMat, this.tendrilMat, this.coreMat, this.eyeMat];
    const body = this.body = group(this.object);
    const core = mesh(S.core, this.coreMat, body, 0, 0.35, 0); core.scale.set(0.9, 1.25, 0.9); core.renderOrder = 1;
    this.eyes = [-1, 1].map((s) => mesh(S.eye, this.eyeMat, body, s * 0.085, 0.42, -0.25));
    this.shroud = [];
    for (let i = 0; i < 6; i++) {
      const m = mesh(S.ribbon, this.shroudMat, body, 0, 0.75, 0);
      m.rotation.y = (i / 6) * Math.PI; m.scale.set(rand(0.8, 1.15), rand(1.9, 2.4), 1); m.renderOrder = 2;
      m.onBeforeRender = this._seedFn(i * 0.137 + 0.1, this.shroudMat);
      this.shroud.push(m);
    }
    this.tendrils = group(body, 0, -0.1, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const m = mesh(S.ribbon, this.tendrilMat, this.tendrils, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
      m.rotation.y = a; m.scale.set(0.12, rand(2.0, 3.0), 1); m.renderOrder = 2;
      m.onBeforeRender = this._seedFn(i * 0.29 + 0.5, this.tendrilMat);
    }
    this.fade = 1; this.lit = 0; this.blinkT = rand(2, 5); this.blink = 0; this.shudder = 0;
    this.goal.copy(this.position); this.atkCd = 0; this.hitDone = false;
    this.setState('patrol');
    this.startLoop('wraith_hum', 0.6);
  }
  _seedFn(seed, mat) {
    return () => { mat.uniforms.uSeed.value = seed; mat.uniformsNeedUpdate = true; };
  }
  loopVolume() { return this.hidden ? 0 : (this.state === 'chase' || this.state === 'attack' ? 1 : 0.5); }
  onStateChange(prev, next) {
    if (next === 'flee') {
      try { this.ctx.fx?.burst?.(this.position.clone(), { count: 60, color: 0x8a5cff, speed: 3, life: 1.4, size: 0.14 }); } catch (e) { /* ignore */ }
      this.play('whisper', 1, 0.7);
    }
    if (next === 'stunned') { this.shudder = 1; this.play('screech', 0.5, 0.55); }
    if (next === 'chase' && prev === 'patrol') this.play('whisper', 0.7, 0.5);
    if (next === 'attack') this.onAttackAnim();
    if (prev === 'flee') this.fade = 0;
  }
  onAttackAnim() { this.shudder = 0.6; }
  hearNoise(pos, loudness = 0.5) {
    if (!this.isHost || this.hidden || !pos || this.state !== 'patrol') return;
    if (this.position.distanceTo(pos) <= (loudness || 0) * 20 * this.aggr) this.goal.set(pos.x, pos.y + 1.6, pos.z);
  }
  _hoverY(x, z, fallback) {
    let g = -Infinity;
    try { g = this.ctx.world?.groundHeight?.(x, z, fallback + 1) ?? -Infinity; } catch (e) { g = -Infinity; }
    return Number.isFinite(g) && g > fallback - 6 ? g + 1.6 : fallback;
  }
  _fly(tx, ty, tz, speed, dt) {
    _p.set(tx - this.position.x, ty - this.position.y, tz - this.position.z);
    const d = _p.length();
    if (d > 0.05) {
      _p.multiplyScalar(1 / d);
      this.yaw = dampAngle(this.yaw, yawTo(_p.x, _p.z), 3, dt);
    }
    const sp = d > 0.1 ? Math.min(speed, d * 2) : 0;
    this.vel.x = damp(this.vel.x, _p.x * sp, 2.5, dt); this.vel.y = damp(this.vel.y, _p.y * sp, 2.5, dt); this.vel.z = damp(this.vel.z, _p.z * sp, 2.5, dt);
    this.position.addScaledVector(this.vel, dt);
    return d;
  }
  think(dt) {
    this.atkCd -= dt;
    if (this.state !== 'flee' && this.state !== 'stunned') {
      _p.set(this.position.x, this.position.y + 0.2, this.position.z);
      if (this.litByAny(_p)) { this.lit += dt; if (this.lit >= 1) { this.lit = 0; this.setState('stunned'); } }
      else this.lit = Math.max(0, this.lit - dt * 0.35);
    }
    switch (this.state) {
      case 'idle': case 'patrol': case 'investigate': {
        const tgt = this.nearestPlayer(this.range);
        if (tgt) { this.target = tgt; this.setState('chase'); break; }
        const gy = this._hoverY(this.goal.x, this.goal.z, this.goal.y);
        const d = this._fly(this.goal.x, gy, this.goal.z, 1.2, dt);
        if (d < 1 || this.stateTime > 20) { this.nextPatrolPoint(this.goal); this.goal.y += this.patrol.length ? 1.6 : 0; this.stateTime = 0; }
        break;
      }
      case 'chase': {
        const tgt = this.target;
        if (!validTarget(tgt) || tgt.position.distanceTo(this.position) > this.range + 6) { this.target = this.nearestPlayer(this.range); if (!this.target) { this.setState('patrol'); break; } }
        const p = this.target.position;
        const d = this._fly(p.x, p.y + 1.45, p.z, this.chase, dt);
        if (d < 1.6 && this.atkCd <= 0) { this.atkCd = 1.5; this.hitDone = false; this.atkSeq++; this.setState('attack'); }
        break;
      }
      case 'attack': {
        const tgt = this.target;
        if (validTarget(tgt)) this._fly(tgt.position.x, tgt.position.y + 1.4, tgt.position.z, this.chase * 1.6, dt);
        if (!this.hitDone && this.stateTime > 0.25) { this.hitDone = true; if (validTarget(tgt) && tgt.position.distanceTo(this.position) < 2.4) this.hitPlayer(tgt, this.dmg); }
        if (this.stateTime > 0.6) this.setState('chase');
        break;
      }
      case 'stunned':
        this.vel.multiplyScalar(Math.exp(-6 * dt)); this.position.addScaledVector(this.vel, dt);
        if (this.stateTime > 0.45) { this.hidden = true; this.setState('flee'); }
        break;
      case 'flee':
        this.vel.set(0, 0, 0);
        if (this.stateTime > 6) {
          const pts = this.patrol.length ? this.patrol : [this.home];
          let best = pts[0], bestScore = -1;
          for (let i = 0; i < pts.length; i++) {
            const n = this.ctx.players ? this._nearestDist(pts[i]) : 99;
            const s = Math.min(n, 25) + Math.random() * 6;
            if (s > bestScore) { bestScore = s; best = pts[i]; }
          }
          this.position.set(best.x, best === this.home ? best.y : best.y + 1.6, best.z);
          this.goal.copy(this.position); this.hidden = false; this.target = null; this.setState('patrol');
        }
        break;
      default: this.setState('patrol');
    }
  }
  _nearestDist(pt) {
    let m = 999;
    for (const p of this.ctx.players.values()) if (p?.position) m = Math.min(m, p.position.distanceTo(pt));
    return m;
  }
  animate(dt) {
    const t = this.t, st = this.state;
    const want = this.hidden || st === 'flee' ? 0 : 1;
    this.fade = want ? Math.min(1, this.fade + dt * 0.8) : Math.max(0, this.fade - dt * 4);
    this.shudder = Math.max(0, this.shudder - dt * 1.5);
    const sh = this.shudder + (st === 'stunned' ? 1 : 0);
    const flick = sh > 0 ? (Math.random() < 0.4 ? 0.4 : 1) : 1;
    const spd = clamp(this.animSpeed, 0, 4);
    for (const m of [this.shroudMat, this.tendrilMat]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uFade.value = this.fade * flick;
    }
    this.shroudMat.uniforms.uAmp.value = 0.8 + spd * 0.35 + sh * 1.5;
    this.tendrilMat.uniforms.uAmp.value = 1.6 + spd * 0.4 + sh * 2;
    this.coreMat.opacity = 0.9 * this.fade * flick;
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkT = rand(1.5, 6); this.blink = 0.14; }
    this.blink -= dt;
    const glow = (st === 'chase' || st === 'attack' ? 1.6 : 0.9) * (0.85 + 0.15 * Math.sin(t * 7)) * this.fade;
    this.eyeMat.color.setRGB(0.8 * glow, 0.75 * glow, 1.2 * glow);
    this.eyeMat.opacity = this.blink > 0 ? 0 : this.fade;
    const B = this.body;
    B.position.y = Math.sin(t * 1.3) * 0.13;
    B.rotation.x = -spd * 0.07 + (sh ? rand(-0.1, 0.1) * sh : 0);
    B.rotation.z = Math.sin(t * 0.9) * 0.06 + (sh ? rand(-0.15, 0.15) * sh : 0);
    B.position.x = sh ? rand(-0.06, 0.06) * sh : 0;
    this.tendrils.rotation.x = spd * 0.14 + Math.sin(t * 0.7) * 0.05;
    this.tendrils.rotation.y += dt * 0.15;
    this.object.visible = this.fade > 0.01;
  }
  disposeOwn() { for (const m of this.mats) m.dispose(); }
}
